import type { Request, Response, NextFunction } from "express";
import { requireUserId } from "../middleware/auth.middleware";
import * as accountService from "../services/account.service";
import * as reauthService from "../services/reauth.service";
import * as preferencesService from "../services/preferences.service";
import * as profileService from "../services/profile.service";
import { patchPreferencesSchema } from "../schemas/preferences.schema";
import { patchProfileSchema } from "../schemas/profile.schema";
import { parse } from "../lib/utils";
import { z } from "zod";

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

/**
 * PATCH /account/preferences — merge a partial update into the account's
 * preferences and return the full result. Unknown keys are rejected rather than
 * stored, so the column only ever holds what the schema describes.
 */
export async function updatePreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const patch = parse(patchPreferencesSchema, req.body ?? {});
    res.json({
      preferences: await preferencesService.updatePreferences(
        requireUserId(req),
        patch,
      ),
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /account/profile — the display name. Null or blank clears it. */
export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { displayName } = parse(patchProfileSchema, req.body ?? {});
    await profileService.updateDisplayName(requireUserId(req), displayName);
    res.json({ displayName });
  } catch (err) {
    next(err);
  }
}

/** PUT /account/avatar — raw image bytes, resized by the browser beforehand. */
export async function uploadAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await profileService.uploadAvatar(requireUserId(req), req.body);
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

/** DELETE /account/avatar — back to the generated avatar. */
export async function removeAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await profileService.removeAvatar(requireUserId(req));
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

/** GET /account/activity?tz=Area/City — the private activity graph. */
export async function getActivity(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await profileService.getActivity(requireUserId(req), req.query.tz));
  } catch (err) {
    next(err);
  }
}

const avatarParamSchema = z.object({ userId: z.uuid() });

/**
 * GET /avatars/:userId — public redirect to a short-lived signed URL.
 *
 * Public because an `<img>` can't send the Bearer token. That's acceptable: the
 * id is an unguessable UUID that only ever appears in the owner's own session,
 * and a picture is the one thing on the account meant to be looked at. The
 * `?v=` the client appends makes each version its own cache entry.
 */
export async function getAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = parse(avatarParamSchema, req.params);
    const url = await profileService.avatarUrlFor(userId);
    if (!url) {
      res.sendStatus(404);
      return;
    }
    res.set(
      "Cache-Control",
      `private, max-age=${profileService.AVATAR_REDIRECT_MAX_AGE_SECONDS}`,
    );
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
}
