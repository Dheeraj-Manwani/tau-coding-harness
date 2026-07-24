import OpenAI from "openai";
import { env } from "./env";

export const kimi = env.KIMI_API_KEY
  ? new OpenAI({ apiKey: env.KIMI_API_KEY, baseURL: env.KIMI_BASE_URL })
  : null;
