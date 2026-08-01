import { bus, type JobEvent } from "@/lib/bus";

/**
 * Emit one job event to every SSE subscriber (and the replay buffer).
 *
 * The index is allocated by the bus, never by the caller. Passing one in was the
 * source of duplicate indices — the client drops any event whose `index` is
 * `<= watermark`, so a collision silently swallowed a frame, occasionally a
 * terminal one (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.5).
 */
export async function publish(jobId: string, event: object): Promise<void> {
  bus.emit(jobId, {
    ...(event as Record<string, unknown>),
    index: bus.nextIndex(jobId),
  } as JobEvent);
}

/**
 * Emit the job's single terminal frame (`done` / `error` / `cancelled` /
 * `insufficient_credits`), or do nothing if one was already emitted.
 *
 * Returns whether this call was the one that ended the job. Use this — never a
 * bare `publish` — for any frame the client finalizes on: the client stops
 * streaming at the first terminal frame, so a second one only ever contradicts
 * the first (e.g. a ⚠️ error bubble appended after a clean finish).
 */
export async function publishTerminal(
  jobId: string,
  event: object,
): Promise<boolean> {
  if (!bus.claimTerminal(jobId)) return false;
  await publish(jobId, event);
  return true;
}

/**
 * The `nextIndex` callback threaded through the agent loop and tool executors.
 * Now just a bound view onto the bus's per-job counter, so indices allocated
 * here can never collide with those `publish` hands out.
 */
export function makeIndexer(jobId: string): () => number {
  return () => bus.nextIndex(jobId);
}
