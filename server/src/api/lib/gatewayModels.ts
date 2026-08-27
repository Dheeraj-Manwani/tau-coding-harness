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
import { env } from "@/lib/env";
import type OpenAI from "openai";

export const MODEL_ALIASES = ["tau-fast", "tau-smart", "tau-max"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const DEFAULT_ALIAS: ModelAlias = "tau-fast";

interface AliasEntry {
  /** Human description, surfaced by GET /v1/models. */
  description: string;
  /** Resolved at call time from env, so it tracks the build-path config. */
  model: () => string;
}

const ALIASES: Record<ModelAlias, AliasEntry> = {
  "tau-fast": {
    description: "Fastest and cheapest. Good default for most app features.",
    model: () => env.DEEPSEEK_MODEL_FLASH,
  },
  "tau-smart": {
    description: "Stronger reasoning at a higher per-token cost.",
    model: () => env.DEEPSEEK_MODEL,
  },
  "tau-max": {
    description: "DeepSeek Pro compatibility alias for Max-tier app features.",
    model: () => env.DEEPSEEK_MODEL,
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
 * All public aliases currently use DeepSeek. `tau-max` mirrors the build path:
 * it uses the pro model and is differentiated there by a larger agent budget.
 */
export function resolveModel(alias: ModelAlias): ResolvedModel | null {
  const entry = ALIASES[alias];
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
