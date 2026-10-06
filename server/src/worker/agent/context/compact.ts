import type OpenAI from "openai";
import { estimateTokens, tokensToChars } from "./tokens";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface CompactResult {
  messages: MessageParam[];
  tokensBefore: number;
  tokensAfter: number;
  changed: boolean;
}

interface ToolCallMeta {
  name: string;
  path: string | null;
  /**
   * What a later read must match to supersede this one: the path plus the
   * `offset` / `limit` it was read with. `read_file` pages long files, so two
   * reads of one path can be two different halves of it — the second does not
   * make the first stale, and collapsing it would throw away the only copy of
   * those lines the model has.
   */
  readKey: string | null;
}

/** Map every tool_call_id → its tool name + `path` arg (if any). */
function indexToolCalls(messages: MessageParam[]): Map<string, ToolCallMeta> {
  const map = new Map<string, ToolCallMeta>();
  for (const m of messages) {
    if (m.role !== "assistant" || !("tool_calls" in m) || !m.tool_calls) {
      continue;
    }
    for (const tc of m.tool_calls) {
      if (tc.type !== "function") continue;
      let path: string | null = null;
      let readKey: string | null = null;
      try {
        const args = tc.function.arguments
          ? (JSON.parse(tc.function.arguments) as {
              path?: unknown;
              offset?: unknown;
              limit?: unknown;
            })
          : {};
        path = typeof args.path === "string" ? args.path : null;
        if (path !== null) {
          const part = (v: unknown) => (typeof v === "number" ? String(v) : "");
          readKey = `${path}|${part(args.offset)}|${part(args.limit)}`;
        }
      } catch {
        path = null;
      }
      map.set(tc.id, { name: tc.function.name, path, readKey });
    }
  }
  return map;
}

/** Head+tail elision that keeps the shape of a result visible to the model. */
function elide(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const keep = Math.floor(maxChars / 2);
  const elided = content.length - keep * 2;
  return `${content.slice(0, keep)}\n\n…[${elided} chars elided — full output retained in history]…\n\n${content.slice(-keep)}`;
}

/**
 * Mechanically shrink the model-facing array without dropping any frames (so an
 * assistant tool_call is never separated from its tool result). Only tool-result
 * `content` strings are edited:
 *   1. Superseded `read_file` results (the same path and the same line range
 *      read again later) collapse to a one-line pointer.
 *   2. Any remaining oversized tool result is elided head+tail.
 *
 * Returns the original array reference (changed=false) when nothing was trimmed.
 */
export function compact(
  messages: MessageParam[],
  opts: { maxToolResultTokens: number },
): CompactResult {
  const tokensBefore = estimateTokens(messages);
  const meta = indexToolCalls(messages);

  // For read_file, find the last tool_call_id per path + range so earlier
  // reads of that same range collapse.
  const latestReadIdByKey = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "tool") continue;
    const info = meta.get(m.tool_call_id);
    if (info?.name === "read_file" && info.readKey) {
      latestReadIdByKey.set(info.readKey, m.tool_call_id);
    }
  }

  const maxChars = tokensToChars(opts.maxToolResultTokens);
  let changed = false;

  const out = messages.map((m) => {
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    const info = meta.get(m.tool_call_id);

    // 1. Superseded read.
    if (
      info?.name === "read_file" &&
      info.path &&
      info.readKey &&
      latestReadIdByKey.get(info.readKey) !== m.tool_call_id
    ) {
      changed = true;
      return {
        ...m,
        content: `[stale read of ${info.path} — superseded by a later read]`,
      };
    }

    // 2. Oversized result.
    if (m.content.length > maxChars) {
      changed = true;
      return { ...m, content: elide(m.content, maxChars) };
    }

    return m;
  });

  if (!changed) {
    return { messages, tokensBefore, tokensAfter: tokensBefore, changed: false };
  }
  return {
    messages: out,
    tokensBefore,
    tokensAfter: estimateTokens(out),
    changed: true,
  };
}
