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

/**
 * The two surfaces report errors differently — `/v1` in OpenAI's envelope so the
 * SDK can type them, `/ai` flat so a `fetch` caller can read `data.error` as a
 * string. Auth failures have to follow the same rule as every other error on
 * their surface, or an app that handles `data.error` correctly everywhere else
 * gets an object exactly when its key is wrong.
 */
export type ErrorDialect = "openai" | "simple";

function deny(
  res: Response,
  dialect: ErrorDialect,
  status: number,
  message: string,
  code: string,
  type: "invalid_request_error" | "api_error" = "invalid_request_error",
): void {
  if (dialect === "simple") {
    res.status(status).json({ error: message, code });
    return;
  }
  gatewayError(res, status, { message, type, code });
}

export function apiKeyAuth(dialect: ErrorDialect) {
  return async function requireApiKeyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const presented = extractKey(req);
    if (!presented) {
      deny(
        res,
        dialect,
        401,
        "No API key provided. Pass it as `Authorization: Bearer tau_sk_live_…`.",
        "missing_api_key",
      );
      return;
    }

    let verified;
    try {
      verified = await verifyApiKey(presented);
    } catch (err) {
      captureException(err, { detail: "gateway key verification failed" });
      deny(
        res,
        dialect,
        500,
        "Could not verify the API key.",
        "internal_error",
        "api_error",
      );
      return;
    }

    if (!verified) {
      // One message for unknown, revoked, and expired-grace keys alike: which of
      // those a key is is not information an unauthenticated caller should get.
      deny(res, dialect, 401, "Invalid API key.", "invalid_api_key");
      return;
    }

    req.apiKey = verified.record;

    // Best-effort and throttled — a profile timestamp is never worth failing a
    // request over.
    void touchApiKey(verified.record).catch(() => {});

    next();
  };
}

/** `/v1` — OpenAI-shaped errors. */
export const requireApiKey = apiKeyAuth("openai");
/** `/ai` — flat `{ error, code }` errors. */
export const requireApiKeySimple = apiKeyAuth("simple");
