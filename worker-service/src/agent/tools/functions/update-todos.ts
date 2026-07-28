import { publish } from "@/lib/publish";
import { asString } from "./utils";
import { requirePlanCreated } from "./plan-state";

export async function updateTodo(
  input: unknown,
  jobId: string,
  indexer: () => number,
) {
  const { sno, status } = input as { sno?: unknown; status?: unknown };
  if (typeof sno !== "number")
    throw new Error("Tool input 'sno' must be a number");
  const todoStatus = asString(status, "status");

  const planError = await requirePlanCreated(jobId);
  if (planError) return { error: planError };

  await publish(jobId, { type: "todo_updated", sno, status: todoStatus });
  return { success: true };
}
