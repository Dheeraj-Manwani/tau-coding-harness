import { publish } from "@/worker/lib/publish";
import { asStringArray } from "./utils";
import { requirePlanCreated } from "./plan-state";

export async function addTodos(
  input: unknown,
  jobId: string,
  indexer: () => number,
) {
  const { todos } = input as { todos?: unknown };
  const todoList = asStringArray(todos, "todos");
  if (todoList.length === 0) {
    return { error: "'todos' must contain at least one non-empty item" };
  }

  const planError = await requirePlanCreated(jobId);
  if (planError) return { error: planError };

  await publish(jobId, { type: "todos_added", todos: todoList });
  return { success: true };
}
