/**
 * What is put back after a summary.
 *
 * When a run's context fills up, the older part of the conversation is
 * replaced by a summary (`summarize.ts`). The summary is a model's paraphrase,
 * written to a token limit, and several things a run depends on were sitting
 * in exactly the messages it replaces:
 *
 *   - **the user's request.** The message that started the run is the oldest
 *     thing in it, so it is the first to go — and with it the effort the user
 *     chose and the app's memory, design and file map, which ride on that
 *     message (`appBrief.ts`). A paraphrase of "what the user asked for" is
 *     not what the user asked for;
 *   - **the plan**, which existed in the conversation only as old tool calls;
 *   - **which files the run has changed**, which the agent otherwise has to
 *     remember;
 *   - **the guides** it had read, whose text went with the tool results that
 *     carried them.
 *
 * None of these needs paraphrasing, because tau has every one of them exactly:
 * the request is a stored row, the plan is replayable, the app's files are
 * saved. So after a summary they are restored in full, as one message placed
 * straight after it. The summarizer is told they will be, and spends its space
 * on what only the conversation held.
 *
 * The block is a snapshot taken when the summary was made and is not updated
 * afterwards: it sits near the front of the context, and changing it every
 * turn would invalidate the provider's cache of everything after it. The
 * freshest plan is always the latest plan tool result, further down.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §7, items 7 and 8.
 */
import type { Effort } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { renderPlan, type PlanState } from "../plan";
import { effortNote } from "./history";
import { RESTORED_HEADER, messageText } from "./marks";
import type { Entry } from "./types";

export { RESTORED_HEADER, isRestoredState } from "./marks";

/** A request longer than this is cut. Almost none are; the cap is against a pasted file. */
export const MAX_RESTORED_REQUEST_CHARS = 6_000;
/** Paths listed per kind of change. */
export const MAX_RESTORED_PATHS = 40;

export interface RunState {
  /** The user's message that started the request in progress, as text. */
  request: string | null;
  effort: Effort;
  plan: PlanState | null;
  /** What the run has done to the app's files, when tau has been keeping count. */
  work: { created: readonly string[]; edited: readonly string[]; deleted: number } | null;
  /** Guides that were in the conversation before it was summarized. */
  guides: readonly string[];
  /** The `<tau_instructions>` block: what the user told tau to do every time. */
  standing?: string | null;
  /** The `<tau_app>` block, read fresh. */
  brief: string | null;
}

function pathList(label: string, paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const shown = [...paths].sort().slice(0, MAX_RESTORED_PATHS);
  const more = paths.length - shown.length;
  return `- ${label}: ${shown.map((p) => `\`${p}\``).join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}

/** The block's text. Pure. */
export function renderRestoredState(state: RunState): string {
  const sections: string[] = [
    `${RESTORED_HEADER}\nThe conversation before this point was summarized to save space; the summary is above. What follows is tau's own record of where this request stands, restored in full rather than summarized. It is not a new message from the user and needs no reply: carry on with the work. Anything else from before the summary is still stored, and \`search_history\` finds it.`,
  ];

  if (state.request?.trim()) {
    const whole = state.request.trim();
    const text =
      whole.length > MAX_RESTORED_REQUEST_CHARS
        ? `${whole.slice(0, MAX_RESTORED_REQUEST_CHARS)}\n[cut here; the rest of the message is not shown]`
        : whole;
    sections.push(
      `## The request in progress\nThe user's message that started this request, word for word:\n\n<user_request>\n${text}\n</user_request>\n\n${effortNote(state.effort)}`,
    );
  } else {
    sections.push(effortNote(state.effort));
  }

  sections.push(
    state.plan
      ? `## Plan\nAs it stood when the summary was made. A later \`update_todo\` or \`add_todos\` result is newer than this.\n\n${renderPlan(state.plan)}`
      : "## Plan\nNo plan has been made for this request.",
  );

  if (state.work) {
    const lines = [
      pathList("created", state.work.created),
      pathList("edited", state.work.edited),
      state.work.deleted > 0
        ? `- deleted: ${state.work.deleted} file${state.work.deleted === 1 ? "" : "s"}`
        : null,
    ].filter((line): line is string => line !== null);
    if (lines.length > 0) {
      sections.push(
        `## Files changed so far in this request\n${lines.join("\n")}\n\nTheir contents are no longer in the conversation. Read a file again before editing it.`,
      );
    }
  }

  if (state.guides.length > 0) {
    sections.push(
      `## Guides\nYou had read these guides, and their text is no longer in the conversation: ${state.guides
        .map((g) => `\`${g}\``)
        .join(", ")}. tau attaches each again the next time you work on what it covers; \`read_doc\` gets one now.`,
    );
  }

  if (state.standing) sections.push(state.standing);
  if (state.brief) sections.push(state.brief);

  return sections.join("\n\n");
}

/** The block as a history entry. It has no stored row behind it. */
export function restoredEntry(state: RunState): Entry {
  return { param: { role: "user", content: renderRestoredState(state) }, seq: null };
}

/**
 * The user's message that started a job, as text; null when it cannot be
 * found. A user message has no job of its own: it is the last one before the
 * first row the job produced, or simply the latest if the job has produced
 * none yet.
 */
export async function requestText(projectId: string, jobId: string): Promise<string | null> {
  const first = await prisma.message.findFirst({
    where: { projectId, jobId },
    orderBy: { sequence: "asc" },
    select: { sequence: true },
  });
  const row = await prisma.message.findFirst({
    where: {
      projectId,
      role: "USER",
      type: "USER",
      ...(first ? { sequence: { lt: first.sequence } } : {}),
    },
    orderBy: { sequence: "desc" },
    select: { content: true },
  });
  const text = row ? messageText(row.content).trim() : "";
  return text || null;
}
