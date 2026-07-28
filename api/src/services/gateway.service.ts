/**
 * The `/v1` gateway: OpenAI-compatible inference for tau-generated apps, billed
 * to the app owner's credits.
 *
 * Phase 2 is non-streaming only — `stream: true` is rejected with a clear
 * message rather than silently ignored, which would hand the SDK a response
 * shape it isn't expecting.
 *
 * See doc/AI_FOR_GENERATED_APPS.md §3.
 */
import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { env } from "../lib/env";
import { log } from "../lib/log";
import {
  gatewaySpentToday,
  getBalance,
  meterGateway,
  ensureBillingAccount,
} from "../lib/credits";
import { toCredits } from "../lib/pricing";
import { GatewayRequestError } from "../lib/gatewayErrors";
import {
  DEFAULT_ALIAS,
  isModelAlias,
  MODEL_ALIASES,
  resolveModel,
  type ResolvedModel,
} from "../lib/gatewayModels";
import type { ApiKey } from "../generated/prisma/client";

/** Per-key in-flight counter. One of the two bounds on the overshoot window. */
const inFlight = new Map<string, number>();

/** Per-key request timestamps for the RPM limit. In-memory, matching the rest
 *  of the economy build's single-process rate limiting. */
const recentRequests = new Map<string, number[]>();

function bad(message: string, code: string, param?: string): GatewayRequestError {
  return new GatewayRequestError(400, {
    message,
    type: "invalid_request_error",
    code,
    param,
  });
}

export interface ChatCompletionRequest {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  n?: unknown;
  stop?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
  seed?: unknown;
}

interface ValidatedRequest {
  resolved: ResolvedModel;
  body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
}

/**
 * Validate and normalize an incoming request.
 *
 * Notably this *clamps* `max_tokens` rather than rejecting an over-limit value:
 * the ceiling exists to bound cost, and failing a request outright over it
 * would be a worse experience than quietly capping it. Everything else that is
 * wrong is an error, because silently changing semantics is not acceptable.
 */
export function validateChatRequest(
  input: ChatCompletionRequest,
): ValidatedRequest {
  if (input.stream === true) {
    throw bad(
      "Streaming is not supported yet on the tau gateway. Omit `stream` or set it to false.",
      "stream_not_supported",
      "stream",
    );
  }

  const requested = input.model ?? DEFAULT_ALIAS;
  if (!isModelAlias(requested)) {
    throw bad(
      `Unknown model '${String(requested)}'. Available models: ${MODEL_ALIASES.join(", ")}.`,
      "model_not_found",
      "model",
    );
  }

  const resolved = resolveModel(requested);
  if (!resolved) {
    throw new GatewayRequestError(503, {
      message: `Model '${requested}' is temporarily unavailable.`,
      type: "api_error",
      code: "model_unavailable",
    });
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw bad(
      "`messages` must be a non-empty array.",
      "invalid_messages",
      "messages",
    );
  }

  // n > 1 multiplies output tokens against a cap sized for one completion, so
  // the cost bound would no longer hold.
  if (input.n !== undefined && input.n !== null && input.n !== 1) {
    throw bad(
      "`n` must be 1 on the tau gateway.",
      "invalid_n",
      "n",
    );
  }

  const askedFor =
    typeof input.max_completion_tokens === "number"
      ? input.max_completion_tokens
      : typeof input.max_tokens === "number"
        ? input.max_tokens
        : env.GATEWAY_MAX_OUTPUT_TOKENS;

  const maxTokens = Math.max(
    1,
    Math.min(Math.trunc(askedFor), env.GATEWAY_MAX_OUTPUT_TOKENS),
  );

  const body = {
    model: resolved.model,
    messages: input.messages,
    max_tokens: maxTokens,
    stream: false,
    ...(typeof input.temperature === "number"
      ? { temperature: input.temperature }
      : {}),
    ...(typeof input.top_p === "number" ? { top_p: input.top_p } : {}),
    ...(input.stop !== undefined ? { stop: input.stop } : {}),
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.tool_choice !== undefined
      ? { tool_choice: input.tool_choice }
      : {}),
    ...(input.response_format !== undefined
      ? { response_format: input.response_format }
      : {}),
    ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

  return { resolved, body };
}

/** The per-key daily ceiling, falling back to the global default. */
export function dailyCapFor(key: ApiKey): bigint {
  return key.dailyCapMicro ?? env.GATEWAY_DEFAULT_DAILY_CAP_MICRO;
}

/**
 * Everything that must hold before we spend money upstream.
 *
 * This is check-then-charge, so concurrent requests can each pass here before
 * any of them bills. That window is bounded, not eliminated, by three knobs:
 * `GATEWAY_MAX_OUTPUT_TOKENS` (cost per request), `GATEWAY_MAX_CONCURRENT`
 * (requests in flight per key) and `GATEWAY_RPM`. Worst case is a few credits
 * of unbilled usage, which `spendBuckets` absorbs by flooring at zero. The
 * alternative — a row lock on the account before every request — costs more
 * than it saves at this scale.
 */
export async function preflight(key: ApiKey): Promise<void> {
  const rpmWindow = Date.now() - 60_000;
  const stamps = (recentRequests.get(key.id) ?? []).filter((t) => t > rpmWindow);
  if (stamps.length >= env.GATEWAY_RPM) {
    throw new GatewayRequestError(429, {
      message: `Rate limit reached (${env.GATEWAY_RPM} requests/minute). Slow down and retry.`,
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
    });
  }
  stamps.push(Date.now());
  recentRequests.set(key.id, stamps);

  if ((inFlight.get(key.id) ?? 0) >= env.GATEWAY_MAX_CONCURRENT) {
    throw new GatewayRequestError(429, {
      message: `Too many concurrent requests (limit ${env.GATEWAY_MAX_CONCURRENT}). Retry shortly.`,
      type: "rate_limit_error",
      code: "concurrency_limit_exceeded",
    });
  }

  await ensureBillingAccount(key.userId);
  const balance = await getBalance(key.userId);
  if (balance.available < env.GATEWAY_MIN_BALANCE_MICRO) {
    throw new GatewayRequestError(402, {
      message:
        "The tau account behind this API key is out of credits. Top up at the tau billing page to restore AI features.",
      type: "insufficient_quota",
      code: "insufficient_credits",
    });
  }

  const cap = dailyCapFor(key);
  const spent = await gatewaySpentToday(key.id);
  if (spent >= cap) {
    throw new GatewayRequestError(429, {
      message: `Daily spend cap reached (${toCredits(cap)} credits). It resets at 00:00 UTC, or raise it in tau settings.`,
      type: "rate_limit_error",
      code: "daily_cap_exceeded",
    });
  }
}

export interface CompletionOutcome {
  requestId: string;
  /** The upstream response, passed through with the alias swapped back in. */
  payload: OpenAI.Chat.Completions.ChatCompletion;
  creditsRemaining: number;
}

/**
 * Run one chat completion: validate, pre-flight, proxy, meter.
 *
 * Metering happens after a successful upstream call, in a transaction that also
 * writes the `GatewayUsage` row. A failed upstream call is not billed — we have
 * no usage figures for it and the user got nothing.
 */
export async function chatCompletion(
  key: ApiKey,
  input: ChatCompletionRequest,
  projectId: string | null,
): Promise<CompletionOutcome> {
  const { resolved, body } = validateChatRequest(input);
  await preflight(key);

  const requestId = randomUUID();
  inFlight.set(key.id, (inFlight.get(key.id) ?? 0) + 1);

  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await resolved.client.chat.completions.create(body);
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status: unknown }).status)
        : 502;
    log.warn("gateway.upstream_failed", {
      requestId,
      userId: key.userId,
      alias: resolved.alias,
      model: resolved.model,
      status,
    });
    // Deliberately not billed: no usage figures, and nothing was delivered.
    throw new GatewayRequestError(status >= 400 && status < 600 ? status : 502, {
      message: "The upstream model provider failed to complete this request.",
      type: "api_error",
      code: "upstream_error",
    });
  } finally {
    const n = (inFlight.get(key.id) ?? 1) - 1;
    if (n <= 0) inFlight.delete(key.id);
    else inFlight.set(key.id, n);
  }

  const usage = completion.usage;
  const { available } = await meterGateway({
    userId: key.userId,
    apiKeyId: key.id,
    projectId,
    alias: resolved.alias,
    model: resolved.model,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    requestId,
    status: 200,
  });

  return {
    requestId,
    // Echo the alias, not the vendor model id. An app that logs or displays
    // `response.model` should see the name it asked for, and the indirection is
    // pointless if the real id leaks back out here.
    payload: { ...completion, model: resolved.alias },
    creditsRemaining: toCredits(available),
  };
}

/** Test seam: the in-memory limiter state is per-process and sticky. */
export function __resetGatewayLimiters(): void {
  inFlight.clear();
  recentRequests.clear();
}
