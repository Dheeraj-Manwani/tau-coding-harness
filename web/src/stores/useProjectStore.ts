import { create } from "zustand";

import type {
  JobEvent,
  ProjectDetail,
  ProjectMessage,
  ProjectTree,
} from "@/src/features/project/types";

export type ChatRole = "user" | "ai";

export interface Message {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
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

/** Decode a persisted message row into a chat bubble, or `null` to skip it
 *  (tool requests/results aren't shown in the conversation). */
function toChatMessage(row: ProjectMessage): Message | null {
  const ts = Date.parse(row.createdAt) || now();

  if (row.role === "USER" && row.type === "USER") {
    const blocks = row.content as { type?: string; text?: string }[] | string;
    const text = Array.isArray(blocks)
      ? blocks.map((b) => b?.text ?? "").join("")
      : String(blocks ?? "");
    return { id: row.id, role: "user", content: text, timestamp: ts };
  }

  if (row.role === "ASSISTANT" && row.type === "RESULT") {
    const c = row.content as { content?: string } | string;
    const text = typeof c === "string" ? c : (c?.content ?? "");
    if (!text.trim()) return null;
    return { id: row.id, role: "ai", content: text, timestamp: ts };
  }

  return null;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
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
  /** Whether older messages exist beyond the current window (pagination). */
  hasMoreMessages: boolean;
  /** Sequence number of the oldest loaded message — used as the pagination cursor. */
  oldestSequence: number | null;

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
  hasMoreMessages: false,
  oldestSequence: null as number | null,
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

      const chatMessages = detail.messages
        .map(toChatMessage)
        .filter((m): m is Message => m !== null);

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
      const prepended = rows
        .map(toChatMessage)
        .filter((m): m is Message => m !== null);
      return {
        chatMessages: [...prepended, ...s.chatMessages],
        hasMoreMessages: hasMore,
        oldestSequence: rows[0]?.sequence ?? s.oldestSequence,
      };
    }),

  applyEvent: (event) => applyEvent(set, event),

  setCanceller: (fn) => set({ cancelStream: fn }),

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
  if (!s.streamingId) return { streamingId: null, chatMessages: s.chatMessages };
  const bubble = s.chatMessages.find((m) => m.id === s.streamingId);
  const drop = !bubble || bubble.content.trim().length === 0;
  return {
    streamingId: null,
    chatMessages: drop
      ? s.chatMessages.filter((m) => m.id !== s.streamingId)
      : s.chatMessages,
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

    case "tool_req":
      // Each tool turn closes the prior thinking bubble so the final title
      // lands in its own bubble rather than merging with intermediate text.
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: true,
        activity: `Using ${event.toolName}`,
      }));
      return;

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
          activity: `Writing ${basename(path)}`,
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
      set(event.headSequence !== undefined
        ? { writingPath: null, headSequence: event.headSequence }
        : { writingPath: null });
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
        return { files, openFiles, activeFileId, headSequence: event.headSequence };
      });
      return;
    }

    case "resync":
      // Handled in useJobStream before reaching here; nothing to do in the reducer.
      return;

    case "shell_output":
      set({ activity: event.line.trim() || null });
      return;

    case "preview_ready":
      set({ previewUrl: event.url, buildStarted: true });
      return;

    case "done":
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: false,
        status: "done",
        activity: null,
        writingPath: null,
        currentJobId: null,
      }));
      return;

    case "cancelled":
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: false,
        status: "cancelled",
        activity: null,
        writingPath: null,
        currentJobId: null,
      }));
      return;

    case "error":
      set((s) => {
        const fin = finalizeStreaming(s);
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
            ...fin.chatMessages,
            {
              id: crypto.randomUUID(),
              role: "ai",
              content: `⚠️ ${message}`,
              timestamp: now(),
            },
          ],
        };
      });
      return;

    default:
      // Unknown / gateway frames (e.g. its own "error") — ignore quietly.
      return;
  }
}
