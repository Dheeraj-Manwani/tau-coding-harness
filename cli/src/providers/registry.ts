/**
 * Static catalog of providers and the models tau knows how to talk to.
 *
 * Two wire protocols are supported:
 *  - "anthropic"  -> POST {baseUrl}/v1/messages   (Claude native)
 *  - "openai"     -> POST {baseUrl}/chat/completions (OpenAI-compatible)
 *
 * Most third-party providers (DeepSeek, Google's compat endpoint, ...)
 * speak the OpenAI protocol, so a single client covers all of them.
 */

export type Protocol = "anthropic" | "openai";

export interface ModelInfo {
  /** Wire id sent to the provider. */
  id: string;
  /** Human friendly label for menus. */
  name: string;
  /** Context window in tokens, for display only. */
  context?: number;
  /** Marks the recommended default model for the provider. */
  recommended?: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  /** Alternate names that resolve to this provider (e.g. "gemini" -> google). */
  aliases?: string[];
  models: ModelInfo[];
}

// TODO: the providers will come from our own api endpoint which will keep refreshing after some time
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    aliases: ["claude"],
    models: [
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        context: 1_000_000,
        recommended: true,
      },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7", context: 1_000_000 },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6", context: 1_000_000 },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1_000_000,
      },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", context: 200_000 },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o", context: 128_000, recommended: true },
      { id: "gpt-4o-mini", name: "GPT-4o mini", context: 128_000 },
      { id: "o3", name: "o3", context: 200_000 },
      { id: "o4-mini", name: "o4-mini", context: 200_000 },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek-V3 (chat)",
        context: 64_000,
        recommended: true,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek-R1 (reasoner)",
        context: 64_000,
      },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    aliases: ["gemini", "google-gemini"],
    models: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        context: 1_000_000,
        recommended: true,
      },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1_000_000 },
    ],
  },
];

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
