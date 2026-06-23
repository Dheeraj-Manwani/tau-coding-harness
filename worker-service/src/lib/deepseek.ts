import OpenAI from "openai";
import { env } from "./env";

export const deepseek = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
});
