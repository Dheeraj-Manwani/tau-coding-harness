import { clientForModel } from "@/lib/kimi";
import { SUMMARY_MAX_TOKENS } from "../config";
import { pickBoundary } from "./boundary";
import { compact } from "./compact";
import { isRestoredState, messageText } from "./marks";
import { estimateTokens } from "./tokens";
import type { Entry, MessageParam } from "./types";

/** Marks an injected summary entry so it can be recognised + folded in later. */
export const SUMMARY_HEADER = "## Summary of earlier conversation\n";

/**
 * Said after every summary. A summary reads as the whole of what happened; the
 * agent has to be told that it is not, and where the rest is.
 */
export const SUMMARY_FOOTER =
  "\n\n[The messages this summary replaces are still stored. `search_history` finds a detail it left out.]";

/** A summary as it sits in the conversation. */
export function summaryMessage(summary: string): string {
  return `${SUMMARY_HEADER}${summary}${SUMMARY_FOOTER}`;
}

/** The summary inside such a message. */
export function summaryOf(message: string): string {
  const body = message.slice(SUMMARY_HEADER.length);
  return body.endsWith(SUMMARY_FOOTER) ? body.slice(0, -SUMMARY_FOOTER.length) : body;
}

/**
 * The summary's sections, in order. Fixed, so that a summary of a summary
 * keeps its shape and the agent always knows where to look for what.
 */
export const SUMMARY_SECTIONS = ["Requests", "State of the work", "Decisions", "Problems", "Next"] as const;

export const SUMMARIZER_SYSTEM = `You compress the earlier part of a long conversation between a user and a coding agent that is building the user's web app. Your summary replaces those messages: it is all the agent will remember of them.

Some things are restored for the agent separately, exactly and in full, right after your summary: the user's most recent request word for word, the agent's plan with the status of each item, the list of files changed, the app's own memory file, its design, and a map of its files. Do not spend space repeating any of those. Spend it on what only the conversation held.

Write these five sections, with these headings, in this order. Write "None." under one with nothing to say.

## Requests
What the user has asked for, oldest first, in their terms — one line each. Include corrections, preferences and things they said not to do, however briefly they said them: these are the first things a summary loses and the most expensive to lose. Mark the request in progress.

## State of the work
Where things stand, concretely: what is built and working, what is half-done and in what state it was left, what has not been started. Name the files, routes and components involved.

## Decisions
Choices already made that later work has to respect, each with its reason in a few words: a library picked, a structure settled on, an approach the user approved or rejected.

## Problems
Errors hit and how each was fixed; approaches that were tried and failed, so they are not tried again; anything still broken or unanswered.

## Next
What the agent was about to do when this part of the conversation ended, most immediate first.

Your output has a hard token limit, and it must come out far smaller than the transcript however long that was. You will not fit everything. Leave out routine tool-call narration, command output, file contents, and anything a later step made moot. When short of space, cut from "State of the work" before cutting a user's stated preference or a failed approach. Plain, dense markdown; concrete names over vague prose; no greeting, no commentary, nothing outside the five sections.`;

/**
 * Blocks tau attaches to a user's message — the app's memory and map, the
 * effort note, a previous plan, the user's standing instructions. They are
 * restored fresh after a summary, so
 * handing them to the summarizer would only invite it to copy them.
 */
const TAU_BLOCK = /\n*<(tau_app|tau_effort|tau_previous_plan|tau_instructions)>[\s\S]*?<\/\1>/g;

/** A user message as the summarizer should read it: the user's words only. */
export function withoutTauBlocks(text: string): string {
  return text.replace(TAU_BLOCK, "").trim();
}

/** Render a slice of messages as a plain-text transcript for the summarizer. */
function renderTranscript(messages: MessageParam[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      const text = withoutTauBlocks(messageText(m.content));
      if (text) lines.push(`User: ${text}`);
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
      prevSummary = summaryOf(e.param.content);
    } else if (isRestoredState(e.param)) {
      // State restored after the last summary. It is not conversation, and a
      // fresh copy follows this summary too.
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
              content: `Your summary of the conversation before this point, in the same five sections. Fold it into the new one: keep what still matters, drop what the newer messages made moot.\n\n${prevSummary}`,
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
    param: { role: "system", content: summaryMessage(summaryText) },
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
