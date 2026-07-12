import rateLimit from "express-rate-limit";

// Economy (Redis-free): express-rate-limit's built-in in-memory store. Correct
// for a single-process deployment; would need a shared store if ever scaled out.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
