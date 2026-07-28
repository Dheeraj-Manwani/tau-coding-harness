import OpenAI from "openai";
import { env } from "./env";

/**
 * Per-request ceiling. Left to the SDK default (10 min) a provider that accepts
 * the connection and then goes quiet parks the agent loop indefinitely, holding
 * the job at RUNNING and the user's shimmer on screen with nothing to show for
 * it (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.6). A long generation turn is
 * comfortably inside this; a stalled socket is not.
 */
export const LLM_REQUEST_TIMEOUT_MS = 4 * 60_000;
export const LLM_MAX_RETRIES = 2;

export const deepseek = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
  timeout: LLM_REQUEST_TIMEOUT_MS,
  maxRetries: LLM_MAX_RETRIES,
});
