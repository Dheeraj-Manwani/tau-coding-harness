import type Sandbox from "e2b";
import type { Effort } from "@/generated/prisma/enums";
import { asString } from "../functions/utils";
import { executeSubAgentLoop } from "./sub-agent-executor";

export async function dispatchVerifier(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
  model: string,
  effort: Effort,
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

  const summary = await executeSubAgentLoop({
    kind: "verifier",
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
