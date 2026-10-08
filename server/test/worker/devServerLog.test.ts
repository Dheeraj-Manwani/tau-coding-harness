import { describe, expect, test } from "bun:test";
import type { TemplateBuilder } from "e2b";
import { readDevServerLog, tailOfLog } from "@/worker/lib/devServerLog";
import { SEED_FIND_COMMAND, WORK_DIR } from "@/worker/lib/sandbox";
import {
  DEV_SERVER_LOG_CAP_AWK,
  DEV_SERVER_LOG_CAP_PATH,
  DEV_SERVER_LOG_MAX_BYTES,
  DEV_SERVER_LOG_PATH,
  DEV_SERVER_START_CMD,
  writeDevServerLogCap,
} from "@/worker/templates/shared";

// The base image keeps what its dev server prints, so that when an app will
// not compile or will not load, the reason can be read
// (doc/PREVIEW_DIAGNOSTICS_PLAN.md §3.6). Two things about it were learned the
// hard way on real sandboxes, and are pinned here.

describe("the dev server's log", () => {
  test("is kept beside the app, never in it", () => {
    // Inside the app it would be a file Vite watches and a file a new project
    // is seeded with. `/home/user` is neither.
    expect(DEV_SERVER_LOG_PATH).toBe("/home/user/.tau-vite.log");
    expect(DEV_SERVER_LOG_PATH.startsWith(`${WORK_DIR}/`)).toBe(false);
    expect(DEV_SERVER_LOG_CAP_PATH.startsWith(`${WORK_DIR}/`)).toBe(false);
  });

  test("is written through something that stops it growing without limit", () => {
    // While a browser has a broken app open, Vite prints the same error about
    // 270 KB a second. Redirected straight to a file, that is a full disk.
    expect(DEV_SERVER_START_CMD).not.toMatch(/>\s*\S*vite\.log/);
    expect(DEV_SERVER_START_CMD).toContain("bunx vite --host 2>&1 | awk");
    expect(DEV_SERVER_START_CMD).toContain(`-v f=${DEV_SERVER_LOG_PATH}`);
    expect(DEV_SERVER_START_CMD).toContain(`-v max=${DEV_SERVER_LOG_MAX_BYTES}`);
    expect(DEV_SERVER_START_CMD).toContain(`-f ${DEV_SERVER_LOG_CAP_PATH}`);
    expect(DEV_SERVER_LOG_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
    // The program starts the file again once it is past the limit, and writes
    // each line as it arrives.
    expect(DEV_SERVER_LOG_CAP_AWK).toContain("if (n > max)");
    expect(DEV_SERVER_LOG_CAP_AWK).toContain("fflush(f)");
  });

  test("is read line by line as it is printed, not a block at a time", () => {
    // The image's awk is mawk, which holds a pipe's input until 4 KB has
    // arrived. Without this flag the log of a server that printed one error is
    // empty: the template check caught exactly that.
    expect(DEV_SERVER_START_CMD).toContain("awk -W interactive ");
  });

  test("the program that writes it is put in the image before anything runs it", () => {
    const commands: string[] = [];
    const builder = {
      runCmd(command: string) {
        commands.push(command);
        return builder;
      },
    } as unknown as TemplateBuilder;
    writeDevServerLogCap(builder);
    expect(commands).toEqual([`cat > ${DEV_SERVER_LOG_CAP_PATH} <<'EOF'\n${DEV_SERVER_LOG_CAP_AWK}EOF`]);
    // The heredoc ends at a line reading EOF, and the program has none.
    expect(DEV_SERVER_LOG_CAP_AWK.endsWith("\n")).toBe(true);
    expect(DEV_SERVER_LOG_CAP_AWK).not.toMatch(/^EOF$/m);
  });

  test("command output under .tau/logs is never seeded into a project either", () => {
    expect(SEED_FIND_COMMAND).toContain("-not -path '*/.tau/logs/*'");
    expect(SEED_FIND_COMMAND).toContain("-not -path '*/node_modules/*'");
    expect(SEED_FIND_COMMAND).toContain("-not -path '*/.git/*'");
  });
});

describe("the end of the log, for reading", () => {
  const entry = (time: string, what: string) => [
    `${time} [vite] (client) Pre-transform error: ${what}`,
    "  Plugin: vite:import-analysis",
    "  File: /home/user/app/src/App.tsx:1:24",
    '  1  |  import { Missing } from "./pages/Missing";',
    "     |                           ^",
    "      at TransformPluginContext._formatLog (file:///home/user/app/node_modules/vite/dist/node/chunks/dep.js:31422:43)",
    "      at processTicksAndRejections (native:7:39)",
  ];
  const MISSING = 'Failed to resolve import "./pages/Missing" from "src/App.tsx". Does the file exist?';

  test("keeps the error and drops the colours, the blank lines and the server's own stack", () => {
    const text = [
      "",
      "  VITE v8.3.4  ready in 2298 ms",
      "",
      "  \u001b[32m➜\u001b[39m  Local:   http://localhost:5173/",
      "7:02:11 PM [vite] (client) hmr update /src/App.tsx",
      ...entry("7:02:19 PM", MISSING),
    ].join("\r\n");
    const tail = tailOfLog(text);
    expect(tail).toContain(`Pre-transform error: ${MISSING}`);
    expect(tail).toContain("  Plugin: vite:import-analysis");
    // A path the agent's tools take.
    expect(tail).toContain("  File: src/App.tsx:1:24");
    expect(tail).not.toContain("node_modules");
    expect(tail).not.toContain("processTicksAndRejections");
    expect(tail).not.toContain("\u001b");
    expect(tail).not.toContain("\r");
    expect(tail.split("\n").every((line) => line.trim().length > 0)).toBe(true);
  });

  test("says an error once, however many times the server printed it", () => {
    // What a real log looks like while a broken app is open in a browser.
    const text = Array.from({ length: 400 }, (_, i) => entry(`7:44:${String(i % 60).padStart(2, "0")} PM`, MISSING))
      .flat()
      .join("\n");
    const tail = tailOfLog(text);
    expect(tail.match(/Pre-transform error/g)).toHaveLength(1);
    // The newest copy is the one kept.
    expect(tail.startsWith("7:44:39 PM")).toBe(true);
  });

  test("keeps different errors apart, newest last", () => {
    const text = [...entry("7:01:00 PM", "first fault"), ...entry("7:02:00 PM", "second fault"), ...entry("7:03:00 PM", "first fault")].join("\n");
    const tail = tailOfLog(text, 30);
    expect(tail.indexOf("second fault")).toBeLessThan(tail.indexOf("7:03:00 PM"));
    expect(tail.match(/first fault/g)).toHaveLength(1);
  });

  test("a file that opens half-way through an entry starts at the first whole one", () => {
    // The file is kept to a size by starting it again, wherever that falls.
    const text = ["  File: /home/user/app/src/Old.tsx:9:1", "     |   ^", ...entry("7:02:19 PM", MISSING)].join("\n");
    const tail = tailOfLog(text);
    expect(tail).not.toContain("Old.tsx");
    expect(tail.startsWith("7:02:19 PM")).toBe(true);
  });

  test("is whole entries from the end, within a number of lines and characters", () => {
    const many = Array.from({ length: 50 }, (_, i) => [`7:00:${String(i).padStart(2, "0")} PM [vite] fault ${i}`, "  detail a", "  detail b"]).flat().join("\n");
    const tail = tailOfLog(many, 10);
    // Three lines an entry: three entries fit in ten lines, and none is cut.
    expect(tail.split("\n")).toHaveLength(9);
    expect(tail.startsWith("7:00:47 PM [vite] fault 47")).toBe(true);
    expect(tail.endsWith("  detail b")).toBe(true);

    // Characters are counted in whole entries too: one that does not fit is
    // left out, not cut.
    const byChars = tailOfLog(many, 30, 100);
    expect(byChars.split("\n")).toHaveLength(6);
    expect(byChars.startsWith("7:00:48 PM [vite] fault 48")).toBe(true);

    const older = tailOfLog(`${"x".repeat(5_000)}\nthe newest error`, 30, 200);
    expect(older).toBe("the newest error");

    // The newest entry is kept even when it alone is too long, from its start.
    const long = tailOfLog(`an older line\n7:00:00 PM [vite] ${"x".repeat(5_000)}\n  detail`, 30, 200);
    expect(long.length).toBeLessThanOrEqual(201);
    expect(long.startsWith("7:00:00 PM [vite] xxx")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });

  test("a sandbox from an older image has no log, and that is not an error", async () => {
    const without = {
      files: {
        read: async (): Promise<string> => {
          throw new Error("no such file");
        },
      },
    };
    expect(await readDevServerLog(without)).toBeNull();
    const empty = { files: { read: async () => "\n\n  \n" } };
    expect(await readDevServerLog(empty)).toBeNull();
  });

  test("is read from where the image writes it", async () => {
    let asked = "";
    const sandbox = {
      files: {
        read: async (path: string) => {
          asked = path;
          return "7:02:19 PM [vite] Pre-transform error: boom";
        },
      },
    };
    expect(await readDevServerLog(sandbox)).toBe("7:02:19 PM [vite] Pre-transform error: boom");
    expect(asked).toBe(DEV_SERVER_LOG_PATH);
  });
});
