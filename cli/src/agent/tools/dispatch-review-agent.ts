import { ToolError, type Tool } from "./types.ts";

export const dispatchReviewAgent: Tool = {
  name: "dispatch_review_agent",
  description:
    "Spawn a read-only sub-agent to review code for correctness bugs, edge cases, and risky changes (e.g. 'review the current git diff', 'review src/auth/*.ts for security issues'). The sub-agent can read files and run read-only commands (git diff, grep) but cannot edit. Returns a prioritized list of findings, not raw transcripts. Use this to get a focused review without filling your own context with the code under review.",
  mutating: false,
  schema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "What to review and what to look for (e.g. 'the current diff, focus on error handling').",
      },
      context: {
        type: "string",
        description:
          "Relevant background the sub-agent needs (e.g. the intended behavior, files in scope, constraints).",
      },
    },
    required: ["task"],
  },
  summarize: (input) => `review agent: ${input.task ?? "(task)"}`,
  run(input, ctx) {
    if (!ctx.spawnSubAgent) {
      throw new ToolError("Sub-agents are not available in this session.");
    }
    const task = String(input.task ?? "").trim();
    if (!task) throw new ToolError("`task` must not be empty.");
    return ctx.spawnSubAgent({ kind: "review", task, context: input.context });
  },
};
