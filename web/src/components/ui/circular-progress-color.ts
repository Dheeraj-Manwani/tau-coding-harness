/** Mirrors `CONTEXT_COMPACT_RATIO`/`CONTEXT_SUMMARIZE_RATIO` in
 *  server/src/worker/agent/config.ts, so the color band change lines up with
 *  when auto-compaction/auto-summarization actually fire. */
const COMPACT_RATIO = 0.6;
const SUMMARIZE_RATIO = 0.75;

export function colorForPercent(percent: number): string {
  const fraction = percent / 100;
  if (fraction >= SUMMARIZE_RATIO) return "text-red-400";
  if (fraction >= COMPACT_RATIO) return "text-amber-400";
  return "text-green-500";
}
