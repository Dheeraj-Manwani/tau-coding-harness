import { ToolError, type Tool } from "./types.ts";

export const dispatchSearchAgent: Tool = {
  name: "dispatch_search_agent",
  description:
    "Spawn a read-only sub-agent to explore the codebase and answer a question (e.g. 'where is auth handled', 'find all callers of foo()'). The sub-agent has access to read/bash (read-only commands like grep, find, ls) but cannot edit files. Returns a concise summary/answer, not raw transcripts. Use this instead of doing broad exploration yourself to keep your context clean.",
  mutating: false,
  schema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The question or exploration goal.",
      },
      context: {
        type: "string",
        description:
          "Relevant background the sub-agent needs (e.g. relevant files already known, constraints).",
      },
    },
    required: ["task"],
  },
  summarize: (input) => `search agent: ${input.task ?? "(task)"}`,
  run(input, ctx) {
    if (!ctx.spawnSubAgent) {
      throw new ToolError("Sub-agents are not available in this session.");
    }
    const task = String(input.task ?? "").trim();
    if (!task) throw new ToolError("`task` must not be empty.");
    return ctx.spawnSubAgent({ kind: "search", task, context: input.context });
  },
};
