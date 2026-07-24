import { clientForModel } from "../../lib/kimi";
import { SUMMARY_MAX_TOKENS } from "../config";
import { pickBoundary } from "./boundary";
import { compact } from "./compact";
import { estimateTokens } from "./tokens";
import type { Entry, MessageParam } from "./types";

/** Marks an injected summary entry so it can be recognised + folded in later. */
export const SUMMARY_HEADER = "## Summary of earlier conversation\n";

const SUMMARIZER_SYSTEM = `You compress the earlier part of a long coding-agent conversation into a durable summary the agent will rely on as its memory of everything that happened before the retained recent turns.

Your output has a hard token limit, and reducing size is the entire point of this step — it must always come out substantially smaller than the transcript, no matter how large or eventful that transcript was. You will not fit everything in. Be ruthless about what earns a place:

Keep, in this priority order (drop lower-priority items first if space runs short):
1. What the app is and does now; the stack/template it was built on.
2. Current plan / todo state: what's done, what's in progress, what's left.
3. Anything unresolved: bugs, blockers, open questions, things the user asked for but not yet built.
4. Decisions and conventions already made (naming, patterns, libraries chosen) — only ones that still matter going forward.
5. Key files, routes, components, and data model / types — only the ones still relevant, not an exhaustive inventory.

Discard aggressively: exploratory dead-ends, superseded decisions, routine tool-call narration, verbose command output, anything a later step already made moot. When in doubt, omit — a short summary that drops a minor detail beats a long one that trails off mid-thought because it hit the token limit.

Write plain, dense markdown — no greetings, no restating these instructions, no commentary. Prefer concrete names (files, routes, functions) over vague prose, but only for things that survive the cut above. This replaces the raw messages, so omitting something means the agent forgets it — omit the unimportant, not the load-bearing.`;

/** Render a slice of messages as a plain-text transcript for the summarizer. */
function renderTranscript(messages: MessageParam[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      lines.push(`User: ${text}`);
    } else if (m.role === "assistant") {
      if (typeof m.content === "string" && m.content.trim()) {
        lines.push(`Assistant: ${m.content}`);
      }
      if ("tool_calls" in m && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.type === "function") {
            lines.push(
              `Assistant called ${tc.function.name}(${tc.function.arguments})`,
            );
          }
        }
      }
    } else if (m.role === "tool") {
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      lines.push(`Tool result: ${text}`);
    }
  }
  return lines.join("\n");
}

export interface SummarizeResult {
  entries: Entry[];
  upToSequence: number;
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Replace the older prefix of `entries` with an LLM-generated running summary,
 * keeping index 0 (system) and the recent tail verbatim. Returns null when
 * there is nothing worth summarizing (no backing rows in the prefix).
 */
export async function summarize(
  entries: Entry[],
  opts: {
    model: string;
    keepTailTokens: number;
    maxToolResultTokens: number;
  },
): Promise<SummarizeResult | null> {
  const boundary = pickBoundary(entries, opts.keepTailTokens);
  // Need at least one non-system, non-summary entry in the prefix to summarize.
  if (boundary <= 1) return null;

  const system = entries[0]!;
  const prefix = entries.slice(1, boundary);
  const tail = entries.slice(boundary);

  // Fold a previous summary (if the prefix leads with one) into the new one.
  let prevSummary = "";
  const prefixBody: Entry[] = [];
  for (const e of prefix) {
    if (
      e.seq === null &&
      typeof e.param.content === "string" &&
      e.param.content.startsWith(SUMMARY_HEADER)
    ) {
      prevSummary = e.param.content.slice(SUMMARY_HEADER.length);
    } else {
      prefixBody.push(e);
    }
  }

  const upToSequence = prefixBody.reduce<number | null>(
    (max, e) => (e.seq !== null && (max === null || e.seq > max) ? e.seq : max),
    null,
  );
  if (upToSequence === null) return null;

  // Bound the summarizer's own input by compacting the prefix first.
  const compacted = compact(
    prefixBody.map((e) => e.param),
    { maxToolResultTokens: opts.maxToolResultTokens },
  );
  const transcript = renderTranscript(compacted.messages);

  const completion = await clientForModel(opts.model).chat.completions.create({
    model: opts.model,
    temperature: 0.2,
    max_tokens: SUMMARY_MAX_TOKENS,
    messages: [
      { role: "system", content: SUMMARIZER_SYSTEM },
      ...(prevSummary
        ? [
            {
              role: "user" as const,
              content: `Summary of the conversation before this point:\n${prevSummary}`,
            },
          ]
        : []),
      {
        role: "user",
        content: `Conversation to summarize:\n\n${transcript}`,
      },
    ],
  });

  const summaryText = completion.choices[0]?.message.content?.trim();
  if (!summaryText) return null;

  const summaryEntry: Entry = {
    param: { role: "system", content: `${SUMMARY_HEADER}${summaryText}` },
    seq: null,
  };

  const newEntries: Entry[] = [system, summaryEntry, ...tail];

  return {
    entries: newEntries,
    upToSequence,
    summary: summaryText,
    tokensBefore: estimateTokens(entries.map((e) => e.param)),
    tokensAfter: estimateTokens(newEntries.map((e) => e.param)),
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}
