import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.ts";
import { ToolError } from "./types.ts";

export const editTool: Tool = {
  name: "edit",
  description:
    "Replace an exact string in a file. `old_string` must appear exactly once " +
    "(unless `replace_all` is true) and must differ from `new_string`. Include " +
    "enough surrounding context to make the match unique.",
  mutating: true,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to edit." },
      old_string: { type: "string", description: "The exact text to find." },
      new_string: { type: "string", description: "The text to replace it with." },
      replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
    },
    required: ["path", "old_string", "new_string"],
  },
  summarize: (input) => `edit ${input.path}`,
  async run(input, ctx) {
    const { old_string, new_string, replace_all } = input;
    if (old_string === new_string) {
      throw new ToolError("`old_string` and `new_string` are identical.");
    }
    const path = isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path);

    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (e: any) {
      throw new ToolError(`Could not read ${path}: ${e.code ?? e.message}`);
    }

    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) {
      throw new ToolError(`\`old_string\` not found in ${path}.`);
    }
    if (occurrences > 1 && !replace_all) {
      throw new ToolError(
        `\`old_string\` appears ${occurrences} times in ${path}. ` +
          `Add more context to make it unique, or set replace_all=true.`,
      );
    }

    const updated = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string);

    try {
      await writeFile(path, updated, "utf8");
    } catch (e: any) {
      throw new ToolError(`Could not write ${path}: ${e.code ?? e.message}`);
    }

    return `Replaced ${replace_all ? occurrences : 1} occurrence(s) in ${path}`;
  },
};
