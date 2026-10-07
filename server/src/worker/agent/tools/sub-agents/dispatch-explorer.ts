import type Sandbox from "e2b";
import type { Effort } from "@/generated/prisma/enums";
import { asString } from "../functions/utils";
import { executeSubAgentLoop } from "./sub-agent-executor";

export async function dispatchExplorer(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
  model: string,
  effort: Effort,
) {
  const task = asString((input as { task?: unknown }).task, "task");

  const summary = await executeSubAgentLoop({
    kind: "explorer",
    task,
    sandbox,
    jobId,
    projectId,
    userId,
    nextIndex,
    model,
    effort,
  });

  return { summary };
}
