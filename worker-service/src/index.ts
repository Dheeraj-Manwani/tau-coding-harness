import { env } from "./lib/env";
import { bus, type DispatchPayload } from "./lib/bus";
import { prisma } from "./lib/prisma";
import { publish } from "./lib/publish";
import { provisionSandbox } from "./lib/sandbox";
import { runAgentLoop } from "./agent/loop";
import { settle } from "./lib/credits";
import { getNextSequence } from "./lib/sequence";
import { PREVIEW_PORT } from "./agent/config";
import {
  JobStatus,
  JobType,
  MessageRole,
  MessageType,
  type Effort,
} from "./generated/prisma/enums";
import type { Prisma } from "./generated/prisma/client";

async function runPreviewJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId } = payload;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
  await publish(jobId, { type: "thinking", message: "Starting preview" }, 0);

  // Reconnect-or-rebuild + rehydrate from R2. The template's start command
  // auto-runs Vite on PREVIEW_PORT, so the returned sandbox is serving the app.
  const sandbox = await provisionSandbox(projectId, userId, jobId);
  const previewUrl = `https://${sandbox.getHost(PREVIEW_PORT)}`;

  await publish(
    jobId,
    { type: "preview_ready", url: previewUrl },
    bus.length(jobId),
  );

  // Persist the new URL as the project's latest fragment so a page reload
  // hydrates the live sandbox, not the stale one. Fragment requires a message,
  // so anchor it to an empty assistant row — empty RESULT rows don't render in
  // the transcript, keeping the chat clean.
  const messageId = await prisma.$transaction(async (tx) => {
    const seq = await getNextSequence(tx, projectId);
    const message = await tx.message.create({
      data: {
        project: { connect: { id: projectId } },
        job: { connect: { id: jobId } },
        role: MessageRole.ASSISTANT,
        type: MessageType.RESULT,
        content: { content: null } as unknown as Prisma.InputJsonValue,
        sequence: seq,
      },
    });
    return message.id;
  });

  await prisma.fragment.create({
    data: {
      message: { connect: { id: messageId } },
      job: { connect: { id: jobId } },
      sandboxUrl: previewUrl,
      title: "Preview",
    },
  });

  await publish(jobId, { type: "done" }, bus.length(jobId));
}

/**
 * Process a single code-generation job: run the agent loop, handle in-flight
 * cancellation, and settle credits on terminal status. Economy (Redis-free):
 * cancellation and event indexing go through the in-process bus. A PREVIEW-type
 * job short-circuits to {@link runPreviewJob} instead of the agent loop.
 */
export async function processJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId, prompt, effort } = payload;

  if (payload.type === JobType.PREVIEW) {
    try {
      await runPreviewJob(payload);
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.COMPLETED, completedAt: new Date() },
      });
    } catch (err) {
      console.error(`[runner] preview job ${jobId} failed`, err);
      await publish(
        jobId,
        { type: "error", message: "Couldn't start the preview" },
        bus.length(jobId),
      );
      await markFailed(jobId, err);
    }
    return;
  }

  let cancelled = false;

  const offCancel = bus.onCancel(jobId, () => {
    void (async () => {
      cancelled = true;
      try {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.CANCELLED, completedAt: new Date() },
        });
        await settle(jobId);
        await publish(jobId, { type: "cancelled" }, bus.length(jobId));
      } catch (err) {
        console.error(`[runner] cancel handling failed for ${jobId}`, err);
      }
    })();
  });

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING, startedAt: new Date() },
    });

    await publish(jobId, { type: "thinking", message: "Thinking" }, 0);

    const startIndex = bus.length(jobId);
    const hasFiles =
      (await prisma.projectFile.count({ where: { projectId } })) > 0;
    const initialSandbox = hasFiles
      ? await provisionSandbox(projectId, userId, jobId)
      : undefined;

    await runAgentLoop(
      jobId,
      projectId,
      userId,
      prompt,
      effort as Effort,
      startIndex,
      initialSandbox,
    );

    if (!cancelled) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.COMPLETED, completedAt: new Date() },
      });
      await settle(jobId).catch((err) =>
        console.error(`[runner] settle failed on complete for ${jobId}`, err),
      );
    }
  } finally {
    offCancel();
  }
}

async function markFailed(jobId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.job
    .update({
      where: { id: jobId },
      data: { status: JobStatus.FAILED, error: message },
    })
    .catch((e) =>
      console.error(`[runner] failed-status update error for ${jobId}`, e),
    );
  await settle(jobId).catch((e) =>
    console.error(`[runner] settle failed on job failure for ${jobId}`, e),
  );
}

/**
 * Start the in-process job runner (economy): consume dispatched jobs with a
 * concurrency limit and one retry, replacing the BullMQ worker. No Redis, no
 * durability — a process restart drops queued/in-flight jobs (accepted
 * tradeoff, see doc/economy-deployment.md).
 *
 * Idempotent across `bun --hot` reloads: the `bus` is a process-global
 * singleton that outlives this module, so any dispatch handler left over from a
 * previous execution is swept before a fresh one is wired. Without this, each
 * reload would accumulate another handler and a single dispatched job would run
 * once per handler — the model appears to "respond" several times over.
 */
export function startRunner(): void {
  bus.clearDispatchHandlers();

  const MAX_ATTEMPTS = 2; // mirror BullMQ attempts: 2 (initial + 1 retry)
  const queue: DispatchPayload[] = [];
  const attempts = new Map<string, number>();
  let active = 0;

  const pump = (): void => {
    while (active < env.WORKER_CONCURRENCY && queue.length > 0) {
      const payload = queue.shift();
      if (!payload) break;
      active += 1;
      void runOne(payload).finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  const runOne = async (payload: DispatchPayload): Promise<void> => {
    try {
      await processJob(payload);
      attempts.delete(payload.jobId);
    } catch (err) {
      const n = (attempts.get(payload.jobId) ?? 0) + 1;
      if (n < MAX_ATTEMPTS) {
        attempts.set(payload.jobId, n);
        console.error(
          `[runner] job ${payload.jobId} failed (attempt ${n}/${MAX_ATTEMPTS}), retrying`,
          err,
        );
        queue.push(payload);
      } else {
        attempts.delete(payload.jobId);
        console.error(`[runner] job ${payload.jobId} failed permanently`, err);
        await markFailed(payload.jobId, err);
      }
    }
  };

  bus.onDispatch((payload) => {
    queue.push(payload);
    pump();
  });

  console.log(
    `[runner] ready — in-process, concurrency=${env.WORKER_CONCURRENCY} (no redis)`,
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[runner] received ${signal}, shutting down…`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

if (import.meta.main) startRunner();
