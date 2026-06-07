import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.ts";
import { ToolError } from "./types.ts";

export const writeTool: Tool = {
  name: "write",
  description:
    "Write a file to the filesystem, creating parent directories as needed. " +
    "Overwrites the file if it already exists. Prefer `edit` for changes to an " +
    "existing file.",
  mutating: true,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file (absolute or relative to the project root)." },
      content: { type: "string", description: "The full contents to write." },
    },
    required: ["path", "content"],
  },
  summarize: (input) => `write ${input.path}`,
  async run(input, ctx) {
    if (typeof input.content !== "string") {
      throw new ToolError("`content` must be a string.");
    }
    const path = isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.content, "utf8");
    } catch (e: any) {
      throw new ToolError(`Could not write ${path}: ${e.code ?? e.message}`);
    }
    const bytes = Buffer.byteLength(input.content, "utf8");
    const lines = input.content.split("\n").length;
    return `Wrote ${bytes} bytes (${lines} lines) to ${path}`;
  },
};
