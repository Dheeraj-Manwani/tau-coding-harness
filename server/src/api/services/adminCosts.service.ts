import { CREDIT_PACKS } from "./billing.service";
import {
  PRICING,
  PRO_MONTHLY_ALLOTMENT_MICRO,
  PRO_MONTHLY_PRICE_INR,
  toCredits,
} from "@/lib/pricing";

/**
 * Seed for the ops console's unit-economics calculator.
 *
 * What tau charges (plan price, credit packs, credits per million tokens) comes
 * from the live catalog, so the calculator can never disagree with billing.
 * What providers charge is a dated snapshot: there is no pricing API to read it
 * from, and the console lets an operator edit every rate in the browser anyway.
 */

/** Update together with the rates below. */
export const PROVIDER_PRICES_AS_OF = "2026-08-28";

const PROVIDER_RATES = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", cacheHitUsd: 0.014, inputUsd: 0.44, outputUsd: 1.32, note: "Peak rate" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", cacheHitUsd: 0.044, inputUsd: 1.32, outputUsd: 3.96, note: "Peak rate" },
  { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", cacheHitUsd: 0.19, inputUsd: 0.95, outputUsd: 4, note: "Published rate" },
  { id: "bytedance-seed/seedream-5-0-flash", label: "Seedream 5.0 Flash (pictures)", cacheHitUsd: 0, inputUsd: 0.44, outputUsd: 1.25, note: "Billed at $0.018 a picture" },
] as const;

export interface CostSeed {
  providerPricesAsOf: string;
  products: Array<{ id: string; label: string; grossInr: number; credits: number }>;
  models: Array<{
    id: string;
    label: string;
    note: string;
    cacheHitUsd: number;
    inputUsd: number;
    outputUsd: number;
    inputCreditsPerM: number;
    outputCreditsPerM: number;
  }>;
}

export function getCostSeed(): CostSeed {
  return {
    providerPricesAsOf: PROVIDER_PRICES_AS_OF,
    products: [
      {
        id: "pro",
        label: "PRO monthly",
        grossInr: PRO_MONTHLY_PRICE_INR,
        credits: toCredits(PRO_MONTHLY_ALLOTMENT_MICRO),
      },
      ...CREDIT_PACKS.map((pack) => ({
        id: pack.id,
        label: `${pack.credits.toLocaleString("en-IN")} credit pack`,
        grossInr: pack.amount / 100,
        credits: pack.credits,
      })),
    ],
    models: PROVIDER_RATES.map((provider) => {
      const pricing = PRICING[provider.id];
      if (!pricing) throw new Error(`Missing tau pricing for ${provider.id}`);
      return {
        ...provider,
        inputCreditsPerM: Number(pricing.inputPerM) / 1_000_000,
        outputCreditsPerM: Number(pricing.outputPerM) / 1_000_000,
      };
    }),
  };
}
