import { Queue, type ConnectionOptions } from "bullmq";
import { redis } from "./redis";
import type { Effort } from "../generated/prisma/enums";

const connection = redis as ConnectionOptions;

export const CODE_GENERATION_QUEUE = "code-generation";

export interface JobPayload {
  jobId: string;
  projectId: string;
  userId: string;
  prompt: string;
  effort: Effort;
}

export const codeGenerationQueue = new Queue<JobPayload>(
  CODE_GENERATION_QUEUE,
  {
    connection,
  },
);

export async function enqueueJob(data: JobPayload): Promise<string> {
  const job = await codeGenerationQueue.add(CODE_GENERATION_QUEUE, data, {
    jobId: data.jobId,
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
  });

  return job.id!;
}
