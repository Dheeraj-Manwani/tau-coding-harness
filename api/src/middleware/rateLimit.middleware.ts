import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../lib/redis";

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  store: new RedisStore({
    sendCommand: (...args: string[]) =>
      redis.call(args[0]!, ...args.slice(1)) as Promise<any>,
    prefix: "rl:auth:",
  }),
});
