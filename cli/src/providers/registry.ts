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
import {
  CatalogError,
  fetchRawCatalog,
  modelsForProvider,
  type CatalogOptions,
} from "./catalog.ts";

// Providers carry only static metadata; their model lists are loaded from
// models.dev at runtime via `ensureCatalog()`.
const MODULES: ProviderModule[] = [
  anthropicModule,
  openaiModule,
  deepseekModule,
  googleModule,
];

/**
 * Every registered provider. `models` starts empty and is filled in by
 * `ensureCatalog()`; consumers must await that before reading it.
 */
export const PROVIDERS: ProviderInfo[] = MODULES.map((m) => ({
  ...m.info,
  models: [],
}));

let catalogPromise: Promise<void> | undefined;

/**
 * Populate every provider's `models` from the live models.dev catalog. Runs at
 * most once per process (the result is memoized). Throws {@link CatalogError}
 * when the catalog can't be loaded (offline with no prior cache); callers
 * should surface that message. Call this before reading the catalog in any
 * command that lists or resolves models.
 */
export function ensureCatalog(opts?: CatalogOptions): Promise<void> {
  return (catalogPromise ??= hydrateCatalog(opts));
}

async function hydrateCatalog(opts?: CatalogOptions): Promise<void> {
  const raw = await fetchRawCatalog(opts);
  if (!raw) {
    throw new CatalogError(
      "Couldn't load the model catalog from models.dev. Check your internet connection and try again.",
    );
  }
  for (const provider of PROVIDERS) {
    provider.models = modelsForProvider(raw, provider.id);
  }
}

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

/** Default model for a provider — the newest one. Requires a loaded catalog. */
export function defaultModelFor(provider: ProviderInfo): ModelInfo {
  const model = provider.models[0];
  if (!model) {
    throw new CatalogError(`No models available for ${provider.name}.`);
  }
  return model;
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

export { CatalogError } from "./catalog.ts";
export type { ModelInfo, ProviderInfo } from "./types.ts";
