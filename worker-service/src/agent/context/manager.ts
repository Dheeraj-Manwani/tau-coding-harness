import {
  CONTEXT_BUDGET,
  CONTEXT_COMPACT_RATIO,
  CONTEXT_KEEP_TAIL_TOKENS,
  CONTEXT_SUMMARIZE_RATIO,
  MAX_TOOL_RESULT_TOKENS,
} from "../config";
import { compact } from "./compact";
import { summarize, type SummarizeResult } from "./summarize";
import { estimateTokensCalibrated, type TokenCalibration } from "./tokens";
import type { Entry, MessageParam } from "./types";

export interface ManageResult {
  /** The (possibly rebuilt) working history to carry forward. */
  entries: Entry[];
  /** The compacted array to send to the model this turn. */
  ctx: MessageParam[];
  /** Present only when mechanical compaction actually trimmed something. */
  compacted?: { tokensBefore: number; tokensAfter: number };
  /** Present only when the older prefix was summarized this turn. */
  summarized?: SummarizeResult;
}

/** `summarize` with one immediate retry, swallowing failures. Returns null on a
 *  no-op boundary (as `summarize` does) or when both attempts throw — the caller
 *  then proceeds with the compacted ctx instead of the job dying. */
async function summarizeWithRetry(
  ...args: Parameters<typeof summarize>
): Promise<SummarizeResult | null> {
  try {
    return await summarize(...args);
  } catch (err) {
    console.error("[worker] summarization failed, retrying once", err);
    try {
      return await summarize(...args);
    } catch (err2) {
      console.error(
        "[worker] summarization failed after retry, proceeding without it",
        err2,
      );
      return null;
    }
  }
}

/**
 * Bound the model-facing context for one turn. Compaction is ephemeral (the full
 * `entries` are preserved); summarization is persistent (it rebuilds `entries`
 * and the caller must write a checkpoint). Runs before each model call.
 */
export async function manageContext(
  entries: Entry[],
  opts: { model: string; calibration: TokenCalibration },
): Promise<ManageResult> {
  const raw = entries.map((e) => e.param);
  const before = estimateTokensCalibrated(raw, opts.calibration);

  // 1. Mechanical compaction (ephemeral) once past the compaction ratio.
  let compacted: ManageResult["compacted"];
  let ctx = raw;
  if (before > CONTEXT_COMPACT_RATIO * CONTEXT_BUDGET) {
    const res = compact(raw, { maxToolResultTokens: MAX_TOOL_RESULT_TOKENS });
    ctx = res.messages;
    if (res.changed) {
      compacted = { tokensBefore: res.tokensBefore, tokensAfter: res.tokensAfter };
    }
  }

  // 2. Summarization (persistent) if still over the high-water mark.
  let summarized: SummarizeResult | undefined;
  let outEntries = entries;
  if (
    estimateTokensCalibrated(ctx, opts.calibration) >
    CONTEXT_SUMMARIZE_RATIO * CONTEXT_BUDGET
  ) {
    // Summarization makes a live LLM call, so it can fail transiently. It must
    // never take the whole job down with it — a summarize failure just means we
    // proceed with the (already compacted) ctx for this turn and try again next
    // turn. Retry once before giving up.
    const res = await summarizeWithRetry(entries, {
      model: opts.model,
      keepTailTokens: CONTEXT_KEEP_TAIL_TOKENS,
      maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
    });
    if (res) {
      summarized = res;
      outEntries = res.entries;
      // Recompute the model-facing array from the rebuilt, smaller history.
      ctx = compact(outEntries.map((e) => e.param), {
        maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
      }).messages;
    }
  }

  return { entries: outEntries, ctx, compacted, summarized };
}
