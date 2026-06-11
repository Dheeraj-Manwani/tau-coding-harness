import type { Credential } from "../config/store.ts";
import type { ClientOptions, ProviderClient, ProviderModule } from "./types.ts";
import { createOpenAICompatibleClient } from "./openai-compatible.ts";

const BASE_URL = "https://api.deepseek.com";

export const deepseekModule: ProviderModule = {
  info: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: BASE_URL,
  },

  createClient(cred: Credential, opts?: ClientOptions): ProviderClient {
    return createOpenAICompatibleClient({ baseURL: BASE_URL }, cred, opts);
  },
};
