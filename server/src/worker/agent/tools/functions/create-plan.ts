import { publish } from "@/worker/lib/publish";
import { applyPlanCall, renderPlan } from "../../plan";
import { asString, asStringArray } from "./utils";

/**
 * `create_plan`: start a plan. Like every plan tool it answers with the whole
 * plan as it now stands, so the agent's latest copy is the tool result it has
 * just read rather than a call it made many turns ago (`agent/plan.ts`).
 */
export async function createPlan(input: unknown, jobId: string) {
  const { name, description, todos } = input as {
    name?: unknown;
    description?: unknown;
    todos?: unknown;
  };
  const planName = asString(name, "name");
  const planDescription = asString(description, "description");
  const todoList = todos === undefined ? [] : asStringArray(todos, "todos");

  await publish(jobId, {
    type: "plan_created",
    name: planName,
    description: planDescription,
    todos: todoList,
  });

  const plan = applyPlanCall(null, {
    tool: "create_plan",
    input: { name: planName, description: planDescription, todos: todoList },
  });
  return { success: true, ...(plan ? { plan: renderPlan(plan) } : {}) };
}
