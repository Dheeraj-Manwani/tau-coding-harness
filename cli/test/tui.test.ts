import { describe, expect, test } from "bun:test";
import { briefResult, initialState, reducer, statusLabel, type TuiState } from "../src/tui/state.ts";
import { filterCommands, parseSlash } from "../src/tui/commands.ts";

/** Apply a sequence of actions starting from the initial state. */
function run(...actions: Parameters<typeof reducer>[1][]): TuiState {
  return actions.reduce(reducer, initialState);
}

describe("tui reducer", () => {
  test("a user submission appends a user entry", () => {
    const s = run({ type: "submit-user", text: "hello" });
    expect(s.entries).toEqual([{ kind: "user", text: "hello" }]);
  });

  test("streaming text opens one assistant entry then appends deltas", () => {
    const s = run(
      { type: "step-begin" },
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    );
    expect(s.busy).toBe(true);
    expect(s.streamingIndex).toBe(0);
    expect(s.entries).toEqual([
      { kind: "assistant", text: "Hello", streaming: true, gap: false },
    ]);
  });

  test("assistant text following tool calls gets a leading gap", () => {
    const s = run(
      { type: "step-begin" },
      { type: "tool-done", toolName: "bash", summary: "bash ls", output: "ok", isError: false },
      { type: "text", delta: "done" },
    );
    const last = s.entries[s.entries.length - 1];
    expect(last).toEqual({ kind: "assistant", text: "done", streaming: true, gap: true });
  });

  test("step-end finalizes the streaming entry", () => {
    const s = run(
      { type: "step-begin" },
      { type: "text", delta: "hi" },
      { type: "step-end" },
    );
    expect(s.streamingIndex).toBeNull();
    expect(s.entries[0]).toEqual({ kind: "assistant", text: "hi", streaming: false, gap: false });
  });

  test("a successful tool call renders a brief result", () => {
    const s = run({
      type: "tool-done",
      toolName: "read",
      summary: "read a.ts",
      output: "l1\nl2\nl3",
      isError: false,
    });
    expect(s.entries[0]).toEqual({ kind: "tool", summary: "read a.ts", result: "3 lines" });
  });

  test("a failed tool call keeps the raw output", () => {
    const s = run({
      type: "tool-done",
      toolName: "bash",
      summary: "bash ls",
      output: "boom",
      isError: true,
    });
    expect(s.entries[0]).toEqual({ kind: "tool-error", summary: "bash ls", output: "boom" });
  });

  test("model errors and exhaustion become error entries", () => {
    const s = run(
      { type: "model-error", message: "401" },
      { type: "exhausted", maxSteps: 50 },
    );
    expect(s.entries).toEqual([
      { kind: "error", text: "401" },
      { kind: "error", text: "Stopped after 50 steps." },
    ]);
  });

  test("turn-done clears busy; clear resets everything", () => {
    const busy = run({ type: "step-begin" }, { type: "turn-done" });
    expect(busy.busy).toBe(false);
    const cleared = reducer(
      { entries: [{ kind: "user", text: "x" }], busy: true, statusLabel: "Thinking", streamingIndex: null },
      { type: "clear" },
    );
    expect(cleared).toEqual(initialState);
  });
});

describe("statusLabel", () => {
  test("write reduces the path to a tidy file stem", () => {
    expect(statusLabel("write", "write src/README.md")).toBe("Writing to Readme");
  });
  test("read and edit get their own verbs", () => {
    expect(statusLabel("read", "read foo/Bar.ts")).toBe("Reading Bar");
    expect(statusLabel("edit", "edit app.tsx")).toBe("Editing App");
  });
  test("targetless tools get a bare verb phrase", () => {
    expect(statusLabel("bash", "bash: ls -la")).toBe("Running command");
    expect(statusLabel("dispatch_search_agent", "search agent: find x")).toBe("Searching");
  });
  test("tool-begin drives the status line label", () => {
    const s = run({ type: "tool-begin", toolName: "write", summary: "write README.md" });
    expect(s.statusLabel).toBe("Writing to Readme");
  });
});

describe("briefResult", () => {
  test("bash reports the exit code", () => {
    expect(briefResult("bash", "Exit code: 2\n…")).toBe("exit 2");
  });
  test("switch_mode reflects the outcome", () => {
    expect(briefResult("switch_mode", "Switched to build mode.")).toBe("switched");
    expect(briefResult("switch_mode", "Mode unchanged.")).toBe("declined");
  });
});

describe("parseSlash", () => {
  test("aliases for exit", () => {
    for (const t of ["/exit", "/quit", "/q"]) {
      expect(parseSlash(t)).toEqual({ kind: "exit" });
    }
  });
  test("explicit and toggle modes", () => {
    expect(parseSlash("/plan")).toEqual({ kind: "switch-mode", target: "plan" });
    expect(parseSlash("/build")).toEqual({ kind: "switch-mode", target: "build" });
    expect(parseSlash("/mode build")).toEqual({ kind: "switch-mode", target: "build" });
    expect(parseSlash("/mode")).toEqual({ kind: "toggle-mode" });
  });
  test("help, info, clear, unknown", () => {
    expect(parseSlash("/help")).toEqual({ kind: "help" });
    expect(parseSlash("/info")).toEqual({ kind: "info" });
    expect(parseSlash("/clear")).toEqual({ kind: "clear" });
    expect(parseSlash("/bogus")).toEqual({ kind: "unknown", name: "bogus" });
  });
});

describe("filterCommands (the / menu)", () => {
  test("a bare slash lists every command", () => {
    expect(filterCommands("/").map((c) => c.name)).toEqual([
      "/plan",
      "/build",
      "/mode",
      "/clear",
      "/info",
      "/help",
      "/exit",
    ]);
  });
  test("a prefix narrows by name", () => {
    expect(filterCommands("/m").map((c) => c.name)).toEqual(["/mode"]);
    expect(filterCommands("/c").map((c) => c.name)).toEqual(["/clear"]);
  });
  test("no menu for non-slash text or once an arg is typed", () => {
    expect(filterCommands("hello")).toEqual([]);
    expect(filterCommands("/mode ")).toEqual([]);
    expect(filterCommands("/mode build")).toEqual([]);
  });
});
