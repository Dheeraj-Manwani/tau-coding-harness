import { publish } from "@/worker/lib/publish";
import { applyPlanCall, loadPlan, renderPlan } from "../../plan";
import { NO_PLAN_ERROR } from "./update-todos";
import { asStringArray } from "./utils";

/** `add_todos`: append to the plan, and get the whole plan back. */
export async function addTodos(input: unknown, jobId: string, toolCallId?: string) {
  const { todos } = input as { todos?: unknown };
  const todoList = asStringArray(todos, "todos");
  if (todoList.length === 0) {
    return { error: "'todos' must contain at least one non-empty item" };
  }

  const before = await loadPlan(jobId, toolCallId);
  if (!before) return { error: NO_PLAN_ERROR };

  await publish(jobId, { type: "todos_added", todos: todoList });

  const plan = applyPlanCall(before, { tool: "add_todos", input: { todos: todoList } })!;
  return { success: true, plan: renderPlan(plan) };
}
