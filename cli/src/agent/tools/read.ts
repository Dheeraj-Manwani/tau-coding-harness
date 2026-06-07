import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.ts";
import { ToolError } from "./types.ts";

const MAX_LINES = 2000;
const MAX_LINE_LEN = 2000;

export const readTool: Tool = {
  name: "read",
  description:
    "Read a file from the filesystem. Returns the contents with 1-based line " +
    "numbers. Use `offset` and `limit` to page through large files.",
  mutating: false,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file (absolute or relative to the project root)." },
      offset: { type: "number", description: "1-based line number to start reading from." },
      limit: { type: "number", description: "Maximum number of lines to read (default 2000)." },
    },
    required: ["path"],
  },
  summarize: (input) => `read ${input.path}`,
  async run(input, ctx) {
    const path = isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (e: any) {
      throw new ToolError(`Could not read ${path}: ${e.code ?? e.message}`);
    }

    const allLines = content.split("\n");
    const offset = Math.max(1, input.offset ?? 1);
    const limit = Math.min(input.limit ?? MAX_LINES, MAX_LINES);
    const slice = allLines.slice(offset - 1, offset - 1 + limit);

    if (slice.length === 0) {
      return `(file has ${allLines.length} lines; offset ${offset} is past the end)`;
    }

    const numbered = slice.map((line, i) => {
      const n = offset + i;
      const truncated =
        line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + " …(truncated)" : line;
      return `${String(n).padStart(6)}\t${truncated}`;
    });

    const more =
      offset - 1 + slice.length < allLines.length
        ? `\n… (${allLines.length - (offset - 1 + slice.length)} more lines, use offset to continue)`
        : "";
    return numbered.join("\n") + more;
  },
};
