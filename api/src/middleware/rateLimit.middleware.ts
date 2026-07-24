import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// Economy (Redis-free): express-rate-limit's built-in in-memory store. Correct
// for a single-process deployment; would need a shared store if ever scaled out.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Extraction is a user-triggered LLM call, so it needs a ceiling that isn't the
// credit balance.
export const attachmentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "Too many attachments uploaded. Please try again in a little while.",
  },
});
