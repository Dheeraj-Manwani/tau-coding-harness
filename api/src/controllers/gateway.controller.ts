import type { Request, Response } from "express";
import {
  chatCompletion,
  projectIdFromHeader,
  streamChatCompletion,
} from "../services/gateway.service";
import { listModels } from "../lib/gatewayModels";
import { gatewayError, GatewayRequestError } from "../lib/gatewayErrors";
import { captureException, log } from "../lib/log";
import { env } from "../lib/env";

/** GET /v1/models — the alias catalog. */
export function models(_req: Request, res: Response): void {
  res.json(listModels());
}

/**
 * Drive a streaming completion over SSE, in OpenAI's wire format: one
 * `data: {chunk}` per line pair, terminated by `data: [DONE]`.
 *
 * **Once headers are flushed the status code is spent.** An error after that
 * point cannot become a 4xx, so it goes out as an SSE error frame — which is
 * what the OpenAI SDK parses mid-stream — rather than a silent truncation that
 * looks to the app like a normal short response.
 *
 * ── Client-disconnect detection does not work on Bun ────────────────────────
 *
 * We run Express on Bun's `node:http` compatibility layer. Measured on
 * bun 1.3.8, for a POST whose body has been consumed by `express.json()`, the
 * runtime gives us **no signal at all** when the client goes away mid-response:
 *
 *   res.on("close")        never fires
 *   res.writable           stays true
 *   res.socket.destroyed   stays false
 *   res.socket.writable    stays true
 *   res.write() return     stays true
 *   res.write(cb) error    never called
 *
 * The only things that do change are `req.destroyed` and `req.on("close")` —
 * and both fire when the **request body finishes parsing**, while the client is
 * still very much connected. Wiring the abort to those would tear down every
 * healthy stream a moment after it started, so they are deliberately unused.
 * (A GET with an unconsumed body *does* get the events; that is not this route.)
 *
 * What this costs, precisely: an abandoned stream keeps generating upstream
 * until it hits `max_tokens`, and we pay for it. It is **not** a correctness or
 * billing hole — the generator still meters exactly what upstream produced, so
 * nobody gets free inference. It is wasted spend, bounded by
 * `GATEWAY_MAX_OUTPUT_TOKENS` (4096 → ~0.016 credits per abandoned stream).
 *
 * The two mitigations that do work on Bun are the socket poll below (a no-op
 * here, correct on Node) and the wall-clock abort.
 */
async function streamCompletion(
  req: Request,
  res: Response,
  key: NonNullable<Request["apiKey"]>,
  projectId: string | null,
): Promise<void> {
  // Thrown before the first byte, so these still surface as real HTTP errors.
  const handle = await streamChatCompletion(key, req.body ?? {}, projectId);

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stop nginx/Render from buffering the stream into one lump — same reason
    // deploy/sse-route.ts sets it.
    "X-Accel-Buffering": "no",
    // No `x-tau-credits-remaining` here: the balance isn't known until after
    // the stream closes, and headers are long gone by then.
    "x-tau-request-id": handle.requestId,
  });
  res.flushHeaders();

  let closedByClient = false;
  const stopUpstream = (why: string): void => {
    if (closedByClient || res.writableEnded) return;
    closedByClient = true;
    log.info("gateway.stream_aborting", { requestId: handle.requestId, why });
    handle.abort();
  };

  // Correct on Node; never fires on Bun (see the note above `streamCompletion`).
  // Kept because it costs nothing and starts working the day the runtime does.
  res.on("close", () => stopUpstream("res_close"));

  // The runtime-independent backstop: a stream that runs absurdly long is
  // wedged, and `max_tokens` alone won't stop an upstream that has stalled
  // mid-generation. Same reasoning as EffortBudget.maxWallClockMs on the build
  // path — generous by design, this is a backstop and not a limit.
  const wallClock = setTimeout(
    () => stopUpstream("wall_clock"),
    env.GATEWAY_STREAM_TIMEOUT_MS,
  );

  try {
    for await (const chunk of handle.chunks) {
      // Poll for a dead socket. `destroyed` is never a false positive — on Bun
      // it simply never becomes true, so this is a no-op there and a prompt
      // abort on Node.
      if (res.socket?.destroyed) {
        stopUpstream("socket_destroyed");
        break;
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    if (!closedByClient) res.write("data: [DONE]\n\n");
  } catch (err) {
    if (closedByClient) {
      // Expected: our own abort unwinding. The generator has already metered.
      log.info("gateway.stream_client_closed", {
        requestId: handle.requestId,
        userId: key.userId,
      });
      return;
    }
    captureException(err, {
      detail: "gateway stream failed mid-flight",
      requestId: handle.requestId,
    });
    res.write(
      `data: ${JSON.stringify({
        error: {
          message: "The stream ended early because the model provider failed.",
          type: "api_error",
          code: "upstream_error",
        },
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
  } finally {
    clearTimeout(wallClock);
    if (!res.writableEnded) res.end();
  }
}

/** POST /v1/chat/completions */
export async function chatCompletions(
  req: Request,
  res: Response,
): Promise<void> {
  const key = req.apiKey;
  if (!key) {
    // Unreachable behind requireApiKey; asserted rather than assumed because
    // getting it wrong would mean serving unauthenticated inference.
    gatewayError(res, 401, {
      message: "Invalid API key.",
      type: "invalid_request_error",
      code: "invalid_api_key",
    });
    return;
  }

  // Attribution only, and spoofable — but only by the key's owner, whose own
  // credits are being spent either way.
  const projectId = projectIdFromHeader(req.headers["x-tau-project"]);

  try {
    if (req.body?.stream === true) {
      await streamCompletion(req, res, key, projectId);
      return;
    }

    const outcome = await chatCompletion(key, req.body ?? {}, projectId);
    res.setHeader("x-tau-request-id", outcome.requestId);
    res.setHeader("x-tau-credits-remaining", String(outcome.creditsRemaining));
    res.json(outcome.payload);
  } catch (err) {
    if (err instanceof GatewayRequestError) {
      log.info("gateway.rejected", {
        userId: key.userId,
        apiKeyId: key.id,
        status: err.status,
        code: err.body.code,
      });
      gatewayError(res, err.status, err.body);
      return;
    }
    captureException(err, { detail: "gateway chat completion failed" });
    gatewayError(res, 500, {
      message: "The tau gateway failed to handle this request.",
      type: "api_error",
      code: "internal_error",
    });
  }
}
