import type { Request, Response, NextFunction } from "express";
import * as githubService from "../services/github.service";
import { Errors } from "../lib/errors";
import { env } from "../lib/env";

/**
 * Only allow post-OAuth redirects back into our own app, so `return_to` can't be
 * turned into an open redirect. Falls back to APP_URL when absent/foreign.
 */
function safeReturnTo(raw: unknown): string {
  if (typeof raw === "string" && raw.startsWith(env.APP_URL)) return raw;
  return env.APP_URL;
}

/** GET /auth/github — start consent (gated by the refresh-cookie middleware). */
export function start(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    const returnTo = safeReturnTo(req.query["return_to"]);
    const state = githubService.signState(req.user.id, returnTo);
    res.redirect(githubService.buildAuthorizeUrl(state));
  } catch (err) {
    next(err);
  }
}

/** GET /auth/github/callback — GitHub redirects here with ?code&state. */
export async function callback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const state = req.query["state"];
  const code = req.query["code"];

  // Resolve the target first so we can bounce the browser back with an error
  // flag instead of dumping a JSON error page on a top-level navigation.
  let returnTo = env.APP_URL;
  try {
    if (typeof state !== "string") throw Errors.badRequest("Missing state");
    const resolved = githubService.verifyState(state);
    if (resolved.returnTo) returnTo = safeReturnTo(resolved.returnTo);

    if (typeof code !== "string") {
      // User denied consent, or GitHub returned an error.
      res.redirect(withParam(returnTo, "github", "denied"));
      return;
    }

    await githubService.linkFromCallback(resolved.userId, code);
    res.redirect(withParam(returnTo, "github", "connected"));
  } catch (err) {
    // Log the real cause; the browser only sees a generic error flag.
    console.error("[github] callback failed:", err);
    if (res.headersSent) return next(err);
    res.redirect(withParam(returnTo, "github", "error"));
  }
}

/** GET /auth/github/status — { connected, username }. Bearer-authenticated. */
export async function status(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    res.status(200).json(await githubService.getStatus(req.user.id));
  } catch (err) {
    next(err);
  }
}

/** DELETE /auth/github — disconnect. Bearer-authenticated. */
export async function disconnect(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    await githubService.disconnect(req.user.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** Append/replace a single query param on an absolute URL. */
function withParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}
