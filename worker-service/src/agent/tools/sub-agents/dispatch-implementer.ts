import type Sandbox from "e2b";
import { asString, asStringArray } from "../functions/utils";
import { IMPLEMENTER_PROMPT } from "./config";
import { executeSubAgentLoop } from "./sub-agent-executor";
import { IMPLEMENTER_TOOLS } from "./tool-sets";

export async function dispatchImplementer(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
  model: string,
) {
  const { goal, relevant_files } = input as {
    goal?: unknown;
    relevant_files?: unknown;
  };
  const goalDescription = asString(goal, "goal");
  const files =
    relevant_files === undefined
      ? []
      : asStringArray(relevant_files, "relevant_files");

  const task = files.length
    ? `${goalDescription}\n\nRelevant files to read first:\n${files
        .map((f) => `- ${f}`)
        .join("\n")}`
    : goalDescription;

  const summary = await executeSubAgentLoop(
    [IMPLEMENTER_PROMPT, task],
    IMPLEMENTER_TOOLS,
    sandbox,
    jobId,
    projectId,
    userId,
    nextIndex,
    model,
    "implementer",
  );

  return { summary };
}
