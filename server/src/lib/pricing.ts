/**
 * Credit pricing, shared by `api` and `worker-service`.
 *
 * This file used to exist twice, byte-identical, in each service's `lib/`.
 * Both `lib/pricing.ts` files are now one-line re-exports of this one.
 */

/**
 * Mirrors `enum Effort` in prisma/schema.prisma.
 *
 * Declared locally rather than imported from a generated client on purpose:
 * each service generates its own client into its own `node_modules`, and CI
 * installs them in separate jobs, so a shared module that reached into either
 * one would fail to typecheck in the other's job. The generated type is
 * `(typeof Effort)[keyof typeof Effort]` over a `const` object — i.e. exactly
 * this string union — so callers passing a generated `Effort` type-check
 * against this without a cast.
 *
 * Add a tier to the schema and the compiler will flag the gap here, because
 * `RESERVE_CEILING_BY_EFFORT` below is an exhaustive `Record`.
 */
export type Effort = "LOW" | "HIGH" | "MAX";

// 1 credit = 1_000_000 micro-credits.
export const MICRO = 1_000_000n;

// credits charged per 1M tokens, expressed in micro-credits, per model.
export const PRICING: Record<
  string,
  { inputPerM: bigint; outputPerM: bigint }
> = {
  "deepseek-chat": { inputPerM: 1_400_000_000n, outputPerM: 4_200_000_000n },
  "deepseek-v4-pro": {
    inputPerM: 1_400_000_000n,
    outputPerM: 4_200_000_000n,
  },
  "deepseek-v4-flash": {
    inputPerM: 450_000_000n,
    outputPerM: 1_400_000_000n,
  },
  "kimi-k2.7-code": {
    inputPerM: 1_000_000_000n,
    outputPerM: 4_000_000_000n,
  },
  "kimi-k2.6": {
    inputPerM: 1_000_000_000n,
    outputPerM: 4_000_000_000n,
  },
};

const DEFAULT_PRICE = {
  inputPerM: 1_400_000_000n,
  outputPerM: 4_200_000_000n,
};

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
export const FREE_SIGNUP_GRANT_MICRO = 200n * MICRO; // one-time free grant at signup (never refilled)
export const PRO_MONTHLY_ALLOTMENT_MICRO = 5_000n * MICRO; // granted each PRO cycle
export const PRO_MONTHLY_PRICE_INR = 1_499;
export const JOB_RESERVE_CEILING_MICRO = 25_000n * MICRO; // legacy/default HIGH ceiling
export const MIN_SPEND_TO_START_MICRO = 1n * MICRO; // refuse a job below this available

// Max concurrent projects a FREE-plan user may own (PRO is unlimited).
export const FREE_PLAN_MAX_PROJECTS = 3;

export const RESERVE_CEILING_BY_EFFORT: Record<Effort, bigint> = {
  LOW: 5_000n * MICRO,
  HIGH: 25_000n * MICRO,
  MAX: 50_000n * MICRO,
};

export function reserveCeilingForEffort(effort: Effort): bigint {
  return RESERVE_CEILING_BY_EFFORT[effort];
}

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
