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

// Revealing or rotating hands out a live spend credential in plaintext. Neither
// is something a legitimate user does more than a handful of times, so the limit
// is tight enough to make scripted extraction pointless without ever being felt.
export const revealRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "Too many key reveals. Please try again in a little while.",
  },
});

// The re-auth exchange takes a password or a 6-digit emailed code. The code is
// stateless (an HMAC over a ten-minute window, see reauth.service.ts), so it is
// not consumed on use and nothing else bounds guessing — a million codes at a
// few thousand tries a minute would fall in an afternoon. This limit is what
// makes that arithmetic not work. Deliberately separate from
// `revealRateLimiter`: failing to confirm must not burn a user's reveal budget.
export const reauthRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "Too many confirmation attempts. Please try again in a little while.",
  },
});
