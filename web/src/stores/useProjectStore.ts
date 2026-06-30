import { create } from "zustand";

import type {
  JobEvent,
  ProjectDetail,
  ProjectMessage,
  ProjectTree,
} from "@/src/features/project/types";
import { useBillingStore } from "@/src/features/billing/useBillingStore";

export type ChatRole = "user" | "ai";

export type ActionKind =
  | "create_file"
  | "edit_file"
  | "read_file"
  | "delete_file"
  | "run_command"
  | "report_progress"
  | "create_plan"
  | "update_todo"
  | "provision_sandbox"
  | "ask_user";

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
}

export interface Message {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  /** Tool calls + thinking steps that produced this ai message. */
  actions?: ActionItem[];
}

export type Tab = "preview" | "code";
export type PreviewDevice = "mobile" | "tablet" | "desktop";

/** A file in the generated app, keyed by its sandbox-relative path.
 *  `content` is absent for manifest-only entries; lazy-loaded on click. */
export interface ProjectFile {
  path: string;
  content?: string;
}

/** Lifecycle of the project's active generation job. */
export type JobStatus = "idle" | "streaming" | "done" | "error" | "cancelled";

// ── Helpers ─────────────────────────────────────────────────────────────────

const now = () => Date.now();

function userMessage(content: string): Message {
  return { id: crypto.randomUUID(), role: "user", content, timestamp: now() };
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function truncateLabel(s: string, max = 72): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function deriveActionItem(
  toolName: string,
  input: Record<string, unknown>,
  planSnapshot: { sno: number; label: string; status: string }[] = [],
): ActionItem {
  const path = String(input.path ?? "");
  const file = basename(path);
  switch (toolName) {
    case "create_file":
      return { kind: "create_file", label: `Created ${file}` };
    case "edit_file":
      return { kind: "edit_file", label: `Edited ${file}` };
    case "read_file":
      return { kind: "read_file", label: `Opened ${file}` };
    case "delete_file":
      return { kind: "delete_file", label: `Deleted ${file}` };
    case "run_command":
      return {
        kind: "run_command",
        label: `Ran ${truncateLabel(String(input.command ?? ""), 50)}`,
      };
    case "report_progress":
      return { kind: "report_progress", label: String(input.message ?? "") };

    case "create_plan": {
      const todosStr = String(input.todos ?? "");
      const todos = todosStr.trim()
        ? todosStr
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      return {
        kind: "create_plan",
        label: String(input.name ?? "Plan"),
        meta: { description: String(input.description ?? ""), todos },
      };
    }
    case "update_todo": {
      const sno = Number(input.sno);
      const status = String(input.status ?? "");
      return {
        kind: "update_todo",
        label: `Item ${sno} marked ${status}`,
        meta: { sno, status, ...(planSnapshot.length ? { todos: planSnapshot } : {}) },
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
function toConversation(rows: ProjectMessage[]): Message[] {
  const messages: Message[] = [];
  let turnStart = 0;
  // Running plan state — rebuilt as create_plan / update_todo calls are replayed.
  let planTodos: { sno: number; label: string; status: string }[] = [];

  for (const row of rows) {
    const ts = Date.parse(row.createdAt) || now();

    if (row.role === "USER" && row.type === "USER") {
      const blocks = row.content as { type?: string; text?: string }[] | string;
      const text = Array.isArray(blocks)
        ? blocks.map((b) => b?.text ?? "").join("")
        : String(blocks ?? "");
      if (text)
        messages.push({
          id: row.id,
          role: "user",
          content: text,
          timestamp: ts,
        });
      turnStart = messages.length; // ai messages from here onward are this turn's response
    } else if (row.role === "ASSISTANT" && row.type === "TOOL_REQ") {
      const stored = row.content as {
        content?: string | null;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
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
            const todosStr = String(input.todos ?? "");
            planTodos = todosStr.trim()
              ? todosStr.split(",").map((t, i) => ({
                  sno: i + 1,
                  label: t.trim(),
                  status: "pending",
                }))
              : [];
          } else if (name === "update_todo") {
            const sno = Number(input.sno);
            const status = String(input.status ?? "");
            planTodos = planTodos.map((t) =>
              t.sno === sno ? { ...t, status } : t,
            );
          }

          // Attach to the nearest ai message within this turn.
          const action = deriveActionItem(name, input, planTodos);
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
    }
    // TOOL_RES and ERROR rows are skipped
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
  /** Short human label of what the agent is doing right now (tool/shell). */
  activity: string | null;
  hydrated: boolean;
  /** Flips true once the agent starts writing files (or a preview exists). Drives
   *  the home→workspace reveal: chat is centered until this is true, then it docks
   *  left and the preview/code panel slides in from the right. */
  buildStarted: boolean;

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
  previewUrl: string | null;
  /** Bumped to force the preview iframe to remount (manual reload). */
  previewNonce: number;

  // Cancellation hook, registered by the active WebSocket stream.
  cancelStream: (() => void) | null;

  // UI (local, not server-derived)
  isChatOpen: boolean;
  activeTab: Tab;
  openFiles: string[];
  activeFileId: string;
  previewDevice: PreviewDevice;
  codeTreeWidth: number;

  // ── Actions ──
  /** Reset everything when entering (or switching to) a project. */
  initProject: (projectId: string) => void;
  /** Seed chat/files/preview from the persisted project once on entry. */
  hydrate: (detail: ProjectDetail) => void;
  /** Populate the file tree from the manifest (paths only, no bodies). */
  hydrateTree: (tree: ProjectTree) => void;
  /** Cache a lazily-loaded file body in the store. */
  setFileContent: (path: string, content: string) => void;
  /** Begin streaming a job; optionally append the prompt as a user bubble. */
  startJob: (jobId: string, prompt?: string) => void;
  /** Append a user bubble immediately (optimistic, before the job id is known).
   *  Returns the generated message id so callers can remove it on failure. */
  appendUserMessage: (content: string) => string;
  /** Remove a single chat bubble by id (used to roll back a failed optimistic send). */
  removeChatMessage: (id: string) => void;
  /** Prepend a batch of older messages loaded by scroll-up pagination. */
  prependMessages: (rows: ProjectMessage[], hasMore: boolean) => void;
  /** Apply one live event from the ws-gateway stream. */
  applyEvent: (event: JobEvent) => void;
  setCanceller: (fn: (() => void) | null) => void;
  answerPendingQuestion: (answer: string) => void;

  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setActiveTab: (tab: Tab) => void;
  /** Remount the preview iframe to reload the running app. */
  reloadPreview: () => void;
  openFile: (id: string) => void;
  closeFile: (id: string) => void;
  closeOtherFiles: (id: string) => void;
  closeFilesToRight: (id: string) => void;
  closeAllFiles: () => void;
  setActiveFile: (id: string) => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  setCodeTreeWidth: (px: number) => void;
}

/** State reset whenever we enter a project (UI prefs below are preserved). */
const FRESH = {
  currentJobId: null,
  status: "idle" as JobStatus,
  activity: null,
  hydrated: false,
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
  previewNonce: 0,
  cancelStream: null,
  activeTab: "preview" as Tab,
  openFiles: [] as string[],
  activeFileId: "",
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

      const chatMessages = toConversation(detail.messages);

      const previewUrl =
        s.previewUrl ?? detail.latestFragment?.sandboxUrl ?? null;

      const buildStarted = s.buildStarted || previewUrl != null;

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

  setFileContent: (path, content) =>
    set((s) => ({
      files: { ...s.files, [path]: { ...s.files[path], path, content } },
    })),

  startJob: (jobId, prompt) =>
    set((s) => {
      const alreadyShown =
        prompt != null &&
        s.chatMessages.some((m) => m.role === "user" && m.content === prompt);
      return {
        currentJobId: jobId,
        status: "streaming",
        isAiTyping: true,
        activity: "Thinking",
        currentPlan: null,
        chatMessages:
          prompt && !alreadyShown
            ? [...s.chatMessages, userMessage(prompt)]
            : s.chatMessages,
      };
    }),

  appendUserMessage: (content) => {
    const msg = userMessage(content);
    set((s) => ({ chatMessages: [...s.chatMessages, msg] }));
    return msg.id;
  },

  removeChatMessage: (id) =>
    set((s) => ({
      chatMessages: s.chatMessages.filter((m) => m.id !== id),
    })),

  prependMessages: (rows, hasMore) =>
    set((s) => {
      const prepended = toConversation(rows);
      return {
        chatMessages: [...prepended, ...s.chatMessages],
        hasMoreMessages: hasMore,
        oldestSequence: rows[0]?.sequence ?? s.oldestSequence,
      };
    }),

  applyEvent: (event) => applyEvent(set, event),

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
  setCodeTreeWidth: (codeTreeWidth) => set({ codeTreeWidth }),
}));

// ── Event reducer ───────────────────────────────────────────────────────────

type SetState = (
  partial: Partial<ProjectState> | ((s: ProjectState) => Partial<ProjectState>),
) => void;

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

function applyEvent(set: SetState, event: JobEvent): void {
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
        if (!s.currentPlan) return {};
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
        event.toolName === "update_todo"
      ) {
        set((s) => {
          const fin = finalizeStreaming(s);

          let action: ActionItem;

          if (event.toolName === "create_plan") {
            const todosStr = String(inp.todos ?? "");
            const todos = todosStr.trim()
              ? todosStr
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              : [];
            action = {
              kind: "create_plan",
              label: String(inp.name ?? "Plan"),
              meta: { description: String(inp.description ?? ""), todos },
            };
          } else {
            const sno = Number(inp.sno);
            const newStatus = String(inp.status ?? "");
            const updatedTodos = s.currentPlan?.todos.map((t) =>
              t.sno === sno ? { ...t, status: newStatus } : t,
            );
            action = {
              kind: "update_todo",
              label: "Updated Todo",
              meta: {
                sno,
                status: newStatus,
                ...(updatedTodos ? { todos: updatedTodos } : {}),
              },
            };
          }

          const msgs = fin.chatMessages;
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
        const action = deriveActionItem(event.toolName, inp);
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

    case "file_done":
      set(
        event.headSequence !== undefined
          ? { writingPath: null, headSequence: event.headSequence }
          : { writingPath: null },
      );
      return;

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
      // Tool results are sent back to the LLM, not rendered in the UI.
      return;

    case "resync":
      // Handled in useJobStream before reaching here; nothing to do in the reducer.
      return;

    case "shell_output":
      return;

    case "preview_ready":
      set({ previewUrl: event.url, buildStarted: true });
      return;

    case "done":
      set((s) => {
        const fin = finalizeStreaming(s);
        const { chatMessages } = flushPendingActions({ ...s, ...fin });
        return {
          chatMessages,
          streamingId: null,
          isAiTyping: false,
          status: "done",
          activity: null,
          writingPath: null,
          currentJobId: null,
          pendingActions: [],
          pendingQuestion: null,
        };
      });
      return;

    case "cancelled": {
      set((s) => {
        const fin = finalizeStreaming(s);
        const { chatMessages } = flushPendingActions({ ...s, ...fin });
        return {
          chatMessages,
          streamingId: null,
          isAiTyping: false,
          status: "cancelled",
          activity: null,
          writingPath: null,
          currentJobId: null,
          pendingActions: [],
          pendingQuestion: null,
        };
      });
      return;
    }

    case "error":
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
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: false,
        status: "error",
        activity: null,
        writingPath: null,
        currentJobId: null,
        pendingActions: [],
      }));
      useBillingStore.getState().open();
      return;

    default:
      // Unknown / gateway frames (e.g. its own "error") — ignore quietly.
      return;
  }
}
