import type Sandbox from "e2b";
import { asString } from "../functions/utils";
import { EXPLORER_PROMPT } from "./config";
import { executeSubAgentLoop } from "./sub-agent-executor";
import { EXPLORATION_TOOLS } from "./tool-sets";

export async function dispatchExplorer(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
) {
  const task = asString((input as { task?: unknown }).task, "task");

  const summary = await executeSubAgentLoop(
    [EXPLORER_PROMPT, task],
    EXPLORATION_TOOLS,
    sandbox,
    jobId,
    projectId,
    userId,
    nextIndex,
  );

  return { summary };
}
