import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../lib/env";
import { Errors } from "../lib/errors";
import { log } from "../lib/log";

export const ADMIN_COOKIE = "tau_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Constant-time compare, so a wrong key can't be recovered a byte at a time by
 * timing the response.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Mint an opaque admin session token: `<expiry>.<hmac>`.
 *
 * Signed with the admin key itself, so there is no new secret to manage and
 * rotating `ADMIN_API_KEY` invalidates every outstanding session for free.
 */
export function issueAdminSession(): { token: string; expiresAt: Date } {
  const key = env.ADMIN_API_KEY;
  if (!key) throw Errors.forbidden("Admin access is not configured");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const exp = String(expiresAt.getTime());
  const mac = crypto.createHmac("sha256", key).update(exp).digest("hex");
  return { token: `${exp}.${mac}`, expiresAt };
}

function verifyAdminSession(token: string): boolean {
  const key = env.ADMIN_API_KEY;
  if (!key) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac) return false;
  if (Number(exp) <= Date.now()) return false;
  const expected = crypto.createHmac("sha256", key).update(exp).digest("hex");
  return safeEqual(mac, expected);
}

/**
 * Admin gate accepting either credential:
 *   - `x-admin-key` — for curl and scripts;
 *   - the `tau_admin` cookie — for the browser console, since a tab can't set a
 *     header and pasting the raw key into `localStorage` would leave a
 *     long-lived secret sitting in browser storage.
 *
 * Every allowed request is audit-logged. Admin reads touch other people's
 * projects, so "who looked at what, when" needs to exist before anyone asks.
 */
export function requireAdminKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!env.ADMIN_API_KEY) {
    return next(Errors.forbidden("Admin access required"));
  }

  const header = req.headers["x-admin-key"];
  const viaHeader =
    typeof header === "string" && safeEqual(header, env.ADMIN_API_KEY);
  const cookie = (req.cookies as Record<string, string> | undefined)?.[
    ADMIN_COOKIE
  ];
  const viaCookie = typeof cookie === "string" && verifyAdminSession(cookie);

  if (!viaHeader && !viaCookie) {
    return next(Errors.forbidden("Admin access required"));
  }

  // `req.params` is empty here — this runs before a route matches — so the path
  // itself carries the target id, which is what an audit trail needs anyway.
  log.info("admin.access", {
    method: req.method,
    path: req.originalUrl.split("?")[0],
    via: viaHeader ? "key" : "cookie",
    ip: req.ip,
  });

  next();
}
