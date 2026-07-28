import { Router } from "express";
import {
  createApiKey,
  getApiKey,
  revealApiKey,
  revokeApiKeys,
  rotateApiKey,
  setDailyCap,
} from "../controllers/account.controller";
import { revealRateLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

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
