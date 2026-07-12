import { bus } from "@/lib/bus";

/** Call once create_plan has published, so later todo calls can be validated. */
export async function markPlanCreated(jobId: string): Promise<void> {
  bus.markPlan(jobId);
}

/** Returns an agent-visible error message if no plan exists yet for this job, else null. */
export async function requirePlanCreated(jobId: string): Promise<string | null> {
  return bus.hasPlan(jobId)
    ? null
    : "No plan exists yet for this job — call create_plan before updating or adding todos.";
}
