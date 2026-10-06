import { useProjectStore } from "@/src/stores/useProjectStore";

/**
 * Live context-window-usage ring state. Two sources feed the store field
 * this reads, per doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md:
 *  - the job-scoped SSE stream's `context_usage` event, while a job runs;
 *  - the `/chat/clear` and `/chat/summarize` response bodies, applied
 *    directly by their callers regardless of whether a job is running.
 * The initial value (before either has fired) comes from `getProject` via
 * `hydrate`/`resyncFromDetail`.
 */
export function useContextUsage() {
  const usage = useProjectStore((s) => s.contextUsage);
  const flashKind = useProjectStore((s) => s.contextUsageFlashKind);
  const flashToken = useProjectStore((s) => s.contextUsageFlashToken);
  return { usage, flashKind, flashToken };
}
