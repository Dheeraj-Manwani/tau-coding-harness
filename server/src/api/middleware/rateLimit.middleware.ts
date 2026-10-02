import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

export const feedbackRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "Too many feedback submissions. Please try again later." },
});

// Economy (Redis-free): express-rate-limit's built-in in-memory store. Correct
// for a single-process deployment; would need a shared store if ever scaled out.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Signing into the ops console. Separate from `authRateLimiter` rather than
// reusing it: that one is a module-level singleton with a single store, so
// sharing it would make an operator's admin sign-ins spend the same per-IP
// budget as ordinary app logins from that address, and a burst of either would
// lock them out of the console during an incident. Tighter than /auth because
// far fewer people should ever be typing into this box.
export const adminSessionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
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

// Visual edits are free to the user — no model call, no credits — so nothing
// else bounds them, and each one is a parse plus three writes. The limit is set
// far above real use: clicking through the style panel is a handful of requests
// a minute, and the ceiling only bites on a script.
export const visualEditRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "Too many edits at once. Please try again in a moment.",
  },
});

// Importing an image makes the API fetch a URL the user chose, which is both
// slower and more abusable than the source edits above — it is bandwidth in and
// storage out. Tighter, and separate so a burst of imports can't spend the
// allowance that ordinary styling needs.
export const assetImportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "Too many image imports. Please try again in a little while.",
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

// A GitHub handoff token is a 60-second bearer credential that rides in a query
// string, so it lands in access logs. It is single-use, which is the real
// defence, but nothing should be able to mint a stream of them: each one is a
// fresh window in which a log reader could act. Sits with the other credential
// endpoints on purpose.
export const handoffRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "Too many connection attempts. Please try again in a little while.",
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

// Avatar changes. Generous for a person fiddling with a crop, tight enough that
// nobody uses the bucket as free image hosting.
export const avatarRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "That's a lot of new looks. Try again in a bit." },
});
