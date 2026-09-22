/**
 * Wire types for the project flow: the REST shapes returned by `api` and the
 * live event union published by `worker-service` and streamed over SSE.
 */

// ── REST (api) ──────────────────────────────────────────────────────────────

export type Effort = "LOW" | "HIGH" | "MAX";

export type { MessageAttachment } from "@/src/features/composer/attachments/types";
import type { MessageAttachment } from "@/src/features/composer/attachments/types";

/**
 * The element a chat message was sent about, when it came from the visual-edit
 * inspector. Mirrors `visualContextSchema` in the API.
 *
 * All facts, no prose: the API writes every sentence the model reads
 * (`server/src/api/lib/visualContext.ts`), so the wording lives in one place
 * and this stays a description of what was clicked.
 */
export interface VisualMessageContext {
  /** `src/App.tsx:42:7` — path, 1-based line, 1-based column. */
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
  /** Vite's message — plugin, reason, and the source position. */
  message: string;
  file?: string;
  /** The offending source excerpt with its caret. */
  frame?: string;
}

/** A persisted message row as returned by `GET /project/:id`. `content` is the
 *  raw JSON the worker/api stored (OpenAI chat shape), decoded lazily in the
 *  store — we keep it `unknown` here rather than over-specifying. */
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
  sandboxStatus: string;
  /** Durable one-way transition from the initial chat-only view. */
  workspaceStartedAt: string | null;
}

/** A row in the user's project list (`GET /project`). */
export interface ProjectListItem {
  id: string;
  name: string;
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

/** Shape of `GET /project/:projectId`. */
export interface ProjectDetail {
  project: ProjectSummary;
  messages: ProjectMessage[];
  latestFragment: Fragment | null;
  /** Id of a still-running job, if any — used to resume the stream on reload. */
  activeJobId: string | null;
  activeJobEventIndex: number | null;
  checkpoints: ProjectCheckpoint[];
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

/** `GET /project/:id/preview/status` — is the live E2B sandbox reachable? */
export interface PreviewStatusResponse {
  alive: boolean;
}

/** `POST /project/:id/preview/restart` — the queued provision-only job. */
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
 *  return a short-lived presigned `url` to preview instead — their bytes never
 *  round-trip through the text editor. */
export type ProjectFileResponse =
  | {
      binary?: false;
      content: string;
      /** Hash of the content served — echoed back on save for optimistic concurrency. */
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
    | { type: "preview_ready"; url: string }
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
    | { type: "ask_user"; question: string; options: string[] }
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
  );
