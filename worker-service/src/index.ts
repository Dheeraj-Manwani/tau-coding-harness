import { env } from "./lib/env";
import { bus, type DispatchPayload } from "./lib/bus";
import { prisma } from "./lib/prisma";
import { publish, publishTerminal } from "./lib/publish";
import { provisionSandbox } from "./lib/sandbox";
import { AgentStopError, runAgentLoop } from "./agent/loop";
import { settle } from "./lib/credits";
import { getNextSequence } from "./lib/sequence";
import { PREVIEW_PORT } from "./agent/config";
import {
  FinishReason,
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
  await publish(jobId, { type: "thinking", message: "Starting preview" });

  // Reconnect-or-rebuild + rehydrate from R2. The template's start command
  // auto-runs Vite on PREVIEW_PORT, so the returned sandbox is serving the app.
  const sandbox = await provisionSandbox(projectId, userId, jobId);
  const previewUrl = `https://${sandbox.getHost(PREVIEW_PORT)}`;

  await publish(jobId, { type: "preview_ready", url: previewUrl });

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

  await publishTerminal(jobId, { type: "done" });
}

/**
 * Process a single code-generation job: run the agent loop, handle in-flight
 * cancellation, and settle credits on terminal status. Economy (Redis-free):
 * cancellation and event indexing go through the in-process bus. A PREVIEW-type
 * job short-circuits to {@link runPreviewJob} instead of the agent loop.
 */
export async function processJob(payload: DispatchPayload): Promise<void> {
  // Tell the reaper this process owns the job, so a stale heartbeat during one
  // long turn isn't mistaken for an abandoned run (api/src/lib/jobs.ts).
  bus.markResident(payload.jobId);
  try {
    await runJob(payload);
  } finally {
    bus.clearResident(payload.jobId);
  }
}

async function runJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId, prompt, effort } = payload;

  if (payload.type === JobType.PREVIEW) {
    try {
      await runPreviewJob(payload);
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          finishReason: FinishReason.DONE,
        },
      });
    } catch (err) {
      console.error(`[runner] preview job ${jobId} failed`, err);
      await markFailed(jobId, err, "Couldn't start the preview");
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
          data: {
            status: JobStatus.CANCELLED,
            completedAt: new Date(),
            finishReason: FinishReason.CANCELLED,
          },
        });
        await settle(jobId);
        await publishTerminal(jobId, { type: "cancelled" });
      } catch (err) {
        console.error(`[runner] cancel handling failed for ${jobId}`, err);
      }
    })();
  });

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        // Start the heartbeat here: provisioning a sandbox can take a while and
        // must not look like a stalled job to the reaper.
        lastHeartbeatAt: new Date(),
      },
    });

    await publish(jobId, { type: "thinking", message: "Thinking" });

    const hasFiles =
      (await prisma.projectFile.count({ where: { projectId } })) > 0;
    const initialSandbox = hasFiles
      ? await provisionSandbox(projectId, userId, jobId)
      : undefined;

    const finishReason = await runAgentLoop(
      jobId,
      projectId,
      userId,
      prompt,
      effort as Effort,
      initialSandbox,
    );

    if (!cancelled) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          finishReason,
        },
      });
      await settle(jobId).catch((err) =>
        console.error(`[runner] settle failed on complete for ${jobId}`, err),
      );
    }
  } finally {
    offCancel();
  }
}

/**
 * Terminate a job for good: mark it FAILED, release its hold, and — critically —
 * emit the terminal frame.
 *
 * Every failure path funnels through here, including the ones that used to
 * publish nothing at all (a `provisionSandbox` throw, a DB blip while flipping
 * the row to RUNNING). Those left the browser shimmering with no explanation
 * until a poll happened to notice (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.3).
 *
 * Deliberately called only when the runner has stopped retrying: a frame emitted
 * on a non-final attempt tears the client's stream down, so the retry would run
 * with nobody listening (§2.4).
 */
async function markFailed(
  jobId: string,
  err: unknown,
  userMessage?: string,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  // A guard rail that fired names itself; anything else is an opaque failure.
  const finishReason =
    err instanceof AgentStopError ? err.finishReason : FinishReason.ERROR;
  await prisma.job
    .update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: message,
        completedAt: new Date(),
        finishReason,
      },
    })
    .catch((e) =>
      console.error(`[runner] failed-status update error for ${jobId}`, e),
    );
  await settle(jobId).catch((e) =>
    console.error(`[runner] settle failed on job failure for ${jobId}`, e),
  );
  await publishTerminal(jobId, {
    type: "error",
    message: userMessage ?? message,
  }).catch((e) =>
    console.error(`[runner] terminal publish failed for ${jobId}`, e),
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
      // A cancelled job is already terminal — retrying it would resurrect a run
      // the user explicitly stopped.
      if (n < MAX_ATTEMPTS && !bus.isCancelled(payload.jobId)) {
        attempts.set(payload.jobId, n);
        console.error(
          `[runner] job ${payload.jobId} failed (attempt ${n}/${MAX_ATTEMPTS}), retrying`,
          err,
        );
        // No terminal frame here on purpose: publishing one would make the
        // client finalize and close its stream, so the retry would run with
        // nobody listening (§2.4). The browser keeps shimmering through it.
        await prisma.job
          .update({
            where: { id: payload.jobId },
            data: { attemptNumber: n + 1, lastHeartbeatAt: new Date() },
          })
          .catch(() => {});
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
