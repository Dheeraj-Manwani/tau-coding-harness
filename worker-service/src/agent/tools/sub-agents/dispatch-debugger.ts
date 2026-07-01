import type Sandbox from "e2b";
import { asString } from "../functions/utils";
import { DEBUGGER_PROMPT } from "./config";
import { executeSubAgentLoop } from "./sub-agent-executor";
import { EXPLORATION_TOOLS } from "./tool-sets";

export async function dispatchDebugger(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
) {
  const { problem, known_context } = input as {
    problem?: unknown;
    known_context?: unknown;
  };
  const problemDescription = asString(problem, "problem");
  const task =
    typeof known_context === "string" && known_context.trim()
      ? `${problemDescription}\n\nKnown context: ${known_context}`
      : problemDescription;

  const summary = await executeSubAgentLoop(
    [DEBUGGER_PROMPT, task],
    EXPLORATION_TOOLS,
    sandbox,
    jobId,
    projectId,
    userId,
    nextIndex,
  );

  return { summary };
}
