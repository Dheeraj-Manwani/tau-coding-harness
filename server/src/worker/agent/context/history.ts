/**
 * Turning a project's stored messages into the history the model is sent.
 *
 * The rows are stored raw and stay raw — what changes is how they are replayed:
 *
 *   - **Earlier requests are cleared.** A request that has finished is kept as
 *     the conversation it was (the user's words, the agent's replies, which
 *     tools it called on what), but the bulky, re-fetchable parts are replaced
 *     with one-line placeholders: tool results that can be had again by calling
 *     the tool, and the file bodies inside write calls. Those were accurate
 *     when produced and may not be now, and before this they were re-sent — and
 *     re-paid for — on every turn of every later request. The request in
 *     progress is replayed in full.
 *   - **Each request carries its own effort note.** The effort directive used
 *     to sit near the top of the system prompt, so switching a project from
 *     HIGH to MAX changed the first lines of every request and with them the
 *     whole cached prefix. Effort is a property of a request, not of the
 *     project, so it now travels with the request: appended to the user's
 *     message, derived from that request's `Job.effort`. The system prompt no
 *     longer mentions it.
 *
 * Both are pure functions of the stored rows, so a history comes out the same
 * every time it is loaded — which is what keeps the provider's prefix cache
 * valid from one request to the next.
 *
 * Pure: no database, no clock. `loadHistory` in `loop.ts` does the queries.
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §7.
 */
import type OpenAI from "openai";
import type { Effort } from "@/generated/prisma/enums";
import { effortDirective } from "../config";
import { summaryMessage } from "./summarize";
import {
  clearedResultText,
  isClearable,
  trimWriteCall,
} from "./clearing";
import type { Entry } from "./types";

type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type UserContent = OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"];

/** The columns of a `Message` row this needs. */
export interface HistoryRow {
  sequence: number;
  role: string;
  type: string;
  jobId: string | null;
  content: unknown;
}

interface StoredAssistant {
  content: string | null;
  tool_calls: ToolCall[] | null;
}

interface StoredToolResult {
  tool_call_id: string;
  content: string;
}

/** Content of a hidden USER_EDIT row — a manual edit the user made in the code
 *  editor. Written by the api (`saveProjectFile`). See doc/USER_CODE_EDITING.md. */
interface StoredUserEdit {
  path: string;
  diff: string;
  truncated: boolean;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Render a hidden USER_EDIT row as a user-role turn.
 *
 * The user's edit is already applied to the file — this is a notification, not
 * a request, and the prompt says so explicitly to stop the model "helpfully"
 * re-applying or reverting it. We send the diff rather than the content because
 * the model can always `read_file` the live sandbox for bytes; what it can't do
 * is notice that something moved.
 */
function userEditPrompt(edit: StoredUserEdit): string {
  const stat = `+${edit.linesAdded}/-${edit.linesRemoved}`;
  if (edit.truncated) {
    return `[The user manually edited ${edit.path} in the code editor (${stat} lines). This is not a request — the change is already applied to the file. The diff was too large to include in full; re-read the file before relying on your memory of it.]\n\n${edit.diff}`;
  }
  return `[The user manually edited ${edit.path} in the code editor (${stat} lines). This is not a request — the change is already applied to the file. Unified diff:]\n\n${edit.diff}`;
}

/** The effort directive as it is attached to a request. */
export function effortNote(effort: Effort): string {
  return `<tau_effort>\nSet by the user for this request, and only this request.\n${effortDirective(effort)}\n</tau_effort>`;
}

/** Append a note to the user's message, whatever its shape. */
export function withNote(content: UserContent, note: string): UserContent {
  if (typeof content === "string") return `${content}\n\n${note}`;
  // Attachments make the content an array of parts; the note is one more.
  return [...content, { type: "text", text: note }];
}

/** Append a request's effort note to the user's message. */
export function withEffortNote(content: UserContent, effort: Effort): UserContent {
  return withNote(content, effortNote(effort));
}

/**
 * Which job each user message started.
 *
 * A user message row has no `jobId` of its own, but the rows its request
 * produced do, and they follow it. So a message's job is the job of the next
 * row that has one — unless another user message comes first, in which case it
 * never ran (a prompt that was superseded before any work happened). A message
 * with nothing after it is the request being run right now.
 */
function jobByUserSequence(
  rows: HistoryRow[],
  currentJobId: string | undefined,
): Map<number, string> {
  const out = new Map<number, string>();
  let pending: number | null = null;
  for (const row of rows) {
    if (row.role === "USER" && row.type === "USER") {
      pending = row.sequence;
    } else if (row.jobId && pending !== null) {
      out.set(pending, row.jobId);
      pending = null;
    }
  }
  if (pending !== null && currentJobId) out.set(pending, currentJobId);
  return out;
}

/** Every job id the rows refer to, for one effort lookup. */
export function jobIdsIn(rows: HistoryRow[]): string[] {
  return [...new Set(rows.map((r) => r.jobId).filter((id): id is string => !!id))];
}

/**
 * Build the replayable history.
 *
 * @param currentJobId  the request in progress: its rows are replayed in full.
 *                      Omit when there is none (the "summarize chat" action,
 *                      the context-usage figure) — every request is then an
 *                      earlier one, which is what the next request will see.
 * @param effortByJob   `Job.effort` for the jobs in `rows`. A request whose job
 *                      is missing from it simply gets no effort note.
 * @param currentRequestNote  appended to the message that started the request
 *                      in progress, after its effort note — the app's memory
 *                      and map (`appBrief.ts`). Only that message gets it: an
 *                      earlier request is replayed without the copy it was
 *                      sent, because the copy on the newest request replaces
 *                      it and an old one would only be stale.
 */
export function shapeHistory(
  rows: HistoryRow[],
  opts: {
    checkpointSummary?: string | null;
    currentJobId?: string;
    effortByJob?: ReadonlyMap<string, Effort>;
    currentRequestNote?: string | null;
  } = {},
): Entry[] {
  const entries: Entry[] = [];

  // A "Clear chat" checkpoint carries no summary — nothing of it should
  // carry forward into the model's context.
  if (opts.checkpointSummary) {
    entries.push({
      param: {
        role: "system",
        content: summaryMessage(opts.checkpointSummary),
      },
      seq: null,
    });
  }

  const jobOfUser = jobByUserSequence(rows, opts.currentJobId);
  const isEarlier = (row: HistoryRow) =>
    row.jobId !== null && row.jobId !== opts.currentJobId;

  // Tool calls by id, so a result knows which call produced it.
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();

  for (const row of rows) {
    if (row.type === "TOOL_RES") {
      const results = row.content as StoredToolResult[];
      for (const r of results) {
        const call = calls.get(r.tool_call_id);
        const content =
          isEarlier(row) && isClearable(call, r.content)
            ? clearedResultText(call!, r.content)
            : r.content;
        entries.push({
          param: { role: "tool", tool_call_id: r.tool_call_id, content },
          seq: row.sequence,
        });
      }
    } else if (row.role === "ASSISTANT") {
      const stored = row.content as StoredAssistant;
      const hasToolCalls = !!stored.tool_calls?.length;
      const hasContent =
        typeof stored.content === "string" && stored.content.trim().length > 0;
      // Skip empty assistant rows — e.g. the anchor row a PREVIEW job writes to
      // hang a fragment on, or a final turn the model ended with null content.
      // Replaying one sends `{ role: "assistant" }` with neither content nor
      // tool_calls, which the completions API rejects with a 400.
      if (!hasToolCalls && !hasContent) continue;

      for (const tc of stored.tool_calls ?? []) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // Unparseable arguments: the call is still replayed, just undescribed.
        }
        calls.set(tc.id, { name: tc.function.name, args });
      }

      const toolCalls = isEarlier(row)
        ? stored.tool_calls?.map(trimWriteCall)
        : stored.tool_calls;
      entries.push({
        param: {
          role: "assistant",
          content: stored.content,
          ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        },
        seq: row.sequence,
      });
    } else if (row.role === "USER" && row.type === "USER") {
      const jobId = jobOfUser.get(row.sequence);
      const effort = jobId ? opts.effortByJob?.get(jobId) : undefined;
      let content = row.content as UserContent;
      if (effort) content = withEffortNote(content, effort);
      if (opts.currentRequestNote && jobId && jobId === opts.currentJobId) {
        content = withNote(content, opts.currentRequestNote);
      }
      entries.push({ param: { role: "user", content }, seq: row.sequence });
    } else if (row.type === "USER_EDIT") {
      // Hidden row: the model sees it, the chat transcript doesn't (web's
      // toConversation has no branch for this type). doc/USER_CODE_EDITING.md.
      entries.push({
        param: {
          role: "user",
          content: userEditPrompt(row.content as StoredUserEdit),
        },
        seq: row.sequence,
      });
    }
  }

  return entries;
}
