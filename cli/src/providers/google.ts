import type { Credential } from "../config/store.ts";
import type { ClientOptions, ProviderClient, ProviderModule } from "./types.ts";
import { createOpenAICompatibleClient } from "./openai-compatible.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export const googleModule: ProviderModule = {
  info: {
    id: "google",
    name: "Google Gemini",
    baseUrl: BASE_URL,
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

  createClient(cred: Credential, opts?: ClientOptions): ProviderClient {
    return createOpenAICompatibleClient({ baseURL: BASE_URL }, cred, opts);
  },
};
