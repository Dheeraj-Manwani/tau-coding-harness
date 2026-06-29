/**
 * Wire types for the project flow: the REST shapes returned by `api` and the
 * live event union published by `worker-service` and relayed by `ws-gateway`.
 */

// ── REST (api) ──────────────────────────────────────────────────────────────

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
}

export interface Fragment {
  id: string;
  sandboxUrl: string | null;
  title: string | null;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sandboxStatus: string;
}

/** A row in the user's project list (`GET /project`). */
export interface ProjectListItem {
  id: string;
  name: string;
  sandboxStatus: string;
  createdAt: string;
  updatedAt: string;
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
}

/** Response from `GET /project/:id/messages?before=<sequence>` */
export interface OlderMessagesResponse {
  messages: ProjectMessage[];
  hasMore: boolean;
}

export interface InitProjectResponse {
  projectId: string;
  jobId: string;
}

export interface AddMessageResponse {
  jobId: string;
}

/** `GET /project/:id/tree` response. */
export interface ProjectTree {
  files: { path: string; sizeBytes: number }[];
  headSequence: number;
}

/** `GET /project/:id/file?path=…` response. */
export interface ProjectFileResponse {
  content: string;
}

// ── Live events (worker → Redis → ws-gateway) ───────────────────────────────

/** Every event carries the monotonic `index` used for replay/dedup. */
interface BaseEvent {
  index: number;
}

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
    | { type: "plan_created"; name: string; description: string; todos: string[] }
    | { type: "todo_updated"; sno: number; status: string }
    | { type: "resync" }
    | { type: "cancelled" }
    | { type: "done" }
    | { type: "error"; message: string }
    | { type: "insufficient_credits" }
  );
