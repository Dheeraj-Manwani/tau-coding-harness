/**
 * Attaching guides to tool results, without the model having to ask.
 *
 * Of the three ways a guide reaches the model (see `index.ts`), asking for one
 * with `read_doc` is the least dependable: a model that is confident it knows
 * how to write a Hono route does not look up how. So wherever there is a
 * trigger tau can see for itself, it does not wait to be asked:
 *
 *   - the agent opens or changes a file a guide covers (`server/db/schema.ts`
 *     → `database`, `src/index.css` → `theme`), or
 *   - it first uses a tool a guide explains (`search_images` → `assets`),
 *
 * and the guide is added to that tool's result. Reads are a trigger as well as
 * writes on purpose: the agent reads a file before it edits it, so the guide
 * arrives before the code is written rather than just after.
 *
 * ## Once per conversation
 *
 * A guide is attached only if it is not already in the conversation. "In the
 * conversation" is decided by looking, not by remembering: every guide carries
 * a marker line (`guideText`), and `docStateFrom` finds the markers in the tool
 * results the model is about to be sent. That makes it true across requests —
 * a guide loaded on Monday is still in Tuesday's history, because results that
 * carry one are never cleared of it (`context/clearing.ts`) — and true after a
 * summarization, which drops the old results: the guide is gone, so the next
 * trigger attaches it again.
 *
 * Generation 2 only. A generation-1 project carries all of this in its system
 * prompt and is sent no attachments.
 *
 * Pure: no database, no sandbox. See doc/CONTEXT_AND_MEMORY_PLAN.md §3.
 */
import type OpenAI from "openai";
import {
  docsForPath,
  docsForTool,
  guideText,
  guidesIn,
  type DocName,
} from "./index";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Tools whose `path` argument names a project file the agent is working on. */
const PATH_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "edit_file",
  "create_file",
]);

/** Which guides are in the conversation right now. */
export interface DocState {
  loaded: Set<DocName>;
}

/** Read the state off a conversation: every guide some tool result carries. */
export function docStateFrom(messages: readonly MessageParam[]): DocState {
  const loaded = new Set<DocName>();
  for (const m of messages) {
    if (m.role !== "tool" || typeof m.content !== "string") continue;
    for (const name of guidesIn(m.content)) loaded.add(name);
  }
  return { loaded };
}

/** How a guide got into a result. */
export type DocRoute =
  /** The tool returned it itself (`add_backend`, `enable_ai`, …). */
  | "tool"
  /** The model asked, with `read_doc`. */
  | "pull"
  /** tau attached it because of the file the call touched. */
  | "path"
  /** tau attached it because the tool was used for the first time. */
  | "first_use";

export interface Delivered {
  name: DocName;
  via: DocRoute;
  /** The guide was already in the conversation when the tool returned it again. */
  repeat: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathOf(input: unknown): string | null {
  if (!isPlainObject(input)) return null;
  return typeof input.path === "string" && input.path.trim() ? input.path : null;
}

function attachmentNote(tool: string, path: string | null, wrote: boolean): string {
  const why = path
    ? `because you ${wrote ? "changed" : "opened"} ${path}`
    : `because this is the first time \`${tool}\` was used`;
  const check = wrote
    ? " Check what you just wrote against it, and fix anything that disagrees."
    : "";
  return `A guide is attached below ${why}. It describes how this is done in this app — follow it over what you remember.${check}`;
}

/**
 * Account for the guides in a tool's result, and attach any that are due.
 *
 * Call once per finished tool call, with the output the tool produced. Returns
 * the output to hand the model — the same object when nothing was attached —
 * and what was delivered, for the run log.
 *
 * Nothing is attached to a failed call: its result is an error to read, and the
 * guide will ride on the retry.
 */
export function deliverDocs(
  state: DocState,
  tool: string,
  input: unknown,
  output: unknown,
): { output: unknown; delivered: Delivered[] } {
  const delivered: Delivered[] = [];

  // Guides the tool returned by itself.
  for (const name of guidesIn(JSON.stringify(output ?? null))) {
    delivered.push({
      name,
      via: tool === "read_doc" ? "pull" : "tool",
      repeat: state.loaded.has(name),
    });
    state.loaded.add(name);
  }

  if (!isPlainObject(output) || "error" in output) return { output, delivered };

  const path = PATH_TOOLS.has(tool) ? pathOf(input) : null;
  const due = [
    ...(path ? docsForPath(path).map((name) => ({ name, via: "path" as const })) : []),
    ...docsForTool(tool, output).map((name) => ({ name, via: "first_use" as const })),
  ].filter((d) => !state.loaded.has(d.name));
  if (due.length === 0) return { output, delivered };

  for (const d of due) {
    state.loaded.add(d.name);
    delivered.push({ ...d, repeat: false });
  }
  const byPath = due.some((d) => d.via === "path");
  return {
    output: {
      ...output,
      guideNote: attachmentNote(tool, byPath ? path : null, byPath && tool !== "read_file"),
      attachedGuide: due.map((d) => guideText(d.name)).join("\n\n"),
    },
    delivered,
  };
}
