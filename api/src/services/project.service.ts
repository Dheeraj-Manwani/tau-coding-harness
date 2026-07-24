import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import * as projectRepo from "../repositories/project.repository";
import { getNextSequence } from "../lib/sequence";
import { enqueueJob } from "../lib/queue";
import { deepseek } from "../lib/deepseek";
import { env } from "../lib/env";
import { Errors } from "../lib/errors";
import {
  reserveInTx,
  ensureBillingAccount,
  lockAccount,
  settle,
  InsufficientCreditsError,
  ConcurrentJobLimitError,
} from "../lib/credits";
import { FREE_PLAN_MAX_PROJECTS } from "../lib/pricing";
import { getBlobText, deleteProjectBlobs, presignGet } from "../lib/s3";
import {
  writeProjectFile,
  buildEditDiff,
  sha256Hex,
  toWorkdirPath,
} from "../lib/projectFiles";
import { bus } from "../lib/bus";
import {
  attachmentBlock,
  waitForExtraction,
  type ResolvedAttachment,
} from "../lib/attachments";
import {
  MessageRole,
  MessageType,
  JobType,
  JobStatus,
  HoldStatus,
  SandboxStatus,
  Plan,
} from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import type { Effort } from "../generated/prisma/enums";

const MAX_NAME_LENGTH = 80;

function clampName(name: string): string {
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
    : name;
}

function deriveProjectName(message: string): string {
  const firstLine = message.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "Untitled project";
  return clampName(firstLine);
}

async function generateProjectName(message: string): Promise<string> {
  if (!deepseek) return deriveProjectName(message);
  try {
    const completion = await deepseek.chat.completions.create({
      model: env.DEEPSEEK_MODEL,
      temperature: 0.3,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "You generate concise names for software projects. Given the user's first request, reply with ONLY a short, descriptive title of 2-4 words in Title Case. No quotes, no trailing punctuation, no explanation. If the request is unclear, empty, or doesn't make sense, default to 'New Project' as the name.",
        },
        { role: "user", content: message },
      ],
    });

    const raw = completion.choices[0]?.message.content?.trim();
    if (!raw) return deriveProjectName(message);

    const name = raw.replace(/^["']|["']$/g, "").trim();
    return name ? clampName(name) : deriveProjectName(message);
  } catch (err) {
    console.error("DeepSeek project naming failed; using fallback", err);
    return deriveProjectName(message);
  }
}

/**
 * Build the content-block array for a USER message. Attachment text is
 * materialized in here rather than resolved later, which is what lets the
 * worker's `loadHistory()` stay untouched — it hands `Message.content` straight
 * to the completions API, so every block must be a valid content part.
 *
 * Call this BEFORE opening the write transaction; it can block for up to
 * `EXTRACTION_WAIT_MS`.
 */
async function buildUserMessage(
  userId: string,
  text: string,
  attachmentIds: string[],
): Promise<{
  content: Prisma.InputJsonValue;
  resolved: ResolvedAttachment[];
}> {
  const blocks: { type: "text"; text: string }[] = [];
  if (text.trim().length > 0) blocks.push({ type: "text", text });

  if (attachmentIds.length === 0) {
    return { content: blocks, resolved: [] };
  }
  if (attachmentIds.length > env.ATTACHMENT_MAX_PER_MESSAGE) {
    throw Errors.badRequest("TOO_MANY_ATTACHMENTS");
  }

  let resolved: ResolvedAttachment[];
  try {
    resolved = await waitForExtraction(userId, attachmentIds);
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "ATTACHMENT_NOT_FOUND") throw Errors.notFound(code);
    if (code === "ATTACHMENT_FORBIDDEN") throw Errors.forbidden(code);
    if (code === "ATTACHMENT_ALREADY_USED") throw Errors.conflict(code);
    throw err;
  }

  for (const a of resolved) {
    blocks.push({ type: "text", text: attachmentBlock(a) });
  }

  // Without this an attachment-only message reads as a bare document dump. It
  // goes LAST on purpose: the transcript treats block 0 as the user's own
  // words, so leading with it renders our instruction as their chat bubble.
  if (blocks.length === resolved.length) {
    blocks.push({
      type: "text",
      text: "The user sent the attached content without a message. Respond to it.",
    });
  }

  return { content: blocks, resolved };
}

/** The `messageId: null` guard makes this a no-op if a concurrent request
 *  claimed the attachments first. */
async function linkAttachments(
  tx: Prisma.TransactionClient,
  attachmentIds: string[],
  messageId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return;
  await tx.attachment.updateMany({
    where: { id: { in: attachmentIds }, messageId: null },
    data: { messageId },
  });
}

/** Job.prompt is informational — the loop reads history, not this — but it
 *  shows up in logs, so keep it honest about what was sent. */
function promptWithAttachments(
  text: string,
  resolved: ResolvedAttachment[],
): string {
  if (resolved.length === 0) return text;
  const names = resolved.map((a) => a.filename).join(", ");
  return text.trim().length > 0 ? `${text}\n\n[Attached: ${names}]` : `[Attached: ${names}]`;
}

export interface InitializeProjectResult {
  projectId: string;
  jobId: string;
}

export async function initializeProject(
  userId: string,
  message: string,
  effort: Effort,
  attachmentIds: string[] = [],
): Promise<InitializeProjectResult> {
  // Before the transaction — this can block on extraction. When the user sent
  // an image with no words, name off the extracted text instead.
  const { content, resolved } = await buildUserMessage(
    userId,
    message,
    attachmentIds,
  );
  const name = await generateProjectName(
    message.trim().length > 0
      ? message
      : (resolved[0]?.extractedText?.slice(0, 2_000) ?? message),
  );

  const { projectId, jobId } = await prisma.$transaction(async (tx) => {
    const account = await ensureBillingAccount(userId, tx);
    if (account.plan === Plan.FREE) {
      await lockAccount(tx, userId);
      const projectCount = await projectRepo.countProjectsByUser(userId, tx);
      if (projectCount >= FREE_PLAN_MAX_PROJECTS) {
        throw Errors.forbidden("PROJECT_LIMIT_REACHED");
      }
    }

    const project = await projectRepo.createProject(tx, {
      name,
      userId,
    });

    const job = await projectRepo.createJob(tx, {
      projectId: project.id,
      prompt: promptWithAttachments(message, resolved),
      type: JobType.GENERATION,
      effort,
    });

    if (env.CREDITS_ENFORCE) {
      try {
        await reserveInTx(tx, userId, job.id, {
          maxConcurrentJobs: env.CREDITS_MAX_CONCURRENT_JOBS,
          effort,
        });
      } catch (err) {
        if (err instanceof ConcurrentJobLimitError) {
          throw Errors.tooMany("CONCURRENT_JOB_LIMIT");
        }
        if (err instanceof InsufficientCreditsError) {
          throw Errors.paymentRequired("INSUFFICIENT_CREDITS");
        }
        throw err;
      }
    }

    const sequence = await getNextSequence(tx, project.id);
    const userMessage = await projectRepo.createMessage(tx, {
      projectId: project.id,
      role: MessageRole.USER,
      type: MessageType.USER,
      content,
      sequence,
    });
    await linkAttachments(tx, attachmentIds, userMessage.id);

    return { projectId: project.id, jobId: job.id };
  });

  const queueJobId = await enqueueJob({
    jobId,
    projectId,
    userId,
    prompt: promptWithAttachments(message, resolved),
    effort,
  });
  await projectRepo.setJobQueueId(jobId, queueJobId);

  return { projectId, jobId };
}

export interface AddMessageResult {
  jobId: string;
}

export async function addMessage(
  projectId: string,
  userId: string,
  text: string,
  effort: Effort,
  attachmentIds: string[] = [],
): Promise<AddMessageResult> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  // Before the transaction — this can block on an in-flight extraction.
  const { content, resolved } = await buildUserMessage(
    userId,
    text,
    attachmentIds,
  );
  const prompt = promptWithAttachments(text, resolved);

  const jobId = await prisma.$transaction(
    async (tx) => {
      const active = await projectRepo.findActiveJob(projectId, tx);
      if (active) throw Errors.conflict("generation in progress");

      const job = await projectRepo.createJob(tx, {
        projectId,
        prompt,
        type: JobType.GENERATION,
        effort,
      });

      if (env.CREDITS_ENFORCE) {
        try {
          await reserveInTx(tx, userId, job.id, {
            maxConcurrentJobs: env.CREDITS_MAX_CONCURRENT_JOBS,
            effort,
          });
        } catch (err) {
          if (err instanceof ConcurrentJobLimitError) {
            throw Errors.tooMany("CONCURRENT_JOB_LIMIT");
          }
          if (err instanceof InsufficientCreditsError) {
            throw Errors.paymentRequired("INSUFFICIENT_CREDITS");
          }
          throw err;
        }
      }

      const sequence = await getNextSequence(tx, projectId);
      const userMessage = await projectRepo.createMessage(tx, {
        projectId,
        role: MessageRole.USER,
        type: MessageType.USER,
        content,
        sequence,
      });
      await linkAttachments(tx, attachmentIds, userMessage.id);

      return job.id;
    },
    { isolationLevel: "Serializable" },
  );

  const queueJobId = await enqueueJob({
    jobId,
    projectId,
    userId,
    prompt,
    effort,
  });
  await projectRepo.setJobQueueId(jobId, queueJobId);

  return { jobId };
}

const PREVIEW_LIVENESS_TIMEOUT_MS = 8_000;

export async function getPreviewStatus(
  projectId: string,
  userId: string,
): Promise<{ alive: boolean }> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  if (!project.sandboxId || project.sandboxStatus !== SandboxStatus.READY) {
    return { alive: false };
  }

  try {
    const sandbox = await Sandbox.connect(project.sandboxId);
    await sandbox.commands.run("true", {
      timeoutMs: PREVIEW_LIVENESS_TIMEOUT_MS,
    });
    return { alive: true };
  } catch {
    // Sandbox is gone. Clear the stale status so future reads short-circuit.
    await prisma.project
      .update({
        where: { id: projectId },
        data: { sandboxStatus: SandboxStatus.DEAD },
      })
      .catch(() => {});
    return { alive: false };
  }
}

export interface RestartPreviewResult {
  jobId: string;
}

/** Queue a provision-only PREVIEW job that reboots the sandbox from persisted
 *  files and streams the fresh URL back over the normal job event stream. */
export async function restartPreview(
  projectId: string,
  userId: string,
): Promise<RestartPreviewResult> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const jobId = await prisma.$transaction(
    async (tx) => {
      const active = await projectRepo.findActiveJob(projectId, tx);
      if (active) throw Errors.conflict("generation in progress");

      // Nothing to rehydrate a sandbox from — the project has never been built.
      const fileCount = await tx.projectFile.count({ where: { projectId } });
      if (fileCount === 0) {
        throw Errors.badRequest("Nothing to preview yet");
      }

      const job = await projectRepo.createJob(tx, {
        projectId,
        prompt: "",
        type: JobType.PREVIEW,
      });

      return job.id;
    },
    { isolationLevel: "Serializable" },
  );

  // No credit reserve: preview restarts are free (no LLM calls, no metering).
  const queueJobId = await enqueueJob({
    jobId,
    projectId,
    userId,
    prompt: "",
    effort: "LOW",
    type: JobType.PREVIEW,
  });
  await projectRepo.setJobQueueId(jobId, queueJobId);

  return { jobId };
}

export async function listProjects(
  userId: string,
  opts: { cursor?: string; limit: number },
) {
  const { projects, nextCursor } = await projectRepo.listProjectsByUser(
    userId,
    opts,
  );

  return {
    projects: await Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name,
        sandboxStatus: p.sandboxStatus,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        previewImageUrl: p.previewImageKey
          ? await presignGet(p.previewImageKey)
          : null,
      })),
    ),
    nextCursor,
  };
}

export async function getProject(projectId: string, userId: string) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const [messages, latestFragment, activeJob] = await Promise.all([
    projectRepo.findRecentMessages(projectId, 50),
    projectRepo.findLatestFragment(projectId),
    projectRepo.findActiveJob(projectId),
  ]);

  const checkpoints = messages.length
    ? await projectRepo.findCheckpointsInRange(
        projectId,
        messages[0]!.sequence,
        messages[messages.length - 1]!.sequence,
      )
    : [];

  return {
    project,
    messages,
    latestFragment,
    activeJobId: activeJob?.id ?? null,
    activeJobEventIndex: activeJob ? bus.headIndex(activeJob.id) : null,
    checkpoints,
  };
}

export async function listMessages(
  projectId: string,
  userId: string,
  opts: { cursor?: string; before?: number; limit: number },
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  if (opts.before !== undefined) {
    const result = await projectRepo.findMessagesBefore(
      projectId,
      opts.before,
      opts.limit,
    );
    const checkpoints = result.messages.length
      ? await projectRepo.findCheckpointsInRange(
          projectId,
          result.messages[0]!.sequence,
          result.messages[result.messages.length - 1]!.sequence,
        )
      : [];
    return { ...result, checkpoints };
  }

  return projectRepo.listMessages(projectId, opts);
}

export async function getProjectTree(projectId: string, userId: string) {
  const project = await projectRepo.findProjectWithTree(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  return {
    files: project.files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes })),
    headSequence: project.headSequence,
  };
}

export async function submitJobAnswer(
  projectId: string,
  jobId: string,
  userId: string,
  answer: string,
): Promise<void> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId)
    throw Errors.forbidden("You do not have access to this project");

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.projectId !== projectId)
    throw Errors.notFound("Job not found");
  if (job.status !== "RUNNING")
    throw Errors.conflict("Job is not waiting for a response");

  bus.pushUserResponse(jobId, answer);
}

/**
 * Free every concurrent-job slot the user is holding.
 *
 * The {@link ConcurrentJobLimitError} 429 is gated on the count of ACTIVE credit
 * holds — NOT on live jobs — so this targets the holds directly. A hold can
 * outlive its job (the worker crashed mid-run, or a terminal frame never
 * settled it), leaving phantom concurrency that no `bus.requestCancel` can clear
 * because there is no running job to cancel. For each ACTIVE hold:
 *   - if its job is still QUEUED/RUNNING, signal a cancel (as the single-job
 *     stop button does) and let the worker flip the job to CANCELLED + settle
 *     the hold;
 *   - otherwise the hold is stuck behind an already-terminal job, so settle it
 *     here so the slot frees immediately.
 *
 * Returns how many holds were freed so the caller can report whether anything
 * was actually blocking.
 */
export async function cancelAllActiveJobs(userId: string): Promise<number> {
  const holds = await prisma.creditHold.findMany({
    where: { userId, status: HoldStatus.ACTIVE },
    select: { jobId: true },
  });
  if (holds.length === 0) return 0;

  const jobs = await prisma.job.findMany({
    where: { id: { in: holds.map((h) => h.jobId) } },
    select: { id: true, status: true },
  });
  const statusByJobId = new Map(jobs.map((j) => [j.id, j.status]));

  for (const { jobId } of holds) {
    const status = statusByJobId.get(jobId);
    if (status === JobStatus.QUEUED || status === JobStatus.RUNNING) {
      // Live job — the worker settles the hold as it tears the run down.
      bus.requestCancel(jobId);
    } else {
      // Stuck hold (terminal or missing job) — settle directly. Idempotent, and
      // pay-as-you-go means this only clears the concurrency slot, never refunds.
      await settle(jobId);
    }
  }
  return holds.length;
}

export async function deleteProject(
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  // Delete R2 blobs first; if this fails we abort before touching the DB.
  await deleteProjectBlobs(userId, projectId);
  await projectRepo.deleteProject(projectId);
}

/**
 * Resolve a file's current content, sandbox-first with an R2 fallback.
 *
 * The returned `contentHash` is the hash of the content actually served, which
 * is NOT always the manifest's `contentHash`: a `run_command` that rewrites a
 * file (a build step, `bun add` touching package.json) changes the sandbox
 * without going through `persistFile`. Callers doing optimistic concurrency
 * must therefore compare against *this* hash, resolved the same way, rather
 * than against the manifest — otherwise a legitimately diverged sandbox would
 * reject every save.
 */
async function readProjectFileContent(
  project: { id: string; sandboxId: string | null; sandboxStatus: SandboxStatus },
  userId: string,
  filePath: string,
): Promise<{ content: string; contentHash: string }> {
  // Sandbox-first: return live content when sandbox is up.
  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      const sandbox = await Sandbox.connect(project.sandboxId);
      const content = await sandbox.files.read(toWorkdirPath(filePath));
      return { content, contentHash: sha256Hex(content) };
    } catch {
      // Sandbox unreachable — fall through to R2 blob.
    }
  }

  // R2 blob fallback via manifest hash.
  const record = await projectRepo.findProjectFileRecord(project.id, filePath);
  if (!record) throw Errors.notFound("File not found");

  const content = await getBlobText(userId, project.id, record.contentHash);
  return { content, contentHash: record.contentHash };
}

export async function getProjectFile(
  projectId: string,
  userId: string,
  filePath: string,
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  return readProjectFileContent(project, userId, filePath);
}

/** Max source-file size accepted from the editor. */
const MAX_EDIT_BYTES = 1_000_000;

/**
 * Persist a manual edit the user made in the code editor.
 *
 * Writes the live sandbox (best-effort) + R2 + the ProjectFile manifest, and
 * records a hidden USER_EDIT message so the agent learns about the change on
 * its next turn without the edit appearing in the chat transcript.
 *
 * See doc/USER_CODE_EDITING.md.
 */
export async function saveProjectFile(
  projectId: string,
  userId: string,
  filePath: string,
  content: string,
  baseHash?: string,
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  // The agent writes these same files. Rather than race it, refuse while a job
  // is live — mirrors addMessage's "generation in progress" conflict.
  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  // v1 edits existing files only; creating/renaming from the editor is not
  // supported, so the path must already be in the manifest.
  const record = await projectRepo.findProjectFileRecord(projectId, filePath);
  if (!record) throw Errors.notFound("File not found");

  if (Buffer.byteLength(content, "utf-8") > MAX_EDIT_BYTES) {
    throw Errors.badRequest("File is too large to save");
  }
  if (content.includes("\0")) {
    throw Errors.badRequest("Binary files can't be edited");
  }

  const before = await readProjectFileContent(project, userId, filePath);

  if (baseHash && baseHash !== before.contentHash) {
    throw Errors.conflict("file changed since it was opened");
  }

  if (before.contentHash === sha256Hex(content)) {
    return { contentHash: before.contentHash, headSequence: project.headSequence };
  }

  // Sandbox first: it's what readProjectFileContent serves back, so writing it
  // before the manifest means a read-after-write can't show stale content. A
  // failure here is not fatal — R2 + the manifest are the durable truth and the
  // next provisionSandbox rehydrates from them.
  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      const sandbox = await Sandbox.connect(project.sandboxId);
      await sandbox.files.write(toWorkdirPath(filePath), content);
    } catch (err) {
      console.warn(
        `[projectFile] sandbox write failed for ${projectId}:${filePath}`,
        err,
      );
    }
  }

  const result = await writeProjectFile(
    projectId,
    userId,
    filePath,
    content,
    {
      inTransaction: (tx) =>
        recordUserEdit(tx, {
          projectId,
          userId,
          filePath,
          before: before.content,
          beforeHash: before.contentHash,
          after: content,
        }),
    },
  );

  return {
    contentHash: result.contentHash,
    headSequence: result.headSequence ?? project.headSequence,
  };
}

/**
 * Write (or coalesce into) the hidden USER_EDIT message for an edit.
 *
 * Consecutive saves to the same file with nothing else in between collapse into
 * a single row, re-diffed against the *original* base so the model sees one
 * coherent change rather than a save-by-save replay. Coalescing is skipped when
 * the original base content can't be recovered from R2.
 */
async function recordUserEdit(
  tx: Prisma.TransactionClient,
  args: {
    projectId: string;
    userId: string;
    filePath: string;
    before: string;
    beforeHash: string;
    after: string;
  },
): Promise<void> {
  const { projectId, userId, filePath, before, beforeHash, after } = args;

  const latest = await tx.message.findFirst({
    where: { projectId },
    orderBy: { sequence: "desc" },
    select: { id: true, type: true, content: true },
  });

  const prior =
    latest?.type === MessageType.USER_EDIT
      ? (latest.content as unknown as StoredUserEdit)
      : null;

  if (prior && prior.path === filePath) {
    // Re-diff from the run's original base so the row stays a single change.
    const base = await recoverBaseContent(userId, projectId, prior.baseHash);
    if (base !== null) {
      const diff = buildEditDiff(filePath, base, after);
      await tx.message.update({
        where: { id: latest!.id },
        data: {
          content: {
            path: filePath,
            baseHash: prior.baseHash,
            ...diff,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }
  }

  const diff = buildEditDiff(filePath, before, after);
  const sequence = await getNextSequence(tx, projectId);
  await projectRepo.createMessage(tx, {
    projectId,
    role: MessageRole.USER,
    type: MessageType.USER_EDIT,
    content: { path: filePath, baseHash: beforeHash, ...diff },
    sequence,
  });
}

interface StoredUserEdit {
  path: string;
  baseHash: string;
  diff: string;
  truncated: boolean;
  linesAdded: number;
  linesRemoved: number;
}

/** Blobs are content-addressed and immutable, so a base hash is enough to get
 *  the exact bytes back — unless it was never blobbed (a sandbox-only version,
 *  e.g. a file a build step rewrote). Returns null in that case. */
async function recoverBaseContent(
  userId: string,
  projectId: string,
  hash: string,
): Promise<string | null> {
  try {
    return await getBlobText(userId, projectId, hash);
  } catch {
    return null;
  }
}
