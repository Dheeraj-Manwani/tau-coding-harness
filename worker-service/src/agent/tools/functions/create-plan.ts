import { publish } from "@/lib/publish";
import { asString } from "./utils";

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
  const todoList =
    typeof todos === "string" && todos.trim()
      ? todos
          .split(/[,，;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

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
