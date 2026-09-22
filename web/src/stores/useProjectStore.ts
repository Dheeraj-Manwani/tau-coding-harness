import { create } from "zustand";

import type {
  JobEvent,
  MessageAttachment,
  ProjectCheckpoint,
  ProjectDetail,
  ProjectMessage,
  ProjectTree,
  PreviewBuildError,
  TerminalOutcome,
  VisualMessageContext,
} from "@/src/features/project/types";
import { useBillingStore } from "@/src/features/billing/useBillingStore";
import { billingKeys, type BalanceSummary } from "@/src/features/billing/api";
import { queryClient } from "@/src/lib/query-client";
import { sha256Hex } from "@/src/lib/hash";
import { normalizePreviewPath } from "@/src/features/project/previewUrl";
import { deployKeys } from "@/src/features/project/deploy";
import type { ComputedValue } from "@/src/features/project/visualEditPrompt";

/** Pull the credit balance back from the server after a job settles. */
function invalidateBalance(): void {
  void queryClient.invalidateQueries({ queryKey: billingKeys.balance });
}

export type ChatRole = "user" | "ai" | "divider";

export interface DividerMeta {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
}

export type ActionKind =
  | "create_file"
  | "edit_file"
  | "read_file"
  | "list_dir"
  | "delete_file"
  | "run_command"
  | "tail_command_output"
  | "wait_for_port"
  | "check_sandbox"
  | "report_progress"
  | "create_plan"
  | "update_todo"
  | "add_todos"
  | "provision_sandbox"
  | "ask_user"
  | "dispatch_explorer"
  | "dispatch_debugger"
  | "dispatch_verifier"
  | "dispatch_implementer"
  | "web_search"
  | "search_images"
  | "image_dimensions"
  | "download_asset"
  | "push_to_github"
  | "create_github_issue";

export type TodoStatus = "pending" | "done" | "skipped" | "blocked";

export interface Todo {
  sno: number;
  label: string;
  status: TodoStatus;
}

export interface Plan {
  name: string;
  description: string;
  todos: Todo[];
}

export interface ActionItem {
  kind: ActionKind;
  label: string;
  /** Used by report_plan to carry the full plan description. */
  description?: string;
  /** Structured detail payload for create_plan and update_todo. */
  meta?: Record<string, unknown>;
  /** Tool call id — lets a later tool_res attach its output to this action (dispatch_* only). */
  toolCallId?: string;
}

export interface Message {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  /** Tool calls + thinking steps that produced this ai message. */
  actions?: ActionItem[];
  divider?: DividerMeta;
  /** Attachments the user sent with this turn; rendered as read-only chips. */
  attachments?: MessageAttachment[];
  /** The element this turn was sent about, when it came from the visual-edit
   *  inspector. Rendered as a chip; the rest of the context is in a block the
   *  model reads and this transcript never shows. */
  element?: MessageElement;
}

/** What the transcript needs to say "this was about that element". */
export interface MessageElement {
  path: string;
  line: string;
  tagName: string;
}

export type Tab = "preview" | "code";
export type PreviewDevice = "mobile" | "tablet" | "desktop";

/**
 * One element picked in the preview, as reported by the in-iframe runtime
 * (`worker-service/src/templates/visual-edit/runtime.js`).
 *
 * See doc/VISUAL_EDIT_PLAN.md.
 */
export interface VisualSelection {
  /** `src/App.tsx:42:7` — path, 1-based line, 1-based column. */
  loc: string;
  tagName: string;
  className: string;
  text: string;
  /** True only when the element's content is a single static text node, so a
   *  future text edit could be applied deterministically. */
  editableText: boolean;
  /** How many DOM nodes share this source position. >1 means a `.map()`, and
   *  an edit here would change all of them. */
  siblingCount: number;
  /** Current `src`/`alt`, for `<img>` only. Read off the DOM, so `src` is the
   *  browser-resolved absolute URL rather than what the source literally says —
   *  fine for previewing, never sent back as the new value. */
  src?: string;
  alt?: string;
}

/** `src/App.tsx:42:7` → `src/App.tsx`. */
export function locToPath(loc: string): string {
  return loc.replace(/:\d+:\d+$/, "");
}

/** `src/App.tsx:42:7` → `42`. */
export function locToLine(loc: string): string {
  return /:(\d+):\d+$/.exec(loc)?.[1] ?? "?";
}

/**
 * A visual edit request body. Mirrors `VisualEditOp` in
 * `api/src/lib/visualEdit.ts`. Declared here rather than in `api.ts` because
 * the undo stack below stores these, and `api.ts` already imports from this
 * module — putting it there would make the two files circular.
 */
export type VisualEditOpInput =
  | { kind: "text"; value: string }
  | { kind: "classes"; add?: string[]; remove?: string[] }
  | { kind: "attr"; name: "src" | "alt"; value: string };

/**
 * One reversible visual edit, stored as the operation that *undoes* it.
 *
 * Keeping the inverse op rather than the previous file contents means undo runs
 * through exactly the same deterministic path as the original edit — same AST
 * lookup, same guards, same `USER_EDIT` record — instead of blindly restoring
 * bytes that may no longer be current.
 */
export interface VisualUndoEntry {
  loc: string;
  expectTag: string;
  op: VisualEditOpInput;
  /** Shown in the "undone" toast, e.g. `text`. */
  label: string;
}

/** Cap so a long styling session can't grow without bound. */
const MAX_VISUAL_UNDO = 20;

/** A file in the generated app, keyed by its sandbox-relative path.
 *  `content` is absent for manifest-only entries; lazy-loaded on click. */
export interface ProjectFile {
  path: string;
  /** Last content known to be on the server. */
  content?: string;
  /**
   * Unsaved editor buffer. Lives in the store, not the editor component, so it
   * survives switching tabs. `undefined` means "no local edits".
   */
  draft?: string;
  /** Hash of `content` as the server served it — sent as `baseHash` on save so
   *  a file that moved underneath us is rejected instead of clobbered. */
  savedHash?: string;
  saving?: boolean;
  saveError?: string | null;
}

/** A file has unsaved edits when its draft diverges from the saved content. */
export function isFileDirty(file: ProjectFile | undefined): boolean {
  return file?.draft !== undefined && file.draft !== file.content;
}

/** Lifecycle of the project's active generation job. */
export type JobStatus = "idle" | "streaming" | "done" | "error" | "cancelled";

// ── Helpers ─────────────────────────────────────────────────────────────────

const now = () => Date.now();

function userMessage(
  content: string,
  attachments?: MessageAttachment[],
  element?: MessageElement,
): Message {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    timestamp: now(),
    ...(attachments?.length ? { attachments } : {}),
    ...(element ? { element } : {}),
  };
}

/** `src/App.tsx:42:7` → what the transcript chip shows. */
export function toMessageElement(
  ctx: VisualMessageContext,
): MessageElement | undefined {
  const m = /^(.+):(\d+):\d+$/.exec(ctx.loc);
  if (!m) return undefined;
  return { path: m[1]!, line: m[2]!, tagName: ctx.tagName };
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function truncateLabel(s: string, max = 72): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function parseTodos(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,，;]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function nextSno(todos: { sno: number }[]): number {
  return todos.length > 0 ? Math.max(...todos.map((t) => t.sno)) + 1 : 1;
}

function todoUpdateLabel(
  sno: number,
  status: string,
  todos: { sno: number; label: string; status: string }[],
): string {
  const todo = todos.find((item) => item.sno === sno);
  const target = todo?.label || `todo #${sno}`;
  if (status === "done") return `Completed ${target}`;
  if (status === "skipped") return `Skipped ${target}`;
  if (status === "blocked") return `Blocked ${target}`;
  if (status === "pending") return `Reopened ${target}`;
  return `Updated ${target}`;
}

/**
 * A todo status change belongs to the plan that introduced the todo. Keep the
 * checklist as the single visual source of truth instead of appending a new
 * "Updated Todo" card for every checkbox change.
 */
function withUpdatedPlanTodos(
  messages: Message[],
  todos: { sno: number; label: string; status: string }[],
  startIndex: number,
): Message[] | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= startIndex;
    messageIndex--
  ) {
    const actions = messages[messageIndex].actions;
    if (!actions) continue;

    for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex--) {
      if (actions[actionIndex].kind !== "create_plan") continue;

      const nextActions = [...actions];
      nextActions[actionIndex] = {
        ...actions[actionIndex],
        meta: { ...actions[actionIndex].meta, todos },
      };
      const nextMessages = [...messages];
      nextMessages[messageIndex] = {
        ...messages[messageIndex],
        actions: nextActions,
      };
      return nextMessages;
    }
  }

  return null;
}

function deriveActionItem(
  toolName: string,
  input: Record<string, unknown>,
  planSnapshot: { sno: number; label: string; status: string }[] = [],
  toolCallId?: string,
): ActionItem {
  const path = normalizePath(String(input.path ?? ""));
  const file = basename(path);
  switch (toolName) {
    case "dispatch_explorer": {
      const task = String(input.task ?? "");
      return {
        kind: "dispatch_explorer",
        label: `Explored: ${truncateLabel(task, 60)}`,
        meta: { prompt: task },
        toolCallId,
      };
    }
    case "dispatch_debugger": {
      const problem = String(input.problem ?? "");
      const knownContext = String(input.known_context ?? "").trim();
      return {
        kind: "dispatch_debugger",
        label: `Debugging: ${truncateLabel(problem, 60)}`,
        meta: {
          prompt: knownContext
            ? `${problem}\n\nKnown context: ${knownContext}`
            : problem,
        },
        toolCallId,
      };
    }
    case "dispatch_verifier": {
      const scope = String(input.scope ?? "");
      const checks = Array.isArray(input.checks)
        ? (input.checks as unknown[]).map(String)
        : [];
      return {
        kind: "dispatch_verifier",
        label: `Verifying: ${truncateLabel(scope, 60)}`,
        meta: {
          prompt: checks.length
            ? `${scope}\n\nChecks:\n${checks.map((c) => `- ${c}`).join("\n")}`
            : scope,
        },
        toolCallId,
      };
    }
    case "dispatch_implementer": {
      const goal = String(input.goal ?? "");
      const files = Array.isArray(input.relevant_files)
        ? (input.relevant_files as unknown[]).map(String)
        : [];
      return {
        kind: "dispatch_implementer",
        label: `Implementing: ${truncateLabel(goal, 60)}`,
        meta: {
          prompt: files.length
            ? `${goal}\n\nRelevant files:\n${files.map((f) => `- ${f}`).join("\n")}`
            : goal,
        },
        toolCallId,
      };
    }
    case "web_search": {
      const query = String(input.query ?? "");
      return {
        kind: "web_search",
        label: `Searched: ${truncateLabel(query, 60)}`,
        meta: { prompt: query },
        toolCallId,
      };
    }
    case "search_images": {
      const query = String(input.query ?? "");
      return {
        kind: "search_images",
        label: `Searched images: ${truncateLabel(query, 55)}`,
        meta: { prompt: query },
        toolCallId,
      };
    }
    case "image_dimensions": {
      const url = String(input.url ?? "");
      return {
        kind: "image_dimensions",
        label: `Checked image ${truncateLabel(basename(url), 40)}`,
      };
    }
    case "download_asset": {
      const dest = normalizePath(String(input.path ?? ""));
      const file = basename(dest);
      return {
        kind: "download_asset",
        label: `Downloaded ${file}`,
        meta: { path: dest },
      };
    }
    case "push_to_github": {
      const title = String(input.title ?? "");
      const description = String(input.description ?? "").trim();
      return {
        kind: "push_to_github",
        label: `Pushed to GitHub: ${truncateLabel(title, 50)}`,
        meta: { prompt: description ? `${title}\n\n${description}` : title },
        toolCallId,
      };
    }
    case "create_github_issue": {
      const title = String(input.title ?? "");
      const description = String(input.description ?? "").trim();
      return {
        kind: "create_github_issue",
        label: `Filed issue: ${truncateLabel(title, 50)}`,
        meta: { prompt: description ? `${title}\n\n${description}` : title },
        toolCallId,
      };
    }
    case "create_file":
      return { kind: "create_file", label: `Created ${file}`, meta: { path } };
    case "edit_file":
      return { kind: "edit_file", label: `Edited ${file}`, meta: { path } };
    case "read_file":
      return { kind: "read_file", label: `Opened ${file}`, meta: { path } };
    case "list_dir":
      return {
        kind: "list_dir",
        label: `Listed ${input.path ? String(input.path) : "project root"}`,
      };
    case "delete_file":
      return { kind: "delete_file", label: `Deleted ${file}`, meta: { path } };
    case "run_command":
      return {
        kind: "run_command",
        label: `Ran ${truncateLabel(String(input.command ?? ""), 50)}`,
      };
    case "tail_command_output":
      return { kind: "tail_command_output", label: "Checked command output" };
    case "wait_for_port":
      return {
        kind: "wait_for_port",
        label: `Waited for port ${input.port ?? ""}`,
      };
    case "check_sandbox":
      return { kind: "check_sandbox", label: "Checked sandbox health" };
    case "report_progress":
      return { kind: "report_progress", label: String(input.message ?? "") };

    case "create_plan": {
      const todos = parseTodos(input.todos);
      return {
        kind: "create_plan",
        label: String(input.name ?? "Plan"),
        meta: { description: String(input.description ?? ""), todos },
      };
    }
    case "add_todos": {
      const todos = parseTodos(input.todos);
      return {
        kind: "add_todos",
        label: `Added ${todos.length} todo${todos.length === 1 ? "" : "s"}`,
        meta: { todos },
      };
    }
    case "update_todo": {
      const sno = Number(input.sno);
      const status = String(input.status ?? "");
      return {
        kind: "update_todo",
        label: todoUpdateLabel(sno, status, planSnapshot),
        meta: {
          sno,
          status,
          ...(planSnapshot.length ? { todos: planSnapshot } : {}),
        },
      };
    }
    case "provision_sandbox":
      return {
        kind: "provision_sandbox",
        label: "Started Sandbox",
      };
    case "ask_user": {
      return { kind: "ask_user", label: "Asked Question" };
    }
    default:
      return { kind: "create_file", label: truncateLabel(toolName) };
  }
}

/** Render a web_search tool's { answer, results } output as markdown. */
function formatWebSearchResult(answer: unknown, results: unknown[]): string {
  const parts: string[] = [];
  if (typeof answer === "string" && answer.trim()) parts.push(answer.trim());
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const { title, url, content } = r as {
      title?: unknown;
      url?: unknown;
      content?: unknown;
    };
    const t = typeof title === "string" && title ? title : String(url ?? "");
    const u = typeof url === "string" ? url : "";
    const snippet =
      typeof content === "string" ? truncateLabel(content, 200) : "";
    parts.push(
      u ? `- [${t}](${u})${snippet ? `\n  ${snippet}` : ""}` : `- ${t}`,
    );
  }
  return parts.join("\n\n");
}

/** Render a search_images tool's { images: [{ url, description }] } as markdown. */
function formatImageSearchResult(images: unknown[]): string {
  const parts: string[] = [];
  for (const img of images) {
    if (!img || typeof img !== "object") continue;
    const { url, description } = img as { url?: unknown; description?: unknown };
    const u = typeof url === "string" ? url : "";
    if (!u) continue;
    const desc =
      typeof description === "string" && description.trim()
        ? truncateLabel(description.trim(), 160)
        : "image";
    parts.push(`- [${desc}](${u})`);
  }
  return parts.length ? parts.join("\n") : "No images found.";
}

/** Pull the sub-agent's written summary out of a dispatch_* tool's raw output. */
function extractDispatchResult(output: unknown): string {
  if (output && typeof output === "object") {
    const o = output as {
      summary?: unknown;
      error?: unknown;
      results?: unknown;
      answer?: unknown;
      images?: unknown;
      note?: unknown;
    };
    if (typeof o.summary === "string") return o.summary;
    if (typeof o.error === "string") return `Error: ${o.error}`;
    if (Array.isArray(o.images)) {
      const formatted = formatImageSearchResult(o.images);
      return typeof o.note === "string" ? `${o.note}\n\n${formatted}` : formatted;
    }
    if (Array.isArray(o.results)) {
      return formatWebSearchResult(o.answer, o.results);
    }
  }
  return typeof output === "string" ? output : JSON.stringify(output);
}

/** Attach a sub-agent's result to the action with this toolCallId, wherever it lives. */
function attachDispatchResult(
  messages: Message[],
  toolCallId: string,
  result: string,
): Message[] {
  return messages.map((m) => {
    if (!m.actions?.some((a) => a.toolCallId === toolCallId)) return m;
    return {
      ...m,
      actions: m.actions.map((a) =>
        a.toolCallId === toolCallId ? { ...a, meta: { ...a.meta, result } } : a,
      ),
    };
  });
}

/**
 * Convert a sequence of persisted message rows into chat bubbles.
 *
 * Key invariants:
 *  - Tool calls are processed IN ORDER within each TOOL_REQ row so that
 *    actions attach to the progress message that immediately preceded them,
 *    not to an arbitrary later one.
 *  - Action attachment is scoped to the current conversation turn (messages
 *    added since the last USER row) so follow-up turns never contaminate
 *    earlier messages.
 *  - report_progress tool calls become standalone ai messages; all other
 *    tool calls become accordion actions on the nearest preceding ai message
 *    within the same turn.
 */
/** A context-summarization divider derived from a persisted checkpoint. */
function dividerMessage(cp: ProjectCheckpoint): Message {
  return {
    id: `divider_${cp.id}`,
    role: "divider",
    content: "",
    timestamp: Date.parse(cp.createdAt) || now(),
    divider: {
      summary: cp.summary,
      tokensBefore: cp.tokensBefore,
      tokensAfter: cp.tokensAfter,
    },
  };
}

/**
 * Text the api generated for the model, which must never render as the user's
 * chat bubble. Attachment blocks are self-identifying; the second entry is a
 * placeholder that shipped briefly at index 0 before it was moved to the end,
 * so messages written in that window still carry it. Recognising it here is
 * cheaper and safer than rewriting stored conversation history.
 */
const LEGACY_EMPTY_MESSAGE_PLACEHOLDER =
  "(no message — see the attached content below)";

function isGeneratedBlock(text: string): boolean {
  return (
    text.startsWith("<attachment ") ||
    text.startsWith("<selected-element ") ||
    text.startsWith("<build-error>") ||
    text.trim() === LEGACY_EMPTY_MESSAGE_PLACEHOLDER
  );
}

/**
 * Recover the chip from a `<selected-element>` block.
 *
 * Parsing a format we generate ourselves, which is normally a smell — but the
 * alternative is a column on `Message` for three strings the block already
 * carries, and the attributes exist precisely so this is a lookup rather than
 * a guess. `visualContext.ts` escapes them on the way out, so an element whose
 * class list contained a quote cannot produce a chip that lies.
 *
 * Only the opening tag is examined; whatever prose follows is the model's
 * business, not the transcript's.
 *
 * Exported for `web/test/visualEditPrompt.test.ts`, which pins it against the
 * same fixture `server/test/api/visualContext.test.ts` pins the *writer*
 * against. The two halves live in different packages and cannot import each
 * other, so a shared literal is what stops one being changed without the other
 * — the same arrangement the tagger and the AST resolver use for coordinates
 * (VISUAL_EDIT_PLAN.md §6 Phase 2).
 */
export function parseElementBlock(text: string): MessageElement | undefined {
  const open = /^<selected-element ([^>]*)>/.exec(text);
  if (!open) return undefined;
  const attrs = open[1]!;
  const get = (name: string) =>
    new RegExp(`${name}="([^"]*)"`)
      .exec(attrs)?.[1]
      ?.replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

  const path = get("file");
  const line = get("line");
  const tagName = get("tag");
  if (!path || !line || !tagName) return undefined;
  return { path, line, tagName };
}

function toConversation(
  rows: ProjectMessage[],
  checkpoints: ProjectCheckpoint[] = [],
): Message[] {
  const messages: Message[] = [];
  // Sorted ascending; a divider is emitted once we pass its boundary sequence.
  const pendingCps = [...checkpoints].sort(
    (a, b) => a.upToSequence - b.upToSequence,
  );
  let cpIdx = 0;
  let turnStart = 0;
  // Running plan state — rebuilt as create_plan / update_todo calls are replayed.
  let planTodos: { sno: number; label: string; status: string }[] = [];
  // tool_call_id -> true for ask_user calls, so a later TOOL_RES row can be
  // rendered as the user's reply instead of being skipped.
  const askUserToolCallIds = new Set<string>();

  for (const row of rows) {
    const ts = Date.parse(row.createdAt) || now();

    if (row.role === "USER" && row.type === "USER") {
      const blocks = row.content as { type?: string; text?: string }[] | string;
      // Only the first block is the user's own words — later ones are extracted
      // attachment text, which would otherwise splice into their bubble. When
      // the user sent attachments and typed nothing there is no such block, so
      // whatever sits at index 0 is ours and must not render as their message.
      const first = Array.isArray(blocks)
        ? (blocks[0]?.text ?? "")
        : String(blocks ?? "");
      const text = isGeneratedBlock(first) ? "" : first;
      const attachments = row.attachments ?? [];
      // The element chip comes from a later block — the same one the model
      // reads, so a reloaded transcript shows exactly what the optimistic
      // bubble did without a column to store it in.
      const element = Array.isArray(blocks)
        ? blocks
            .map((b) => parseElementBlock(b?.text ?? ""))
            .find((e) => e !== undefined)
        : undefined;
      if (text || attachments.length > 0 || element)
        messages.push({
          id: row.id,
          role: "user",
          content: text,
          timestamp: ts,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(element ? { element } : {}),
        });
      turnStart = messages.length; // ai messages from here onward are this turn's response
    } else if (row.role === "ASSISTANT" && row.type === "TOOL_REQ") {
      const stored = row.content as {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      } | null;

      // Render any text the LLM wrote alongside its tool calls.
      const assistantText = (stored?.content ?? "").trim();
      if (assistantText) {
        messages.push({
          id: `${row.id}_text`,
          role: "ai",
          content: assistantText,
          timestamp: ts,
        });
      }

      // Process each tool call in the order the LLM produced them.
      // This preserves the interleaving: progress message → actions that
      // follow it → next progress message → its actions → …
      for (let j = 0; j < (stored?.tool_calls?.length ?? 0); j++) {
        const tc = stored!.tool_calls![j];
        const name = tc.function.name;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          /* ignore */
        }

        if (name === "report_progress") {
          const text = String(input.message ?? "").trim();
          if (text)
            messages.push({
              id: `${row.id}_p${j}`,
              role: "ai",
              content: text,
              timestamp: ts,
            });
        } else if (name === "ask_user") {
          askUserToolCallIds.add(tc.id);
          const text = String(input.question ?? "").trim();
          if (text)
            messages.push({
              id: `${row.id}_q${j}`,
              role: "ai",
              content: text,
              timestamp: ts,
            });
        } else {
          // Maintain running plan state so update_todo can snapshot the full list.
          if (name === "create_plan") {
            planTodos = parseTodos(input.todos).map((label, i) => ({
              sno: i + 1,
              label,
              status: "pending",
            }));
          } else if (name === "add_todos") {
            const start = nextSno(planTodos);
            planTodos = [
              ...planTodos,
              ...parseTodos(input.todos).map((label, i) => ({
                sno: start + i,
                label,
                status: "pending",
              })),
            ];
          } else if (name === "update_todo") {
            const sno = Number(input.sno);
            const status = String(input.status ?? "");
            planTodos = planTodos.map((t) =>
              t.sno === sno ? { ...t, status } : t,
            );

            const updatedMessages = withUpdatedPlanTodos(
              messages,
              planTodos,
              turnStart,
            );
            if (updatedMessages) {
              messages.splice(0, messages.length, ...updatedMessages);
              continue;
            }
          }

          // Attach to the nearest ai message within this turn.
          const action = deriveActionItem(name, input, planTodos, tc.id);
          let targetIdx = -1;
          for (let i = messages.length - 1; i >= turnStart; i--) {
            if (messages[i].role === "ai") {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx !== -1) {
            messages[targetIdx] = {
              ...messages[targetIdx],
              actions: [...(messages[targetIdx].actions ?? []), action],
            };
          } else {
            // No preceding AI bubble in this turn — create a placeholder so
            // the action isn't silently dropped (mirrors the live streaming
            // tool_req handler's fallback).
            messages.push({
              id: `${row.id}_ph${j}`,
              role: "ai",
              content: "",
              timestamp: ts,
              actions: [action],
            });
          }
        }
      }
    } else if (row.role === "ASSISTANT" && row.type === "RESULT") {
      const c = row.content as { content?: string } | string;
      const text = typeof c === "string" ? c : (c?.content ?? "");
      if (text.trim()) {
        messages.push({ id: row.id, role: "ai", content: text, timestamp: ts });
      }
    } else if (row.type === "TOOL_RES") {
      // Not rendered as a tool result — but if one of these results answers
      // a pending ask_user call, surface it as the user's reply bubble. Otherwise,
      // if it belongs to a dispatch_* action, attach its summary to that action.
      const results = row.content as {
        tool_call_id: string;
        content: string;
      }[];
      for (const r of results ?? []) {
        if (askUserToolCallIds.has(r.tool_call_id)) {
          let answer = "";
          try {
            const parsed = JSON.parse(r.content) as { answer?: string | null };
            answer = (parsed.answer ?? "").trim();
          } catch {
            /* ignore */
          }
          if (answer) {
            messages.push({
              id: `${row.id}_${r.tool_call_id}`,
              role: "user",
              content: answer,
              timestamp: ts,
            });
            turnStart = messages.length; // ai messages from here onward are this turn's response
          }
          continue;
        }

        let output: unknown;
        try {
          output = JSON.parse(r.content);
        } catch {
          output = r.content;
        }
        const updated = attachDispatchResult(
          messages,
          r.tool_call_id,
          extractDispatchResult(output),
        );
        messages.splice(0, messages.length, ...updated);
      }
    }
    // ERROR rows are skipped

    // Emit any summarization dividers whose boundary this row reached/passed.
    while (
      cpIdx < pendingCps.length &&
      pendingCps[cpIdx].upToSequence <= row.sequence
    ) {
      messages.push(dividerMessage(pendingCps[cpIdx++]));
    }
  }

  return messages;
}

const WORK_DIR = "/home/user/app";
function normalizePath(p: string): string {
  return p.startsWith(`${WORK_DIR}/`) ? p.slice(WORK_DIR.length + 1) : p;
}

// ── State ───────────────────────────────────────────────────────────────────

interface ProjectState {
  // Identity / lifecycle
  projectId: string | null;
  currentJobId: string | null;
  status: JobStatus;
  /** The terminal event that ended the latest run. Kept separately from status
   *  so browser notifications can explain what the user needs to do next. */
  terminalOutcome: TerminalOutcome | null;
  /** Short human label of what the agent is doing right now (tool/shell). */
  activity: string | null;
  hydrated: boolean;
  /** `Date.now()` of the last event applied from the job stream. The stall
   *  detector in ProjectPage compares this against the wall clock: a job the
   *  server still calls active but that has sent nothing in minutes is wedged,
   *  not working, and the user deserves to be told rather than shimmered at. */
  lastEventAt: number | null;
  /** True once the active job has gone quiet past the stall threshold. Purely a
   *  presentation flag — the job is untouched and may still recover. */
  isStalled: boolean;
  /** Flips true once the agent starts writing files (or a preview exists). Drives
   *  the home→workspace reveal: chat is centered until this is true, then it docks
   *  left and the preview/code panel slides in from the right. */
  buildStarted: boolean;
  isPreviewJob: boolean;

  // Chat
  chatMessages: Message[];
  isAiTyping: boolean;
  /** The in-progress assistant bubble currently being streamed into. */
  streamingId: string | null;
  /** Action items accumulating during the active job stream; attached to the final ai message on done. */
  pendingActions: ActionItem[];
  /** Whether older messages exist beyond the current window (pagination). */
  hasMoreMessages: boolean;
  /** Sequence number of the oldest loaded message — used as the pagination cursor. */
  oldestSequence: number | null;

  // Plan tracker (active job only; reset on new job)
  currentPlan: Plan | null;

  // Pending ask_user question waiting for the user's response.
  pendingQuestion: { question: string; options: string[] } | null;

  // Generated app
  files: Record<string, ProjectFile>;
  headSequence: number | null;
  /** Path of the file currently being written by the agent, or null. */
  writingPath: string | null;
  /** Origin of the live sandbox (`https://<host>`), with no path component. */
  previewUrl: string | null;
  /** Path the preview iframe is pointed at — what the URL bar shows and edits.
   *  Cross-origin means we can't observe navigation *inside* the app, so this is
   *  where we last sent it, not necessarily where it is now. */
  previewPath: string;
  /** Bumped to force the preview iframe to remount (manual reload). */
  previewNonce: number;

  // Cancellation hook, registered by the active SSE stream.
  cancelStream: (() => void) | null;

  // UI (local, not server-derived)
  isChatOpen: boolean;
  activeTab: Tab;
  openFiles: string[];
  activeFileId: string;
  previewDevice: PreviewDevice;
  codeTreeWidth: number;

  // Visual edit (preview element picker)
  visualEditEnabled: boolean;
  visualEditReady: boolean;
  visualSelection: VisualSelection | null;
  visualUndo: VisualUndoEntry[];
  /** The global theme panel. Not element-scoped, so it lives beside the picker
   *  rather than inside the inspector. */
  themePanelOpen: boolean;
  /** The deterministic editor — inline text box, style panel, image panel.
   *
   *  Off by default: asking tau is what a selection does now, and editing the
   *  element yourself is the opt-in. Sticky for the session rather than reset
   *  per selection, so a styling pass costs one click instead of one per
   *  element — it is a mode, not a property of the element. */
  manualPanelOpen: boolean;

  /** Text staged into the inspector's prompt box (today: an edit the
   *  deterministic path refused, rewritten as a request), plus which value it
   *  refused. Consumed and cleared by `ElementPrompt`. */
  visualPromptPrefill: { text: string; computed?: ComputedValue } | null;

  /** The build error the preview is currently showing, read out of Vite's
   *  overlay by the in-iframe runtime. Null when the app compiles. */
  previewError: PreviewBuildError | null;
  /** Whether the user has sent the error's modal away. It comes back as a
   *  banner rather than vanishing, and a *new* error opens the modal again —
   *  dismissing "missing semicolon" is not consent to hide the next one. */
  previewErrorDismissed: boolean;

  // ── Actions ──
  /** Reset everything when entering (or switching to) a project. */
  initProject: (projectId: string) => void;
  /** Seed chat/files/preview from the persisted project once on entry. */
  hydrate: (detail: ProjectDetail) => void;
  /** Authoritative rebuild from a fresh project fetch, used to recover from a
   *  stream gap (`resync`) or a missed terminal event. Unlike {@link hydrate} it
   *  always rebuilds the transcript and reconciles the loading state against the
   *  server's `activeJobId` — so the "thinking" shimmer can never outlive the job. */
  resyncFromDetail: (detail: ProjectDetail) => void;
  /** Populate the file tree from the manifest (paths only, no bodies). */
  hydrateTree: (tree: ProjectTree) => void;
  /** Cache a lazily-loaded file body in the store. */
  setFileContent: (path: string, content: string, contentHash?: string) => void;
  /** Record the user's in-progress edits to a file (see {@link isFileDirty}). */
  setFileDraft: (path: string, draft: string) => void;
  /** Mark a save in flight, so the tab can show progress and the editor can
   *  avoid firing a second save for the same buffer. */
  setFileSaving: (path: string, saving: boolean) => void;
  /** Commit a successful save: the draft becomes the new server truth. */
  markFileSaved: (path: string, content: string, contentHash: string) => void;
  /** Surface a failed save; the draft is deliberately kept so nothing typed is lost. */
  setFileSaveError: (path: string, error: string | null) => void;
  /** Begin streaming a job; optionally append the prompt as a user bubble. */
  startJob: (jobId: string, prompt?: string) => void;
  /** Begin streaming a preview-only restart job (drives the preview pane, no chat
   *  turn — so no user bubble and no "thinking" shimmer). */
  startPreviewJob: (jobId: string) => void;
  /** Append a user bubble immediately (optimistic, before the job id is known).
   *  Returns the generated message id so callers can remove it on failure. */
  /** Optimistic user turn. Pass `attachments` so an attachment-only send shows
   *  its chips immediately instead of a bare timestamp until the next reload. */
  appendUserMessage: (
    content: string,
    attachments?: MessageAttachment[],
    visualContext?: VisualMessageContext,
  ) => string;
  /** Remove a single chat bubble by id (used to roll back a failed optimistic send). */
  removeChatMessage: (id: string) => void;
  /** Prepend a batch of older messages loaded by scroll-up pagination. */
  prependMessages: (
    rows: ProjectMessage[],
    hasMore: boolean,
    checkpoints?: ProjectCheckpoint[],
  ) => void;
  /** Apply one live event from the SSE stream. */
  applyEvent: (event: JobEvent) => void;
  /** Flag/clear the "this run has gone quiet" presentation state. */
  setStalled: (stalled: boolean) => void;
  setCanceller: (fn: (() => void) | null) => void;
  answerPendingQuestion: (answer: string) => void;

  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setActiveTab: (tab: Tab) => void;
  /** Remount the preview iframe to reload the running app. */
  reloadPreview: () => void;
  /** Point the preview at a path (`/`, `/home`, `/items?id=1`). Always remounts,
   *  so re-entering the current path re-navigates instead of silently doing
   *  nothing — matching what Enter in a browser address bar does. */
  setPreviewPath: (path: string) => void;
  openFile: (id: string) => void;
  closeFile: (id: string) => void;
  closeOtherFiles: (id: string) => void;
  closeFilesToRight: (id: string) => void;
  closeAllFiles: () => void;
  setActiveFile: (id: string) => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  setCodeTreeWidth: (px: number) => void;

  /** Turn element-picking on/off in the preview. */
  setVisualEditEnabled: (enabled: boolean) => void;
  /** The in-iframe runtime announced itself — the toggle is safe to offer. */
  setVisualEditReady: (ready: boolean) => void;
  /** Record (or clear) the element the user picked. */
  setVisualSelection: (selection: VisualSelection | null) => void;
  /** Remember how to undo the edit that was just applied. */
  pushVisualUndo: (entry: VisualUndoEntry) => void;
  /** Take the most recent undo entry off the stack. */
  popVisualUndo: () => VisualUndoEntry | null;
  clearVisualUndo: () => void;
  /** Open/close the global theme panel. */
  setThemePanelOpen: (open: boolean) => void;
  /** Show/hide the deterministic editor inside the inspector. */
  setManualPanelOpen: (open: boolean) => void;

  /** Stage a request into the inspector's prompt box. */
  prefillVisualPrompt: (text: string, computed?: ComputedValue) => void;
  clearVisualPromptPrefill: () => void;
  /** Record (or clear) the build error the preview is showing. */
  setPreviewError: (error: PreviewBuildError | null) => void;
  /** Collapse the error modal to a banner, or bring it back. */
  setPreviewErrorDismissed: (dismissed: boolean) => void;
}

/** State reset whenever we enter a project (UI prefs below are preserved). */
const FRESH = {
  currentJobId: null,
  isPreviewJob: false,
  status: "idle" as JobStatus,
  terminalOutcome: null as TerminalOutcome | null,
  activity: null,
  hydrated: false,
  lastEventAt: null as number | null,
  isStalled: false,
  buildStarted: false,
  chatMessages: [] as Message[],
  isAiTyping: false,
  streamingId: null,
  pendingActions: [] as ActionItem[],
  hasMoreMessages: false,
  oldestSequence: null as number | null,
  currentPlan: null as Plan | null,
  pendingQuestion: null as { question: string; options: string[] } | null,
  files: {} as Record<string, ProjectFile>,
  headSequence: null as number | null,
  writingPath: null as string | null,
  previewUrl: null,
  previewPath: "/",
  previewNonce: 0,
  cancelStream: null,
  activeTab: "preview" as Tab,
  openFiles: [] as string[],
  activeFileId: "",
  // Never carries across projects: the selection points into one project's
  // source tree, and `ready` describes one specific iframe's runtime.
  visualEditEnabled: false,
  visualEditReady: false,
  visualSelection: null as VisualSelection | null,
  visualUndo: [] as VisualUndoEntry[],
  themePanelOpen: false,
  manualPanelOpen: false,
  visualPromptPrefill: null as {
    text: string;
    computed?: ComputedValue;
  } | null,
  previewError: null as PreviewBuildError | null,
  previewErrorDismissed: false,
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  ...FRESH,

  // Persisted UI defaults (kept across projects).
  isChatOpen: true,
  previewDevice: "desktop",
  codeTreeWidth: 240,

  initProject: (projectId) => {
    // Always reset non-streaming state on (re-)entry so messages are re-seeded
    // from the API. Skip only when an active stream is in progress for the same
    // project — tearing that down would orphan the live job connection.
    const s = get();
    if (s.projectId === projectId && s.status === "streaming") return;
    set({ projectId, ...FRESH });
  },

  hydrate: (detail) =>
    set((s) => {
      // Never overwrite an active stream — the live content takes priority.
      if (s.status === "streaming") return {};
      // Don't replace the fully-populated store right after a stream ends.
      // The refetch triggered by invalidateQueries is for the *next* navigation's
      // cache — the current session already has the correct messages.
      if (s.status === "done" && s.hydrated) return {};

      const chatMessages = toConversation(detail.messages, detail.checkpoints);

      const previewUrl =
        s.previewUrl ?? detail.latestFragment?.sandboxUrl ?? null;

      const buildStarted =
        s.buildStarted ||
        detail.project.workspaceStartedAt != null ||
        previewUrl != null;

      // If we received a full page (50), there may be older messages to load.
      const hasMoreMessages = detail.messages.length >= 50;
      const oldestSequence = detail.messages[0]?.sequence ?? null;

      return {
        hydrated: true,
        chatMessages,
        previewUrl,
        buildStarted,
        hasMoreMessages,
        oldestSequence,
      };
    }),

  resyncFromDetail: (detail) =>
    set((s) => {
      // Authoritative rebuild — always applied, even mid-stream, because we only
      // reach here after a real gap (the live buffer expired → `resync`) or after
      // the status backstop found the job already gone. The DB snapshot is the
      // source of truth; any in-flight bubble it doesn't contain was lost with the
      // buffer and will re-stream if the job is genuinely still running.
      const chatMessages = toConversation(detail.messages, detail.checkpoints);
      const previewUrl =
        s.previewUrl ?? detail.latestFragment?.sandboxUrl ?? null;
      // Chat history alone is not evidence that a workspace exists: a run can
      // stop for credits or fail before writing its first file. Only the
      // durable transition (or a legacy fragment) reveals the right panel.
      const buildStarted =
        s.buildStarted ||
        detail.project.workspaceStartedAt != null ||
        previewUrl != null;
      const hasMoreMessages = detail.messages.length >= 50;
      const oldestSequence = detail.messages[0]?.sequence ?? null;

      const stillActive = detail.activeJobId != null;

      return {
        hydrated: true,
        chatMessages,
        previewUrl,
        buildStarted,
        hasMoreMessages,
        oldestSequence,
        // Reconcile the loading state against the server's authority. If the job
        // is gone, finalize locally so the shimmer/loader can't hang forever.
        ...(stillActive
          ? { status: "streaming" as JobStatus, isAiTyping: true }
          : {
              status: (s.status === "streaming"
                ? "done"
                : s.status) as JobStatus,
              isAiTyping: false,
              isPreviewJob: false,
              isStalled: false,
              streamingId: null,
              currentJobId: null,
              activity: null,
              writingPath: null,
              pendingActions: [],
            }),
      };
    }),

  hydrateTree: (tree) =>
    set((s) => {
      // Rebuild the file map from the manifest, preserving any body already
      // in the store (e.g. from an active or just-completed stream).
      // Normalize paths: old DB records may have absolute paths like
      // /home/user/app/src/App.tsx; strip the WORK_DIR prefix so the tree
      // key always matches what buildTree and openFile produce.
      const files: Record<string, ProjectFile> = {};
      for (const f of tree.files) {
        const path = normalizePath(f.path);
        files[path] = s.files[path] ?? { path };
      }
      // Keep streamed files that haven't been committed to the manifest yet
      // (persistFile runs async; a refetch may arrive before it completes).
      for (const [path, file] of Object.entries(s.files)) {
        if (!files[path] && file.content !== undefined) {
          files[path] = file;
        }
      }
      const buildStarted = s.buildStarted || Object.keys(files).length > 0;
      return { files, headSequence: tree.headSequence, buildStarted };
    }),

  setFileContent: (path, content, contentHash) =>
    set((s) => ({
      files: {
        ...s.files,
        [path]: { ...s.files[path], path, content, savedHash: contentHash },
      },
    })),

  setFileDraft: (path, draft) =>
    set((s) => ({
      files: { ...s.files, [path]: { ...s.files[path], path, draft } },
    })),

  setFileSaving: (path, saving) =>
    set((s) => ({
      files: { ...s.files, [path]: { ...s.files[path], path, saving } },
    })),

  markFileSaved: (path, content, contentHash) =>
    set((s) => {
      const file = s.files[path];
      // Keep the draft if the user kept typing while the save was in flight —
      // dropping it would silently revert those keystrokes to the saved body.
      const draft =
        file?.draft !== undefined && file.draft !== content
          ? file.draft
          : undefined;
      return {
        files: {
          ...s.files,
          [path]: {
            ...file,
            path,
            content,
            savedHash: contentHash,
            draft,
            saving: false,
            saveError: null,
          },
        },
      };
    }),

  setFileSaveError: (path, error) =>
    set((s) => ({
      files: {
        ...s.files,
        [path]: { ...s.files[path], path, saving: false, saveError: error },
      },
    })),

  startJob: (jobId, prompt) =>
    set((s) => {
      const alreadyShown =
        prompt != null &&
        s.chatMessages.some((m) => m.role === "user" && m.content === prompt);
      return {
        currentJobId: jobId,
        status: "streaming",
        terminalOutcome: null,
        isAiTyping: true,
        isPreviewJob: false,
        activity: "Thinking",
        currentPlan: null,
        lastEventAt: Date.now(),
        isStalled: false,
        chatMessages:
          prompt && !alreadyShown
            ? [...s.chatMessages, userMessage(prompt)]
            : s.chatMessages,
      };
    }),

  startPreviewJob: (jobId) =>
    set({
      currentJobId: jobId,
      status: "streaming",
      terminalOutcome: null,
      isPreviewJob: true,
      lastEventAt: Date.now(),
      isStalled: false,
      // No chat turn: the preview pane shows its own "Starting…" state, so we
      // deliberately leave `isAiTyping` false and append no user bubble.
      currentPlan: null,
    }),

  appendUserMessage: (content, attachments, visualContext) => {
    const msg = userMessage(
      content,
      attachments,
      visualContext ? toMessageElement(visualContext) : undefined,
    );
    set((s) => ({ chatMessages: [...s.chatMessages, msg] }));
    return msg.id;
  },

  removeChatMessage: (id) =>
    set((s) => ({
      chatMessages: s.chatMessages.filter((m) => m.id !== id),
    })),

  prependMessages: (rows, hasMore, checkpoints) =>
    set((s) => {
      const prepended = toConversation(rows, checkpoints);
      return {
        chatMessages: [...prepended, ...s.chatMessages],
        hasMoreMessages: hasMore,
        oldestSequence: rows[0]?.sequence ?? s.oldestSequence,
      };
    }),

  applyEvent: (event) => {
    // Any frame at all is proof of life: clear a stall the moment one lands.
    set({ lastEventAt: Date.now(), isStalled: false });
    applyEvent(set, get, event);
  },

  setStalled: (stalled) => set({ isStalled: stalled }),

  setCanceller: (fn) => set({ cancelStream: fn }),
  answerPendingQuestion: (answer) =>
    set((s) => ({
      isAiTyping: true,
      pendingQuestion: null,
      chatMessages: [...s.chatMessages, userMessage(answer)],
    })),

  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setChatOpen: (isChatOpen) => set({ isChatOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  reloadPreview: () => set((s) => ({ previewNonce: s.previewNonce + 1 })),

  setPreviewPath: (path) =>
    set((s) => ({
      previewPath: normalizePreviewPath(path),
      previewNonce: s.previewNonce + 1,
    })),

  openFile: (id) =>
    set((s) => ({
      openFiles: s.openFiles.includes(id) ? s.openFiles : [...s.openFiles, id],
      activeFileId: id,
    })),

  closeFile: (id) =>
    set((s) => {
      const idx = s.openFiles.indexOf(id);
      const openFiles = s.openFiles.filter((f) => f !== id);
      const activeFileId =
        s.activeFileId === id
          ? (openFiles[idx] ?? openFiles[idx - 1] ?? "")
          : s.activeFileId;
      return { openFiles, activeFileId };
    }),

  closeOtherFiles: (id) =>
    set((s) => {
      if (!s.openFiles.includes(id)) return {};
      return { openFiles: [id], activeFileId: id };
    }),

  closeFilesToRight: (id) =>
    set((s) => {
      const idx = s.openFiles.indexOf(id);
      if (idx === -1) return {};
      const openFiles = s.openFiles.slice(0, idx + 1);
      const activeFileId = openFiles.includes(s.activeFileId)
        ? s.activeFileId
        : id;
      return { openFiles, activeFileId };
    }),

  closeAllFiles: () => set({ openFiles: [], activeFileId: "" }),

  setActiveFile: (activeFileId) => set({ activeFileId }),
  setPreviewDevice: (previewDevice) => set({ previewDevice }),

  setVisualEditEnabled: (visualEditEnabled) =>
    // Leaving pick mode drops the selection: the inspector describes a live
    // highlighted element, and the highlight goes away with the mode.
    set(visualEditEnabled ? { visualEditEnabled } : { visualEditEnabled, visualSelection: null }),

  // A remount (reload, path change, rebuilt sandbox) tears the runtime down, so
  // `ready` going false must also invalidate whatever was selected.
  setVisualEditReady: (visualEditReady) =>
    set(visualEditReady ? { visualEditReady } : { visualEditReady, visualSelection: null }),

  setVisualSelection: (visualSelection) => set({ visualSelection }),

  pushVisualUndo: (entry) =>
    set((s) => ({
      visualUndo: [...s.visualUndo, entry].slice(-MAX_VISUAL_UNDO),
    })),

  popVisualUndo: () => {
    const stack = get().visualUndo;
    const entry = stack[stack.length - 1];
    if (!entry) return null;
    set({ visualUndo: stack.slice(0, -1) });
    return entry;
  },

  clearVisualUndo: () => set({ visualUndo: [] }),

  setThemePanelOpen: (themePanelOpen) => set({ themePanelOpen }),
  setManualPanelOpen: (manualPanelOpen) => set({ manualPanelOpen }),

  prefillVisualPrompt: (text, computed) =>
    set({ visualPromptPrefill: { text, computed } }),

  clearVisualPromptPrefill: () => set({ visualPromptPrefill: null }),

  // A different error is a different problem, so it gets the modal again even
  // if the last one was dismissed. Vite replaces its overlay per error, so this
  // fires on every new failure.
  setPreviewError: (previewError) =>
    set((s) => ({
      previewError,
      previewErrorDismissed:
        previewError && previewError.message === s.previewError?.message
          ? s.previewErrorDismissed
          : false,
    })),

  setPreviewErrorDismissed: (previewErrorDismissed) =>
    set({ previewErrorDismissed }),
  setCodeTreeWidth: (codeTreeWidth) => set({ codeTreeWidth }),
}));

// ── Event reducer ───────────────────────────────────────────────────────────

type SetState = (
  partial: Partial<ProjectState> | ((s: ProjectState) => Partial<ProjectState>),
) => void;

type GetState = () => ProjectState;

/** Ensure there is a streaming assistant bubble to append text into. */
function ensureStreamingBubble(s: ProjectState): {
  chatMessages: Message[];
  streamingId: string;
} {
  if (s.streamingId) {
    return { chatMessages: s.chatMessages, streamingId: s.streamingId };
  }
  const bubble: Message = {
    id: crypto.randomUUID(),
    role: "ai",
    content: "",
    timestamp: now(),
  };
  return { chatMessages: [...s.chatMessages, bubble], streamingId: bubble.id };
}

/** Close the current streaming bubble, dropping it if it never got content. */
function finalizeStreaming(s: ProjectState): {
  streamingId: null;
  chatMessages: Message[];
} {
  if (!s.streamingId)
    return { streamingId: null, chatMessages: s.chatMessages };
  const bubble = s.chatMessages.find((m) => m.id === s.streamingId);
  const drop = !bubble || bubble.content.trim().length === 0;
  return {
    streamingId: null,
    chatMessages: drop
      ? s.chatMessages.filter((m) => m.id !== s.streamingId)
      : s.chatMessages,
  };
}

/** Index of the first message belonging to the current agent turn (after the last user message). */
function currentTurnStart(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}

/**
 * Attach accumulated pendingActions to the last ai message within the current
 * turn that isn't the streaming bubble. Scoped to the current turn so actions
 * never bleed back into a previous exchange.
 */
function flushPendingActions(s: ProjectState): {
  chatMessages: Message[];
  pendingActions: ActionItem[];
} {
  if (s.pendingActions.length === 0)
    return { chatMessages: s.chatMessages, pendingActions: [] };
  const turnStart = currentTurnStart(s.chatMessages);
  let targetIdx = -1;
  for (let i = s.chatMessages.length - 1; i >= turnStart; i--) {
    if (
      s.chatMessages[i].role === "ai" &&
      s.chatMessages[i].id !== s.streamingId
    ) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1)
    return { chatMessages: s.chatMessages, pendingActions: [] };
  return {
    chatMessages: s.chatMessages.map((m, i) =>
      i === targetIdx
        ? { ...m, actions: [...(m.actions ?? []), ...s.pendingActions] }
        : m,
    ),
    pendingActions: [],
  };
}

function applyEvent(set: SetState, get: GetState, event: JobEvent): void {
  switch (event.type) {
    case "thinking":
      set({ isAiTyping: true, status: "streaming", activity: event.message });
      return;

    case "llm_chunk":
      set((s) => {
        const { chatMessages, streamingId } = ensureStreamingBubble(s);
        return {
          isAiTyping: true,
          streamingId,
          chatMessages: chatMessages.map((m) =>
            m.id === streamingId
              ? { ...m, content: m.content + event.content }
              : m,
          ),
        };
      });
      return;

    case "plan_created":
      set({
        currentPlan: {
          name: event.name,
          description: event.description,
          todos: event.todos.map((label, i) => ({
            sno: i + 1,
            label,
            status: "pending" as TodoStatus,
          })),
        },
      });
      return;

    case "todo_updated":
      set((s) => {
        if (!s.currentPlan) {
          // Should no longer happen — the backend now refuses update_todo
          // without a prior create_plan — but warn loudly rather than
          // silently dropping the update if it ever does.
          console.warn(
            "[project] todo_updated received with no active plan; dropping",
            event,
          );
          return {};
        }
        return {
          currentPlan: {
            ...s.currentPlan,
            todos: s.currentPlan.todos.map((t) =>
              t.sno === event.sno
                ? { ...t, status: event.status as TodoStatus }
                : t,
            ),
          },
        };
      });
      return;

    case "todos_added":
      set((s) => {
        if (!s.currentPlan) {
          console.warn(
            "[project] todos_added received with no active plan; dropping",
            event,
          );
          return {};
        }
        const start = nextSno(s.currentPlan.todos);
        const added: Todo[] = event.todos.map((label, i) => ({
          sno: start + i,
          label,
          status: "pending" as TodoStatus,
        }));
        return {
          currentPlan: {
            ...s.currentPlan,
            todos: [...s.currentPlan.todos, ...added],
          },
        };
      });
      return;

    case "ask_user": {
      set((s) => {
        const fin = finalizeStreaming(s);
        const questionBubble: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: event.question,
          timestamp: now(),
        };
        return {
          ...fin,
          isAiTyping: false,
          chatMessages: [...fin.chatMessages, questionBubble],
          pendingQuestion: { question: event.question, options: event.options },
        };
      });
      return;
    }

    case "tool_req": {
      const inp = event.input as Record<string, unknown>;

      if (
        event.toolName === "create_plan" ||
        event.toolName === "add_todos" ||
        event.toolName === "update_todo"
      ) {
        set((s) => {
          const fin = finalizeStreaming(s);

          let action: ActionItem;
          let updatedTodos: Todo[] | undefined;

          if (event.toolName === "create_plan") {
            const todos = parseTodos(inp.todos);
            action = {
              kind: "create_plan",
              label: String(inp.name ?? "Plan"),
              meta: { description: String(inp.description ?? ""), todos },
            };
          } else if (event.toolName === "add_todos") {
            const todos = parseTodos(inp.todos);
            action = {
              kind: "add_todos",
              label: `Added ${todos.length} todo${todos.length === 1 ? "" : "s"}`,
              meta: { todos },
            };
          } else {
            const sno = Number(inp.sno);
            const newStatus = String(inp.status ?? "");
            updatedTodos = s.currentPlan?.todos.map((t) =>
              t.sno === sno
                ? { ...t, status: newStatus as TodoStatus }
                : t,
            );
            action = {
              kind: "update_todo",
              label: todoUpdateLabel(sno, newStatus, updatedTodos ?? []),
              meta: {
                sno,
                status: newStatus,
                ...(updatedTodos ? { todos: updatedTodos } : {}),
              },
            };
          }

          const msgs = fin.chatMessages;
          const turnStart = currentTurnStart(msgs);
          if (event.toolName === "update_todo" && updatedTodos) {
            const updatedMessages = withUpdatedPlanTodos(
              msgs,
              updatedTodos,
              turnStart,
            );
            if (updatedMessages) {
              return {
                ...fin,
                isAiTyping: true,
                chatMessages: updatedMessages,
              };
            }
          }
          let targetIdx = -1;
          for (let i = msgs.length - 1; i >= turnStart; i--) {
            if (msgs[i].role === "ai") {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx !== -1) {
            return {
              ...fin,
              isAiTyping: true,
              chatMessages: msgs.map((m, i) =>
                i === targetIdx
                  ? { ...m, actions: [...(m.actions ?? []), action] }
                  : m,
              ),
            };
          }
          const placeholder: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: "",
            timestamp: now(),
            actions: [action],
          };
          return {
            ...fin,
            isAiTyping: true,
            chatMessages: [...msgs, placeholder],
          };
        });
        return;
      }

      if (event.toolName === "report_progress") {
        const text = String(inp.message ?? "").trim();
        set((s) => {
          const fin = finalizeStreaming(s);
          const progressMsg: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: text,
            timestamp: now(),
          };
          return {
            ...fin,
            isAiTyping: true,
            chatMessages: [...fin.chatMessages, progressMsg],
          };
        });
        return;
      }

      set((s) => {
        const fin = finalizeStreaming(s);
        const action = deriveActionItem(
          event.toolName,
          inp,
          undefined,
          event.toolCallId,
        );
        const msgs = fin.chatMessages;
        // Only attach within the current turn — never reach back into a previous exchange.
        const turnStart = currentTurnStart(msgs);
        let targetIdx = -1;
        for (let i = msgs.length - 1; i >= turnStart; i--) {
          if (msgs[i].role === "ai") {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx !== -1) {
          return {
            ...fin,
            isAiTyping: true,
            chatMessages: msgs.map((m, i) =>
              i === targetIdx
                ? { ...m, actions: [...(m.actions ?? []), action] }
                : m,
            ),
          };
        }
        const placeholder: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: "",
          timestamp: now(),
          actions: [action],
        };
        return {
          ...fin,
          isAiTyping: true,
          chatMessages: [...msgs, placeholder],
        };
      });
      return;
    }

    case "file_start": {
      const path = normalizePath(event.path);
      set((s) => {
        const files = { ...s.files };
        // Always reset content to "" so file_chunk can append cleanly.
        // Preserve any other fields (e.g. path) that may come from hydrateTree.
        files[path] = {
          ...(s.files[path] ?? { path }),
          content: "",
        };
        return {
          files,
          writingPath: path,
          activity: "Working",
          buildStarted: true,
        };
      });
      return;
    }

    case "file_chunk": {
      const path = normalizePath(event.path);
      set((s) => {
        const existing = s.files[path] ?? { path, content: "" };
        return {
          files: {
            ...s.files,
            [path]: {
              ...existing,
              content: (existing.content ?? "") + event.content,
            },
          },
        };
      });
      return;
    }

    case "file_done": {
      set(
        event.headSequence !== undefined
          ? { writingPath: null, headSequence: event.headSequence }
          : { writingPath: null },
      );

      // The agent just replaced this file's body, so the `savedHash` we're
      // holding describes content that no longer exists. Re-derive it from what
      // streamed in (identical to what the server persisted) so a later edit
      // still has a valid base to save against.
      //
      // Deliberately NOT done when the file has unsaved edits: that draft was
      // written against the superseded body, and refreshing the base would let
      // it save cleanly straight over the agent's work. Leaving the stale hash
      // makes the save 409 instead, and the user is told to reopen the file.
      const donePath = normalizePath(event.path);
      const doneFile = get().files[donePath];
      if (doneFile?.content !== undefined && !isFileDirty(doneFile)) {
        const streamed = doneFile.content;
        void sha256Hex(streamed).then((hash) => {
          set((s) => {
            const current = s.files[donePath];
            // Bail if anything moved while we were hashing.
            if (!current || current.content !== streamed) return s;
            return {
              files: {
                ...s.files,
                [donePath]: { ...current, savedHash: hash },
              },
            };
          });
        });
      }
      return;
    }

    case "file_delete": {
      const path = normalizePath(event.path);
      set((s) => {
        const files = { ...s.files };
        delete files[path];
        const openFiles = s.openFiles.filter((f) => f !== path);
        const activeFileId =
          s.activeFileId === path
            ? (openFiles[openFiles.indexOf(path)] ?? openFiles.at(-1) ?? "")
            : s.activeFileId;
        return {
          files,
          openFiles,
          activeFileId,
          headSequence: event.headSequence,
        };
      });
      return;
    }

    case "tool_res":
      // Only dispatch_* and web_search actions carry a toolCallId, so this is
      // a no-op for every other tool's result.
      set((s) => ({
        chatMessages: attachDispatchResult(
          s.chatMessages,
          event.toolCallId,
          extractDispatchResult(event.output),
        ),
      }));
      return;

    case "credits_update":
      // Live spend tick from the worker after each metered turn. Write the new
      // available balance straight into the react-query cache so the
      // CreditsWidget ticks down turn by turn instead of waiting for its poll.
      // The full bucket breakdown is reconciled by invalidateBalance() when the
      // job reaches a terminal frame.
      queryClient.setQueryData<BalanceSummary>(billingKeys.balance, (old) =>
        old
          ? {
              ...old,
              credits: { ...old.credits, available: event.available },
              micro: { ...old.micro, available: event.availableMicro },
            }
          : old,
      );
      return;

    case "context_compacted":
      return;

    case "context_summarized":
      // The model condensed the older turns. Drop a quiet divider into the
      // transcript. The full summary text isn't in the live event — it's fetched
      // with the checkpoint on the next reload, which upgrades this to expandable.
      set((s) => {
        const divider: Message = {
          id: crypto.randomUUID(),
          role: "divider",
          content: "",
          timestamp: now(),
          divider: {
            summary: "",
            tokensBefore: event.tokensBefore,
            tokensAfter: event.tokensAfter,
          },
        };
        return { chatMessages: [...s.chatMessages, divider] };
      });
      return;

    case "resync":
      // Handled in useJobStream before reaching here; nothing to do in the reducer.
      return;

    case "shell_output":
      return;

    case "preview_ready":
      // Bump the nonce so the iframe remounts even if the URL string is
      // unchanged — a restarted sandbox may serve at the same host, and the old
      // (dead) frame must be torn down and reloaded.
      set((s) => ({
        previewUrl: event.url,
        previewNonce: s.previewNonce + 1,
        buildStarted: true,
      }));
      return;

    case "deploy_ready":
      // The publish job is finished and the live pointer has moved. Refetch the
      // panel rather than patching it locally: the server owns the derived
      // fields (unpublished-change count, which deployment is live) and there
      // is no spinner to race — the panel is already showing "Publishing…".
      // Any warning the build produced is on the deployment row, so the refetch
      // brings it along — no need to carry it through the store as well.
      void queryClient.invalidateQueries({
        queryKey: deployKeys.status(get().projectId ?? ""),
      });
      return;

    case "done":
      invalidateBalance();
      // The worker captures and stores the project cover before this terminal
      // event. Mark the inactive home-page list stale so returning home fetches
      // the new presigned thumbnail URL instead of keeping the placeholder.
      void queryClient.invalidateQueries({ queryKey: ["project", "list"] });
      set((s) => {
        const fin = finalizeStreaming(s);
        const { chatMessages } = flushPendingActions({ ...s, ...fin });
        return {
          chatMessages,
          streamingId: null,
          isAiTyping: false,
          status: "done",
          terminalOutcome: { kind: "done" },
          activity: null,
          writingPath: null,
          currentJobId: null,
          isPreviewJob: false,
          pendingActions: [],
          pendingQuestion: null,
        };
      });
      return;

    case "cancelled": {
      invalidateBalance();
      set((s) => {
        const fin = finalizeStreaming(s);
        const { chatMessages } = flushPendingActions({ ...s, ...fin });
        return {
          chatMessages,
          streamingId: null,
          isAiTyping: false,
          status: "cancelled",
          terminalOutcome: { kind: "cancelled" },
          activity: null,
          writingPath: null,
          currentJobId: null,
          isPreviewJob: false,
          pendingActions: [],
          pendingQuestion: null,
        };
      });
      return;
    }

    case "error":
      invalidateBalance();
      set((s) => {
        const fin = finalizeStreaming(s);
        const { chatMessages } = flushPendingActions({ ...s, ...fin });
        const message =
          typeof event.message === "string"
            ? event.message
            : "Something went wrong during generation.";
        return {
          streamingId: null,
          isAiTyping: false,
          status: "error",
          terminalOutcome: { kind: "error", message },
          activity: null,
          writingPath: null,
          currentJobId: null,
          chatMessages: [
            ...chatMessages,
            {
              id: crypto.randomUUID(),
              role: "ai",
              content: `⚠️ ${message}`,
              timestamp: now(),
            },
          ],
          pendingActions: [],
          pendingQuestion: null,
        };
      });
      return;

    case "insufficient_credits":
      invalidateBalance();
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: false,
        status: "error",
        terminalOutcome: {
          kind: "credits",
          reason: event.reason ?? "balance",
        },
        activity: null,
        writingPath: null,
        currentJobId: null,
        isPreviewJob: false,
        pendingActions: [],
      }));
      useBillingStore.getState().open();
      return;

    default:
      // Unknown / gateway frames (e.g. its own "error") — ignore quietly.
      return;
  }
}
