import type { JobStatus } from "@/src/stores/useProjectStore";

export type AgentBrowserState =
  | "idle"
  | "working"
  | "waiting"
  | "stalled"
  | "error"
  | "cancelled";

type AgentBrowserStateInput = {
  status: JobStatus;
  pendingQuestion: boolean;
  stalled: boolean;
  /** A preview restart or deploy: background housekeeping, not agent work,
   *  so the tab shouldn't blink as if tau were building. */
  previewJob?: boolean;
};

/** Reduce the project lifecycle to the small state machine shown in the tab. */
export function resolveAgentBrowserState({
  status,
  pendingQuestion,
  stalled,
  previewJob = false,
}: AgentBrowserStateInput): AgentBrowserState {
  if (status === "streaming") {
    if (previewJob) return "idle";
    if (pendingQuestion) return "waiting";
    if (stalled) return "stalled";
    return "working";
  }
  if (status === "done") return "idle";
  if (status === "error") return "error";
  if (status === "cancelled") return "cancelled";
  return "idle";
}

type FaviconAppearance = {
  href: string;
  blinks: boolean;
};

export const FAVICON_APPEARANCE: Record<
  Exclude<AgentBrowserState, "idle">,
  FaviconAppearance
> = {
  working: { href: "/favicon-working.svg", blinks: true },
  waiting: { href: "/favicon-waiting.svg", blinks: true },
  stalled: { href: "/favicon-stalled.svg", blinks: true },
  error: { href: "/favicon-error.svg", blinks: false },
  cancelled: { href: "/favicon-cancelled.svg", blinks: false },
};

/** Every frame is a static asset from public so it retains the original Tau artwork. */
export function agentFaviconHref(
  state: Exclude<AgentBrowserState, "idle">,
  dotVisible = true,
): string {
  return dotVisible ? FAVICON_APPEARANCE[state].href : "/favicon.ico";
}
