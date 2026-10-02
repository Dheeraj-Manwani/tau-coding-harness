import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Role } from "@/generated/prisma/enums";
import { Errors } from "../lib/errors";
import { log } from "../lib/log";
import { verifyAccessToken } from "../lib/tokens";

export const ADMIN_COOKIE = "tau_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Admin access is `User.role === ADMIN` and nothing else. There is no
 * environment key, no shared secret and no fallback credential — the column is
 * the whole gate, which is why it is checked against the database on **every**
 * request rather than trusted from a token (see `resolveAdmin`).
 *
 * The first admin is promoted by hand; there is deliberately no seed script:
 *
 *   UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
 */

/**
 * Constant-time compare, so a forged session mac can't be recovered a byte at a
 * time by timing the response.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", env.ACCESS_TOKEN_SECRET)
    .update(payload)
    .digest("hex");
}

/**
 * Mint an opaque admin session token: `<userId>.<expiry>.<hmac>`.
 *
 * Signed with `ACCESS_TOKEN_SECRET` — the same secret that backs ordinary
 * access tokens — so there is no new secret to manage and rotating it
 * invalidates every outstanding admin session for free.
 *
 * The token carries an *identity*, never an authorisation: it says "this is
 * user X", and `resolveAdmin` still reads their current role from the database.
 * A demoted admin therefore loses access on their next request instead of when
 * this cookie happens to expire.
 */
export function issueAdminSession(userId: string): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const payload = `${userId}.${expiresAt.getTime()}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/**
 * Mint a session and set it as the `/admin`-scoped HttpOnly cookie. The only
 * caller is the Google round trip (`/auth/google?client=admin`) — there is no
 * password or token exchange for an admin session.
 *
 * `SameSite=Lax` is what lets the standalone console at ADMIN_URL use it: that
 * origin and the API are the same *site* (e.g. admin.tauai.pro / api.tauai.pro),
 * so the cookie rides along on its credentialed fetches.
 */
export function setAdminSessionCookie(res: Response, userId: string): Date {
  const { token, expiresAt } = issueAdminSession(userId);
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/admin",
  });
  return expiresAt;
}

/** Returns the user id a session cookie attests to, or null if it doesn't verify. */
function verifyAdminSession(token: string): string | null {
  const [userId, exp, mac] = token.split(".");
  if (!userId || !exp || !mac) return null;
  if (!Number(exp) || Number(exp) <= Date.now()) return null;
  return safeEqual(mac, sign(`${userId}.${exp}`)) ? userId : null;
}

/** The id a request claims, from either credential — identity only, no role yet. */
function claimedUserId(req: Request): { userId: string; via: string } | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) {
      try {
        // Throws on a bad or expired token; an unparseable bearer is simply not
        // a credential, so fall through to the cookie rather than failing hard.
        return { userId: verifyAccessToken(token).sub, via: "bearer" };
      } catch {
        /* ignore */
      }
    }
  }

  const cookie = (req.cookies as Record<string, string> | undefined)?.[
    ADMIN_COOKIE
  ];
  if (typeof cookie === "string") {
    const userId = verifyAdminSession(cookie);
    if (userId) return { userId, via: "cookie" };
  }

  return null;
}

export interface AdminIdentity {
  id: string;
  email: string;
  via: string;
}

/**
 * Resolve a request to an admin, or throw.
 *
 * The role is read from the database on every call — not carried in the token.
 * Admin traffic is a rounding error next to ordinary API traffic, so one
 * indexed primary-key lookup is a cheap price for revocation that takes effect
 * immediately instead of whenever a token expires.
 */
async function resolveAdmin(req: Request): Promise<AdminIdentity> {
  const claim = claimedUserId(req);
  if (!claim) throw Errors.unauthorized("Authentication required");

  const user = await prisma.user.findUnique({
    where: { id: claim.userId },
    select: { id: true, email: true, role: true },
  });

  // A deleted user and a non-admin get the same answer: "no", with no hint
  // about which.
  if (!user || user.role !== Role.ADMIN) {
    throw Errors.forbidden("Admin access required");
  }

  return { id: user.id, email: user.email, via: claim.via };
}

/**
 * Two credentials, one authority:
 *   - `Authorization: Bearer <access token>` — for curl and scripts;
 *   - the `tau_admin` cookie — for the ops console (admin/), minted by the
 *     Google round trip; it rides the console's credentialed fetches.
 *
 * Both only establish *who* is asking. Whether that person is an admin is
 * always a fresh read of `User.role`.
 *
 * Every allowed request is audit-logged with the operator's identity. Admin
 * reads touch other people's projects, so "who looked at what, when" needs to
 * exist before anyone asks — and unlike the shared key this replaced, the
 * answer is now a person rather than "someone with the secret".
 */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const admin = await resolveAdmin(req);
    req.user = { id: admin.id, email: admin.email };

    // `req.params` is empty here — this runs before a route matches — so the
    // path itself carries the target id, which is what an audit trail needs
    // anyway.
    log.info("admin.access", {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      userId: admin.id,
      email: admin.email,
      via: admin.via,
      ip: req.ip,
    });

    next();
  } catch (err) {
    next(err);
  }
}
