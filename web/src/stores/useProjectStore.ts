import { create } from "zustand";

import type {
  JobEvent,
  ProjectDetail,
  ProjectMessage,
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

/** A file in the generated app, keyed by its sandbox-relative path. */
export interface ProjectFile {
  path: string;
  content: string;
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

// ── State ───────────────────────────────────────────────────────────────────

interface ProjectState {
  // Identity / lifecycle
  projectId: string | null;
  currentJobId: string | null;
  status: JobStatus;
  /** Short human label of what the agent is doing right now (tool/shell). */
  activity: string | null;
  hydrated: boolean;

  // Chat
  chatMessages: Message[];
  isAiTyping: boolean;
  /** The in-progress assistant bubble currently being streamed into. */
  streamingId: string | null;

  // Generated app
  files: Record<string, ProjectFile>;
  previewUrl: string | null;

  // Cancellation hook, registered by the active WebSocket stream.
  cancelStream: (() => void) | null;

  // UI (local, not server-derived)
  isChatOpen: boolean;
  activeTab: Tab;
  openFiles: string[];
  activeFileId: string;
  previewDevice: PreviewDevice;
  splitPosition: number;
  codeTreeWidth: number;

  // ── Actions ──
  /** Reset everything when entering (or switching to) a project. */
  initProject: (projectId: string) => void;
  /** Seed chat/files/preview from the persisted project once on entry. */
  hydrate: (detail: ProjectDetail) => void;
  /** Begin streaming a job; optionally append the prompt as a user bubble. */
  startJob: (jobId: string, prompt?: string) => void;
  /** Append a user bubble immediately (optimistic, before the job id is known). */
  appendUserMessage: (content: string) => void;
  /** Apply one live event from the ws-gateway stream. */
  applyEvent: (event: JobEvent) => void;
  setCanceller: (fn: (() => void) | null) => void;

  toggleChat: () => void;
  setActiveTab: (tab: Tab) => void;
  openFile: (id: string) => void;
  closeFile: (id: string) => void;
  closeOtherFiles: (id: string) => void;
  closeFilesToRight: (id: string) => void;
  closeAllFiles: () => void;
  setActiveFile: (id: string) => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  setSplitPosition: (px: number) => void;
  setCodeTreeWidth: (px: number) => void;
}

/** State reset whenever we enter a project (UI prefs below are preserved). */
const FRESH = {
  currentJobId: null,
  status: "idle" as JobStatus,
  activity: null,
  hydrated: false,
  chatMessages: [] as Message[],
  isAiTyping: false,
  streamingId: null,
  files: {} as Record<string, ProjectFile>,
  previewUrl: null,
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
  splitPosition: 400,
  codeTreeWidth: 240,

  initProject: (projectId) => {
    if (get().projectId === projectId) return; // already on this project
    set({ projectId, ...FRESH });
  },

  hydrate: (detail) =>
    set((s) => {
      if (s.hydrated) return { hydrated: true };

      // Only seed chat from the DB if we haven't already shown anything
      // (e.g. an optimistic prompt from navigation) — never clobber a stream.
      const chatMessages =
        s.chatMessages.length === 0
          ? detail.messages
              .map(toChatMessage)
              .filter((m): m is Message => m !== null)
          : s.chatMessages;

      const files: Record<string, ProjectFile> = { ...s.files };
      for (const f of detail.latestFragment?.files ?? []) {
        files[f.path] ??= { path: f.path, content: f.content };
      }

      const previewUrl =
        s.previewUrl ?? detail.latestFragment?.sandboxUrl ?? null;

      return { hydrated: true, chatMessages, files, previewUrl };
    }),

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

  appendUserMessage: (content) =>
    set((s) => ({ chatMessages: [...s.chatMessages, userMessage(content)] })),

  applyEvent: (event) => applyEvent(set, event),

  setCanceller: (fn) => set({ cancelStream: fn }),

  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setActiveTab: (activeTab) => set({ activeTab }),

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
  setSplitPosition: (splitPosition) => set({ splitPosition }),
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

    case "file_start":
      set((s) => {
        const files = { ...s.files };
        files[event.path] ??= { path: event.path, content: "" };
        const openFiles = s.openFiles.includes(event.path)
          ? s.openFiles
          : [...s.openFiles, event.path];
        return {
          files,
          openFiles,
          activeFileId: event.path,
          activeTab: "code",
          activity: `Writing ${basename(event.path)}`,
        };
      });
      return;

    case "file_chunk":
      set((s) => {
        const existing = s.files[event.path] ?? {
          path: event.path,
          content: "",
        };
        return {
          files: {
            ...s.files,
            [event.path]: {
              ...existing,
              content: existing.content + event.content,
            },
          },
        };
      });
      return;

    case "file_done":
      return;

    case "shell_output":
      set({ activity: event.line.trim() || null });
      return;

    case "preview_ready":
      set({ previewUrl: event.url, activeTab: "preview" });
      return;

    case "done":
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: false,
        status: "done",
        activity: null,
        currentJobId: null,
      }));
      return;

    case "cancelled":
      set((s) => ({
        ...finalizeStreaming(s),
        isAiTyping: false,
        status: "cancelled",
        activity: null,
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
