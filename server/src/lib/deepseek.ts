import OpenAI from "openai";
import { env } from "@/lib/env";

/**
 * Deepseek clients, shared by the agent loop and the AI gateway.
 *
 * This file existed twice with genuinely different configuration, and the two
 * uses want different things — so the merged module exports both rather than
 * picking a winner.
 */

/**
 * Per-request ceiling. Left to the SDK default (10 min) a provider that accepts
 * the connection and then goes quiet parks the agent loop indefinitely, holding
 * the job at RUNNING and the user's shimmer on screen with nothing to show for
 * it (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.6). A long generation turn is
 * comfortably inside this; a stalled socket is not.
 */
export const LLM_REQUEST_TIMEOUT_MS = 4 * 60_000;
export const LLM_MAX_RETRIES = 2;

/** The agent loop's client — bounded, so a silent provider cannot park a job. */
export const deepseek = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
  timeout: LLM_REQUEST_TIMEOUT_MS,
  maxRetries: LLM_MAX_RETRIES,
});

/**
 * The `/v1` gateway's client — SDK defaults on purpose.
 *
 * The gateway proxies user-facing streams and already has its own wall-clock
 * backstop, `GATEWAY_STREAM_TIMEOUT_MS` (5 min). Applying the 4-minute
 * per-request timeout above would preempt that backstop and cut long streams
 * short, which is a behaviour change rather than a merge. Kept separate so the
 * two call sites keep the timeouts they were written against.
 */
export const deepseekGateway = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
});
