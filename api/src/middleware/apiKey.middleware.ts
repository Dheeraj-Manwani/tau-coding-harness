/**
 * Bearer-key authentication for the `/v1` gateway.
 *
 * Mounted before the global `requireAuth` (which expects a JWT), because
 * generated apps hold an API key, not a session. Errors are shaped like
 * OpenAI's so the client SDK surfaces them as real typed errors rather than an
 * opaque 500.
 */
import type { Request, Response, NextFunction } from "express";
import { touchApiKey, verifyApiKey } from "../lib/apiKeys";
import { gatewayError } from "../lib/gatewayErrors";
import { captureException } from "../lib/log";
import type { ApiKey } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
    }
  }
}

function extractKey(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const presented = extractKey(req);
  if (!presented) {
    gatewayError(res, 401, {
      message:
        "No API key provided. Pass it as `Authorization: Bearer tau_sk_live_…`.",
      type: "invalid_request_error",
      code: "missing_api_key",
    });
    return;
  }

  let verified;
  try {
    verified = await verifyApiKey(presented);
  } catch (err) {
    captureException(err, { detail: "gateway key verification failed" });
    gatewayError(res, 500, {
      message: "Could not verify the API key.",
      type: "api_error",
      code: "internal_error",
    });
    return;
  }

  if (!verified) {
    // One message for unknown, revoked, and expired-grace keys alike: which of
    // those a key is is not information an unauthenticated caller should get.
    gatewayError(res, 401, {
      message: "Invalid API key.",
      type: "invalid_request_error",
      code: "invalid_api_key",
    });
    return;
  }

  req.apiKey = verified.record;

  // Best-effort and throttled — a profile timestamp is never worth failing a
  // request over.
  void touchApiKey(verified.record).catch(() => {});

  next();
}
