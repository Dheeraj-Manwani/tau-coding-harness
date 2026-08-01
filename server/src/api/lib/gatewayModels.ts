/**
 * The model catalog the `/v1` gateway exposes to generated apps.
 *
 * Apps ask for an **alias** (`tau-fast`), never a vendor model id. The
 * indirection is the point: a deployed app bakes whatever string it was given
 * into its source, so exposing `deepseek-v4-flash` directly would mean every
 * app breaks the day tau changes provider. Aliases let the mapping move.
 *
 * Allowlist-only — an unknown model is a 400, not a silent passthrough.
 */
import { deepseekGateway } from "@/lib/deepseek";
import { kimi } from "@/lib/kimi";
import { env } from "@/lib/env";
import type OpenAI from "openai";

export const MODEL_ALIASES = ["tau-fast", "tau-smart", "tau-max"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const DEFAULT_ALIAS: ModelAlias = "tau-fast";

interface AliasEntry {
  /** Human description, surfaced by GET /v1/models. */
  description: string;
  /** Which upstream client serves it. */
  provider: "deepseek" | "kimi";
  /** Resolved at call time from env, so it tracks the build-path config. */
  model: () => string;
}

const ALIASES: Record<ModelAlias, AliasEntry> = {
  "tau-fast": {
    description: "Fastest and cheapest. Good default for most app features.",
    provider: "deepseek",
    model: () => env.DEEPSEEK_MODEL_FLASH,
  },
  "tau-smart": {
    description: "Stronger reasoning at a higher per-token cost.",
    provider: "deepseek",
    model: () => env.DEEPSEEK_MODEL,
  },
  "tau-max": {
    description: "Most capable. Falls back to tau-smart when unconfigured.",
    provider: "kimi",
    model: () => env.KIMI_MODEL_MAX,
  },
};

export function isModelAlias(value: unknown): value is ModelAlias {
  return (
    typeof value === "string" &&
    (MODEL_ALIASES as readonly string[]).includes(value)
  );
}

export interface ResolvedModel {
  alias: ModelAlias;
  /** The upstream model id — also the `PRICING` key, so cost is exact. */
  model: string;
  client: OpenAI;
}

/**
 * Map an alias to a live client + upstream model.
 *
 * `tau-max` degrades to the Deepseek model when `KIMI_API_KEY` is absent,
 * mirroring `modelForEffort()` on the build path: a missing key should downgrade
 * the top tier, not fail every request booked into it. Cost is metered on the
 * model actually called, so a degraded request is billed at the lower rate.
 */
export function resolveModel(alias: ModelAlias): ResolvedModel | null {
  const entry = ALIASES[alias];

  if (entry.provider === "kimi") {
    if (kimi) return { alias, model: entry.model(), client: kimi };
    if (deepseekGateway) {
      return { alias, model: env.DEEPSEEK_MODEL, client: deepseekGateway };
    }
    return null;
  }

  if (!deepseekGateway) return null;
  return { alias, model: entry.model(), client: deepseekGateway };
}

/** The OpenAI `GET /v1/models` payload shape. */
export function listModels(): {
  object: "list";
  data: { id: string; object: "model"; owned_by: string; description: string }[];
} {
  return {
    object: "list",
    data: MODEL_ALIASES.map((id) => ({
      id,
      object: "model" as const,
      owned_by: "tau",
      description: ALIASES[id].description,
    })),
  };
}
