import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import {
  Strategy as GoogleStrategy,
  type VerifyCallback,
} from "passport-google-oauth20";
import * as authController from "../controllers/auth.controller";
import * as githubController from "../controllers/github.controller";
import * as authService from "../services/auth.service";
import { requireAuth, requireNavAuth } from "../middleware/auth.middleware";
import {
  authRateLimiter,
  handoffRateLimiter,
} from "../middleware/rateLimit.middleware";
import { Errors } from "../lib/errors";
import { env } from "@/lib/env";
import { signOAuthClientState } from "../lib/mobileLink";

// Registered only when configured: the strategy throws on an empty clientID at
// construction, which used to crash the server at import time for variables the
// schema calls optional. Without it the Google routes 404 (see `requireGoogle`).
const googleConfigured = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done: VerifyCallback) => {
        try {
          const user = await authService.findOrCreateGoogleUser({
            providerAccountId: profile.id,
            email: profile.emails?.[0]?.value,
            displayName: profile.displayName,
            photoUrl: profile.photos?.[0]?.value,
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
}

function requireGoogle(_req: Request, _res: Response, next: NextFunction): void {
  next(googleConfigured ? undefined : Errors.notFound("Google sign-in is not configured"));
}

const router = Router();

router.post("/register", authRateLimiter, authController.register);
router.post("/login", authRateLimiter, authController.login);

router.post("/verify-email", authRateLimiter, authController.verifyEmail);
router.post(
  "/resend-verification",
  authRateLimiter,
  requireAuth,
  authController.resendVerification,
);

router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.post("/logout-all", requireAuth, authController.logoutAll);

// `?client=mobile` marks the round trip so `googleCallback` returns a one-shot
// code on a `tau://` deep link instead of a cookie + URL fragment, neither of
// which an in-app browser tab can hand back to the app. The marker is signed
// (see lib/mobileLink.ts) because the callback picks a redirect scheme from it.
// Without the param this is byte-for-byte the previous behaviour.
router.get(
  "/google",
  requireGoogle,
  (req: Request, res: Response, next: NextFunction) => {
    // `?client=admin` is the standalone ops console's sign-in. It is only
    // honoured when ADMIN_URL is configured: the callback redirects there, and
    // with nowhere to send the operator the round trip would dead-end.
    const client =
      req.query["client"] === "mobile"
        ? "mobile"
        : req.query["client"] === "admin" && env.ADMIN_URL
          ? "admin"
          : null;
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
      ...(client ? { state: signOAuthClientState(client) } : {}),
    })(req, res, next);
  },
);

// The mobile tail: trade the deep-linked code for a real token pair.
router.post("/google/exchange", authRateLimiter, authController.googleExchange);

router.get(
  "/google/callback",
  requireGoogle,
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

// ── GitHub account linking (Connect GitHub) ──
// `start` runs on a full-page navigation, so it authenticates via the refresh
// cookie — or, for mobile, a one-shot handoff token, since an in-app browser
// tab carries no cookie (see requireNavAuth). `callback` authenticates via the
// signed state it issued. status + disconnect are called from the app over XHR,
// so they use Bearer auth.
router.post(
  "/github/prepare",
  requireAuth,
  handoffRateLimiter,
  githubController.prepare,
);
router.get("/github", requireNavAuth, githubController.start);
router.get("/github/callback", githubController.callback);
router.get("/github/status", requireAuth, githubController.status);
router.delete("/github", requireAuth, githubController.disconnect);

export default router;
