import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { balanceToolResults } from "../src/agent/loop.ts";
import type { Entry } from "../src/agent/context/types.ts";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// ── Helpers ──────────────────────────────────────────────────────────────────

function entry(param: MessageParam, seq: number | null = 1): Entry {
  return { param, seq };
}

function assistantCalling(...ids: string[]): Entry {
  return entry({
    role: "assistant",
    content: null,
    tool_calls: ids.map((id) => ({
      id,
      type: "function" as const,
      function: { name: "read_file", arguments: "{}" },
    })),
  });
}

function toolResult(id: string, content = "{}"): Entry {
  return entry({ role: "tool", tool_call_id: id, content });
}

function user(content: string): Entry {
  return entry({ role: "user", content });
}

/** Every `tool` message must be preceded by an assistant that requested its id,
 *  and every requested id must be answered before the next non-tool message —
 *  the contract the completions API enforces with a 400. */
function assertBalanced(entries: Entry[]): void {
  let outstanding = new Set<string>();
  for (const e of entries) {
    const p = e.param;
    if (p.role === "tool") {
      expect(outstanding.has(p.tool_call_id)).toBe(true);
      outstanding.delete(p.tool_call_id);
      continue;
    }
    expect([...outstanding]).toEqual([]);
    outstanding =
      p.role === "assistant" && p.tool_calls
        ? new Set(p.tool_calls.map((tc) => tc.id))
        : new Set();
  }
  expect([...outstanding]).toEqual([]);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("balanceToolResults", () => {
  test("leaves an already-balanced history untouched", () => {
    const entries = [
      user("build me a todo app"),
      assistantCalling("a"),
      toolResult("a"),
      entry({ role: "assistant", content: "done" }),
    ];
    const out = balanceToolResults(entries);
    expect(out).toEqual(entries);
    assertBalanced(out);
  });

  test("answers a tool call the previous run died before finishing", () => {
    // The shape left behind when the process dies between persisting the
    // TOOL_REQ row and the TOOL_RES row, then the user prompts again.
    const out = balanceToolResults([
      assistantCalling("a"),
      user("still there?"),
    ]);

    expect(out).toHaveLength(3);
    expect(out[1]!.param.role).toBe("tool");
    expect(out[2]!.param.role).toBe("user");
    assertBalanced(out);
  });

  test("answers only the unanswered ids of a partially-answered turn", () => {
    const out = balanceToolResults([
      assistantCalling("a", "b", "c"),
      toolResult("b", '{"ok":true}'),
    ]);

    const tools = out.filter((e) => e.param.role === "tool");
    expect(tools).toHaveLength(3);
    // The real result survives verbatim; only the gaps get a synthetic answer.
    const b = tools.find(
      (e) => (e.param as { tool_call_id: string }).tool_call_id === "b",
    );
    expect((b!.param as { content: string }).content).toBe('{"ok":true}');
    assertBalanced(out);
  });

  test("drops an orphan tool result with no preceding assistant", () => {
    // Previously passed straight through and 400'd the request.
    const out = balanceToolResults([user("hi"), toolResult("ghost")]);

    expect(out).toHaveLength(1);
    expect(out[0]!.param.role).toBe("user");
    assertBalanced(out);
  });

  test("drops a tool result whose id the assistant never requested", () => {
    const out = balanceToolResults([
      assistantCalling("a"),
      toolResult("a"),
      toolResult("stale-from-an-earlier-turn"),
    ]);

    const ids = out
      .filter((e) => e.param.role === "tool")
      .map((e) => (e.param as { tool_call_id: string }).tool_call_id);
    expect(ids).toEqual(["a"]);
    assertBalanced(out);
  });

  test("handles two consecutive assistant turns from a retried run", () => {
    // Attempt 1 persisted an assistant row and died; attempt 2 wrote its own.
    const out = balanceToolResults([
      assistantCalling("a"),
      assistantCalling("b"),
      toolResult("b"),
    ]);

    assertBalanced(out);
    expect(out.filter((e) => e.param.role === "tool")).toHaveLength(2);
  });

  test("does not treat a later turn's results as answering an earlier call", () => {
    const out = balanceToolResults([
      assistantCalling("a"),
      user("interrupting"),
      assistantCalling("b"),
      toolResult("b"),
    ]);

    assertBalanced(out);
    // "a" is answered in place, before the user message — not by "b"'s result.
    expect(out[1]!.param.role).toBe("tool");
    expect((out[1]!.param as { tool_call_id: string }).tool_call_id).toBe("a");
  });
});
