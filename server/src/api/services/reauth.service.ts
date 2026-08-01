/**
 * Proving, a second time, that the person holding this session is the account
 * owner.
 *
 * Needed by exactly one thing today: revealing or rotating a `tau_sk_*` key.
 * Those endpoints put a live spend credential into an HTTP response and usually
 * the clipboard, so a stolen or borrowed session should not be enough on its own
 * (doc/AI_FOR_GENERATED_APPS.md §5, §8.11).
 *
 * ## Why this is stateless
 *
 * There is nowhere good to put short-lived state in this build. Redis is
 * declared but unused by the api (the economy build dropped BullMQ), and a table
 * for two five-minute values is a migration and a cleanup job for something that
 * expires on its own. Both artifacts here are therefore derived rather than
 * stored:
 *
 *   - the **token** is a short JWT under `ACCESS_TOKEN_SECRET` with its own
 *     `purpose`, so an access token cannot be presented in its place and vice
 *     versa;
 *   - the **email code** is a truncated HMAC over a time window — TOTP with a
 *     ten-minute step and the code delivered by email instead of an authenticator
 *     app.
 *
 * The cost of statelessness is that neither is single-use: a token can be
 * replayed inside its five-minute life, and a code inside its window. That is a
 * real limitation and it is written down rather than papered over. It is also a
 * long way from where this started, which was "a session cookie is enough."
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import { log } from "../lib/log";
import { sendReauthCodeEmail } from "../lib/email";

const TOKEN_PURPOSE = "reauth";
const TOKEN_TTL_SECONDS = 5 * 60;

/** How long an emailed code stays valid. Also the HMAC's time step. */
const CODE_WINDOW_MS = 10 * 60_000;
const CODE_DIGITS = 6;

/**
 * How a given account can prove itself again.
 *
 * A Google-only user has no password to re-enter, and sending them back through
 * an OAuth redirect would mean a full round trip with state, a landing route and
 * a way to hand the result back to the SPA. An emailed code is a real second
 * factor — it proves control of the address the account is bound to — and it
 * reuses email infrastructure that already exists.
 */
export type ReauthMethod = "password" | "email_code";

export interface ReauthChallenge {
  method: ReauthMethod;
  /** Where the code went, obfuscated. Null for the password method. */
  sentTo: string | null;
}

async function userFor(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) throw Errors.unauthorized("Not signed in");
  return user;
}

export async function methodFor(userId: string): Promise<ReauthMethod> {
  const user = await userFor(userId);
  return user.passwordHash ? "password" : "email_code";
}

/** `ada@example.com` → `a••@example.com`. Enough to recognise, not to learn. */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

function codeFor(userId: string, windowIndex: number): string {
  const mac = crypto
    .createHmac("sha256", env.ACCESS_TOKEN_SECRET)
    .update(`reauth:${userId}:${windowIndex}`)
    .digest();
  // Standard HOTP dynamic truncation: take an offset from the low nibble so the
  // digits come from a varying slice of the mac rather than a fixed one.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

/**
 * Start a re-auth. For password accounts this is a no-op that just says so; for
 * OAuth-only accounts it sends the code.
 */
export async function challenge(userId: string): Promise<ReauthChallenge> {
  const user = await userFor(userId);
  if (user.passwordHash) return { method: "password", sentTo: null };

  const code = codeFor(userId, Math.floor(Date.now() / CODE_WINDOW_MS));
  await sendReauthCodeEmail({
    email: user.email,
    code,
    minutes: Math.round(CODE_WINDOW_MS / 60_000),
  });
  log.info("reauth.code_sent", { userId });

  return { method: "email_code", sentTo: maskEmail(user.email) };
}

export interface ReauthResult {
  token: string;
  expiresInSeconds: number;
}

/**
 * Verify the second factor and mint a re-auth token.
 *
 * Both failure paths return the same error on purpose — which factor was wrong
 * is not information worth handing back.
 */
export async function reauthenticate(
  userId: string,
  input: { password?: unknown; code?: unknown },
): Promise<ReauthResult> {
  const user = await userFor(userId);
  const invalid = Errors.unauthorized("That didn't match. Try again.");

  if (user.passwordHash) {
    if (typeof input.password !== "string" || input.password.length === 0) {
      throw Errors.badRequest("Enter your password to continue");
    }
    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      log.warn("reauth.failed", { userId, method: "password" });
      throw invalid;
    }
  } else {
    if (typeof input.code !== "string" || input.code.trim().length === 0) {
      throw Errors.badRequest("Enter the code we emailed you");
    }
    const supplied = input.code.trim();
    const now = Math.floor(Date.now() / CODE_WINDOW_MS);
    // Accept the previous window too, or a code issued at 9:59 into a window is
    // dead on arrival through no fault of the person typing it.
    const accepted = [codeFor(userId, now), codeFor(userId, now - 1)];
    const match = accepted.some((expected) => timingSafeEqual(expected, supplied));
    if (!match) {
      log.warn("reauth.failed", { userId, method: "email_code" });
      throw invalid;
    }
  }

  const token = jwt.sign({ sub: userId, purpose: TOKEN_PURPOSE }, env.ACCESS_TOKEN_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
  log.info("reauth.granted", { userId });
  return { token, expiresInSeconds: TOKEN_TTL_SECONDS };
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Gate for an endpoint that hands out a credential.
 *
 * Throws unless `token` is a live re-auth token for this exact user. The `sub`
 * check is what stops one account's token unlocking another's key.
 */
export function requireReauth(userId: string, token: unknown): void {
  if (typeof token !== "string" || token.length === 0) {
    throw Errors.forbidden(
      "Confirm it's you before revealing or rotating an API key.",
    );
  }
  let decoded: { sub?: string; purpose?: string };
  try {
    decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET) as typeof decoded;
  } catch {
    throw Errors.forbidden("That confirmation expired. Try again.");
  }
  if (decoded.purpose !== TOKEN_PURPOSE || decoded.sub !== userId) {
    throw Errors.forbidden("That confirmation isn't valid for this account.");
  }
}
