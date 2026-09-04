import { describe, expect, test } from "bun:test";
import {
  costMicro,
  spendBuckets,
  MICRO,
  FREE_SIGNUP_GRANT_MICRO,
  JOB_RESERVE_CEILING_MICRO,
  PRO_MONTHLY_PRICE_INR,
} from "@/lib/pricing.ts";

// ── Drift guard ────────────────────────────────────────────────────────────────
// This file is duplicated verbatim in api/ and worker-service/. The vectors below
// pin the money math; if the two copies of pricing.ts diverge, one service's
// suite breaks. Keep both copies of this file identical too.

describe("costMicro", () => {
  test("deepseek-chat input rate: 1,400 credits / 1M input tokens", () => {
    expect(costMicro("deepseek-chat", 1_000_000, 0)).toBe(1_400_000_000n);
  });

  test("deepseek-chat output rate: 4,200 credits / 1M output tokens", () => {
    expect(costMicro("deepseek-chat", 0, 1_000_000)).toBe(4_200_000_000n);
  });

  test("mixed input + output", () => {
    // 500k input = 700 credits; 250k output = 1,050 credits.
    expect(costMicro("deepseek-chat", 500_000, 250_000)).toBe(1_750_000_000n);
  });

  test("unknown model falls back to default price", () => {
    expect(costMicro("some-future-model", 1_000_000, 0)).toBe(1_400_000_000n);
  });

  test("clamps negative and truncates fractional token counts", () => {
    expect(costMicro("deepseek-chat", -5, 1.9)).toBe(4_200n);
  });

  test("zero usage costs nothing", () => {
    expect(costMicro("deepseek-chat", 0, 0)).toBe(0n);
  });
});

describe("spendBuckets — free → plan → bonus order", () => {
  const start = { free: 10n, plan: 10n, bonus: 10n };

  test("spends free first", () => {
    const r = spendBuckets(start, 5n);
    expect(r.buckets).toEqual({ free: 5n, plan: 10n, bonus: 10n });
    expect(r.debited).toBe(5n);
    expect(r.remaining).toBe(0n);
  });

  test("overflows free into plan", () => {
    const r = spendBuckets(start, 15n);
    expect(r.buckets).toEqual({ free: 0n, plan: 5n, bonus: 10n });
    expect(r.debited).toBe(15n);
  });

  test("drains all three then reports remainder", () => {
    const r = spendBuckets(start, 35n);
    expect(r.buckets).toEqual({ free: 0n, plan: 0n, bonus: 0n });
    expect(r.debited).toBe(30n);
    expect(r.remaining).toBe(5n);
  });

  test("zero amount is a no-op", () => {
    const r = spendBuckets(start, 0n);
    expect(r.buckets).toEqual(start);
    expect(r.debited).toBe(0n);
  });
});

describe("constants", () => {
  test("micro unit and allotments are the agreed values", () => {
    expect(MICRO).toBe(1_000_000n);
    expect(FREE_SIGNUP_GRANT_MICRO).toBe(200_000_000n);
    expect(PRO_MONTHLY_PRICE_INR).toBe(1_499);
    expect(JOB_RESERVE_CEILING_MICRO).toBe(25_000_000_000n);
  });
});
