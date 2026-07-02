import { redis } from "@/lib/redis";

/** Generous — comfortably outlives a single job's agent loop. */
const PLAN_TTL_SECONDS = 2 * 60 * 60;

function planKey(jobId: string): string {
  return `job:${jobId}:plan_created`;
}

/** Call once create_plan has published, so later todo calls can be validated. */
export async function markPlanCreated(jobId: string): Promise<void> {
  await redis.set(planKey(jobId), "1", "EX", PLAN_TTL_SECONDS);
}

/** Returns an agent-visible error message if no plan exists yet for this job, else null. */
export async function requirePlanCreated(jobId: string): Promise<string | null> {
  const exists = await redis.get(planKey(jobId));
  return exists
    ? null
    : "No plan exists yet for this job — call create_plan before updating or adding todos.";
}
