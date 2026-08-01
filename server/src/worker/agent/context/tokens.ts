import type OpenAI from "openai";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Cheap token estimator. We don't need exact tokenization to drive thresholds —
 * a chars/4 heuristic plus a small per-message framing overhead is close enough
 * and dependency-free, especially once corrected by `recalibrate` against the
 * model's real `usage.prompt_tokens` after each turn.
 */
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

function textLen(content: MessageParam["content"]): number {
  if (content == null) return 0;
  if (typeof content === "string") return content.length;
  // Array content (e.g. user content parts) or anything structured.
  return JSON.stringify(content).length;
}

export function estimateMessageTokens(m: MessageParam): number {
  let len = textLen(m.content);
  if ("tool_calls" in m && m.tool_calls) {
    len += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(len / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD;
}

export function estimateTokens(messages: MessageParam[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

/** Estimate tokens for arbitrary non-message text (e.g. a tool schema blob). */
export function estimateStringTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

/** Convert a token count to an approximate character budget. */
export function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

// ── Self-correcting calibration ──────────────────────────────────────────────
// The chars/4 heuristic drifts from the model's real tokenizer depending on
// content mix (dense code vs. prose, JSON-heavy tool output, etc). Each turn
// the loop knows the *actual* prompt token count from `usage.prompt_tokens` —
// this folds that ground truth back in as a multiplicative correction, so the
// threshold checks in `manager.ts` track reality instead of a fixed guess.

const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 2;
/** Weight given to each new sample in the running correction (EMA). Low enough
 *  that one unusual turn (e.g. a huge one-off tool result) can't whipsaw it. */
const CALIBRATION_SMOOTHING = 0.3;

export interface TokenCalibration {
  factor: number;
}

/** Fresh, neutral calibration — scoped per job. Drift comes from this job's
 *  own content mix, so it isn't worth carrying across jobs or projects. */
export function createCalibration(): TokenCalibration {
  return { factor: 1 };
}

/**
 * Fold one real `usage.prompt_tokens` reading back into the calibration
 * factor. `rawEstimate` must be `estimateTokens()` (uncalibrated) for the
 * exact same payload that produced `actualTokens`.
 */
export function recalibrate(
  cal: TokenCalibration,
  rawEstimate: number,
  actualTokens: number,
): void {
  if (rawEstimate <= 0 || actualTokens <= 0) return;
  const sample = Math.min(
    CALIBRATION_MAX,
    Math.max(CALIBRATION_MIN, actualTokens / rawEstimate),
  );
  cal.factor += CALIBRATION_SMOOTHING * (sample - cal.factor);
}

/** `estimateTokens`, corrected by the running calibration factor. */
export function estimateTokensCalibrated(
  messages: MessageParam[],
  cal: TokenCalibration,
): number {
  return Math.ceil(estimateTokens(messages) * cal.factor);
}
