import { publish } from "@/worker/lib/publish";
import {
  TODO_STATUSES,
  applyPlanCall,
  loadPlan,
  normalizeStatus,
  renderPlan,
} from "../../plan";

export const NO_PLAN_ERROR =
  "No plan exists yet for this job — call create_plan before updating or adding todos.";

/**
 * `update_todo`: change one todo's status, and get the whole plan back.
 *
 * @param toolCallId  this call's stored row, so the plan can be read as it
 *                    stood just before it — including other updates made in
 *                    the same turn, which run alongside this one
 */
export async function updateTodo(input: unknown, jobId: string, toolCallId?: string) {
  const { sno, status } = input as { sno?: unknown; status?: unknown };
  if (typeof sno !== "number")
    throw new Error("Tool input 'sno' must be a number");

  const next = normalizeStatus(status);
  if (next === null) {
    return { error: `'status' must be one of: ${TODO_STATUSES.join(", ")}.` };
  }

  const before = await loadPlan(jobId, toolCallId);
  if (!before) return { error: NO_PLAN_ERROR };
  if (!before.todos.some((t) => t.sno === sno)) {
    // Said with the list, because a wrong number usually means the agent has
    // lost track of it.
    return {
      error: `There is no todo ${sno}. The plan has ${before.todos.length}.`,
      plan: renderPlan(before),
    };
  }

  await publish(jobId, { type: "todo_updated", sno, status: next });

  const plan = applyPlanCall(before, { tool: "update_todo", input: { sno, status: next } })!;
  return { success: true, plan: renderPlan(plan) };
}
