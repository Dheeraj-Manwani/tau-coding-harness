import type Sandbox from "e2b";
import type { Effort } from "@/generated/prisma/enums";
import { asString } from "../functions/utils";
import { executeSubAgentLoop } from "./sub-agent-executor";

export async function dispatchDebugger(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
  model: string,
  effort: Effort,
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

  const summary = await executeSubAgentLoop({
    kind: "debugger",
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
