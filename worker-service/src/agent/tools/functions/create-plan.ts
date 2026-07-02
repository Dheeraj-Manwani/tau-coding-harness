import { publish } from "@/lib/publish";
import { asString, asStringArray } from "./utils";
import { markPlanCreated } from "./plan-state";

export async function createPlan(
  input: unknown,
  jobId: string,
  indexer: () => number,
) {
  const { name, description, todos } = input as {
    name?: unknown;
    description?: unknown;
    todos?: unknown;
  };
  const planName = asString(name, "name");
  const planDescription = asString(description, "description");
  const todoList = todos === undefined ? [] : asStringArray(todos, "todos");

  await markPlanCreated(jobId);

  await publish(
    jobId,
    {
      type: "plan_created",
      name: planName,
      description: planDescription,
      todos: todoList,
    },
    indexer(),
  );
  return { success: true };
}
