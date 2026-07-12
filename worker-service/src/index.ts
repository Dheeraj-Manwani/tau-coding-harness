import { env } from "./lib/env";
import { bus, type DispatchPayload } from "./lib/bus";
import { prisma } from "./lib/prisma";
import { publish } from "./lib/publish";
import { provisionSandbox } from "./lib/sandbox";
import { runAgentLoop } from "./agent/loop";
import { settle } from "./lib/credits";
import { JobStatus, type Effort } from "./generated/prisma/enums";

/**
 * Process a single code-generation job: run the agent loop, handle in-flight
 * cancellation, and settle credits on terminal status. Economy (Redis-free):
 * cancellation and event indexing go through the in-process bus.
 */
export async function processJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId, prompt, effort } = payload;
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
 */
export function startRunner(): void {
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
