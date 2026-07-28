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
import { captureException, log } from "../lib/log";
import {
  gatewaySpentToday,
  getBalance,
  meterGateway,
  ensureBillingAccount,
} from "../lib/credits";
import { costMicro, toCredits } from "../lib/pricing";
import { GatewayRequestError } from "../lib/gatewayErrors";
import {
  DEFAULT_ALIAS,
  isModelAlias,
  MODEL_ALIASES,
  resolveModel,
  type ModelAlias,
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
  /** Whether the caller asked for SSE. The upstream body is built non-streaming
   *  either way; the streaming path overlays `stream` + `stream_options`. */
  stream: boolean;
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
  if (input.stream !== undefined && typeof input.stream !== "boolean") {
    throw bad("`stream` must be a boolean.", "invalid_stream", "stream");
  }
  const stream = input.stream === true;

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

  return { resolved, body, stream };
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

// ── Simple fetch surface (/ai) ───────────────────────────────────────────────

/**
 * The request shape a generated app posts with plain `fetch`.
 *
 * `/v1` mirrors OpenAI so the SDK works; this exists so an app doesn't need the
 * SDK at all. That matters more than it sounds: `bun add openai` is an install
 * step that can fail, a dependency to keep current, and ~10 lines of client
 * setup the agent has to get right. A `fetch` the model can write from memory
 * has none of those failure modes.
 *
 * Field names are camelCase and task-shaped (`prompt`, `maxTokens`) rather than
 * OpenAI's — this surface is not pretending to be OpenAI, and half-matching it
 * would be worse than not matching at all.
 */
export interface SimpleChatRequest {
  prompt?: unknown;
  system?: unknown;
  messages?: unknown;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  json?: unknown;
}

/**
 * Floor on `maxTokens` for the simple surface.
 *
 * The models behind `tau-*` are reasoning models: they emit into
 * `reasoning_content` first and only then produce the actual answer in
 * `content`. Ask for 30 tokens and the whole budget goes on reasoning, so the
 * response comes back `finish_reason: "length"` with `text: ""` — the caller
 * paid for tokens and got an empty string, which looks like a bug in their app.
 *
 * Raising a caller's explicit value is a real liberty, taken deliberately: it is
 * the same kind of adjustment as clamping the ceiling, and 256 output tokens is
 * a fraction of a credit. Getting an answer is what they asked for.
 */
const MIN_SIMPLE_MAX_TOKENS = 256;

export interface SimpleChatResponse {
  text: string;
  model: string;
  finishReason: string | null;
  /** True when the model ran out of room before finishing its answer. */
  truncated: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    creditsSpent: number;
    creditsRemaining: number;
  };
  requestId: string;
}

type OpenAIMessages =
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming["messages"];

/**
 * Map the simple shape onto the OpenAI one, so both surfaces converge on a
 * single validated body and there is exactly one place that decides what is
 * allowed, what gets clamped, and what gets billed.
 */
export function toChatCompletionRequest(
  input: SimpleChatRequest,
  stream: boolean,
): ChatCompletionRequest {
  const hasPrompt = typeof input.prompt === "string" && input.prompt.length > 0;
  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;

  if (!hasPrompt && !hasMessages) {
    throw bad(
      "Provide either `prompt` (a string) or `messages` (a non-empty array).",
      "missing_prompt",
      "prompt",
    );
  }
  if (hasPrompt && hasMessages) {
    throw bad(
      "Provide `prompt` or `messages`, not both.",
      "ambiguous_prompt",
      "prompt",
    );
  }
  if (input.system !== undefined && typeof input.system !== "string") {
    throw bad("`system` must be a string.", "invalid_system", "system");
  }

  const messages: OpenAIMessages = [];
  if (typeof input.system === "string" && input.system.length > 0) {
    messages.push({ role: "system", content: input.system });
  }
  if (hasPrompt) {
    messages.push({ role: "user", content: input.prompt as string });
  } else {
    messages.push(...(input.messages as OpenAIMessages));
  }

  return {
    model: input.model,
    messages,
    stream,
    ...(typeof input.maxTokens === "number"
      ? { max_tokens: Math.max(input.maxTokens, MIN_SIMPLE_MAX_TOKENS) }
      : {}),
    ...(typeof input.temperature === "number"
      ? { temperature: input.temperature }
      : {}),
    // A convenience flag rather than making apps know OpenAI's nested shape.
    ...(input.json === true
      ? { response_format: { type: "json_object" } }
      : {}),
  };
}

/** `POST /ai/chat` — one call, one string back. */
export async function simpleChat(
  key: ApiKey,
  input: SimpleChatRequest,
  projectId: string | null,
): Promise<SimpleChatResponse> {
  const outcome = await chatCompletion(
    key,
    toChatCompletionRequest(input, false),
    projectId,
  );

  const choice = outcome.payload.choices[0];
  const usage = outcome.payload.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;

  return {
    // Reasoning models leave `content` null and put their working in
    // `reasoning_content`. The app asked for an answer, so hand back the answer
    // and never the scratch work.
    text: choice?.message?.content ?? "",
    model: outcome.payload.model,
    finishReason: choice?.finish_reason ?? null,
    truncated: choice?.finish_reason === "length",
    usage: {
      inputTokens,
      outputTokens,
      creditsSpent: toCredits(
        costMicro(
          // The vendor id is the PRICING key; payload.model is the alias.
          resolveModel(outcome.payload.model as ModelAlias)?.model ??
            outcome.payload.model,
          inputTokens,
          outputTokens,
        ),
      ),
      creditsRemaining: outcome.creditsRemaining,
    },
    requestId: outcome.requestId,
  };
}

// ── Streaming ────────────────────────────────────────────────────────────────

/**
 * Fallback token estimate for a stream that ended without a usage chunk.
 *
 * Same chars/4 heuristic the worker's context manager uses. It is only ever
 * reached on the abnormal path (client hung up, or an upstream that ignores
 * `stream_options`), and the alternative is billing zero — which would make
 * "disconnect early" a free-inference exploit.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * All billable text a chunk contributed, for the fallback estimate.
 *
 * Must include `reasoning_content`. Reasoning models (Deepseek, Kimi) stream
 * their tokens there and leave `content` null for most of a response, but they
 * bill every one of them as a completion token. Counting only `content` made
 * the estimate 0 for precisely the requests that need it — long ones that got
 * abandoned partway.
 */
export function extractDeltaText(chunk: {
  choices?: { delta?: unknown }[] | null;
}): string {
  let out = "";
  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta as
      | { content?: unknown; reasoning_content?: unknown }
      | undefined;
    if (typeof delta?.content === "string") out += delta.content;
    if (typeof delta?.reasoning_content === "string") {
      out += delta.reasoning_content;
    }
  }
  return out;
}

/**
 * Only the text meant for a human — the answer, never the reasoning.
 *
 * The counterpart to {@link extractDeltaText}, and the distinction is not
 * cosmetic. `tau-*` are reasoning models: they stream their working into
 * `reasoning_content` before writing the answer into `content`. Billing must
 * count both (the provider charges for both). A chat bubble must show only
 * `content`, or the end user of a generated app watches the model think out
 * loud — "We need to count from 1 to 5…" — instead of seeing the answer.
 *
 * Mirrors the non-streaming path, which returns `message.content` alone.
 */
export function extractDisplayText(chunk: {
  choices?: { delta?: unknown }[] | null;
}): string {
  let out = "";
  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta as { content?: unknown } | undefined;
    if (typeof delta?.content === "string") out += delta.content;
  }
  return out;
}

function estimatePromptTokens(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): number {
  let chars = 0;
  for (const m of messages) {
    chars +=
      typeof m.content === "string"
        ? m.content.length
        : JSON.stringify(m.content ?? "").length;
    chars += 16; // per-message framing
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Status recorded on `GatewayUsage` when the client hung up mid-stream.
 *  499 is nginx's "client closed request" — it keeps those rows distinguishable
 *  from clean 200s when someone asks why a bill looks odd. */
const STATUS_CLIENT_CLOSED = 499;

export interface StreamHandle {
  requestId: string;
  alias: string;
  /** Yields chunks ready to serialize, with the vendor model id swapped out. */
  chunks: AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk>;
  /** Abort the upstream call — the generator's `finally` still meters. */
  abort: () => void;
}

/**
 * Start a streaming completion.
 *
 * Metering lives in the generator's `finally`, so it runs on every exit path:
 * clean completion, upstream error, and — the one that matters — the client
 * disconnecting mid-stream. A disconnected stream still cost real money
 * upstream, so dropping the charge would be a hole rather than a kindness.
 *
 * The caller drives the generator and owns the HTTP response; keeping `res` out
 * of here is what lets the whole path be tested without a socket.
 */
export async function streamChatCompletion(
  key: ApiKey,
  input: ChatCompletionRequest,
  projectId: string | null,
): Promise<StreamHandle> {
  const { resolved, body } = validateChatRequest(input);
  await preflight(key);

  const requestId = randomUUID();
  const controller = new AbortController();

  // Ask for the usage chunk. Without this the stream ends with no token counts
  // at all and every request would fall back to the estimate.
  const upstream = await resolved.client.chat.completions.create(
    {
      ...body,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal: controller.signal },
  );

  inFlight.set(key.id, (inFlight.get(key.id) ?? 0) + 1);

  async function* run(): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let emitted = "";
    let clean = false;

    try {
      for await (const chunk of upstream) {
        // The final `include_usage` chunk carries real counts and an empty
        // `choices` array. Prefer it over any estimate.
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
        emitted += extractDeltaText(chunk);
        // Echo the alias, never the vendor model id — same contract as the
        // non-streaming path, and it has to hold on every single chunk.
        yield { ...chunk, model: resolved.alias };
      }
      // Aborting the upstream fetch can end its iterator gracefully rather than
      // throwing, so "the loop finished" is not the same as "the stream
      // completed". Ask the controller, or an aborted run gets recorded as a
      // clean 200 and becomes invisible in the usage table.
      clean = !controller.signal.aborted;
    } finally {
      const n = (inFlight.get(key.id) ?? 1) - 1;
      if (n <= 0) inFlight.delete(key.id);
      else inFlight.set(key.id, n);

      const estimated = promptTokens === null || completionTokens === null;
      const inputTokens =
        promptTokens ?? estimatePromptTokens(body.messages ?? []);
      const outputTokens = completionTokens ?? estimateTokensFromText(emitted);

      if (estimated) {
        log.warn("gateway.stream_estimated", {
          requestId,
          userId: key.userId,
          alias: resolved.alias,
          clean,
          emittedChars: emitted.length,
          inputTokens,
          outputTokens,
        });
      }

      try {
        await meterGateway({
          userId: key.userId,
          apiKeyId: key.id,
          projectId,
          alias: resolved.alias,
          model: resolved.model,
          inputTokens,
          outputTokens,
          requestId,
          status: clean ? 200 : STATUS_CLIENT_CLOSED,
        });
      } catch (err) {
        // Never let a metering failure surface as a stream error — the user
        // already has their tokens. Loud, because it is money going unbilled.
        captureException(err, {
          detail: "gateway stream metering failed",
          requestId,
        });
      }
    }
  }

  return {
    requestId,
    alias: resolved.alias,
    chunks: run(),
    abort: () => controller.abort(),
  };
}

/** Test seam: the in-memory limiter state is per-process and sticky. */
export function __resetGatewayLimiters(): void {
  inFlight.clear();
  recentRequests.clear();
}

/** Test seam: current in-flight count for a key. */
export function __inFlightFor(keyId: string): number {
  return inFlight.get(keyId) ?? 0;
}
