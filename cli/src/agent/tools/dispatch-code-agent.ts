import { ToolError, type Tool } from "./types.ts";

export const dispatchCodeAgent: Tool = {
  name: "dispatch_code_agent",
  description:
    "Delegate a self-contained implementation subtask to an autonomous build sub-agent (e.g. 'add a deepseek provider module mirroring openai.ts and register it'). The sub-agent can read, write, edit, and run shell commands, and returns a summary of what it changed. It shares none of your conversation, so give it a precise, well-scoped task plus the context it needs. Prefer making small changes yourself; use this for larger, separable chunks of work to keep your own context focused. It cannot ask the user questions, so don't delegate ambiguous tasks.",
  mutating: true,
  schema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The implementation task, scoped precisely (what to build/change and the definition of done).",
      },
      context: {
        type: "string",
        description:
          "Background the sub-agent needs: relevant files, patterns to follow, constraints, and how to verify.",
      },
    },
    required: ["task"],
  },
  summarize: (input) => `code agent: ${input.task ?? "(task)"}`,
  run(input, ctx) {
    if (!ctx.spawnSubAgent) {
      throw new ToolError("Sub-agents are not available in this session.");
    }
    const task = String(input.task ?? "").trim();
    if (!task) throw new ToolError("`task` must not be empty.");
    return ctx.spawnSubAgent({ kind: "code", task, context: input.context });
  },
};
