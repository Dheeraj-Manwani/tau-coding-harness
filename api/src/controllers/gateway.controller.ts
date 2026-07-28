import type { Request, Response } from "express";
import { chatCompletion } from "../services/gateway.service";
import { listModels } from "../lib/gatewayModels";
import { gatewayError, GatewayRequestError } from "../lib/gatewayErrors";
import { captureException, log } from "../lib/log";

/** GET /v1/models — the alias catalog. */
export function models(_req: Request, res: Response): void {
  res.json(listModels());
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
  const projectHeader = req.headers["x-tau-project"];
  const projectId =
    typeof projectHeader === "string" && projectHeader.length > 0
      ? projectHeader
      : null;

  try {
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
