import { createHash } from "node:crypto";
import { publicSiteUrl } from "@/lib/sites";
import { findShowcaseSites } from "../repositories/showcase.repository";
import { createProjectArchive } from "../lib/projectArchive";
import { Sandbox } from "e2b";
import { prisma } from "@/lib/prisma";
import * as projectRepo from "../repositories/project.repository";
import { getContextUsage } from "./context.service";
import { getNextSequence } from "@/lib/sequence";
import { enqueueJob } from "../lib/queue";
import { deepseek } from "@/lib/deepseek";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import {
  reserveInTx,
  ensureBillingAccount,
  lockAccount,
  settle,
  InsufficientCreditsError,
  ConcurrentJobLimitError,
} from "@/lib/credits";
import { FREE_PLAN_MAX_PROJECTS } from "@/lib/pricing";
import { deleteStoragePrefix, projectStoragePrefix, storageConfigured } from "@/lib/storageBucket";
import { revokeStorageKeys } from "@/lib/storageKeys";
import {
  getBlobText,
  getBlob,
  deleteProjectBlobs,
  presignGet,
  blobKey,
} from "@/lib/s3";
import {
  writeProjectFile,
  writeProjectBinaryFile,
  buildEditDiff,
  sha256Hex,
  toWorkdirPath,
  isBinaryPath,
  isSecretPath,
} from "../lib/projectFiles";
import {
  applyVisualEdit,
  parseLoc,
  type VisualEditOp,
} from "../lib/visualEdit";
import {
  applyThemeEdit,
  readThemeTokens,
  type ThemeScope,
} from "../lib/themeEdit";
import { fetchImageAsset, slugifyAssetName } from "../lib/assetImport";
import { bus } from "@/lib/bus";
import { terminateStrandedJob } from "../lib/jobs";
import { pendingSecretFields } from "./projectSecret.service";
import {
  attachmentBlock,
  waitForExtraction,
  type ResolvedAttachment,
} from "../lib/attachments";
import {
  buildErrorBlock,
  runtimeErrorBlock,
  visualContextBlock,
  type BuildErrorContext,
  type RuntimeErrorContext,
  type VisualContext,
} from "../lib/visualContext";
import {
  MessageRole,
  MessageType,
  FinishReason,
  JobType,
  JobStatus,
  ToolCallStatus,
  HoldStatus,
  SandboxStatus,
  Plan,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeDesignConfig } from "@/worker/design/config";
import { readPreferences } from "../schemas/preferences.schema";
import { syncDesignAfterThemeEdit } from "./design.service";
import { removeSite } from "@/lib/edgeRegistry";
import { releaseProjectDomains } from "./domain.service";
import { removeBackend } from "@/lib/lambdaApps";
import { scheduleDatabaseRemoval } from "@/lib/neonApps";
import { invalidateSiteLookup } from "../lib/siteLookup";
import type { Effort } from "@/generated/prisma/enums";

const MAX_NAME_LENGTH = 48;
const MAX_NAME_WORDS = 4;

const LEADING_REQUEST_WORDS = new Set([
  "a",
  "an",
  "build",
  "create",
  "develop",
  "design",
  "for",
  "make",
  "me",
  "please",
  "the",
]);

function clampName(name: string): string {
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
    : name;
}

/** Keep provider output usable even if it ignores the requested format. */
export function normalizeProjectName(name: string): string {
  const firstLine = name.split(/\r?\n/)[0]?.trim() ?? "";
  const withoutPrefix = firstLine.replace(
    /^(?:project\s+)?(?:name|title)\s*:\s*/i,
    "",
  );
  // Strip markdown syntax wherever it appears, not just at the edges. The AI
  // path hands this function a raw completion with no prior filtering, and
  // when there's no typed message the model is often naming off an
  // image-extracted description that's itself markdown (headings, bold,
  // code spans are explicitly allowed there - see IMAGE_SYSTEM_PROMPT in
  // api/lib/attachments.ts) - a title that echoes a fragment of it must not
  // leak markdown characters into the display name.
  const withoutMarkdown = withoutPrefix
    .replace(/\*\*?|__?|`+/g, "") // bold/italic/code markers
    .replace(/(?<![\p{L}\p{N}])#+/gu, ""); // heading markers, but not "C#"
  const clean = withoutMarkdown
    .replace(/^[\s'"`*_#-]+|[\s'"`*_#.!?,;:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";
  return clampName(clean.split(" ").slice(0, MAX_NAME_WORDS).join(" "));
}

function deriveProjectName(message: string): string {
  const firstLine = message.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "New Project";

  const words = firstLine
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEADING_REQUEST_WORDS.has(words[0]!.toLowerCase())) {
    words.shift();
  }

  return normalizeProjectName(words.join(" ")) || "New Project";
}

async function generateProjectName(message: string): Promise<string> {
  if (!deepseek) return deriveProjectName(message);
  try {
    const completion = await deepseek.chat.completions.create({
      model: env.DEEPSEEK_MODEL_FLASH,
      temperature: 0.1,
      max_tokens: 12,
      messages: [
        {
          role: "system",
          content:
            "Name the software product described by the user. Return exactly one crisp title of 2-4 words in Title Case. Name the product, not the task: use 'Dentist Appointment Scheduler', not 'Build A Dentist Appointment Scheduling App'. Prefer specific nouns and omit filler such as Build, Create, My, New, App, Website, Platform, Project, or System unless essential to meaning. Output only the title: no label, quotes, punctuation, markdown, or explanation. If there is no clear product, return New Project.",
        },
        { role: "user", content: message },
      ],
    });

    const raw = completion.choices[0]?.message.content?.trim();
    if (!raw) return deriveProjectName(message);

    const name = normalizeProjectName(raw);
    return name || deriveProjectName(message);
  } catch (err) {
    console.error("DeepSeek project naming failed; using fallback", err);
    return deriveProjectName(message);
  }
}

/**
 * What a message was sent about, beyond its words: the element that was
 * selected, the build error on screen, or the crash the user's browser saw.
 * Each becomes a block the model reads and the transcript does not show.
 */
export interface MessageContext {
  visual?: VisualContext;
  buildError?: BuildErrorContext;
  runtimeError?: RuntimeErrorContext;
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
  context?: MessageContext,
): Promise<{
  content: Prisma.InputJsonValue;
  resolved: ResolvedAttachment[];
}> {
  const blocks: { type: "text"; text: string }[] = [];
  const hasUserText = text.trim().length > 0;
  if (hasUserText) blocks.push({ type: "text", text });

  // Directly after the user's words, so the model reads "make it a dropdown"
  // and "this is the <button> at App.tsx:42" adjacent rather than with a
  // document dump between them.
  if (context?.visual) {
    const block = visualContextBlock(context.visual);
    if (block) blocks.push({ type: "text", text: block });
  }
  if (context?.buildError) {
    const block = buildErrorBlock(context.buildError);
    if (block) blocks.push({ type: "text", text: block });
  }
  if (context?.runtimeError) {
    const block = runtimeErrorBlock(context.runtimeError);
    if (block) blocks.push({ type: "text", text: block });
  }

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
  //
  // Keyed on whether the user actually typed something, not on a block count —
  // a visual-context block also lands in here, and counting would read an
  // element prompt with no typed words as if it had some.
  if (!hasUserText) {
    blocks.push({
      type: "text",
      text: "The user sent the attached content without a message. Respond to it.",
    });
  }

  return { content: blocks, resolved };
}

/** Claim attachments atomically; a competing send rolls back this transaction. */
async function linkAttachments(
  tx: Prisma.TransactionClient,
  attachmentIds: string[],
  messageId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const claimed = await tx.attachment.updateMany({
    where: { id: { in: attachmentIds }, messageId: null, feedbackId: null },
    data: { messageId },
  });
  if (claimed.count !== attachmentIds.length) throw Errors.conflict("ATTACHMENT_ALREADY_USED");
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

/** The look a user has set as their default for new projects, if any. */
async function defaultDesignOf(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  return normalizeDesignConfig(readPreferences(user?.preferences).defaultDesign);
}

export interface InitializeProjectResult {
  projectId: string;
  jobId: string;
}

/**
 * @param design  the look the user chose in the composer. Stored with the
 *                project; the worker reads it when it designs the new app
 *                (`worker/design/provision.ts`). Three cases, and the first
 *                two are different on purpose:
 *                  - left out entirely: the client has no picker (or sent
 *                    nothing), so the user's default look applies, if they
 *                    have set one;
 *                  - present but empty: the user saw their default and chose
 *                    "let tau decide" for this project — no default;
 *                  - anything else: what they chose.
 */
export async function initializeProject(
  userId: string,
  message: string,
  effort: Effort,
  attachmentIds: string[] = [],
  design?: unknown,
): Promise<InitializeProjectResult> {
  const designConfig =
    design === undefined
      ? await defaultDesignOf(userId)
      : normalizeDesignConfig(design);
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
      ...(designConfig ? { designConfig: designConfig as Prisma.InputJsonValue } : {}),
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
  context?: MessageContext,
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
    context,
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
): Promise<{ alive: boolean; url?: string }> {
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
    return { alive: true, url: `https://${sandbox.getHost(5173)}` };
  } catch {
    // Sandbox is gone. Clear the stale status so future reads short-circuit.
    await prisma.project
      .updateMany({
        // A probe of the old sandbox can finish after recovery replaced it.
        where: { id: projectId, sandboxId: project.sandboxId },
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
  opts: { cursor?: string; limit: number; search?: string },
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
        description: p.description,
        tags: p.tags,
        instructions: p.instructions,
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

export async function getProjectShowcase(userId: string) {
  const sites = await findShowcaseSites(userId);
  // Slugs are already public. Internal names, descriptions and sandbox
  // screenshots may contain unpublished work and must not leave the owner API.
  return sites.map(({ slug }) => ({ slug, url: publicSiteUrl(slug) }));
}

/**
 * User-edited project metadata: name, description, tags. Distinct from
 * {@link generateProjectName} — that's the one-time AI-generated name at
 * creation; this is the user overriding it (or adding what the model never
 * generates) from the edit-project dialog, in both Home and the project page.
 */
export async function updateProject(
  projectId: string,
  userId: string,
  input: { name?: string; description?: string; tags?: string[]; instructions?: string },
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const data: {
    name?: string;
    description?: string | null;
    tags?: string[];
    instructions?: string | null;
  } = {};
  if (input.name !== undefined) data.name = input.name;
  // Like the description: an empty string clears them.
  if (input.instructions !== undefined) data.instructions = input.instructions || null;
  // An empty string is the form's "clear the description" — store it as the
  // unset `null` rather than a lingering empty row.
  if (input.description !== undefined) data.description = input.description || null;
  if (input.tags !== undefined) {
    // Case-insensitive de-dupe, keeping whichever casing the user typed first.
    const seen = new Set<string>();
    data.tags = input.tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const updated = await projectRepo.updateProject(projectId, data);
  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    tags: updated.tags,
    instructions: updated.instructions,
  };
}

async function findWaitingQuestionCall(
  activeJob: { id: string; status: JobStatus } | null,
) {
  if (activeJob?.status !== JobStatus.RUNNING) return null;
  return prisma.toolCall.findFirst({
    where: {
      message: { jobId: activeJob.id },
      // A key request is a question too: same pause, same recovery.
      toolName: { in: ["ask_user", "request_secret"] },
      status: ToolCallStatus.RUNNING,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Small recovery-poll response. Full messages are fetched only on mismatch. */
export async function getProjectJobStatus(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const activeJob = await prisma.job.findFirst({
    where: {
      projectId,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
    },
    select: { id: true, type: true, status: true },
  });
  const waitingCall = await findWaitingQuestionCall(activeJob);
  return {
    activeJobId: activeJob?.id ?? null,
    jobType: activeJob?.type ?? null,
    pendingQuestionId: waitingCall?.id ?? null,
  };
}

export async function getProject(projectId: string, userId: string) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const { designConfig: _designConfig, ...summary } = project;

  const clearFloor = await projectRepo.findLatestClearSequence(projectId);
  const [messages, latestFragment, activeJob, previewImageUrl, contextUsage] =
    await Promise.all([
      projectRepo.findRecentMessages(projectId, 50, clearFloor),
      projectRepo.findLatestFragment(projectId),
      projectRepo.findActiveJob(projectId),
      project.previewImageKey ? presignGet(project.previewImageKey) : Promise.resolve(null),
      getContextUsage(projectId),
    ]);

  const checkpoints = messages.length
    ? await projectRepo.findCheckpointsInRange(
        projectId,
        messages[0]!.sequence,
        messages[messages.length - 1]!.sequence,
      )
    : [];

  const latestJob = activeJob ?? await prisma.job.findFirst({
    where: { projectId },
    orderBy: { queuedAt: "desc" },
  });
  const waitingCall = await findWaitingQuestionCall(activeJob);
  const questionInput = waitingCall?.input as {
    question?: unknown;
    options?: unknown;
    reason?: unknown;
  } | undefined;
  const pendingQuestion = !waitingCall
    ? null
    : waitingCall.toolName === "request_secret"
      ? {
          id: waitingCall.id,
          question:
            typeof questionInput?.reason === "string" ? questionInput.reason : "",
          options: [],
          // Names and descriptions only — the values were never on this row.
          secrets: pendingSecretFields(waitingCall),
        }
      : typeof questionInput?.question === "string"
        ? {
            id: waitingCall.id,
            question: questionInput.question,
            options: Array.isArray(questionInput.options)
              ? questionInput.options.filter((option): option is string => typeof option === "string")
              : [],
          }
        : null;

  return {
    // Everything on the row but the design choice: that can hold a whole
    // imported DESIGN.md, and the page reads the design from its own endpoint.
    project: { ...summary, previewImageUrl },
    messages,
    latestFragment,
    activeJobId: activeJob?.id ?? null,
    activeJobEventIndex: activeJob ? bus.headIndex(activeJob.id) : null,
    jobState: latestJob ? {
      id: latestJob.id,
      type: latestJob.type,
      status: latestJob.status,
      phase: pendingQuestion
        ? "waiting_user"
        : activeJob?.status === JobStatus.QUEUED
          ? "queued"
          : activeJob
            ? "working"
            : "terminal",
      finishReason: latestJob.finishReason,
      error: latestJob.error,
      pendingQuestion,
    } : null,
    contextUsage,
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

  const clearFloor = await projectRepo.findLatestClearSequence(projectId);

  if (opts.before !== undefined) {
    const result = await projectRepo.findMessagesBefore(
      projectId,
      opts.before,
      opts.limit,
      clearFloor,
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

  return projectRepo.listMessages(projectId, opts, clearFloor);
}

export async function downloadProjectArchive(projectId: string, userId: string) {
  const project = await projectRepo.findProjectWithTree(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) throw Errors.forbidden("You do not have access to this project");
  const files = project.files.filter((file) => !isSecretPath(file.path));
  if (files.reduce((total, file) => total + file.sizeBytes, 0) > 100 * 1024 * 1024) {
    throw Errors.badRequest("Project exceeds the 100 MB download limit");
  }
  return createProjectArchive(files, (hash) => getBlob(userId, projectId, hash));
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
  questionId: string,
): Promise<void> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId)
    throw Errors.forbidden("You do not have access to this project");

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.projectId !== projectId)
    throw Errors.notFound("Job not found");
  // A retry may arrive after the worker has already consumed the answer and
  // even completed the job. Acknowledge the exact same accepted answer without
  // sending it to the in-memory handoff again.
  const existing = await prisma.toolCall.findFirst({
    where: { id: questionId, message: { jobId }, toolName: "ask_user" },
    select: { status: true, output: true },
  });
  const existingOutput = existing?.output as { answer?: unknown } | null;
  if (existing?.status === ToolCallStatus.SUCCESS && existingOutput?.answer === answer)
    return;
  if (job.status !== "RUNNING")
    throw Errors.conflict("Job is not waiting for a response");

  if (!bus.isResident(jobId)) {
    await terminateStrandedJob(jobId);
    throw Errors.conflict("This run was interrupted. Send another message to continue.");
  }
  if (!bus.isQuestionActive(jobId, questionId))
    throw Errors.conflict("This question is no longer waiting for an answer");

  const claimed = await prisma.toolCall.updateMany({
    where: {
      id: questionId,
      message: { jobId },
      toolName: "ask_user",
      status: ToolCallStatus.RUNNING,
    },
    data: {
      status: ToolCallStatus.SUCCESS,
      output: { answer },
      completedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    // Idempotent retry when the HTTP response to an accepted answer was lost.
    // Do not push it into the bus twice (the next ask_user could consume it).
    const previous = await prisma.toolCall.findFirst({
      where: { id: questionId, message: { jobId }, toolName: "ask_user" },
      select: { status: true, output: true },
    });
    const saved = previous?.output as { answer?: unknown } | null;
    if (previous?.status === ToolCallStatus.SUCCESS && saved?.answer === answer)
      return;
    throw Errors.conflict("This question has already been answered or expired");
  }

  bus.pushUserResponse(jobId, questionId, answer);
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
    const nonTerminal =
      status === JobStatus.QUEUED || status === JobStatus.RUNNING;

    // A non-terminal row is only genuinely cancellable if this process is
    // actually running it. After a restart the row survives but the run doesn't,
    // so `requestCancel` signals nobody, nothing settles the hold, and the slot
    // stays locked forever — the exact gap that made this escape hatch useless
    // for the jobs that most needed it (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §3.1).
    if (nonTerminal && bus.isResident(jobId)) {
      // Live job — the worker settles the hold as it tears the run down.
      bus.requestCancel(jobId);
      continue;
    }

    if (nonTerminal) {
      // Stranded row: terminate it here, exactly as the reaper would. This also
      // settles the hold and emits the terminal frame.
      await terminateStrandedJob(jobId, {
        status: JobStatus.CANCELLED,
        reason: FinishReason.CANCELLED,
        message: "This run was stopped because it was no longer running.",
      }).catch(() => {});
      continue;
    }

    // Stuck hold behind an already-terminal job — settle directly. Idempotent,
    // and pay-as-you-go means this only clears the concurrency slot, never
    // refunds.
    await settle(jobId);
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
  // The storage rows would cascade away with the project and leave the bytes. The
  // keys go first, so a published app that is still running cannot add a file
  // between the listing and the delete. This is immediate on purpose, unlike the
  // database's delay: nothing can restore the rows, so bytes kept past this point
  // would only be orphans (doc/TAU_CLOUD_STORAGE.md 0.11).
  if (storageConfigured()) {
    await revokeStorageKeys(projectId);
    await deleteStoragePrefix(projectStoragePrefix(projectId));
  }
  // Before the rows go: the database would delete the domains, but not at Cloudflare or the edge.
  await releaseProjectDomains(projectId);
  // Also before the rows go: they are what says which AWS resources exist. Throws
  // if AWS cannot be reached, so the delete is retried rather than leaving a
  // running function nobody tracks.
  await removeBackend(projectId);
  // The database is kept for a few days more (DATABASE_DELETE_DELAY_DAYS), then
  // the sweep removes it; the schedule must be written before the project's rows go.
  await scheduleDatabaseRemoval(projectId);
  await projectRepo.deleteProject(projectId);
  // The address is gone for good (SiteName keeps the name), so the edge must stop serving it.
  if (project.slug) {
    invalidateSiteLookup(project.slug);
    await removeSite(project.slug);
  }
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
export async function readProjectFileContent(
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

  // Binary assets can't be served as text (a UTF-8 decode corrupts them, and
  // the editor can't render them anyway). Hand back a short-lived presigned URL
  // to the R2 blob so the client can preview it as an image/media instead.
  if (isBinaryPath(filePath)) {
    const record = await projectRepo.findProjectFileRecord(project.id, filePath);
    if (!record) throw Errors.notFound("File not found");
    const url = await presignGet(blobKey(userId, project.id, record.contentHash));
    return { binary: true as const, url, contentHash: record.contentHash };
  }

  // Gate on the manifest before the sandbox-first read below. Without this the
  // handler hands `sandbox.files.read()` an arbitrary caller-supplied path, and
  // `toWorkdirPath` passes absolute paths through unchanged — so `?path=.env`
  // (or any absolute path in the VM) is served even though no such row exists.
  // The editor only ever opens paths from the manifest-built file tree, and
  // saveProjectFile already requires the row, so this costs nothing.
  const record = await projectRepo.findProjectFileRecord(project.id, filePath);
  if (!record) throw Errors.notFound("File not found");

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
  // A credentials file can't be persisted (see `isSecretPath`), so saving one
  // would clear the editor's dirty state while storing nothing. Reject instead
  // of lying. Only reachable for rows written before the deny-list existed —
  // scripts/remediate-leaked-secrets.ts clears those out.
  if (isSecretPath(filePath)) {
    throw Errors.badRequest(
      "This file holds credentials and is not stored with the project.",
    );
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
 * Apply one visual edit — a change the user made by clicking an element in the
 * preview rather than by typing in the editor or the chat.
 *
 * Costs nothing: no model call, no credits, no job. The whole point of the
 * feature is that "make this heading say X" should be instant and free.
 *
 * Everything after the AST splice is `saveProjectFile`, so a visual edit gets
 * the sandbox write (and therefore Vite's hot reload), the R2 + manifest write,
 * the `USER_EDIT` message that tells the agent what changed, the running-job
 * guard and the stale-file guard — all for free, and all identical to what a
 * hand edit in the code pane does.
 *
 * Returns `applied: false` with a reason rather than throwing when the element
 * simply isn't safe to edit deterministically (an expression child, a mapped
 * list). That is a normal outcome the UI turns into a chat fallback, not an
 * error. Genuine problems — a moved file, a missing one — still throw.
 *
 * See doc/archive/VISUAL_EDIT_PLAN.md §5.3.
 */
export async function applyVisualEditToProject(
  projectId: string,
  userId: string,
  args: { loc: string; expectTag: string; op: VisualEditOp; baseHash?: string },
) {
  const parsed = parseLoc(args.loc);
  if (!parsed) throw Errors.badRequest("Malformed element location");

  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  // Checked here as well as in saveProjectFile so the user gets the "tau is
  // building" message before we spend a read and a parse on work we'd discard.
  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  const record = await projectRepo.findProjectFileRecord(projectId, parsed.path);
  if (!record) throw Errors.notFound("File not found");

  const before = await readProjectFileContent(project, userId, parsed.path);

  // The element was selected against a specific version of the file. If the
  // agent has rewritten it since, the line/column now point somewhere else
  // entirely — fail loudly instead of editing a random line.
  if (args.baseHash && args.baseHash !== before.contentHash) {
    throw Errors.conflict("file changed since it was opened");
  }

  const result = applyVisualEdit({
    content: before.content,
    fileName: parsed.path,
    line: parsed.line,
    column: parsed.column,
    expectTag: args.expectTag,
    op: args.op,
  });

  if (!result.ok) {
    // `not_found` / `tag_mismatch` mean the source moved under the selection —
    // that is the same class of problem as a hash mismatch, so it is a conflict
    // the user resolves by reselecting, not a "can't do that" refusal.
    if (result.reason === "not_found" || result.reason === "tag_mismatch") {
      throw Errors.conflict("element moved since it was selected");
    }
    return { applied: false as const, reason: result.reason };
  }

  if (result.content === before.content) {
    return {
      applied: true as const,
      contentHash: before.contentHash,
      headSequence: project.headSequence,
      className: result.className,
    };
  }

  const saved = await saveProjectFile(
    projectId,
    userId,
    parsed.path,
    result.content,
    before.contentHash,
  );

  return { applied: true as const, ...saved, className: result.className };
}

/** Where every template's theme lives (`writeTheme` in the worker templates). */
const THEME_FILE = "src/index.css";

/**
 * The current theme palettes, for the global style panel.
 *
 * Read rather than assumed: the agent is told to edit these palettes in place
 * (`.tau/CONTEXT.md`), so the file is the only authority on what the colours
 * are. `contentHash` comes back so the panel can send it as `baseHash` and get
 * the same stale-file protection every other visual edit has.
 */
export async function getProjectTheme(projectId: string, userId: string) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const record = await projectRepo.findProjectFileRecord(projectId, THEME_FILE);
  if (!record) throw Errors.notFound("This project has no theme file");

  const file = await readProjectFileContent(project, userId, THEME_FILE);

  return {
    path: THEME_FILE,
    contentHash: file.contentHash,
    activeScope: await openingScope(project, userId),
    ...readThemeTokens(file.content),
  };
}

/**
 * Which palette is on screen. An app opens dark only when `index.html` puts
 * the `dark` class on `<html>`; the panel uses this to open on the palette the
 * user is actually looking at, and a theme edit uses it to know which palette
 * `DESIGN.md` describes.
 */
async function openingScope(
  project: Parameters<typeof readProjectFileContent>[0],
  userId: string,
): Promise<ThemeScope> {
  try {
    const html = await readProjectFileContent(project, userId, "index.html");
    const tag = /<html\b[^>]*>/i.exec(html.content)?.[0] ?? "";
    const classes = /\sclass=(["'])(.*?)\1/i.exec(tag)?.[2] ?? "";
    return classes.split(/\s+/).includes("dark") ? "dark" : "root";
  } catch {
    // No index.html to read: keep the historical default.
    return "dark";
  }
}

/**
 * Set one theme variable and let hot reload restyle the whole app.
 *
 * Structurally identical to `applyVisualEditToProject` — same ownership check,
 * same running-job guard, same `baseHash` conflict, same `saveProjectFile` — and
 * deliberately so: this is the same feature pointed at a different file, and the
 * guarantees users get from it should not depend on which panel they used.
 */
export async function applyThemeEditToProject(
  projectId: string,
  userId: string,
  args: { name: string; value: string; scope: ThemeScope; baseHash?: string },
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  const record = await projectRepo.findProjectFileRecord(projectId, THEME_FILE);
  if (!record) throw Errors.notFound("This project has no theme file");

  const before = await readProjectFileContent(project, userId, THEME_FILE);
  if (args.baseHash && args.baseHash !== before.contentHash) {
    throw Errors.conflict("file changed since it was opened");
  }

  const result = applyThemeEdit({
    content: before.content,
    name: args.name,
    value: args.value,
    scope: args.scope,
  });

  if (!result.ok) return { applied: false as const, reason: result.reason };

  if (result.content === before.content) {
    return {
      applied: true as const,
      contentHash: before.contentHash,
      headSequence: project.headSequence,
      scope: result.scope,
    };
  }

  const saved = await saveProjectFile(
    projectId,
    userId,
    THEME_FILE,
    result.content,
    before.contentHash,
  );

  // The agent reads the design from DESIGN.md, not from the stylesheet. Left
  // alone, its next request would be built to the colour just replaced.
  const palettes = readThemeTokens(result.content);
  const opening = await openingScope(project, userId);
  await syncDesignAfterThemeEdit(projectId, userId, {
    ...palettes[opening],
    ...(palettes.root["--radius"] ? { "--radius": palettes.root["--radius"] } : {}),
  });

  return { applied: true as const, ...saved, scope: result.scope };
}

/**
 * Import a remote image into `public/` and return the path to point a `src` at.
 *
 * Two steps rather than one on purpose: this call only puts the bytes in the
 * project, and the client then issues a normal `attr` visual edit to point the
 * element at them. That keeps the source rewrite on the one audited path — with
 * its tag check, its stale-file check and its undo entry — instead of growing a
 * second way to edit JSX that would have to reimplement all three.
 */
export async function importVisualAsset(
  projectId: string,
  userId: string,
  url: string,
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  const asset = await fetchImageAsset(url);
  if (!asset.ok) return { imported: false as const, reason: asset.reason };

  // Content-addressed name: re-importing the same image twice reuses the same
  // file instead of littering `public/` with `hero-1`, `hero-2`, `hero-3`.
  const stem = slugifyAssetName(url);
  const digest = createHash("sha256")
    .update(asset.bytes)
    .digest("hex")
    .slice(0, 8);
  const path = `public/${stem}-${digest}.${asset.ext}`;

  // Sandbox first, same as saveProjectFile: it is what the preview serves, so
  // writing it before the manifest means the `src` edit that follows can never
  // point at a file the running app hasn't got yet.
  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      const sandbox = await Sandbox.connect(project.sandboxId);
      const buf = asset.bytes.buffer.slice(
        asset.bytes.byteOffset,
        asset.bytes.byteOffset + asset.bytes.byteLength,
      ) as ArrayBuffer;
      await sandbox.files.write(toWorkdirPath(path), buf);
    } catch (err) {
      console.warn("[visual-asset] sandbox write failed", err);
    }
  }

  const saved = await writeProjectBinaryFile(projectId, userId, path, asset.bytes);

  return {
    imported: true as const,
    path,
    // Vite serves `public/` from the root, so this — not the file path — is what
    // belongs in the `src` attribute.
    src: `/${path.slice("public/".length)}`,
    sizeBytes: saved.sizeBytes,
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
