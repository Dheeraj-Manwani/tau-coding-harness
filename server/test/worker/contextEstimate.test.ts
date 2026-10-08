import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import {
  createCalibration,
  estimateTokens,
  estimateTokensCalibrated,
  recalibrate,
} from "@/worker/agent/context/tokens";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// How big a context is is an estimate, corrected after each turn by what the
// provider actually counted. A request is its messages plus a fixed part, the
// tool schema, which does not shrink when the messages do. When that fixed part
// was folded into the correction, the estimate ran high just after a summary
// (doc/CONTEXT_AND_MEMORY_PLAN.md §9, C4). These model a provider whose count is
// exactly "messages at a ratio, plus the schema", and ask the estimate to follow.

const SCHEMA = 5_000;
/** The provider's tokenizer finds this many tokens for each the estimate does. */
const RATIO = 0.8;
const truth = (messages: Message[]) => Math.round(estimateTokens(messages) * RATIO + SCHEMA);

const messages = (chars: number): Message[] => [{ role: "user", content: "x".repeat(chars) }];

function calibrated(over: { fixed: number }, samples: Message[][]) {
  const cal = createCalibration(over.fixed);
  for (const m of samples) recalibrate(cal, estimateTokens(m), truth(m));
  return cal;
}

describe("the estimate of how big a request is", () => {
  const big = messages(300_000);
  const small = messages(8_000);

  test("learns the ratio from messages, whatever else the request carries", () => {
    const cal = calibrated({ fixed: SCHEMA }, [big, big, big, big, big, big]);
    expect(cal.factor).toBeCloseTo(RATIO, 1);
  });

  test("is right for a large context, and for a small one just after a summary", () => {
    const cal = calibrated({ fixed: SCHEMA }, [big, big, big, big, big, big]);
    for (const m of [big, small]) {
      const off = Math.abs(estimateTokensCalibrated(m, cal) - truth(m)) / truth(m);
      expect(off).toBeLessThan(0.03);
    }
  });

  test("folding the fixed part into the ratio, as before, is far out for the small one", () => {
    // The old arrangement: no fixed cost, and the schema added to what was compared.
    const old = createCalibration();
    for (let i = 0; i < 6; i++) recalibrate(old, estimateTokens(big) + SCHEMA, truth(big));
    const overshoot = estimateTokensCalibrated(small, old) / truth(small);
    // Not the point that it is wrong by a fixed amount, but that the new one is not.
    const cal = calibrated({ fixed: SCHEMA }, [big, big, big, big, big, big]);
    const now = estimateTokensCalibrated(small, cal) / truth(small);
    expect(Math.abs(now - 1)).toBeLessThan(Math.abs(overshoot - 1));
  });

  test("a request with nothing but the schema is the schema", () => {
    const cal = createCalibration(SCHEMA);
    expect(estimateTokensCalibrated([], cal)).toBe(SCHEMA);
  });

  test("a reading below the fixed cost teaches it nothing", () => {
    const cal = createCalibration(SCHEMA);
    recalibrate(cal, 1_000, SCHEMA - 10);
    recalibrate(cal, 0, 50_000);
    expect(cal.factor).toBe(1);
  });

  test("with no fixed cost it is the estimate it always was", () => {
    const cal = createCalibration();
    expect(estimateTokensCalibrated(small, cal)).toBe(estimateTokens(small));
    recalibrate(cal, 1_000, 1_500);
    expect(cal.factor).toBeGreaterThan(1);
  });
});
