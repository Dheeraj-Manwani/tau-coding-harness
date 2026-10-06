import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import {
  CLEARED_ARG_PREFIX,
  KEEP_RECENT_TOOL_RESULTS,
  applyClearing,
  assertRealContent,
  clearedResultText,
  createClearingState,
  planClearing,
  trimWriteCall,
} from "@/worker/agent/context/clearing";
import {
  effortNote,
  shapeHistory,
  type HistoryRow,
} from "@/worker/agent/context/history";
import { cachedPromptTokens, estimateTokens } from "@/worker/agent/context/tokens";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// What the model is sent is rebuilt from stored rows on every request, and the
// model provider caches a request by its prefix. Two things follow, and these
// tests pin both down (doc/CONTEXT_AND_MEMORY_PLAN.md §7):
//   - the rebuild must be deterministic, and must only ever change a message
//     once (when its request stops being the current one);
//   - during a run, the context must change in rare large steps rather than a
//     little every turn.

const BIG = "x".repeat(2_000);

// ── Row builders ─────────────────────────────────────────────────────────────

let seq = 0;
const user = (text: string): HistoryRow => ({
  sequence: ++seq,
  role: "USER",
  type: "USER",
  jobId: null,
  content: text,
});
const call = (jobId: string, id: string, name: string, args: object): HistoryRow => ({
  sequence: ++seq,
  role: "ASSISTANT",
  type: "TOOL_REQ",
  jobId,
  content: {
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  },
});
const result = (jobId: string, id: string, content: string): HistoryRow => ({
  sequence: ++seq,
  role: "USER",
  type: "TOOL_RES",
  jobId,
  content: [{ tool_call_id: id, content }],
});
const reply = (jobId: string, text: string): HistoryRow => ({
  sequence: ++seq,
  role: "ASSISTANT",
  type: "RESULT",
  jobId,
  content: { content: text, tool_calls: null },
});

/** Two requests: job-1 built something, job-2 is a follow-up. */
function twoRequests(): HistoryRow[] {
  seq = 0;
  return [
    user("build a timer"),
    call("job-1", "c1", "read_file", { path: "src/App.tsx" }),
    result("job-1", "c1", BIG),
    call("job-1", "c2", "create_file", { path: "src/Timer.tsx", content: BIG }),
    result("job-1", "c2", JSON.stringify({ success: true, path: "src/Timer.tsx" })),
    reply("job-1", "Built the timer."),
    user("make it blue"),
    call("job-2", "c3", "read_file", { path: "src/Timer.tsx" }),
    result("job-2", "c3", BIG),
  ];
}

const efforts = new Map([
  ["job-1", "HIGH"],
  ["job-2", "MAX"],
] as const);

const toolContent = (entries: ReturnType<typeof shapeHistory>, id: string) =>
  entries.find((e) => e.param.role === "tool" && e.param.tool_call_id === id)!.param
    .content as string;
const callArgs = (entries: ReturnType<typeof shapeHistory>, id: string) => {
  for (const e of entries) {
    if (e.param.role !== "assistant" || !e.param.tool_calls) continue;
    const tc = e.param.tool_calls.find((t) => t.id === id);
    if (tc && tc.type === "function") return JSON.parse(tc.function.arguments) as Record<string, string>;
  }
  throw new Error(`no call ${id}`);
};

// ── shapeHistory ─────────────────────────────────────────────────────────────

describe("shapeHistory — earlier requests", () => {
  const entries = shapeHistory(twoRequests(), { currentJobId: "job-2", effortByJob: efforts });

  test("a re-fetchable result from an earlier request is cleared", () => {
    const cleared = toolContent(entries, "c1");
    expect(cleared.length).toBeLessThan(200);
    // …and still says what it was, so the agent knows how to get it back.
    expect(cleared).toContain("read_file src/App.tsx");
  });

  test("the request in progress is replayed in full", () => {
    expect(toolContent(entries, "c3")).toBe(BIG);
  });

  test("the file body in an earlier write call is trimmed, its path kept", () => {
    const args = callArgs(entries, "c2");
    expect(args.path).toBe("src/Timer.tsx");
    expect(args.content!.startsWith(CLEARED_ARG_PREFIX)).toBe(true);
    expect(args.content).toContain("2000 characters");
  });

  test("small results and the conversation itself are untouched", () => {
    expect(toolContent(entries, "c2")).toBe('{"success":true,"path":"src/Timer.tsx"}');
    const texts = entries.map((e) => e.param.content).filter((c) => typeof c === "string");
    expect(texts).toContain("Built the timer.");
  });

  test("every tool call still has its result, in order", () => {
    // Clearing replaces content; it never removes a frame, which the API
    // would reject.
    const ids = entries.flatMap((e) =>
      e.param.role === "tool" ? [e.param.tool_call_id] : [],
    );
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  test("is much smaller than replaying everything", () => {
    const raw = shapeHistory(twoRequests(), { currentJobId: "job-1" });
    const size = (es: typeof entries) => estimateTokens(es.map((e) => e.param));
    // job-1 as the current request (raw) vs job-1 as an earlier one (cleared).
    const earlier = shapeHistory(twoRequests().slice(0, 6), { effortByJob: efforts });
    expect(size(earlier)).toBeLessThan(size(raw.slice(0, 6)) / 4);
  });
});

describe("shapeHistory — what is deliberately kept", () => {
  test("answers, guides and sub-agent reports from earlier requests", () => {
    seq = 0;
    const rows = [
      user("add a database"),
      call("job-1", "a1", "add_database", {}),
      result("job-1", "a1", `guide ${BIG}`),
      call("job-1", "a2", "dispatch_verifier", { scope: "all" }),
      result("job-1", "a2", `report ${BIG}`),
      call("job-1", "a3", "ask_user", { question: "which?" }),
      result("job-1", "a3", `answer ${BIG}`),
      user("next"),
    ];
    const entries = shapeHistory(rows, { currentJobId: "job-2" });
    for (const id of ["a1", "a2", "a3"]) {
      expect(toolContent(entries, id).length).toBeGreaterThan(2_000);
    }
  });

  test("with no request in progress, every request counts as earlier", () => {
    // What "summarize chat" and the context-usage figure see — and what the
    // next request will be sent.
    const entries = shapeHistory(twoRequests(), { effortByJob: efforts });
    expect(toolContent(entries, "c1").length).toBeLessThan(200);
    expect(toolContent(entries, "c3").length).toBeLessThan(200);
  });
});

describe("shapeHistory — stable across requests", () => {
  test("a finished request looks the same in every later request", () => {
    // The whole point: once job-1 has been cleared, its messages never change
    // again, so they stay in the provider's cached prefix for good.
    const during2 = shapeHistory(twoRequests(), { currentJobId: "job-2", effortByJob: efforts });
    const later = [
      ...twoRequests(),
      reply("job-2", "Now blue."),
      user("and bigger"),
    ];
    const during3 = shapeHistory(later, {
      currentJobId: "job-3",
      effortByJob: new Map([...efforts, ["job-3", "LOW"]] as const),
    });
    const job1 = (es: typeof during2) => JSON.stringify(es.slice(0, 6).map((e) => e.param));
    expect(job1(during3)).toBe(job1(during2));
  });

  test("the same rows always produce the same history", () => {
    const a = shapeHistory(twoRequests(), { currentJobId: "job-2", effortByJob: efforts });
    const b = shapeHistory(twoRequests(), { currentJobId: "job-2", effortByJob: efforts });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("shapeHistory — effort travels with the request", () => {
  const entries = shapeHistory(twoRequests(), { currentJobId: "job-2", effortByJob: efforts });
  const users = entries.filter((e) => e.param.role === "user").map((e) => e.param.content as string);

  test("each request carries the effort it was run at", () => {
    expect(users[0]).toStartWith("build a timer");
    expect(users[0]).toContain("## Effort: HIGH");
    expect(users[1]).toStartWith("make it blue");
    expect(users[1]).toContain("## Effort: MAX");
  });

  test("changing effort for a new request does not touch the earlier ones", () => {
    const atLow = shapeHistory(twoRequests(), {
      currentJobId: "job-2",
      effortByJob: new Map([["job-1", "HIGH"], ["job-2", "LOW"]] as const),
    });
    // Everything before the new request is byte-identical; only the new
    // request's own message differs.
    expect(JSON.stringify(atLow.slice(0, 6))).toBe(JSON.stringify(entries.slice(0, 6)));
    expect(atLow[6]!.param.content).toContain("## Effort: LOW");
  });

  test("the request in progress gets its note before any of its rows exist", () => {
    seq = 0;
    const fresh = shapeHistory([user("hello")], {
      currentJobId: "job-9",
      effortByJob: new Map([["job-9", "HIGH"]] as const),
    });
    expect(fresh[0]!.param.content).toContain("## Effort: HIGH");
  });

  test("a message with attachments gets the note as one more part", () => {
    seq = 0;
    const rows: HistoryRow[] = [
      {
        sequence: 1,
        role: "USER",
        type: "USER",
        jobId: null,
        content: [
          { type: "text", text: "like this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ];
    const [entry] = shapeHistory(rows, {
      currentJobId: "job-1",
      effortByJob: new Map([["job-1", "HIGH"]] as const),
    });
    const parts = entry!.param.content as { type: string; text?: string }[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: "text", text: "like this" });
    expect(parts[2]!.text).toBe(effortNote("HIGH"));
  });

  test("a request whose effort is unknown simply gets no note", () => {
    const entries2 = shapeHistory(twoRequests(), { currentJobId: "job-2" });
    expect(entries2[0]!.param.content).toBe("build a timer");
  });

  test("a hidden manual-edit row is not a request and gets no note", () => {
    seq = 0;
    const rows: HistoryRow[] = [
      user("build it"),
      reply("job-1", "Done."),
      {
        sequence: 99,
        role: "USER",
        type: "USER_EDIT",
        jobId: null,
        content: { path: "src/a.ts", diff: "+x", truncated: false, linesAdded: 1, linesRemoved: 0 },
      },
    ];
    const entries2 = shapeHistory(rows, { effortByJob: efforts });
    expect(entries2[2]!.param.content).toContain("manually edited src/a.ts");
    expect(entries2[2]!.param.content).not.toContain("Effort");
  });
});

describe("shapeHistory — checkpoints", () => {
  test("a summary checkpoint leads the history; a cleared chat adds nothing", () => {
    seq = 0;
    expect(shapeHistory([user("hi")], { checkpointSummary: "they built a timer" })[0]!.param.role).toBe("system");
    seq = 0;
    expect(shapeHistory([user("hi")], { checkpointSummary: "" })).toHaveLength(1);
  });
});

// ── Write-call trimming and its guard ────────────────────────────────────────

describe("trimWriteCall", () => {
  const tc = (name: string, args: object) =>
    ({ id: "t", type: "function", function: { name, arguments: JSON.stringify(args) } }) as const;

  test("trims both strings of an edit, and leaves short ones alone", () => {
    const trimmed = trimWriteCall(tc("edit_file", { path: "a.ts", old_string: BIG, new_string: "short" }));
    const args = JSON.parse((trimmed as { function: { arguments: string } }).function.arguments);
    expect(args.old_string.startsWith(CLEARED_ARG_PREFIX)).toBe(true);
    expect(args.new_string).toBe("short");
  });

  test("returns the same object when there is nothing to trim", () => {
    const small = tc("create_file", { path: "a.ts", content: "tiny" });
    expect(trimWriteCall(small)).toBe(small);
    const other = tc("run_command", { command: BIG });
    expect(trimWriteCall(other)).toBe(other);
  });

  test("survives arguments that are not JSON", () => {
    const broken = { id: "t", type: "function", function: { name: "create_file", arguments: "{not json" } } as const;
    expect(trimWriteCall(broken)).toBe(broken);
  });
});

describe("assertRealContent", () => {
  test("refuses a write whose content is the placeholder", () => {
    // A model copying its own earlier (trimmed) call must not be able to
    // overwrite a real file with one line of bookkeeping.
    const trimmed = trimWriteCall({
      id: "t",
      type: "function",
      function: { name: "create_file", arguments: JSON.stringify({ path: "a.ts", content: BIG }) },
    });
    const placeholder = JSON.parse((trimmed as { function: { arguments: string } }).function.arguments).content;
    expect(() => assertRealContent(placeholder, "content")).toThrow(/placeholder/);
    expect(() => assertRealContent(`\n  ${placeholder}`, "content")).toThrow();
  });

  test("lets real content through", () => {
    expect(() => assertRealContent("export const a = 1\n", "content")).not.toThrow();
    expect(() => assertRealContent("// [cleared by tau: mentioned in a comment]", "content")).not.toThrow();
  });
});

// ── Clearing during a run ────────────────────────────────────────────────────

function runWithReads(n: number): MessageParam[] {
  const msgs: MessageParam[] = [{ role: "system", content: "sys" }, { role: "user", content: "go" }];
  for (let i = 0; i < n; i++) {
    msgs.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id: `r${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `src/f${i}.ts` }) } }],
    });
    msgs.push({ role: "tool", tool_call_id: `r${i}`, content: BIG });
  }
  return msgs;
}

const plan = (msgs: MessageParam[], state: ReturnType<typeof createClearingState>, targetTokens: number) =>
  planClearing(msgs, state, {
    tokensNow: estimateTokens(applyClearing(msgs, state)),
    targetTokens,
    tokensPerChar: 1 / 4,
    maxToolResultTokens: 2_000,
  });

describe("planClearing", () => {
  test("clears oldest first and stops once the target is met", () => {
    const msgs = runWithReads(20);
    const state = createClearingState();
    const before = estimateTokens(msgs);

    const added = plan(msgs, state, before / 2);

    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(20 - KEEP_RECENT_TOOL_RESULTS + 1);
    const after = applyClearing(msgs, state);
    expect(estimateTokens(after)).toBeLessThanOrEqual(before / 2 + 50);
    // Oldest gone, newest intact.
    expect(after[3]!.content).toBe(clearedResultText({ name: "read_file", args: { path: "src/f0.ts" } }));
    expect(after[after.length - 1]!.content).toBe(BIG);
  });

  test("never touches the most recent results, however low the target", () => {
    const msgs = runWithReads(20);
    const state = createClearingState();
    plan(msgs, state, 0);
    const after = applyClearing(msgs, state);
    const tools = after.filter((m) => m.role === "tool");
    for (const m of tools.slice(-KEEP_RECENT_TOOL_RESULTS)) expect(m.content).toBe(BIG);
    for (const m of tools.slice(0, -KEEP_RECENT_TOOL_RESULTS)) expect((m.content as string).length).toBeLessThan(200);
  });

  test("is sticky: later turns add to what was cleared, and never undo it", () => {
    const state = createClearingState();
    const turn1 = runWithReads(20);
    plan(turn1, state, estimateTokens(turn1) / 2);
    const clearedAfter1 = new Map(state.replacements);

    // The run goes on; the same prefix plus more messages.
    const turn2 = runWithReads(30);
    plan(turn2, state, estimateTokens(turn2) / 3);

    for (const [id, text] of clearedAfter1) expect(state.replacements.get(id)).toBe(text);
    expect(state.replacements.size).toBeGreaterThan(clearedAfter1.size);
  });

  test("between batches the context is byte-stable", () => {
    // After a batch, turns that stay under the trigger do not plan at all —
    // they only re-apply the recorded decisions. The messages that were in the
    // context at the batch must come out identical every time.
    const state = createClearingState();
    const at = runWithReads(20);
    plan(at, state, estimateTokens(at) / 2);
    const snapshot = JSON.stringify(applyClearing(at, state));

    const later = runWithReads(24);
    const prefix = applyClearing(later, state).slice(0, at.length);
    expect(JSON.stringify(prefix)).toBe(snapshot);
  });

  test("a read the agent has repeated goes first, even if recent", () => {
    const msgs = runWithReads(3);
    // Re-read f0: the first copy is now superseded.
    msgs.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "again", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/f0.ts" }) } }],
    });
    msgs.push({ role: "tool", tool_call_id: "again", content: BIG });
    const state = createClearingState();

    plan(msgs, state, estimateTokens(msgs) - 100);

    expect([...state.replacements.keys()]).toEqual(["r0"]);
  });

  test("leaves guides, answers and reports alone; cuts one only if it is huge and old", () => {
    const msgs: MessageParam[] = [{ role: "system", content: "sys" }];
    const add = (id: string, name: string, content: string) => {
      msgs.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] });
      msgs.push({ role: "tool", tool_call_id: id, content });
    };
    add("guide", "add_backend", BIG);
    add("report", "dispatch_explorer", "y".repeat(40_000));
    for (let i = 0; i < KEEP_RECENT_TOOL_RESULTS; i++) add(`w${i}`, "edit_file", '{"success":true}');
    const state = createClearingState();

    plan(msgs, state, 0);

    expect(state.replacements.has("guide")).toBe(false);
    const report = state.replacements.get("report")!;
    expect(report.length).toBeLessThan(10_000);
    expect(report.startsWith("yyyy")).toBe(true);
    expect(report).toContain("characters cut");
  });

  test("does nothing when already under the target", () => {
    const msgs = runWithReads(5);
    const state = createClearingState();
    expect(plan(msgs, state, estimateTokens(msgs) + 1)).toBe(0);
    expect(applyClearing(msgs, state)).toBe(msgs);
  });
});

describe("clearing is the same at load and during a run", () => {
  test("a result cleared mid-run reads identically once its request is over", () => {
    // Otherwise the boundary between two requests would rewrite every message
    // that had already been cleared, and invalidate the cache for no gain.
    const msgs = runWithReads(20);
    const state = createClearingState();
    plan(msgs, state, 0);
    const midRun = applyClearing(msgs, state)[3]!.content;

    seq = 0;
    const rows = [
      user("go"),
      call("job-1", "r0", "read_file", { path: "src/f0.ts" }),
      result("job-1", "r0", BIG),
      user("next"),
    ];
    const atLoad = toolContent(shapeHistory(rows, { currentJobId: "job-2" }), "r0");

    expect(atLoad).toBe(midRun as string);
  });
});

// ── Cache accounting ─────────────────────────────────────────────────────────

describe("cachedPromptTokens", () => {
  test("reads DeepSeek's field", () => {
    expect(cachedPromptTokens({ prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 })).toBe(800);
  });

  test("reads the OpenAI-style field", () => {
    expect(cachedPromptTokens({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 640 } })).toBe(640);
  });

  test("is zero when the provider reports nothing", () => {
    expect(cachedPromptTokens({ prompt_tokens: 1000 })).toBe(0);
    expect(cachedPromptTokens(undefined)).toBe(0);
    expect(cachedPromptTokens({ prompt_tokens_details: null })).toBe(0);
  });
});
