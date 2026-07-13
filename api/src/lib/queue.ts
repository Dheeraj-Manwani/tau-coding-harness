import { bus } from "./bus";
import type { Effort, JobType } from "../generated/prisma/enums";

export const CODE_GENERATION_QUEUE = "code-generation";

export interface JobPayload {
  jobId: string;
  projectId: string;
  userId: string;
  prompt: string;
  effort: Effort;
  type?: JobType;
}

/**
 * Economy (Redis-free): hand the job to the in-process runner. The Job row is
 * already created by project.service before this call, so there's nothing to
 * persist here — dispatch is a direct in-process signal.
 */
export async function enqueueJob(data: JobPayload): Promise<string> {
  bus.dispatch(data);
  return data.jobId;
}
