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
  },

  createClient(cred: Credential, opts?: ClientOptions): ProviderClient {
    return createOpenAICompatibleClient({ baseURL: BASE_URL }, cred, opts);
  },
};
