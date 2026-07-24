import OpenAI from "openai";
import { env } from "./env";
import { deepseek } from "./deepseek";

export const kimi = env.KIMI_API_KEY
  ? new OpenAI({ apiKey: env.KIMI_API_KEY, baseURL: env.KIMI_BASE_URL })
  : null;

export function isKimiModel(model: string): boolean {
  return model.startsWith("kimi-") || model.startsWith("moonshot-");
}

export function clientForModel(model: string): OpenAI {
  if (isKimiModel(model) && kimi) return kimi;
  return deepseek;
}
