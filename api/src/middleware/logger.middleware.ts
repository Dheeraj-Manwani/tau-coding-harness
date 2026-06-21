import type { Request, Response, NextFunction } from "express";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const { method, originalUrl } = req;
    const { statusCode } = res;
    method !== "OPTIONS" &&
      console.log(
        `${new Date().toISOString()} ${method} ${originalUrl} ${statusCode} ${durationMs.toFixed(1)}ms`,
      );
  });

  next();
}
