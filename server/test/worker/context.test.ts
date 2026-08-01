import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { compact } from "@/worker/agent/context/compact.ts";
import { pickBoundary } from "@/worker/agent/context/boundary.ts";
import type { Entry } from "@/worker/agent/context/types.ts";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// ── Helpers ──────────────────────────────────────────────────────────────────

function assistantToolCall(id: string, name: string, args: object): MessageParam {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
    ],
  };
}

function toolResult(id: string, content: string): MessageParam {
  return { role: "tool", tool_call_id: id, content };
}

/** Validate that every `tool` message is immediately preceded (somewhere before)
 *  by an assistant tool_calls message declaring its id — the completions API
 *  invariant compaction/summarization must never break. */
function toolIdsAreSatisfied(messages: MessageParam[]): boolean {
  const declared = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && "tool_calls" in m && m.tool_calls) {
      for (const tc of m.tool_calls) declared.add(tc.id);
    }
    if (m.role === "tool" && !declared.has(m.tool_call_id)) return false;
  }
  return true;
}

// ── compact ──────────────────────────────────────────────────────────────────

describe("compact", () => {
  test("never drops frames — output length equals input length", () => {
    const messages: MessageParam[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      assistantToolCall("c1", "read_file", { path: "a.ts" }),
      toolResult("c1", "x".repeat(50_000)),
    ];
    const res = compact(messages, { maxToolResultTokens: 2_000 });
    expect(res.messages.length).toBe(messages.length);
    expect(toolIdsAreSatisfied(res.messages)).toBe(true);
  });

  test("elides an oversized tool result but keeps it a tool message", () => {
    const messages: MessageParam[] = [
      assistantToolCall("c1", "run_command", { command: "ls" }),
      toolResult("c1", "y".repeat(40_000)),
    ];
    const res = compact(messages, { maxToolResultTokens: 1_000 });
    const tool = res.messages[1] as { role: string; content: string };
    expect(res.changed).toBe(true);
    expect(tool.role).toBe("tool");
    expect(tool.content.length).toBeLessThan(40_000);
    expect(tool.content).toContain("elided");
  });

  test("collapses a superseded read_file, keeps the latest read verbatim", () => {
    const body = "z".repeat(10_000);
    const messages: MessageParam[] = [
      assistantToolCall("r1", "read_file", { path: "App.tsx" }),
      toolResult("r1", body),
      assistantToolCall("r2", "read_file", { path: "App.tsx" }),
      toolResult("r2", body),
    ];
    const res = compact(messages, { maxToolResultTokens: 100_000 });
    const first = res.messages[1] as { content: string };
    const second = res.messages[3] as { content: string };
    expect(first.content).toContain("superseded");
    expect(second.content).toBe(body);
  });

  test("no-op returns the same reference when nothing exceeds limits", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "small" },
      assistantToolCall("c1", "read_file", { path: "a.ts" }),
      toolResult("c1", "tiny"),
    ];
    const res = compact(messages, { maxToolResultTokens: 2_000 });
    expect(res.changed).toBe(false);
    expect(res.messages).toBe(messages);
  });
});

// ── pickBoundary ─────────────────────────────────────────────────────────────

function entry(param: MessageParam, seq: number | null): Entry {
  return { param, seq };
}

describe("pickBoundary", () => {
  test("never starts the tail on an orphaned tool message", () => {
    // system, user, assistant(tool_calls), tool, assistant(text)
    const entries: Entry[] = [
      entry({ role: "system", content: "sys" }, null),
      entry({ role: "user", content: "u" }, 0),
      entry(assistantToolCall("c1", "read_file", { path: "a" }), 1),
      entry(toolResult("c1", "r".repeat(200_000)), 1),
      entry({ role: "assistant", content: "done" }, 2),
    ];
    // Small keep-tail would land the boundary mid-group; it must snap forward
    // so the tail never begins with the orphaned `tool` message.
    for (const keep of [1, 100, 5_000, 40_000]) {
      const b = pickBoundary(entries, keep);
      expect(entries[b]?.param.role).not.toBe("tool");
    }
  });

  test("keeps index 0 (system) out of any tail boundary", () => {
    const entries: Entry[] = [
      entry({ role: "system", content: "sys" }, null),
      entry({ role: "user", content: "u" }, 0),
    ];
    const b = pickBoundary(entries, 1_000_000);
    expect(b).toBeGreaterThanOrEqual(1);
  });
});
