import type { Request, Response, NextFunction } from "express";
import { env } from "../lib/env";
import { Errors } from "../lib/errors";

export function requireAdminKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const key = req.headers["x-admin-key"];
  if (!env.ADMIN_API_KEY || key !== env.ADMIN_API_KEY) {
    return next(Errors.forbidden("Admin access required"));
  }
  next();
}
