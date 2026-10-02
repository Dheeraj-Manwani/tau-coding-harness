import type { Request, Response, NextFunction } from "express";
import { log } from "../lib/log";
import { normaliseRoute, recordRequest } from "@/lib/telemetry";
import { slugFromHost } from "@/lib/sites";

/**
 * The telemetry route key for a request. Two folds on top of path
 * normalisation keep the key space bounded by *our* routes rather than by what
 * the internet sends:
 *   - every published-site request is one key — their paths are the user's app;
 *   - every 404 is one key per method — scanners probe thousands of paths.
 */
export function telemetryRoute(req: Request, status: number): string {
  if (slugFromHost(req.headers.host)) return `${req.method} (published site)`;
  if (status === 404) return `${req.method} (not found)`;
  return normaliseRoute(req.method, req.originalUrl);
}

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
    recordRequest(telemetryRoute(req, res.statusCode), res.statusCode, durationMs);
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
