import { describe, expect, test } from "bun:test";
import type { Sandbox } from "e2b";
import {
  MAX_COMMAND_STREAM_CHARS,
  MAX_DIR_ENTRIES,
  MAX_GREP_LINES,
  MAX_READ_CHARS,
  MAX_READ_LINES,
  MAX_TAIL_CHARS,
  headTail,
  pageOf,
  shellQuote,
  tailOnly,
} from "@/worker/agent/tools/functions/output";
import {
  buildGrepCommand,
  grepTool,
  parseGrepInput,
  shapeGrepOutput,
} from "@/worker/agent/tools/functions/grep";
import { readFile } from "@/worker/agent/tools/functions/read";
import { runCommand } from "@/worker/agent/tools/functions/run-command";
import { tailCommandOutput } from "@/worker/agent/tools/functions/tail-command-output";
import { listDir } from "@/worker/agent/tools/functions/list-dir";

// What a tool returns is paid for on every later turn, so the tools bound it
// themselves — and keep whatever did not fit reachable, on disk, rather than
// cutting it and losing it. See doc/CONTEXT_AND_MEMORY_PLAN.md §7.

const APP = "/home/user/app";
const numbered = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `line ${i + from}`).join("\n");

/** A sandbox that records what it was asked to do. */
function fakeSandbox(opts: {
  files?: Record<string, string>;
  run?: (cmd: string) => { exitCode?: number; stdout?: string; stderr?: string };
  entries?: number;
}) {
  const written: Record<string, string> = {};
  const commands: string[] = [];
  const sandbox = {
    files: {
      read: async (path: string) => {
        const content = opts.files?.[path];
        if (content === undefined) throw new Error(`not found: ${path}`);
        return content;
      },
      write: async (path: string, content: string) => {
        written[path] = content;
      },
      list: async () =>
        Array.from({ length: opts.entries ?? 0 }, (_, i) => ({
          name: `f${i}.ts`,
          path: `${APP}/src/f${i}.ts`,
          type: "file",
          size: 1,
        })),
    },
    commands: {
      run: async (cmd: string) => {
        commands.push(cmd);
        return { exitCode: 0, stdout: "", stderr: "", ...opts.run?.(cmd) };
      },
    },
  } as unknown as Sandbox;
  return { sandbox, written, commands };
}

describe("headTail", () => {
  test("leaves short text exactly as it is", () => {
    expect(headTail("all good", 100)).toEqual({ text: "all good", truncated: false });
  });

  test("keeps the start and the end, and more of the end", () => {
    const text = `START${"x".repeat(5_000)}END`;
    const out = headTail(text, 1_000);
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith("START")).toBe(true);
    expect(out.text.endsWith("END")).toBe(true);
    // What went wrong is at the bottom of a build log, so the tail gets 60%.
    const [head, tail] = out.text.split(/\n\n…\[\d+ characters cut\]…\n\n/);
    expect(head!.length).toBe(400);
    expect(tail!.length).toBe(600);
  });

  test("says how much it cut", () => {
    expect(headTail("a".repeat(1_500), 1_000).text).toContain("[500 characters cut]");
  });
});

describe("tailOnly", () => {
  test("keeps the end", () => {
    const out = tailOnly(`${"x".repeat(500)}THE END`, 100);
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith("THE END")).toBe(true);
    expect(out.text).toContain("[407 earlier characters cut]");
  });
});

describe("pageOf", () => {
  test("a file that fits comes back whole, in the shape it always had", () => {
    // `edit_file` matches against this content byte for byte, and existing
    // histories hold results of exactly this shape.
    const content = "const a = 1\nconst b = 2\n";
    expect(pageOf(content)).toEqual({ content });
  });

  test("a long file comes back as its first page, with how to read on", () => {
    const page = pageOf(numbered(1_500));
    expect(page.startLine).toBe(1);
    expect(page.endLine).toBe(MAX_READ_LINES);
    expect(page.totalLines).toBe(1_500);
    expect(page.truncated).toBe(true);
    expect(page.content.split("\n")).toHaveLength(MAX_READ_LINES);
    expect(page.note).toContain(`offset=${MAX_READ_LINES + 1}`);
  });

  test("offset and limit return exactly that range", () => {
    const page = pageOf(numbered(1_500), { offset: 601, limit: 3 });
    expect(page.content).toBe("line 601\nline 602\nline 603");
    expect(page).toMatchObject({ startLine: 601, endLine: 603, totalLines: 1_500 });
    // The request was met in full, so this is not a truncation.
    expect(page.truncated).toBeUndefined();
  });

  test("pages join back into the original file", () => {
    const content = `${numbered(1_500)}\n`;
    let rebuilt = "";
    let offset = 1;
    for (let guard = 0; guard < 10; guard++) {
      const page = pageOf(content, { offset });
      rebuilt += rebuilt && !rebuilt.endsWith("\n") ? `\n${page.content}` : page.content;
      if (page.endLine! >= page.totalLines!) break;
      offset = page.endLine! + 1;
    }
    expect(rebuilt).toBe(content);
  });

  test("the content never carries line numbers", () => {
    const page = pageOf(numbered(1_500), { offset: 10, limit: 2 });
    expect(page.content).toBe("line 10\nline 11");
  });

  test("a file with few lines but too many characters is still paged", () => {
    const wide = Array.from({ length: 100 }, () => "y".repeat(1_000)).join("\n");
    const page = pageOf(wide);
    expect(page.content.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(page.endLine).toBeLessThan(100);
    expect(page.truncated).toBe(true);
  });

  test("one enormous line is cut rather than skipped or returned whole", () => {
    const page = pageOf("z".repeat(MAX_READ_CHARS * 3));
    expect(page.content.length).toBeLessThan(MAX_READ_CHARS + 50);
    expect(page.truncated).toBe(true);
    expect(page.note).toContain("grep");
  });

  test("reading past the end says how long the file is", () => {
    const page = pageOf(numbered(10), { offset: 50 });
    expect(page.content).toBe("");
    expect(page.note).toContain("10 lines");
  });

  test("ignores junk for offset and limit", () => {
    const content = "a\nb\n";
    expect(pageOf(content, { offset: "3", limit: -1 })).toEqual({ content });
  });
});

describe("read_file", () => {
  test("pages a long file through the sandbox", async () => {
    const { sandbox } = fakeSandbox({ files: { [`${APP}/src/big.ts`]: numbered(2_000) } });
    const first = (await readFile({ path: "src/big.ts" }, sandbox)) as { endLine: number };
    expect(first.endLine).toBe(MAX_READ_LINES);
    const next = (await readFile(
      { path: "src/big.ts", offset: first.endLine + 1, limit: 2 },
      sandbox,
    )) as { content: string };
    expect(next.content).toBe("line 601\nline 602");
  });
});

describe("run_command", () => {
  test("short output passes through untouched and writes nothing", async () => {
    const { sandbox, written } = fakeSandbox({ run: () => ({ stdout: "ok\n" }) });
    const result = await runCommand({ command: "bunx tsc --noEmit" }, sandbox);
    expect(result).toEqual({ exitCode: 0, stdout: "ok\n", stderr: "" });
    expect(written).toEqual({});
  });

  test("long output is cut in the result and saved whole to .tau/logs", async () => {
    const big = `FIRST\n${"noise\n".repeat(5_000)}LAST ERROR\n`;
    const { sandbox, written } = fakeSandbox({ run: () => ({ stdout: big }) });

    const result = (await runCommand({ command: "bun run build" }, sandbox)) as unknown as {
      stdout: string;
      truncated: boolean;
      logPath: string;
      note: string;
    };

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(MAX_COMMAND_STREAM_CHARS + 100);
    expect(result.stdout.startsWith("FIRST")).toBe(true);
    expect(result.stdout.trimEnd().endsWith("LAST ERROR")).toBe(true);

    // Nothing is lost: the full output is on disk, and the result says where.
    expect(result.logPath).toMatch(/^\.tau\/logs\/\d+-bun-run-build\.out$/);
    expect(written[`${APP}/${result.logPath}`]).toContain(big);
    expect(result.note).toContain(result.logPath);
  });

  test("caps stderr of a failed command too", async () => {
    const { sandbox } = fakeSandbox({});
    const { CommandExitError } = await import("e2b");
    const failing = {
      ...sandbox,
      commands: {
        run: async () => {
          throw new CommandExitError({
            exitCode: 2,
            stdout: "",
            stderr: "e".repeat(50_000),
          });
        },
      },
    } as unknown as Sandbox;

    const result = (await runCommand({ command: "bun test" }, failing)) as unknown as {
      exitCode: number;
      stderr: string;
      truncated: boolean;
    };
    expect(result.exitCode).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.stderr.length).toBeLessThan(MAX_COMMAND_STREAM_CHARS + 100);
  });
});

describe("tail_command_output", () => {
  test("bounds the result by size, not just by line count", async () => {
    const { sandbox, commands } = fakeSandbox({
      run: () => ({ stdout: `${"w".repeat(60_000)}END` }),
    });
    const result = (await tailCommandOutput({ logPath: ".tau/logs/a.log" }, sandbox)) as {
      content: string;
      truncated: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThan(MAX_TAIL_CHARS + 100);
    expect(result.content.endsWith("END")).toBe(true);
    expect(commands[0]).toBe("tail -n 200 '.tau/logs/a.log'");
  });
});

describe("list_dir", () => {
  test("caps a listing that wandered somewhere huge", async () => {
    const { sandbox } = fakeSandbox({ entries: MAX_DIR_ENTRIES + 250 });
    const result = (await listDir({ path: ".", depth: 6 }, sandbox)) as {
      entries: unknown[];
      truncated: boolean;
      note: string;
    };
    expect(result.entries).toHaveLength(MAX_DIR_ENTRIES);
    expect(result.truncated).toBe(true);
    expect(result.note).toContain(String(MAX_DIR_ENTRIES + 250));
  });

  test("a normal listing is unchanged", async () => {
    const { sandbox } = fakeSandbox({ entries: 3 });
    const result = (await listDir({}, sandbox)) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["entries"]);
  });
});

describe("shellQuote", () => {
  test("wraps in single quotes and survives a quote inside", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('$(rm -rf /) `x` "y"')).toBe(`'$(rm -rf /) \`x\` "y"'`);
  });
});

describe("grep", () => {
  test("defaults to the whole project, case-sensitive, no context", () => {
    expect(parseGrepInput({ pattern: "useQuery" })).toEqual({
      pattern: "useQuery",
      path: ".",
      ignoreCase: false,
      context: 0,
    });
  });

  test("clamps context", () => {
    expect(parseGrepInput({ pattern: "x", context: 99 }).context).toBe(5);
  });

  test("uses ripgrep when the sandbox has it and plain grep when it does not", () => {
    const cmd = buildGrepCommand(parseGrepInput({ pattern: "initDb" }));
    expect(cmd).toStartWith("if command -v rg >/dev/null 2>&1; then rg ");
    expect(cmd).toContain("; else grep -rnIE ");
    // The fallback has no .gitignore to lean on.
    expect(cmd).toContain("--exclude-dir=node_modules");
  });

  test("a pattern is always data: quoted, and passed with -e", () => {
    const cmd = buildGrepCommand(
      parseGrepInput({ pattern: "--files'; rm -rf / #", path: "src", glob: "*.tsx" }),
    );
    expect(cmd).toContain(`-e '--files'\\''; rm -rf / #' -- 'src'`);
    expect(cmd).toContain("--glob '*.tsx'");
    expect(cmd).toContain("--include='*.tsx'");
  });

  test("passes the options through to both tools", () => {
    const cmd = buildGrepCommand(
      parseGrepInput({ pattern: "todo", ignoreCase: true, context: 2 }),
    );
    expect(cmd).toContain("--ignore-case");
    expect(cmd).toContain("--context 2");
    expect(cmd).toContain(" -i ");
    expect(cmd).toContain("-C 2");
  });

  test("returns at most a screenful, and says when there was more", () => {
    const out = shapeGrepOutput(
      Array.from({ length: 250 }, (_, i) => `src/a.ts:${i + 1}:match`).join("\n"),
    );
    expect(out.lines).toBe(MAX_GREP_LINES);
    expect(out.truncated).toBe(true);
    expect(out.note).toContain("250");
  });

  test("cuts a very long matching line", () => {
    const out = shapeGrepOutput(`dist/app.js:1:${"q".repeat(5_000)}`);
    expect(out.matches.length).toBeLessThan(400);
  });

  test("finding nothing is an answer, not an error", async () => {
    const { CommandExitError } = await import("e2b");
    const sandbox = {
      commands: {
        run: async () => {
          throw new CommandExitError({
            exitCode: 1,
            stdout: "",
            stderr: "",
          });
        },
      },
    } as unknown as Sandbox;
    expect(await grepTool({ pattern: "nowhere" }, sandbox)).toEqual({
      matches: "",
      lines: 0,
      note: "No matches.",
    });
  });

  test("a bad pattern comes back as an error the model can read", async () => {
    const { CommandExitError } = await import("e2b");
    const sandbox = {
      commands: {
        run: async () => {
          throw new CommandExitError({
            exitCode: 2,
            stdout: "",
            stderr: "regex parse error: unclosed group",
          });
        },
      },
    } as unknown as Sandbox;
    const result = (await grepTool({ pattern: "(" }, sandbox)) as { error: string };
    expect(result.error).toContain("regex parse error");
  });

  test("returns the matches it found", async () => {
    const { sandbox } = fakeSandbox({
      run: () => ({ stdout: "src/App.tsx:12:  <Route path=\"/\" />\n" }),
    });
    expect(await grepTool({ pattern: "Route" }, sandbox)).toEqual({
      matches: 'src/App.tsx:12:  <Route path="/" />',
      lines: 1,
    });
  });
});
