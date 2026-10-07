/**
 * Clearing old tool output from the model-facing context.
 *
 * Two places do this, and they share the functions here so that they produce
 * the same bytes for the same message:
 *
 *   - **at load** (`history.ts`): every request before the current one has its
 *     re-fetchable tool results cleared, and the large file bodies in its
 *     write calls trimmed. Those were true when they were produced and may not
 *     be now — the user edits files, later requests rewrite them — and they are
 *     paid for on every turn of every later request.
 *   - **during a run** (`planClearing`, below): when the context passes its
 *     compaction mark, the oldest results of the current request go the same
 *     way.
 *
 * ## Why this replaced "collapse stale reads, elide big results" each turn
 *
 * The model provider caches a request by its prefix: a request whose first N
 * tokens match an earlier one gets those N at a fraction of the price. The old
 * compaction was recomputed from scratch every turn, and one of its rules —
 * "a read is stale once the same file is read again" — rewrote a message in
 * the middle of the history every time the agent re-read a file. Each rewrite
 * moved the point where the prefix stopped matching back to that message.
 *
 * So clearing here is **sticky and batched**:
 *
 *   - sticky: a decision, once made, is recorded in `ClearingState` and applied
 *     on every later turn. Nothing is ever un-cleared, so the prefix only ever
 *     changes when a batch is taken;
 *   - batched: nothing is cleared until the context passes the trigger, and
 *     then enough is cleared at once to bring it well below — one change to the
 *     prefix that buys a long stretch without another, rather than a small one
 *     every turn. (Same reasoning as `clear_at_least` in Anthropic's context
 *     editing.)
 *
 * What is cleared is always *restorable*: only tools whose output can be had
 * again by running them again, and the placeholder says which tool and which
 * file, command or query it was.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §7.
 */
import type OpenAI from "openai";
import { carriedGuides, mentionsGuide } from "../docs";
import { tokensToChars } from "./tokens";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

/**
 * Tools whose result can be reproduced by calling the tool again.
 *
 * Deliberately a list of what *may* be cleared rather than of what may not: a
 * new tool is kept until someone decides its output is disposable. Not on it,
 * on purpose: the user's answers (`ask_user`, `request_secret`), the guides
 * handed back by `enable_ai` / `add_backend` / `add_database` / `read_doc`,
 * the plan and todo calls, and sub-agent reports — a report is already the
 * distilled result of work that would be expensive to redo.
 *
 * A result on this list can still carry a guide tau attached to it (the first
 * read of `src/index.css`, the first `search_images`). Clearing drops the
 * result and keeps the guide — see `clearedResultText`.
 */
export const CLEARABLE_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "list_dir",
  "grep",
  "run_command",
  "tail_command_output",
  "web_search",
  "search_images",
  // The stored conversation does not change; the same search gives the same
  // answer whenever it is asked.
  "search_history",
  // Normally `{ success: true }`, far too small to clear. On the request that
  // creates an app it also carries the new app's memory and map (`appBrief.ts`),
  // which every later request is given afresh.
  "provision_sandbox",
]);

/** Below this a result costs less than the placeholder that would replace it is worth. */
export const MIN_CLEARABLE_CHARS = 300;

/** The most recent tool results are what the agent is working from; never cleared. */
export const KEEP_RECENT_TOOL_RESULTS = 8;

/**
 * Start of the text left in place of a cleared file body in an old write call.
 * `create_file` / `edit_file` refuse content that starts with it, so a model
 * that copies the placeholder from its history cannot overwrite a file with it.
 */
export const CLEARED_ARG_PREFIX = "[cleared by tau:";

/**
 * Refuse a write whose content is the placeholder rather than a file.
 *
 * An old write call in the history reads `create_file({ path, content:
 * "[cleared by tau: …]" })`. A model can copy what it sees its earlier self
 * doing, and copying that would replace a real file with one line of
 * bookkeeping. Throwing turns it into a tool error the model reads and
 * corrects, at the cost of one turn.
 */
export function assertRealContent(value: string, field: string): void {
  if (value.trimStart().startsWith(CLEARED_ARG_PREFIX)) {
    throw new Error(
      `${field} is a placeholder tau left in the conversation history where earlier file content was cleared — it is not real content. Read the file to see what it contains, then write the actual text.`,
    );
  }
}

interface CallInfo {
  name: string;
  args: Record<string, unknown>;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Map every tool_call_id in `messages` to the call that produced it. */
export function indexToolCalls(messages: MessageParam[]): Map<string, CallInfo> {
  const map = new Map<string, CallInfo>();
  for (const m of messages) {
    if (m.role !== "assistant" || !("tool_calls" in m) || !m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      if (tc.type !== "function") continue;
      map.set(tc.id, {
        name: tc.function.name,
        args: parseArgs(tc.function.arguments),
      });
    }
  }
  return map;
}

/** What the call was about, in a few words: its path, command, pattern or query. */
function describeCall(call: CallInfo): string {
  const { args } = call;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const subject =
    text(args.path) ??
    text(args.logPath) ??
    text(args.command) ??
    text(args.pattern) ??
    text(args.query);
  if (!subject) return call.name;
  const short = subject.length > 80 ? `${subject.slice(0, 80)}…` : subject;
  return `${call.name} ${short}`;
}

/**
 * The placeholder for a cleared result.
 *
 * A pure function of the call and the result it replaces, so a result cleared
 * during a run and the same result cleared when a later request loads its
 * history come out byte-identical — which is what lets the provider's cached
 * prefix survive the boundary between two requests.
 *
 * A guide the result carried is kept. tau attaches a guide to the first read
 * of a file it covers (`docs/delivery.ts`), and the read is disposable where
 * the guide is not: it is what the agent is supposed to be following for the
 * rest of the conversation, and tau will not attach it twice.
 *
 * @param original the result being replaced. Omit when it cannot carry a guide.
 */
export function clearedResultText(call: CallInfo, original?: string): string {
  const placeholder = `[Old result cleared to save context: ${describeCall(call)}. Run it again if you need it — files may have changed since.]`;
  const guides = original ? carriedGuides(original) : "";
  return guides ? `${placeholder}\n\n${guides}` : placeholder;
}

/** Whether this result is one clearing would replace. */
export function isClearable(call: CallInfo | undefined, content: string): boolean {
  if (call === undefined || !CLEARABLE_TOOLS.has(call.name)) return false;
  // A guide is kept when the result is cleared, so it is not part of what
  // clearing would save.
  const disposable = content.length - carriedGuides(content).length;
  return disposable > MIN_CLEARABLE_CHARS;
}

/**
 * Trim the file body out of an old `create_file` / `edit_file` call.
 *
 * In a finished request the arguments of the write calls are usually the bulk
 * of the history — every file the agent wrote, in full — and the least useful
 * part of it: the file on disk is what is true now, and it may have been
 * edited since. The call itself stays, with its path, so the record of *what
 * was written where* survives.
 */
export function trimWriteCall(tc: ToolCall): ToolCall {
  if (tc.type !== "function") return tc;
  const fields =
    tc.function.name === "create_file"
      ? ["content"]
      : tc.function.name === "edit_file"
        ? ["old_string", "new_string"]
        : null;
  if (!fields) return tc;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
  } catch {
    return tc;
  }

  let changed = false;
  for (const field of fields) {
    const value = args[field];
    if (typeof value === "string" && value.length > MIN_CLEARABLE_CHARS) {
      args[field] = `${CLEARED_ARG_PREFIX} ${value.length} characters written in an earlier request. The file on disk is the source of truth — read it before editing.]`;
      changed = true;
    }
  }
  if (!changed) return tc;
  return { ...tc, function: { ...tc.function, arguments: JSON.stringify(args) } };
}

// ── During a run ─────────────────────────────────────────────────────────────

/** Decisions made so far in this run. Only ever grows. */
export interface ClearingState {
  /** tool_call_id → the content that replaces that result from now on. */
  replacements: Map<string, string>;
}

export function createClearingState(): ClearingState {
  return { replacements: new Map() };
}

/** Apply every decision made so far. Returns `messages` itself when none apply. */
export function applyClearing(
  messages: MessageParam[],
  state: ClearingState,
): MessageParam[] {
  if (state.replacements.size === 0) return messages;
  let changed = false;
  const out = messages.map((m) => {
    if (m.role !== "tool") return m;
    const replacement = state.replacements.get(m.tool_call_id);
    if (replacement === undefined || replacement === m.content) return m;
    changed = true;
    return { ...m, content: replacement };
  });
  return changed ? out : messages;
}

function elide(content: string, maxChars: number): string {
  const keep = Math.floor(maxChars / 2);
  const cut = content.length - keep * 2;
  return `${content.slice(0, keep)}\n\n…[${cut} characters cut to save context]…\n\n${content.slice(-keep)}`;
}

/**
 * Take one batch: decide which results to clear so the context comes down to
 * `targetTokens`, and record the decisions in `state`.
 *
 * In order, stopping as soon as the target is met:
 *   1. reads that the agent has since repeated (same file, same range) — the
 *      later copy is the one it is working from;
 *   2. the oldest clearable results, leaving the most recent ones alone;
 *   3. anything else oversized and not recent (a long sub-agent report, say),
 *      cut to its start and end rather than cleared.
 *
 * @param tokensNow    the context's size with the decisions so far applied
 * @param tokensPerChar how the caller's estimate converts, so the running total
 *                      stays in the caller's units
 * @returns how many results were newly cleared or cut
 */
export function planClearing(
  messages: MessageParam[],
  state: ClearingState,
  opts: {
    tokensNow: number;
    targetTokens: number;
    tokensPerChar: number;
    maxToolResultTokens: number;
  },
): number {
  const calls = indexToolCalls(messages);
  let tokens = opts.tokensNow;
  let added = 0;

  const results = messages.filter(
    (m): m is Extract<MessageParam, { role: "tool" }> =>
      m.role === "tool" && typeof m.content === "string",
  );
  const recent = new Set(
    results.slice(-KEEP_RECENT_TOOL_RESULTS).map((m) => m.tool_call_id),
  );

  const replace = (m: (typeof results)[number], replacement: string): void => {
    const current = state.replacements.get(m.tool_call_id) ?? (m.content as string);
    if (replacement.length >= current.length) return;
    state.replacements.set(m.tool_call_id, replacement);
    tokens -= (current.length - replacement.length) * opts.tokensPerChar;
    added++;
  };
  const done = () => tokens <= opts.targetTokens;

  // 1. Superseded reads: the last read of each (path, range) stands.
  const latestRead = new Map<string, string>();
  const readKey = (call: CallInfo | undefined): string | null => {
    if (call?.name !== "read_file" || typeof call.args.path !== "string") return null;
    const part = (v: unknown) => (typeof v === "number" ? String(v) : "");
    return `${call.args.path}|${part(call.args.offset)}|${part(call.args.limit)}`;
  };
  for (const m of results) {
    const key = readKey(calls.get(m.tool_call_id));
    if (key) latestRead.set(key, m.tool_call_id);
  }
  for (const m of results) {
    if (done()) return added;
    if (state.replacements.has(m.tool_call_id)) continue;
    const call = calls.get(m.tool_call_id);
    const key = readKey(call);
    if (key && latestRead.get(key) !== m.tool_call_id && isClearable(call, m.content as string)) {
      replace(m, clearedResultText(call!, m.content as string));
    }
  }

  // 2. Oldest clearable results first.
  for (const m of results) {
    if (done()) return added;
    if (recent.has(m.tool_call_id) || state.replacements.has(m.tool_call_id)) continue;
    const call = calls.get(m.tool_call_id);
    if (isClearable(call, m.content as string)) {
      replace(m, clearedResultText(call!, m.content as string));
    }
  }

  // 3. Whatever is left that is simply too big.
  const maxChars = tokensToChars(opts.maxToolResultTokens);
  for (const m of results) {
    if (done()) return added;
    if (recent.has(m.tool_call_id) || state.replacements.has(m.tool_call_id)) continue;
    const content = m.content as string;
    // Cutting the middle out of a result would cut the middle out of a guide.
    if (mentionsGuide(content)) continue;
    if (content.length > maxChars) replace(m, elide(content, maxChars));
  }

  return added;
}
