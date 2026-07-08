import type Sandbox from "e2b";
import { asString } from "../functions/utils";
import { VERIFIER_PROMPT } from "./config";
import { executeSubAgentLoop } from "./sub-agent-executor";
import { EXPLORATION_TOOLS } from "./tool-sets";

export async function dispatchVerifier(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
  model: string,
) {
  const { scope, checks } = input as { scope?: unknown; checks?: unknown };
  const scopeDescription = asString(scope, "scope");
  const checkList = Array.isArray(checks)
    ? (checks as unknown[]).map((c) => asString(c, "checks[]"))
    : [];

  const task = checkList.length
    ? `${scopeDescription}\n\nSpecific checks to run:\n${checkList
        .map((c) => `- ${c}`)
        .join("\n")}`
    : scopeDescription;

  const summary = await executeSubAgentLoop(
    [VERIFIER_PROMPT, task],
    EXPLORATION_TOOLS,
    sandbox,
    jobId,
    projectId,
    userId,
    nextIndex,
    model,
    "verifier",
  );

  return { summary };
}
