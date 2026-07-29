import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, userFromRefreshToken } from "../lib/tokens";
import * as authRepository from "../repositories/auth.repository";
import { consumeHandoff } from "../services/github.service";
import { Errors } from "../lib/errors";

const REFRESH_COOKIE = "refresh_token";

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

/**
 * Authenticate a top-level browser navigation via the httpOnly refresh cookie
 * (scoped to /auth), since an <a href> can't carry an Authorization header. Used
 * to gate the "Connect GitHub" start route for an already-logged-in user. Does
 * NOT rotate the token — this is a read-only identity check.
 */
export async function requireRefreshAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return next(Errors.unauthorized("Authentication required"));
  try {
    const user = await userFromRefreshToken(raw);
    if (!user) return next(Errors.unauthorized("Authentication required"));
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Authenticate a top-level navigation from *either* client.
 *
 * Web arrives on a full-page navigation carrying the refresh cookie. Mobile
 * opens the same URL in an in-app browser tab, which carries no cookie at all,
 * and presents a one-shot `?handoff=` token instead (see
 * github.service.ts `signHandoff`). The cookie branch is untouched, so nothing
 * about the web flow changes.
 *
 * The handoff is checked first only because its presence is an explicit signal;
 * a request with neither credential fails exactly as it did before.
 */
export async function requireNavAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const handoff = req.query["handoff"];
  if (handoff === undefined) return requireRefreshAuth(req, res, next);

  try {
    // Burns the token even if what follows fails — a handoff that reached the
    // server has been exposed and must not be reusable either way.
    const userId = consumeHandoff(handoff);
    const user = await authRepository.findUserById(userId);
    if (!user) return next(Errors.unauthorized("Authentication required"));
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUserId(req: Request): string {
  if (!req.user) throw Errors.unauthorized("Authentication required");
  return req.user.id;
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
