import type { Request, Response, NextFunction } from "express";
import { requireUserId } from "../middleware/auth.middleware";
import * as accountService from "../services/account.service";
import * as reauthService from "../services/reauth.service";

/**
 * The re-auth token travels in a header, not the body.
 *
 * `PUT /api-key/cap` and friends already own their bodies, and keeping the proof
 * out of the payload means adding this gate to another endpoint later doesn't
 * mean reshaping that endpoint's request.
 */
function reauthTokenOf(req: Request): unknown {
  return req.headers["x-tau-reauth"];
}

/** GET /account/reauth — which second factor this account can produce. */
export async function reauthMethod(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({ method: await reauthService.methodFor(requireUserId(req)) });
  } catch (err) {
    next(err);
  }
}

/** POST /account/reauth/challenge — emails a code, for OAuth-only accounts. */
export async function reauthChallenge(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await reauthService.challenge(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

/** POST /account/reauth — exchange a password or code for a short-lived token. */
export async function reauth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await reauthService.reauthenticate(requireUserId(req), req.body ?? {}),
    );
  } catch (err) {
    next(err);
  }
}

export async function getApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await accountService.getApiKeyView(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function createApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(await accountService.createApiKey(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function revealApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    // Both of these hand back a live spend credential, so a session alone is not
    // enough — see reauth.service.ts.
    reauthService.requireReauth(userId, reauthTokenOf(req));
    res.json(await accountService.revealApiKey(userId));
  } catch (err) {
    next(err);
  }
}

export async function rotateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    reauthService.requireReauth(userId, reauthTokenOf(req));
    res.json(await accountService.rotate(userId));
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKeys(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await accountService.revokeAll(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function setDailyCap(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = (req.body ?? {}).dailyCapCredits;
    // `null` explicitly means "go back to the default", which is different from
    // an absent field — so only undefined is a validation error.
    if (raw !== null && typeof raw !== "number") {
      res.status(400).json({
        error: "dailyCapCredits must be a number, or null to use the default",
      });
      return;
    }
    res.json(await accountService.setDailyCap(requireUserId(req), raw));
  } catch (err) {
    next(err);
  }
}
