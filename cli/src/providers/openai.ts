import type { Credential } from "../config/store.ts";
import type { ClientOptions, ProviderClient, ProviderModule } from "./types.ts";
import { createOpenAICompatibleClient } from "./openai-compatible.ts";

const BASE_URL = "https://api.openai.com/v1";

export const openaiModule: ProviderModule = {
  info: {
    id: "openai",
    name: "OpenAI",
    baseUrl: BASE_URL,
  },

  createClient(cred: Credential, opts?: ClientOptions): ProviderClient {
    // The o-series rejects `max_tokens` and requires `max_completion_tokens`.
    return createOpenAICompatibleClient(
      { baseURL: BASE_URL, maxTokensParam: "max_completion_tokens" },
      cred,
      opts,
    );
  },
};
