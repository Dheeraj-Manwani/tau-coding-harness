import { Router } from "express";
import {
  createApiKey,
  getApiKey,
  reauth,
  reauthChallenge,
  reauthMethod,
  revealApiKey,
  revokeApiKeys,
  rotateApiKey,
  setDailyCap,
} from "../controllers/account.controller";
import {
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

export default router;
