import { Worker, type ConnectionOptions } from "bullmq";
import { env } from "./lib/env";
import { redis } from "./lib/redis";
import { prisma } from "./lib/prisma";
import { publish } from "./lib/publish";
import { provisionSandbox } from "./lib/sandbox";
import { runAgentLoop } from "./agent/loop";
import { settle } from "./lib/credits";
import { JobStatus } from "./generated/prisma/enums";

interface JobPayload {
  jobId: string;
  projectId: string;
  userId: string;
  prompt: string;
}

const connection = redis as unknown as ConnectionOptions;

const worker = new Worker<JobPayload>(
  env.QUEUE_NAME,
  async (job) => {
    const { jobId, projectId, userId, prompt } = job.data;

    const controlChannel = `job:${jobId}:control`;
    const sub = redis.duplicate();
    let cancelled = false;

    sub.on("message", async (_channel, message) => {
      try {
        const msg = JSON.parse(message) as { type?: string };
        if (msg.type === "cancel") {
          cancelled = true;
          await worker.pause();
          await prisma.job.update({
            where: { id: jobId },
            data: { status: JobStatus.CANCELLED, completedAt: new Date() },
          });
          await settle(jobId).catch((err) =>
            console.error(`[worker] settle failed on cancel for ${jobId}`, err),
          );
          const index = await redis.llen(`job:${jobId}:events`);
          await publish(jobId, { type: "cancelled" }, index);
        }
      } catch (err) {
        console.error(`[worker] bad control message on ${controlChannel}`, err);
      }
    });
    await sub.subscribe(controlChannel);

    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.RUNNING, startedAt: new Date() },
      });

      await publish(jobId, { type: "thinking", message: "Thinking" }, 0);

      const startIndex = await redis.llen(`job:${jobId}:events`);
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
        startIndex,
        initialSandbox,
      );

      if (!cancelled) {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.COMPLETED, completedAt: new Date() },
        });
        await settle(jobId).catch((err) =>
          console.error(`[worker] settle failed on complete for ${jobId}`, err),
        );
      }
    } finally {
      await sub.unsubscribe(controlChannel);
      await sub.quit();
    }
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  },
);

worker.on("failed", async (job, err) => {
  if (job) {
    await prisma.job.update({
      where: { id: job.data.jobId },
      data: { status: JobStatus.FAILED, error: err.message },
    });
    await settle(job.data.jobId).catch((settleErr) =>
      console.error(
        `[worker] settle failed on job failure for ${job.data.jobId}`,
        settleErr,
      ),
    );
  }
});

worker.on("ready", () => {
  console.log(
    `[worker] ready — queue="${env.QUEUE_NAME}" concurrency=${env.WORKER_CONCURRENCY}`,
  );
});

worker.on("error", (err) => {
  console.error("[worker] error", err);
});

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down…`);
  await worker.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
