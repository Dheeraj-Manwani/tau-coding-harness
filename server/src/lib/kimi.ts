import OpenAI from "openai";
import { env } from "@/lib/env";
import { deepseek, LLM_MAX_RETRIES, LLM_REQUEST_TIMEOUT_MS } from "@/lib/deepseek";

export const kimi = env.KIMI_API_KEY
  ? new OpenAI({
      apiKey: env.KIMI_API_KEY,
      baseURL: env.KIMI_BASE_URL,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    })
  : null;

export function isKimiModel(model: string): boolean {
  return model.startsWith("kimi-") || model.startsWith("moonshot-");
}

export function clientForModel(model: string): OpenAI {
  if (isKimiModel(model) && kimi) return kimi;
  return deepseek;
}
