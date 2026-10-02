import { Router, raw } from "express";
import {
  createApiKey,
  getActivity,
  getApiKey,
  reauth,
  reauthChallenge,
  reauthMethod,
  removeAvatar,
  revealApiKey,
  revokeApiKeys,
  rotateApiKey,
  setDailyCap,
  updatePreferences,
  updateProfile,
  uploadAvatar,
} from "../controllers/account.controller";
import { AVATAR_MAX_BYTES } from "../services/profile.service";
import {
  avatarRateLimiter,
  reauthRateLimiter,
  revealRateLimiter,
} from "../middleware/rateLimit.middleware";

const router = Router();

// Re-auth: proving a second time that this session belongs to the account owner,
// before anything hands out a live credential. See reauth.service.ts.
router.get("/reauth", reauthMethod);
router.post("/reauth/challenge", reauthRateLimiter, reauthChallenge);
// Rate-limited hard: this endpoint takes a password or a 6-digit code, and an
// unthrottled 6-digit code is a 10-minute brute force.
router.post("/reauth", reauthRateLimiter, reauth);

// GET never decrypts — it returns the prefix and metadata only.
router.get("/api-key", getApiKey);
router.post("/api-key", createApiKey);

// Reveal is the one that hands out a live credential, so it is a separate verb
// with its own tight limit. A page load must never trigger a decrypt.
router.post("/api-key/reveal", revealRateLimiter, revealApiKey);

router.post("/api-key/rotate", revealRateLimiter, rotateApiKey);
router.post("/api-key/revoke", revokeApiKeys);
router.put("/api-key/cap", setDailyCap);

// Account-level UI preferences (tours, motion, last effort). Reads ride along on
// GET /auth/me; this is the only write path.
router.patch("/preferences", updatePreferences);

// Profile: a name and a picture, nothing more. The picture is read through the
// public `/avatars/:userId` redirect, mounted in index.ts.
router.patch("/profile", updateProfile);
router.put(
  "/avatar",
  avatarRateLimiter,
  raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: AVATAR_MAX_BYTES,
    inflate: false,
  }),
  uploadAvatar,
);
router.delete("/avatar", avatarRateLimiter, removeAvatar);

// Private to the owner: there is no way to read anyone else's.
router.get("/activity", getActivity);

export default router;
