/**
 * The plain-`fetch` AI surface (`/ai/*`) that generated apps use.
 *
 * `/v1/*` speaks OpenAI so the SDK works. This speaks a small task-shaped JSON
 * dialect so an app needs nothing but `fetch` — no install step, no client
 * setup, no SDK version to track. Both go through the same validation, limits
 * and metering in `gateway.service.ts`.
 */
import type { Request, Response } from "express";
import {
  simpleChat,
  streamChatCompletion,
  toChatCompletionRequest,
  extractDisplayText,
} from "../services/gateway.service";
import { listModels } from "../lib/gatewayModels";
import { GatewayRequestError } from "../lib/gatewayErrors";
import { captureException, log } from "../lib/log";
import { env } from "../lib/env";

/**
 * Errors here are flat and readable, deliberately unlike `/v1`'s OpenAI
 * envelope: nothing is parsing these into typed exceptions, a human (or the
 * agent) is reading them out of a `fetch` response. `code` stays machine-usable
 * so an app can branch on running out of credits.
 */
function fail(res: Response, status: number, message: string, code: string): void {
  res.status(status).json({ error: message, code });
}

function projectOf(req: Request): string | null {
  const h = req.headers["x-tau-project"];
  return typeof h === "string" && h.length > 0 ? h : null;
}

function handleError(res: Response, err: unknown, where: string): void {
  if (err instanceof GatewayRequestError) {
    fail(res, err.status, err.body.message, err.body.code);
    return;
  }
  captureException(err, { detail: `ai ${where} failed` });
  fail(res, 500, "The tau AI service failed to handle this request.", "internal_error");
}

/** GET /ai/models */
export function models(_req: Request, res: Response): void {
  res.json({
    models: listModels().data.map((m) => ({
      id: m.id,
      description: m.description,
    })),
  });
}

/** POST /ai/chat — one prompt in, one string out. */
export async function chat(req: Request, res: Response): Promise<void> {
  const key = req.apiKey;
  if (!key) return fail(res, 401, "Invalid API key.", "invalid_api_key");

  try {
    const result = await simpleChat(key, req.body ?? {}, projectOf(req));
    res.setHeader("x-tau-request-id", result.requestId);
    res.json(result);
  } catch (err) {
    handleError(res, err, "chat");
  }
}

/**
 * POST /ai/chat/stream — server-sent events carrying plain text deltas.
 *
 * Intentionally NOT OpenAI's chunk format. An app consuming this wants the next
 * few characters to append to a bubble, and making it dig those out of
 * `choices[0].delta.content` (or `reasoning_content`, depending on the model)
 * would push a provider detail into every generated chat UI. Here each frame is
 * `{"text":"…"}` and the last is `{"done":true,"usage":{…}}`.
 */
export async function chatStream(req: Request, res: Response): Promise<void> {
  const key = req.apiKey;
  if (!key) return fail(res, 401, "Invalid API key.", "invalid_api_key");

  let handle;
  try {
    handle = await streamChatCompletion(
      key,
      toChatCompletionRequest(req.body ?? {}, true),
      projectOf(req),
    );
  } catch (err) {
    // Still before the first byte, so a real status code is still possible.
    handleError(res, err, "chat/stream");
    return;
  }

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "x-tau-request-id": handle.requestId,
  });
  res.flushHeaders();

  let aborted = false;
  const stop = (why: string): void => {
    if (aborted || res.writableEnded) return;
    aborted = true;
    log.info("ai.stream_aborting", { requestId: handle.requestId, why });
    handle.abort();
  };
  res.on("close", () => stop("res_close"));
  const wallClock = setTimeout(
    () => stop("wall_clock"),
    env.GATEWAY_STREAM_TIMEOUT_MS,
  );

  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for await (const chunk of handle.chunks) {
      if (res.socket?.destroyed) {
        stop("socket_destroyed");
        break;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
      // Display text only — never `reasoning_content`. Billing counts the
      // model's thinking (the generator handles that); a chat bubble must not
      // show it.
      const text = extractDisplayText(chunk);
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    if (!aborted) {
      res.write(
        `data: ${JSON.stringify({
          done: true,
          usage: { inputTokens, outputTokens },
        })}\n\n`,
      );
    }
  } catch (err) {
    if (!aborted) {
      captureException(err, {
        detail: "ai stream failed mid-flight",
        requestId: handle.requestId,
      });
      res.write(
        `data: ${JSON.stringify({
          error: "The stream ended early.",
          code: "upstream_error",
        })}\n\n`,
      );
    }
  } finally {
    clearTimeout(wallClock);
    if (!res.writableEnded) res.end();
  }
}
