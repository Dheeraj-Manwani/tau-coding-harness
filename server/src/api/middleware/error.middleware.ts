import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { captureException } from "../lib/log";
import { redactUrl } from "./logger.middleware";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  captureException(err, {
    method: req.method,
    path: redactUrl(req.originalUrl),
    userId: (req as { user?: { id?: string } }).user?.id,
  });
  res.status(500).json({ error: "Internal server error" });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}
