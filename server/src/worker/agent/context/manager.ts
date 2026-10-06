import {
  contextBudgetForModel,
  CONTEXT_CLEAR_TARGET_RATIO,
  CONTEXT_COMPACT_RATIO,
  CONTEXT_KEEP_TAIL_TOKENS,
  CONTEXT_SUMMARIZE_RATIO,
  MAX_TOOL_RESULT_TOKENS,
} from "../config";
import { log } from "../../lib/log";
import { applyClearing, planClearing, type ClearingState } from "./clearing";
import { summarize, type SummarizeResult } from "./summarize";
import {
  estimateTokens,
  estimateTokensCalibrated,
  type TokenCalibration,
} from "./tokens";
import type { Entry, MessageParam } from "./types";

export interface ManageResult {
  /** The (possibly rebuilt) working history to carry forward. */
  entries: Entry[];
  /** The array to send to the model this turn. */
  ctx: MessageParam[];
  /** Present only on a turn that took a new batch of clearing. */
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
    log.warn("context.summarize.retry", { error: String(err) });
    try {
      return await summarize(...args);
    } catch (err2) {
      log.error("context.summarize.failed", { error: String(err2) });
      return null;
    }
  }
}

/**
 * Bound the model-facing context for one turn. Runs before each model call.
 *
 * Two mechanisms, cheapest first:
 *
 *   1. **Clearing** (context/clearing.ts) — old, re-fetchable tool results are
 *      replaced with one-line placeholders. The full `entries` are untouched;
 *      what is cleared is recorded in `opts.clearing`, which the caller keeps
 *      for the whole run. Decisions already in it are applied on every turn,
 *      and a new batch is taken only when the context passes the compaction
 *      mark — and then enough to bring it down to the target, so the prefix the
 *      provider has cached changes once per batch instead of once per turn.
 *   2. **Summarization** — persistent: it rebuilds `entries`, and the caller
 *      must write a checkpoint. Only if clearing was not enough.
 */
export async function manageContext(
  entries: Entry[],
  opts: {
    model: string;
    calibration: TokenCalibration;
    clearing: ClearingState;
  },
): Promise<ManageResult> {
  const budget = contextBudgetForModel(opts.model);
  const estimate = (m: MessageParam[]) =>
    estimateTokensCalibrated(m, opts.calibration);

  const raw = entries.map((e) => e.param);
  let ctx = applyClearing(raw, opts.clearing);
  const before = estimate(ctx);

  // 1. Take a batch once past the compaction mark.
  let compacted: ManageResult["compacted"];
  if (before > CONTEXT_COMPACT_RATIO * budget) {
    // The planner keeps a running total as it clears; this converts the
    // characters it frees into the calibrated tokens the thresholds are in.
    const uncalibrated = estimateTokens(ctx);
    const calibrationFactor = uncalibrated > 0 ? before / uncalibrated : 1;
    const added = planClearing(raw, opts.clearing, {
      tokensNow: before,
      targetTokens: CONTEXT_CLEAR_TARGET_RATIO * budget,
      tokensPerChar: calibrationFactor / 4,
      maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
    });
    if (added > 0) {
      ctx = applyClearing(raw, opts.clearing);
      compacted = { tokensBefore: before, tokensAfter: estimate(ctx) };
    }
  }

  // 2. Summarization (persistent) if still over the high-water mark.
  let summarized: SummarizeResult | undefined;
  let outEntries = entries;
  if (estimate(ctx) > CONTEXT_SUMMARIZE_RATIO * budget) {
    // Summarization makes a live LLM call, so it can fail transiently. It must
    // never take the whole job down with it — a summarize failure just means we
    // proceed with the (already cleared) ctx for this turn and try again next
    // turn. Retry once before giving up.
    const res = await summarizeWithRetry(entries, {
      model: opts.model,
      keepTailTokens: CONTEXT_KEEP_TAIL_TOKENS,
      maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
    });
    if (res) {
      summarized = res;
      outEntries = res.entries;
      // The rebuilt history is the summary plus the recent tail. Whatever was
      // cleared in that tail stays cleared.
      ctx = applyClearing(
        outEntries.map((e) => e.param),
        opts.clearing,
      );
    }
  }

  return { entries: outEntries, ctx, compacted, summarized };
}
