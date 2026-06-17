import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import {
  Strategy as GoogleStrategy,
  type VerifyCallback,
} from "passport-google-oauth20";
import * as authController from "../controllers/auth.controller";
import * as authService from "../services/auth.service";
import { requireAuth } from "../middleware/auth.middleware";
import { authRateLimiter } from "../middleware/rateLimit.middleware";
import { Errors } from "../lib/errors";
import { env } from "../lib/env";

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      callbackURL: env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done: VerifyCallback) => {
      try {
        const user = await authService.findOrCreateGoogleUser({
          providerAccountId: profile.id,
          email: profile.emails?.[0]?.value,
          accessToken,
          refreshToken,
        });
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    },
  ),
);

const router = Router();

router.post("/register", authRateLimiter, authController.register);
router.post("/login", authRateLimiter, authController.login);

router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.post("/logout-all", requireAuth, authController.logoutAll);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

router.get(
  "/google/callback",
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate(
      "google",
      { session: false },
      (err: unknown, user: Express.User | false) => {
        if (err) return next(err);
        if (!user)
          return next(Errors.unauthorized("Google authentication failed"));
        res.locals["oauthUser"] = user;
        return authController.googleCallback(req, res, next);
      },
    )(req, res, next);
  },
);

router.get("/me", requireAuth, authController.me);

export default router;
