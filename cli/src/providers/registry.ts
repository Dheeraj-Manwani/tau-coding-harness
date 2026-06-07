/**
 * Provider registry: the single place that knows the full set of providers.
 *
 * Each provider lives in its own module exporting a `ProviderModule` (catalog
 * metadata + a `createClient` factory). To add a provider, create a new module
 * and add it to `MODULES` below — nothing else needs to change.
 *
 * Two wire protocols are covered today:
 *  - Anthropic native (`@anthropic-ai/sdk`)         -> see anthropic.ts
 *  - OpenAI `/chat/completions` (`openai` SDK)       -> see openai-compatible.ts
 *    (OpenAI, DeepSeek, Google's compat endpoint, …)
 */
import type { Credential } from "../config/store.ts";
import type {
  ClientOptions,
  ModelInfo,
  ProviderClient,
  ProviderInfo,
  ProviderModule,
} from "./types.ts";
import { anthropicModule } from "./anthropic.ts";
import { openaiModule } from "./openai.ts";
import { deepseekModule } from "./deepseek.ts";
import { googleModule } from "./google.ts";

// TODO: providers may eventually come from our own API endpoint that refreshes
// periodically; this static list is the bootstrap/fallback catalog.
const MODULES: ProviderModule[] = [
  anthropicModule,
  openaiModule,
  deepseekModule,
  googleModule,
];

/** Catalog metadata for every registered provider. */
export const PROVIDERS: ProviderInfo[] = MODULES.map((m) => m.info);

/**
 * Resolve a provider by its id, display name, or any registered alias.
 * Matching is case-insensitive so `Gemini`, `gemini`, and `google` all work.
 */
export function getProvider(id: string): ProviderInfo | undefined {
  const needle = id.trim().toLowerCase();
  return PROVIDERS.find(
    (p) =>
      p.id.toLowerCase() === needle ||
      p.name.toLowerCase() === needle ||
      p.aliases?.some((a) => a.toLowerCase() === needle),
  );
}

export function getModel(
  providerId: string,
  modelId: string,
): ModelInfo | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

/** Recommended (or first) model for a provider. */
export function defaultModelFor(provider: ProviderInfo): ModelInfo {
  return provider.models.find((m) => m.recommended) ?? provider.models[0]!;
}

/** Locate which provider owns a given model id (best-effort). */
export function findModel(
  modelId: string,
): { provider: ProviderInfo; model: ModelInfo } | undefined {
  for (const provider of PROVIDERS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return { provider, model };
  }
  return undefined;
}

/** Build a live, credential-bound client for the given provider. */
export function createClient(
  provider: ProviderInfo,
  cred: Credential,
  opts?: ClientOptions,
): ProviderClient {
  const mod = MODULES.find((m) => m.info.id === provider.id);
  if (!mod) {
    throw new Error(
      `No client implementation registered for provider: ${provider.id}`,
    );
  }
  return mod.createClient(cred, opts);
}

export type { ModelInfo, ProviderInfo } from "./types.ts";
