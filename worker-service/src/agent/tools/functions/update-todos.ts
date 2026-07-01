import { publish } from "@/lib/publish";
import { asString } from "./utils";

export async function updateTodo(
  input: unknown,
  jobId: string,
  indexer: () => number,
) {
  const { sno, status } = input as { sno?: unknown; status?: unknown };
  if (typeof sno !== "number")
    throw new Error("Tool input 'sno' must be a number");
  const todoStatus = asString(status, "status");

  await publish(
    jobId,
    { type: "todo_updated", sno, status: todoStatus },
    indexer(),
  );
  return { success: true };
}
