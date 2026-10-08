/**
 * Looking something up in a project's stored conversation.
 *
 * A summary is a model's paraphrase written to a token limit, and what it
 * drops is gone from the agent's context for good — the exact wording of
 * something the user said three requests ago, which file a decision was made
 * in, the command that finally worked. None of it is actually gone: every
 * message is a row in Postgres. `search_history` lets the agent go and get the
 * one detail it needs, instead of tau trying to guess in advance which details
 * a summary must keep (doc/CONTEXT_AND_MEMORY_PLAN.md §7, item 10).
 *
 * Two ways in, one tool:
 *
 *   - **search** — words to look for. Returns the messages that contain all of
 *     them, newest first, each as a short excerpt around the match with the
 *     message's number;
 *   - **around** — a message number from a search. Returns that message and
 *     its neighbours at greater length, for reading what led up to something.
 *
 * What is searched: what the user said, what the agent said, and what the
 * agent did (which tools on which files, with what arguments). Tool *results*
 * are not searched — file contents and command output are most of the bytes,
 * are out of date, and can be had fresh by running the tool again.
 *
 * It stops at "Clear chat". A user who cleared the conversation asked for a
 * fresh start, and an agent that could read back past it would not have given
 * them one.
 *
 * The functions here are pure; the queries are in
 * `tools/functions/search-history.ts`.
 */
import { messageText } from "./marks";

export const MAX_HISTORY_MATCHES = 8;
export const MAX_EXCERPT_CHARS = 500;
export const MAX_NEIGHBOUR_CHARS = 1_800;
/**
 * The message that was asked for is given at greater length than the ones
 * either side of it: it is the one being read, they are there for context.
 */
export const MAX_FOCUS_CHARS = 6_000;
/** Messages either side of the one asked about. */
export const NEIGHBOURS_EACH_SIDE = 3;
export const MAX_QUERY_TERMS = 6;

/** The columns of a stored message this needs. */
export interface StoredRow {
  sequence: number;
  role: string;
  type: string;
  content: unknown;
  createdAt: Date;
  /** How many of the searched words the message contains, when the database counted. */
  hits?: number;
}

interface StoredToolCall {
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** Who a row is from, as the agent should think of it; null for rows that are not conversation. */
export function speakerOf(row: Pick<StoredRow, "role" | "type">): "user" | "assistant" | "tool" | null {
  if (row.type === "TOOL_RES") return "tool";
  if (row.type === "USER_EDIT") return "user";
  if (row.role === "USER") return "user";
  if (row.role === "ASSISTANT") return "assistant";
  return null;
}

/** The tool a search is made with. Its own calls are never search results. */
const LOOKUP_TOOL = "search_history";

/** Room in a call for its short values, on top of one long one cut to its limit. */
const CALL_OVERHEAD_CHARS = 2_100;

/**
 * One tool call as a line of text.
 *
 * Cut value by value, not as one string: a call is mostly short values worth
 * keeping whole (a path, a command, the titles of a plan) and at most one long
 * one (the body of a file). A long value is cut to `maxValue` characters —
 * around the first of `terms` it contains, when it contains one, so that a
 * search which matched inside a file shows the line that matched.
 */
function callText(call: StoredToolCall, maxValue: number, terms: readonly string[] = []): string {
  const name = call.function?.name ?? "tool";
  const raw = call.function?.arguments ?? "";
  let args = raw;
  try {
    args = JSON.stringify(JSON.parse(raw), (_key, value: unknown) => {
      if (typeof value !== "string" || value.length <= maxValue) return value;
      const lower = value.toLowerCase();
      if (terms.some((t) => lower.includes(t.toLowerCase()))) {
        return `${excerptAround(value, terms, maxValue)} [${value.length.toLocaleString("en-US")} characters in all]`;
      }
      return `${value.slice(0, maxValue).replace(/\s+/g, " ")}… [${(value.length - maxValue).toLocaleString("en-US")} more characters]`;
    });
  } catch {
    // Arguments the model never finished writing: shown as they are.
  }
  // A plan of twenty todos fits; a file does not.
  const max = maxValue + CALL_OVERHEAD_CHARS;
  return `[called ${name}(${args.length > max ? `${args.slice(0, max)}…` : args})]`;
}

function assistantParts(content: unknown): { said: string; calls: StoredToolCall[] } {
  const stored = (content ?? {}) as { content?: unknown; tool_calls?: StoredToolCall[] | null };
  return {
    said: typeof stored.content === "string" ? stored.content.trim() : "",
    calls: stored.tool_calls ?? [],
  };
}

/**
 * A stored row as plain text: what was said, and for the agent, what it did.
 * A tool result is described rather than quoted.
 *
 * @param maxValue  the length a single argument of a tool call is cut to
 * @param terms     what is being searched for, when something is
 */
export function rowText(
  row: Pick<StoredRow, "role" | "type" | "content">,
  maxValue = 300,
  terms: readonly string[] = [],
): string {
  const content = row.content;
  if (row.type === "TOOL_RES") {
    const results = Array.isArray(content) ? (content as { content?: unknown }[]) : [];
    const chars = results.reduce((n, r) => n + (typeof r.content === "string" ? r.content.length : 0), 0);
    return `[${results.length} tool result${results.length === 1 ? "" : "s"}, ${chars.toLocaleString("en-US")} characters — not kept here; run the tool again for current output]`;
  }
  if (row.type === "USER_EDIT") {
    const edit = (content ?? {}) as { path?: string; linesAdded?: number; linesRemoved?: number };
    return `[the user edited ${edit.path ?? "a file"} by hand: +${edit.linesAdded ?? 0}/-${edit.linesRemoved ?? 0} lines]`;
  }
  if (row.role === "ASSISTANT") {
    const { said, calls } = assistantParts(content);
    const did = calls
      // Looking something up is not part of what happened.
      .filter((call) => call.function?.name !== LOOKUP_TOOL)
      .map((call) => callText(call, maxValue, terms));
    return [said, ...did].filter(Boolean).join("\n");
  }
  return messageText(content).trim();
}

/**
 * Whether a row says or does the thing searched for, as opposed to merely
 * containing the words somewhere in a file it wrote. True for anything a
 * person said; for the agent, true when the words are in what it said or in
 * the short arguments of a call (a path, a command, a plan).
 */
function isDirectMatch(
  row: Pick<StoredRow, "role" | "type" | "content">,
  terms: readonly string[],
  hasAll = true,
): boolean {
  // Whatever a person said counts, with only some of the words or all; for the
  // agent's own messages there is no telling without every word to look for.
  if (row.role !== "ASSISTANT") return true;
  if (!hasAll) return false;
  const { said, calls } = assistantParts(row.content);
  const short: string[] = [said];
  for (const call of calls) {
    if (call.function?.name === LOOKUP_TOOL) continue;
    short.push(call.function?.name ?? "");
    try {
      JSON.stringify(JSON.parse(call.function?.arguments ?? ""), (_key, value: unknown) => {
        if (typeof value === "string" && value.length <= 300) short.push(value);
        return value;
      });
    } catch {
      // Unparseable arguments count for nothing.
    }
  }
  const text = short.join("\n").toLowerCase();
  return terms.every((t) => text.includes(t.toLowerCase()));
}

/** The words of a query: lower-cased, de-duplicated, at most `MAX_QUERY_TERMS`. */
export function queryTerms(query: unknown): string[] {
  if (typeof query !== "string") return [];
  const quoted = /^\s*"(.+)"\s*$/.exec(query);
  const terms = quoted
    ? [quoted[1]!.trim()]
    : query.split(/\s+/).map((t) => t.replace(/^["'`]+|["'`,.;:]+$/g, ""));
  return [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2))].slice(0, MAX_QUERY_TERMS);
}

/**
 * A word cut back to what its forms share, so that "measures" finds
 * "measurements" and "pricing" finds "priced". Crude on purpose: it strips the
 * commonest endings and keeps at least four letters, and since the search is
 * for a stretch of letters inside words, a stem that is a little too short only
 * finds a little more. A phrase, or a short word, is left as it is.
 */
export function stemOf(term: string): string {
  if (/\s/.test(term) || term.length < 6) return term;
  const stem = term.replace(/(ments?|ings?|ers?|ed|es|s|ly)$/i, "");
  return stem.length >= 4 ? stem : term;
}

/** The terms of a search, as the stretches of letters looked for. */
export function searchStems(terms: readonly string[]): string[] {
  return [...new Set(terms.map(stemOf))];
}

/** A term as a SQL `ILIKE` pattern, with its own `%`, `_` and `\` made literal. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * A stretch of `text` around the first place any term appears, cut at word
 * boundaries where it can be. The whole text when it is short enough.
 */
export function excerptAround(text: string, terms: readonly string[], max = MAX_EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0);
  const at = hits.length > 0 ? Math.min(...hits) : 0;
  let start = Math.max(0, at - Math.floor(max / 3));
  let end = Math.min(flat.length, start + max);
  start = Math.max(0, end - max);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > at) end = space;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

export interface HistoryMatch {
  /** The message's number; pass it as `around` to read its neighbours. */
  n: number;
  from: "user" | "assistant";
  /** The day it was said, `YYYY-MM-DD`. */
  on: string;
  excerpt: string;
}

/**
 * Turn rows the database matched (newest first) into what the agent is shown.
 *
 * Conversation comes before code. The database matches on the stored form of
 * a message, which for the agent includes every file it wrote, so a search
 * for an everyday word matches a dozen `create_file` calls. Those are still
 * worth returning — "where did I put that" is a fair question — but after the
 * messages where the words were said or were the point of the call.
 *
 * A row that is nothing but an earlier lookup is dropped: the search would
 * otherwise find itself.
 */
export function toMatches(rows: readonly StoredRow[], terms: readonly string[]): HistoryMatch[] {
  // Four kinds, in this order: said, with every word; in a file, with every
  // word; and then the same two for a message with only some of the words. The
  // rows come in the order the database ranked them, which each kind keeps.
  const tiers: HistoryMatch[][] = [[], [], [], []];
  for (const row of rows) {
    const from = speakerOf(row);
    if (from !== "user" && from !== "assistant") continue;
    const text = rowText(row, 300, terms);
    if (!text) continue;
    const all = (row.hits ?? terms.length) >= terms.length;
    const said = isDirectMatch(row, terms, all);
    tiers[(all ? 0 : 2) + (said ? 0 : 1)]!.push({
      n: row.sequence,
      from,
      on: row.createdAt.toISOString().slice(0, 10),
      excerpt: excerptAround(text, terms),
    });
  }
  return tiers.flat().slice(0, MAX_HISTORY_MATCHES);
}

export interface HistoryMessage {
  n: number;
  from: "user" | "assistant" | "tool";
  on: string;
  text: string;
}

/**
 * Rows as a stretch of conversation, oldest first, each cut to a readable
 * length. `focus` is the number of the message that was asked for, which is
 * given nearly whole: someone who asks to read a message and gets most of it
 * asks again, and again, for the rest.
 */
export function toConversation(rows: readonly StoredRow[], focus?: number): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  for (const row of [...rows].sort((a, b) => a.sequence - b.sequence)) {
    const from = speakerOf(row);
    if (!from) continue;
    const focused = row.sequence === focus;
    const max = focused ? MAX_FOCUS_CHARS : MAX_NEIGHBOUR_CHARS;
    const text = rowText(row, focused ? MAX_FOCUS_CHARS - CALL_OVERHEAD_CHARS : 300);
    if (!text) continue;
    out.push({
      n: row.sequence,
      from,
      on: row.createdAt.toISOString().slice(0, 10),
      text:
        text.length > max
          ? `${text.slice(0, max)}… [${(text.length - max).toLocaleString("en-US")} more characters]`
          : text,
    });
  }
  return out;
}
