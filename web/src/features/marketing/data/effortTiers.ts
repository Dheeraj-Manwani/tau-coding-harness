import type { Effort } from "@/src/features/project/types";

/**
 * The effort tiers, as they actually run.
 *
 * Every figure below is copied from a constant in the tree, not from memory:
 *
 *   turns / subagentTurns / parallel / wallClock
 *     → `EFFORT_BUDGETS` in worker-service/src/agent/config.ts
 *   spendCap
 *     → `RESERVE_CEILING_BY_EFFORT` in api/src/lib/pricing.ts
 *   model
 *     → `modelForEffort` in worker-service/src/agent/config.ts, resolved
 *       through the env defaults DEEPSEEK_MODEL_FLASH / DEEPSEEK_MODEL in
 *       worker-service/src/lib/env.ts
 *
 * If a tier is retuned, change it there and mirror it here — a marketing page
 * quoting stale limits is a promise the product stops keeping.
 */

export interface EffortTier {
  effort: Effort;
  label: string;
  model: string;
  modelId: string;
  turns: number;
  subagentTurns: number;
  parallel: number;
  wallClockMinutes: number;
  /** Ceiling on what one build may spend, in credits. */
  spendCap: number;
  bestFor: string;
}

export const EFFORT_TIERS: EffortTier[] = [
  {
    effort: "LOW",
    label: "Low",
    model: "DeepSeek (flash)",
    modelId: "deepseek-v4-flash",
    turns: 80,
    subagentTurns: 20,
    parallel: 1,
    wallClockMinutes: 20,
    spendCap: 5000,
    bestFor: "Tweaks, single pages, copy changes",
  },
  {
    effort: "HIGH",
    label: "High",
    model: "DeepSeek (pro)",
    modelId: "deepseek-v4-pro",
    turns: 200,
    subagentTurns: 40,
    parallel: 3,
    wallClockMinutes: 45,
    spendCap: 25000,
    bestFor: "Most real apps",
  },
  {
    effort: "MAX",
    label: "Max",
    model: "DeepSeek (pro)",
    modelId: "deepseek-v4-pro",
    turns: 300,
    subagentTurns: 60,
    parallel: 5,
    wallClockMinutes: 90,
    spendCap: 50000,
    bestFor: 'Big multi-file builds, "make it actually work"',
  },
];

/** api/src/lib/pricing.ts — FREE_SIGNUP_GRANT_MICRO. */
export const FREE_SIGNUP_CREDITS = 200;
/** api/src/lib/pricing.ts — PRO_MONTHLY_ALLOTMENT_MICRO. */
export const PRO_MONTHLY_CREDITS = 5000;
/** api/src/lib/pricing.ts — FREE_PLAN_MAX_PROJECTS. */
export const FREE_MAX_PROJECTS = 3;
/** api/src/lib/pricing.ts — MIN_SPEND_TO_START_MICRO. */
export const MIN_CREDITS_TO_START = 1;
/** api/src/services/billing.service.ts — the PRO plan price. */
export const PRO_PRICE_INR = 1499;

/** api/src/services/billing.service.ts — CREDIT_PACKS. */
export const CREDIT_PACKS = [
  { credits: 100, inr: 49 },
  { credits: 500, inr: 199 },
  { credits: 2000, inr: 699 },
];
