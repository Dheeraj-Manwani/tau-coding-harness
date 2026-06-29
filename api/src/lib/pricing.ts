// 1 credit = 1_000_000 micro-credits.
export const MICRO = 1_000_000n;

// credits charged per 1M tokens, expressed in micro-credits, per model.
export const PRICING: Record<
  string,
  { inputPerM: bigint; outputPerM: bigint }
> = {
  "deepseek-chat": { inputPerM: 2_000_000n, outputPerM: 8_000_000n },
};

const DEFAULT_PRICE = { inputPerM: 2_000_000n, outputPerM: 8_000_000n };

/** Cost in micro-credits for a single completion's token usage. */
export function costMicro(
  model: string,
  inputTokens: number,
  outputTokens: number,
): bigint {
  const p = PRICING[model] ?? DEFAULT_PRICE;
  const inTok = BigInt(Math.max(0, Math.trunc(inputTokens)));
  const outTok = BigInt(Math.max(0, Math.trunc(outputTokens)));
  // rate is micro-credits per 1M tokens → divide by 1M after multiplying.
  return (inTok * p.inputPerM + outTok * p.outputPerM) / 1_000_000n;
}

// ── Free tier / plan / reserve sizing (micro-credits) ──────────────────────────
export const FREE_DAILY_ALLOTMENT_MICRO = 50n * MICRO; // daily free bucket reset target
export const PRO_MONTHLY_ALLOTMENT_MICRO = 5_000n * MICRO; // granted each PRO cycle
export const JOB_RESERVE_CEILING_MICRO = 50n * MICRO; // max a single job may spend
export const MIN_SPEND_TO_START_MICRO = 1n * MICRO; // refuse a job below this available

// ── Bucket spend ───────────────────────────────────────────────────────────────
export interface Buckets {
  free: bigint;
  plan: bigint;
  bonus: bigint;
}

/**
 * Spend `amount` across buckets in cheapest-to-expire order (free → plan → bonus),
 * flooring each at 0. Pure: returns the resulting buckets, how much was actually
 * debited, and any remainder that exceeded the total balance.
 */
export function spendBuckets(
  b: Buckets,
  amount: bigint,
): { buckets: Buckets; debited: bigint; remaining: bigint } {
  let remaining = amount < 0n ? 0n : amount;
  const out: Buckets = { ...b };
  for (const key of ["free", "plan", "bonus"] as const) {
    if (remaining <= 0n) break;
    const take = out[key] < remaining ? out[key] : remaining;
    out[key] -= take;
    remaining -= take;
  }
  return { buckets: out, debited: amount - remaining, remaining };
}

/** micro-credits → display credits (number; lossy, for UI only). */
export function toCredits(micro: bigint): number {
  return Number(micro) / Number(MICRO);
}
