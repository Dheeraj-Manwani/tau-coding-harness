/**
 * The user-facing half of project secrets: answering a `request_secret` form,
 * and the Keys tab (list / replace / delete).
 *
 * Values arrive in a request body and go straight into `ProjectSecret` —
 * encrypted — and nowhere else. What the tool call records, and what the chat
 * shows, is which *names* were saved. See `lib/projectSecrets.ts`.
 */
import { Sandbox } from "e2b";
import { prisma } from "@/lib/prisma";
import * as projectRepo from "../repositories/project.repository";
import { Errors } from "../lib/errors";
import { bus } from "@/lib/bus";
import { terminateStrandedJob } from "../lib/jobs";
import {
  deleteProjectSecret,
  listProjectSecrets,
  saveProjectSecrets,
  secretNameError,
  secretValueError,
  SecretLimitError,
} from "@/lib/projectSecrets";
import { keyEncryptionConfigured } from "@/lib/apiKeys";
import { reinjectProjectEnv } from "@/worker/lib/aiEnv";
import { log } from "../lib/log";
import { SandboxStatus, ToolCallStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type {
  SecretAnswerOutput,
  SecretField,
} from "@/worker/agent/tools/functions/request-secret";

async function requireOwnedProject(projectId: string, userId: string) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  return project;
}

function requireEncryption(): void {
  if (!keyEncryptionConfigured()) {
    throw Errors.badRequest("Secure key storage is not available on this server.");
  }
}

/**
 * The form a pending `request_secret` call is showing.
 *
 * The worker writes the filtered list (keys already saved are left out) to the
 * RUNNING row's output before publishing; the raw tool input is the fallback
 * for a row written before that update landed.
 */
export function pendingSecretFields(call: {
  input: unknown;
  output: unknown;
}): SecretField[] {
  const fromOutput = (call.output as { fields?: unknown } | null)?.fields;
  const raw = Array.isArray(fromOutput)
    ? fromOutput
    : (call.input as { secrets?: unknown } | null)?.secrets;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): SecretField[] => {
    const o = (f ?? {}) as Record<string, unknown>;
    if (typeof o.name !== "string") return [];
    return [
      {
        name: o.name,
        label: typeof o.label === "string" && o.label ? o.label : o.name,
        description: typeof o.description === "string" ? o.description : "",
        ...(typeof o.url === "string" && /^https:\/\//i.test(o.url)
          ? { url: o.url }
          : {}),
      },
    ];
  });
}

function answerText(fields: SecretField[], saved: string[], skipped: string[]): string {
  const label = (n: string) => fields.find((f) => f.name === n)?.label ?? n;
  const parts: string[] = [];
  if (saved.length > 0) parts.push(`Added ${saved.map(label).join(", ")}`);
  if (skipped.length > 0) parts.push(`Skipped ${skipped.map(label).join(", ")}`);
  return parts.join(" · ");
}

/**
 * Answer a paused `request_secret` call.
 *
 * Order matters: the keys are stored *before* the tool call is claimed. If the
 * claim then loses (the question timed out a moment ago), the user's keys are
 * still saved and show in the Keys tab — better than accepting the claim and
 * telling the agent a key exists that was never written.
 */
export async function submitSecretAnswer(
  projectId: string,
  jobId: string,
  userId: string,
  questionId: string,
  rawValues: Record<string, string>,
): Promise<{ answer: string; saved: string[]; skipped: string[] }> {
  await requireOwnedProject(projectId, userId);
  requireEncryption();

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.projectId !== projectId) throw Errors.notFound("Job not found");

  const call = await prisma.toolCall.findFirst({
    where: { id: questionId, message: { jobId }, toolName: "request_secret" },
    select: { status: true, input: true, output: true },
  });
  if (!call) throw Errors.notFound("Key request not found");

  // Idempotent retry when the HTTP response to an accepted answer was lost.
  if (call.status === ToolCallStatus.SUCCESS) {
    const out = call.output as Partial<SecretAnswerOutput> | null;
    if (typeof out?.answer === "string") {
      return {
        answer: out.answer,
        saved: out.saved ?? [],
        skipped: out.skipped ?? [],
      };
    }
  }
  if (call.status !== ToolCallStatus.RUNNING || job.status !== "RUNNING") {
    throw Errors.conflict("This key request is no longer waiting for an answer");
  }
  if (!bus.isResident(jobId)) {
    await terminateStrandedJob(jobId);
    throw Errors.conflict("This run was interrupted. Send another message to continue.");
  }
  if (!bus.isQuestionActive(jobId, questionId)) {
    throw Errors.conflict("This key request is no longer waiting for an answer");
  }

  const fields = pendingSecretFields(call);
  const asked = new Set(fields.map((f) => f.name));
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawValues)) {
    if (!asked.has(name)) throw Errors.badRequest(`${name} was not requested`);
    // Copying from a dashboard routinely brings a trailing newline or space.
    const v = value.trim();
    if (!v) continue;
    const problem = secretValueError(v);
    if (problem) throw Errors.badRequest(`${name}: ${problem}`);
    values[name] = v;
  }
  const saved = fields.map((f) => f.name).filter((n) => n in values);
  const skipped = fields.map((f) => f.name).filter((n) => !(n in values));

  try {
    await saveProjectSecrets(projectId, values);
  } catch (err) {
    if (err instanceof SecretLimitError) throw Errors.badRequest(err.message);
    throw err;
  }

  const answer = answerText(fields, saved, skipped) || "Skipped";
  const output: SecretAnswerOutput = { answer, saved, skipped };
  const claimed = await prisma.toolCall.updateMany({
    where: { id: questionId, status: ToolCallStatus.RUNNING },
    data: {
      status: ToolCallStatus.SUCCESS,
      output: output as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    throw Errors.conflict(
      saved.length > 0
        ? "Your keys were saved, but tau stopped waiting for them. Send a message to continue."
        : "This key request is no longer waiting for an answer",
    );
  }

  bus.pushUserResponse(jobId, questionId, answer);
  log.info("secrets.answered", { projectId, jobId, saved, skipped });
  return { answer, saved, skipped };
}

export async function listSecrets(projectId: string, userId: string) {
  await requireOwnedProject(projectId, userId);
  return { secrets: await listProjectSecrets(projectId) };
}

/**
 * Rewrite the running app's `.env` after a change from the Keys tab, and
 * restart its server so it reads the new values.
 *
 * Fire-and-forget: the restart waits for the server to come back (seconds),
 * and the key is already safely stored — the next provision writes it anyway.
 */
function applyToLiveSandbox(project: {
  id: string;
  userId: string;
  sandboxId: string | null;
  sandboxStatus: SandboxStatus;
}): void {
  if (!project.sandboxId || project.sandboxStatus !== SandboxStatus.READY) return;
  const sandboxId = project.sandboxId;
  void (async () => {
    try {
      const sandbox = await Sandbox.connect(sandboxId);
      await reinjectProjectEnv(sandbox, project.id, project.userId, "keys-tab", {
        restart: true,
      });
    } catch (err) {
      log.warn("secrets.live_apply_failed", {
        projectId: project.id,
        error: String(err),
      });
    }
  })();
}

export async function setSecret(
  projectId: string,
  userId: string,
  name: string,
  rawValue: string,
): Promise<void> {
  const project = await requireOwnedProject(projectId, userId);
  requireEncryption();
  const nameProblem = secretNameError(name);
  if (nameProblem) throw Errors.badRequest(nameProblem);
  const value = rawValue.trim();
  const valueProblem = secretValueError(value);
  if (valueProblem) throw Errors.badRequest(valueProblem);

  try {
    await saveProjectSecrets(projectId, { [name]: value });
  } catch (err) {
    if (err instanceof SecretLimitError) throw Errors.badRequest(err.message);
    throw err;
  }
  log.info("secrets.set", { projectId, name });
  applyToLiveSandbox(project);
}

export async function deleteSecret(
  projectId: string,
  userId: string,
  name: string,
): Promise<void> {
  const project = await requireOwnedProject(projectId, userId);
  if (!(await deleteProjectSecret(projectId, name))) {
    throw Errors.notFound("Key not found");
  }
  log.info("secrets.deleted", { projectId, name });
  applyToLiveSandbox(project);
}
