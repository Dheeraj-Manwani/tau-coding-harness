import type { Tool } from "./types.ts";
import { readTool } from "./read.ts";
import { writeTool } from "./write.ts";
import { editTool } from "./edit.ts";
import { bashTool } from "./bash.ts";
import { switchModeTool } from "./switch-mode.ts";

export type { Tool, ToolContext } from "./types.ts";
export { ToolError } from "./types.ts";

export const ALL_TOOLS: Tool[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  switchModeTool,
];

/**
 * Tools available in a given agent mode.
 *  - build: everything
 *  - plan:  read-only tools, plus `write` so the agent can save its plan
 *           document (it must not edit existing files or run commands).
 * `switch_mode` is non-mutating, so it survives the plan-mode filter — that's
 * intentional: it's how the agent escapes plan mode when the task needs it.
 */
export function toolsForMode(mode: "build" | "plan"): Tool[] {
  if (mode === "plan") {
    return ALL_TOOLS.filter((t) => !t.mutating || t.name === "write");
  }
  return ALL_TOOLS;
}
