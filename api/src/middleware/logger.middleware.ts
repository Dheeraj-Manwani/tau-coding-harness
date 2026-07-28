import type { Request, Response, NextFunction } from "express";
import { log } from "../lib/log";

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
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      userId: (req as { user?: { id?: string } }).user?.id,
    });
  });

  next();
}
