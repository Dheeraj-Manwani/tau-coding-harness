import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/tokens";
import { Errors } from "../lib/errors";

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractBearerToken(req);
  if (!token) {
    return next(Errors.unauthorized("Authentication required"));
  }
  try {
    const payload = verifyAccessToken(token); // throws AppError(401) on failure
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
}

export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractBearerToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
  } catch {}
  next();
}
