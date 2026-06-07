import type { Credential } from "../config/store.ts";
import type { ClientOptions, ProviderClient, ProviderModule } from "./types.ts";
import { createOpenAICompatibleClient } from "./openai-compatible.ts";

const BASE_URL = "https://api.deepseek.com";

export const deepseekModule: ProviderModule = {
  info: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: BASE_URL,
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek-V3 (chat)",
        context: 64_000,
        recommended: true,
      },
      { id: "deepseek-reasoner", name: "DeepSeek-R1 (reasoner)", context: 64_000 },
    ],
  },

  createClient(cred: Credential, opts?: ClientOptions): ProviderClient {
    return createOpenAICompatibleClient({ baseURL: BASE_URL }, cred, opts);
  },
};
