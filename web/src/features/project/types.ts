/**
 * Wire types for the project flow: the REST shapes returned by `api` and the
 * live event union published by `worker-service` and streamed over SSE.
 */

// ── REST (api) ──────────────────────────────────────────────────────────────

export type Effort = "LOW" | "HIGH" | "MAX";

export type { MessageAttachment } from "@/src/features/composer/attachments/types";
import type { MessageAttachment } from "@/src/features/composer/attachments/types";
import type { SecretField } from "@/src/features/project/secrets";

/**
 * The element a chat message was sent about, when it came from the visual-edit
 * inspector. Mirrors `visualContextSchema` in the API.
 *
 * All facts, no prose: the API writes every sentence the model reads
 * (`server/src/api/lib/visualContext.ts`), so the wording lives in one place
 * and this stays a description of what was clicked.
 */
export interface VisualMessageContext {
  /** `src/App.tsx:42:7`: path, 1-based line, 1-based column. */
  loc: string;
  tagName: string;
  className?: string;
  text?: string;
  src?: string;
  siblingCount?: number;
  /** Which value the deterministic editor found it could not touch. */
  computed?: "text" | "className" | "attribute";
}

/**
 * A build failure the preview is showing, as reported by the in-iframe runtime
 * reading Vite's error overlay. Mirrors `buildErrorSchema` in the API.
 */
export interface PreviewBuildError {
  /** Vite's message: plugin, reason, and the source position. */
  message: string;
  file?: string;
  /** The offending source excerpt with its caret. */
  frame?: string;
}

/** One error the preview's bootstrap monitor recorded while the app started. */
export interface PreviewRuntimeErrorEntry {
  /** An uncaught exception, an unhandled promise rejection, or a script that would not load. */
  kind: "error" | "rejection" | "script";
  message: string;
  stack?: string;
  /** `file:line:col`, when the browser gave one. */
  at?: string;
  count?: number;
}

/**
 * What the browser saw when the app crashed while starting, as the monitor
 * inside the preview reported it. Mirrors `runtimeErrorSchema` in the API.
 */
export interface PreviewRuntimeError {
  /** The route that was open. */
  path?: string;
  errors: PreviewRuntimeErrorEntry[];
}

/** A persisted message row as returned by `GET /project/:id`. `content` is the
 *  raw JSON the worker/api stored (OpenAI chat shape), decoded lazily in the
 *  store: we keep it `unknown` here rather than over-specifying. */
export interface ProjectMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  type: "USER" | "RESULT" | "ERROR" | "TOOL_REQ" | "TOOL_RES";
  content: unknown;
  sequence: number;
  createdAt: string;
  attachments?: MessageAttachment[];
}

export interface Fragment {
  id: string;
  sandboxUrl: string | null;
  title: string | null;
  createdAt: string;
}

export interface ProjectCheckpoint {
  id: string;
  upToSequence: number;
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  /** User-edited, never generated. Null until someone sets one. */
  description: string | null;
  /** User-edited labels. Empty, never null — same shape the API always sends. */
  tags: string[];
  /** Standing instructions the user wrote for tau in this project; tau reads
   *  them with every request and never edits them. Null when none are set. */
  instructions: string | null;
  sandboxStatus: string;
  /** Durable one-way transition from the initial chat-only view. */
  workspaceStartedAt: string | null;
  /** Short-lived signed URL for the latest captured project cover. */
  previewImageUrl: string | null;
}

/** A row in the user's project list (`GET /project`). */
export interface ProjectListItem {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  instructions: string | null;
  sandboxStatus: string;
  createdAt: string;
  updatedAt: string;
  previewImageUrl: string | null;
}

/** Shape of `GET /project`. */
export interface ListProjectsResponse {
  projects: ProjectListItem[];
  nextCursor: string | null;
}

/**
 * A paused agent waiting on the user. `secrets` is set when it is a
 * `request_secret` call: the composer area then shows the key form instead of
 * answer chips, and the values go to the secrets endpoint, never the chat.
 */
export interface PendingQuestion {
  id: string;
  question: string;
  options: string[];
  secrets?: SecretField[];
}

/** Shape of `GET /project/:projectId`. */
export interface ProjectDetail {
  project: ProjectSummary;
  messages: ProjectMessage[];
  latestFragment: Fragment | null;
  /** Id of a still-running job, if any: used to resume the stream on reload. */
  activeJobId: string | null;
  activeJobEventIndex: number | null;
  jobState: {
    id: string;
    type: "GENERATION" | "RECOVERY" | "PREVIEW" | "DEPLOY";
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
    phase: "queued" | "waiting_user" | "working" | "terminal";
    finishReason: string | null;
    error: string | null;
    pendingQuestion: PendingQuestion | null;
  } | null;
  checkpoints: ProjectCheckpoint[];
  /** Ring value on first load — before any turn runs or any manual action fires. */
  contextUsage: ContextUsageSnapshot;
}

/** Lightweight `GET /project/:id/job-status` recovery-poll response. */
export interface ProjectJobStatusResponse {
  activeJobId: string | null;
  jobType: NonNullable<ProjectDetail["jobState"]>["type"] | null;
  pendingQuestionId: string | null;
}

/** Response from `GET /project/:id/messages?before=<sequence>` */
export interface OlderMessagesResponse {
  messages: ProjectMessage[];
  hasMore: boolean;
  checkpoints: ProjectCheckpoint[];
}

export interface InitProjectResponse {
  projectId: string;
  jobId: string;
}

export interface AddMessageResponse {
  jobId: string;
}

/** Shared "where context usage stands right now" snapshot, echoed back by
 *  both chat-context actions below so the UI can update without waiting on
 *  a live event (doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md). */
export interface ContextUsageSnapshot {
  tokensUsed: number;
  tokensBudget: number;
  usagePercent: number;
}

/** `POST /project/:id/chat/clear` response. */
export type ClearChatResponse = ContextUsageSnapshot &
  ({ cleared: true; upToSequence: number } | { cleared: false; upToSequence: null });

/** `POST /project/:id/chat/summarize` response. */
export type SummarizeChatResponse = ContextUsageSnapshot & {
  summarized: true;
  upToSequence: number;
  tokensBefore: number;
  tokensAfter: number;
};

/** `GET /project/:id/preview/status`: is the live E2B sandbox reachable? */
export interface PreviewStatusResponse {
  alive: boolean;
  url?: string;
}

/** `POST /project/:id/preview/restart`: the queued provision-only job. */
export interface RestartPreviewResponse {
  jobId: string;
}

/** `GET /project/:id/tree` response. */
export interface ProjectTree {
  files: { path: string; sizeBytes: number }[];
  headSequence: number;
}

/** `GET /project/:id/file?path=…` response.
 *  Text files return their `content`; binary assets (images, fonts, media)
 *  return a short-lived presigned `url` to preview instead: their bytes never
 *  round-trip through the text editor. */
export type ProjectFileResponse =
  | {
      binary?: false;
      content: string;
      /** Hash of the content served: echoed back on save for optimistic concurrency. */
      contentHash: string;
    }
  | {
      binary: true;
      /** Presigned URL to the asset in R2, for inline preview. */
      url: string;
      contentHash: string;
    };

export interface SaveProjectFileResponse {
  contentHash: string;
  headSequence: number;
}

// ── Live events (worker → in-process bus → SSE) ─────────────────────────────

/** Every event carries the monotonic `index` used for replay/dedup. */
interface BaseEvent {
  index: number;
}

export type TerminalOutcome =
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "credits"; reason: "budget" | "balance" };

export type JobEvent = BaseEvent &
  (
    | { type: "thinking"; message: string }
    | { type: "llm_chunk"; content: string }
    | { type: "tool_req"; toolName: string; toolCallId: string; input: unknown }
    | { type: "tool_res"; toolCallId: string; output: unknown }
    | { type: "file_start"; path: string }
    | { type: "file_chunk"; path: string; content: string }
    | { type: "file_done"; path: string; headSequence?: number }
    | { type: "file_delete"; path: string; headSequence: number }
    | { type: "shell_output"; stream: "stdout" | "stderr"; line: string }
    | { type: "preview_restoring" }
    | { type: "preview_ready"; url: string; healthCheck?: boolean; readyAt?: string; restored?: boolean }
    | {
        type: "deploy_ready";
        url: string | null;
        deploymentId: string;
        /** Set when the build only passed with the type check bypassed. */
        warning: string | null;
      }
    | {
        type: "plan_created";
        name: string;
        description: string;
        todos: string[];
      }
    | { type: "todo_updated"; sno: number; status: string }
    | { type: "todos_added"; todos: string[] }
    | {
        type: "ask_user";
        questionId: string;
        question: string;
        options: string[];
        secrets?: SecretField[];
      }
    | { type: "ask_user_expired"; questionId: string }
    | { type: "resync" }
    | { type: "cancelled" }
    | { type: "done" }
    | { type: "error"; message: string }
    | { type: "insufficient_credits"; reason?: "budget" | "balance" }
    | { type: "credits_update"; available: number; availableMicro: string }
    | { type: "context_compacted"; tokensBefore: number; tokensAfter: number }
    | {
        type: "context_summarized";
        upToSequence: number;
        tokensBefore: number;
        tokensAfter: number;
      }
    | ({
        type: "context_usage";
        /** Set only on the turn that actually ran compaction/summarization,
         *  so the ring knows when to flash rather than just update. */
        triggeredAutoRun?: "compact" | "summarize";
      } & ContextUsageSnapshot)
  );
