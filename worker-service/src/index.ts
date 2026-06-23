import { Worker, type ConnectionOptions } from "bullmq";
import { env } from "./lib/env";
import { redis } from "./lib/redis";
import { prisma } from "./lib/prisma";
import { publish } from "./lib/publish";
import { provisionSandbox } from "./lib/sandbox";
import { runAgentLoop } from "./agent/loop";
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

    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING, startedAt: new Date() },
    });

    await publish(jobId, { type: "thinking", message: "Starting generation" }, 0);

    const sandbox = await provisionSandbox(projectId);
    await runAgentLoop(jobId, projectId, userId, prompt, sandbox);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.COMPLETED, completedAt: new Date() },
    });
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
