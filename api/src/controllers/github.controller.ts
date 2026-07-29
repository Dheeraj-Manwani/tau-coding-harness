import type { Request, Response, NextFunction } from "express";
import * as githubService from "../services/github.service";
import { Errors } from "../lib/errors";
import { env } from "../lib/env";
import { mobileDeepLink, withParam } from "../lib/mobileLink";

/**
 * Where a web GitHub round-trip lands when we have no usable `return_to`.
 *
 * Not bare APP_URL: `/` is the public marketing page, and a signed-in visitor
 * there is immediately redirected to `/app` — which would drop the
 * `?github=connected|denied|error` flag before the app ever read it, so the
 * user would get no feedback at all about what just happened.
 */
const WEB_FALLBACK_RETURN = `${env.APP_URL.replace(/\/+$/, "")}/app`;

/**
 * Only allow post-OAuth redirects back into our own app, so `return_to` can't be
 * turned into an open redirect. Falls back to the builder when absent/foreign.
 */
function safeReturnTo(raw: unknown): string {
  if (typeof raw === "string" && raw.startsWith(env.APP_URL)) return raw;
  return WEB_FALLBACK_RETURN;
}

/**
 * POST /auth/github/prepare — mint a one-shot token an in-app browser tab can
 * present in place of the refresh cookie it does not have. Bearer-authenticated
 * and rate-limited; see github.service.ts `signHandoff`.
 */
export function prepare(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    res.status(201).json(githubService.signHandoff(req.user.id));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/github — start consent.
 *
 * Gated by `requireNavAuth`: the refresh cookie for web, a spent `?handoff=`
 * token for mobile. Which one got us here decides where `callback` returns the
 * browser, so it is recorded in the signed state now — that is the last point
 * at which it is known.
 */
export function start(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    const client = req.query["handoff"] === undefined ? "web" : "mobile";
    const returnTo = safeReturnTo(req.query["return_to"]);
    const state = githubService.signState(req.user.id, returnTo, client);
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
  let returnTo = WEB_FALLBACK_RETURN;
  try {
    if (typeof state !== "string") throw Errors.badRequest("Missing state");
    const resolved = githubService.verifyState(state);
    // Mobile started this in an in-app browser tab; sending it to APP_URL would
    // strand the user in a web page with no way back into the app. The deep
    // link is derived from the signed state, never from a query param — a
    // caller-supplied scheme here would be an open redirect.
    returnTo =
      resolved.client === "mobile"
        ? mobileDeepLink("account")
        : resolved.returnTo
          ? safeReturnTo(resolved.returnTo)
          : returnTo;

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
