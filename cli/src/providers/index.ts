/**
 * Public surface of the providers layer.
 *
 * Consumers should import from here (or from `registry.ts` for the catalog /
 * `createClient`). Individual provider modules (anthropic.ts, openai.ts, …) are
 * internal and only need to be touched when adding or editing a provider.
 */
export {
  PROVIDERS,
  ensureCatalog,
  getProvider,
  getModel,
  defaultModelFor,
  findModel,
  createClient,
} from "./registry.ts";

export type {
  Message,
  ContentBlock,
  CompletionResult,
  ChatRequest,
  ModelInfo,
  ProviderInfo,
  ProviderClient,
  ProviderModule,
  ClientOptions,
} from "./types.ts";
