import type { Request, Response, NextFunction } from "express";
import { log } from "../lib/log";

/**
 * Query params that carry a credential. The SSE stream takes the access token
 * as `?token=` (EventSource can't send a header), and the OAuth callbacks
 * receive a one-time `code` and signed `state`. Logging `originalUrl` verbatim
 * wrote every one of them into the access log.
 */
const SECRET_PARAMS = /([?&](?:token|access_token|refresh_token|code|state)=)[^&#]*/gi;

/** `originalUrl` with credential-bearing query values replaced. */
export function redactUrl(url: string): string {
  return url.replace(SECRET_PARAMS, "$1[redacted]");
}

/**
 * One structured line per request. `userId` is included when the request was
 * authenticated, which is what makes an access log joinable against the job and
 * credit events emitted elsewhere — the whole point of the shared envelope.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    if (req.method === "OPTIONS") return;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    log.info("http.request", {
      method: req.method,
      path: redactUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      userId: (req as { user?: { id?: string } }).user?.id,
    });
  });

  next();
}
