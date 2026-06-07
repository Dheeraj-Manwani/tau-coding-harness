import type { AgentMode, Tool } from "./types.ts";
import { ToolError } from "./types.ts";

export const switchModeTool: Tool = {
  name: "switch_mode",
  description:
    "Request switching the agent's operating mode between 'plan' (read-only, " +
    "may only write a plan document) and 'build' (full read/write/shell " +
    "access). The user is asked to confirm; the mode changes only if they " +
    "accept. Use this when the current task needs capabilities the active mode " +
    "lacks — e.g. you are in plan mode but the user wants you to implement the " +
    "change, so you request a switch to build mode. After the result, continue " +
    "the task in the mode now in effect.",
  mutating: false,
  schema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: ["plan", "build"],
        description: "The mode to switch to.",
      },
      reason: {
        type: "string",
        description:
          "A short, user-facing reason for the switch, shown in the prompt.",
      },
    },
    required: ["target"],
  },
  summarize: (input) => `switch to ${input.target} mode`,
  async run(input, ctx) {
    const target = input.target as AgentMode;
    if (target !== "plan" && target !== "build") {
      throw new ToolError(`Unknown mode "${input.target}".`);
    }
    if (!ctx.requestModeSwitch) {
      throw new ToolError("Mode switching is not available in this session.");
    }
    const result = await ctx.requestModeSwitch(target, input.reason);
    return result.switched
      ? `Switched to ${result.mode} mode. You now have ${result.mode}-mode tools.`
      : `User declined the switch. Still in ${result.mode} mode — do not retry ` +
          `the switch unless the user asks; work within this mode or stop and ` +
          `explain what you need.`;
  },
};
