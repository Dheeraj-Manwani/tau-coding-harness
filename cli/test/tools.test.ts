import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTool } from "../src/agent/tools/read.ts";
import { writeTool } from "../src/agent/tools/write.ts";
import { editTool } from "../src/agent/tools/edit.ts";
import { bashTool } from "../src/agent/tools/bash.ts";
import { toolsForMode } from "../src/agent/tools/index.ts";
import { ToolError } from "../src/agent/tools/types.ts";

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "tau-test-"));
  return { cwd: dir };
}

describe("write + read", () => {
  test("writes a file and reads it back with line numbers", async () => {
    const ctx = await scratch();
    await writeTool.run({ path: "a/b.txt", content: "hello\nworld" }, ctx);

    const onDisk = await readFile(join(ctx.cwd, "a/b.txt"), "utf8");
    expect(onDisk).toBe("hello\nworld");

    const out = await readTool.run({ path: "a/b.txt" }, ctx);
    expect(out).toContain("1\thello");
    expect(out).toContain("2\tworld");
  });

  test("read paginates with offset/limit", async () => {
    const ctx = await scratch();
    await writeTool.run({ path: "n.txt", content: "l1\nl2\nl3\nl4" }, ctx);
    const out = await readTool.run({ path: "n.txt", offset: 2, limit: 2 }, ctx);
    expect(out).toContain("2\tl2");
    expect(out).toContain("3\tl3");
    expect(out).not.toContain("1\tl1");
  });
});

describe("edit", () => {
  test("replaces a unique string", async () => {
    const ctx = await scratch();
    await writeTool.run({ path: "f.txt", content: "foo bar baz" }, ctx);
    await editTool.run({ path: "f.txt", old_string: "bar", new_string: "QUX" }, ctx);
    expect(await readFile(join(ctx.cwd, "f.txt"), "utf8")).toBe("foo QUX baz");
  });

  test("errors when old_string is ambiguous without replace_all", async () => {
    const ctx = await scratch();
    await writeTool.run({ path: "f.txt", content: "x x x" }, ctx);
    await expect(
      editTool.run({ path: "f.txt", old_string: "x", new_string: "y" }, ctx),
    ).rejects.toBeInstanceOf(ToolError);
  });

  test("replace_all replaces every occurrence", async () => {
    const ctx = await scratch();
    await writeTool.run({ path: "f.txt", content: "x x x" }, ctx);
    await editTool.run(
      { path: "f.txt", old_string: "x", new_string: "y", replace_all: true },
      ctx,
    );
    expect(await readFile(join(ctx.cwd, "f.txt"), "utf8")).toBe("y y y");
  });

  test("errors when old_string is missing", async () => {
    const ctx = await scratch();
    await writeTool.run({ path: "f.txt", content: "abc" }, ctx);
    await expect(
      editTool.run({ path: "f.txt", old_string: "zzz", new_string: "y" }, ctx),
    ).rejects.toBeInstanceOf(ToolError);
  });
});

describe("bash", () => {
  test("runs a command and reports the exit code", async () => {
    const ctx = await scratch();
    const out = await bashTool.run({ command: "echo tau-ok" }, ctx);
    expect(out).toContain("tau-ok");
    expect(out).toContain("Exit code: 0");
  });
});

describe("toolsForMode", () => {
  test("plan mode exposes non-mutating tools plus write", () => {
    const names = toolsForMode("plan").map((t) => t.name).sort();
    expect(names).toEqual([
      "dispatch_review_agent",
      "dispatch_search_agent",
      "prompt_user",
      "read",
      "switch_mode",
      "write",
    ]);
  });

  test("build mode exposes every tool", () => {
    const names = toolsForMode("build").map((t) => t.name).sort();
    expect(names).toEqual([
      "bash",
      "dispatch_code_agent",
      "dispatch_review_agent",
      "dispatch_search_agent",
      "edit",
      "prompt_user",
      "read",
      "switch_mode",
      "write",
    ]);
  });

  test("the mutating code-dispatch tool is hidden in plan mode", () => {
    const plan = toolsForMode("plan").map((t) => t.name);
    expect(plan).not.toContain("dispatch_code_agent");
    expect(plan).not.toContain("bash");
    expect(plan).not.toContain("edit");
  });
});
