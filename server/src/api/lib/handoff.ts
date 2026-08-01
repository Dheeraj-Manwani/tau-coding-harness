import crypto from "crypto";
import jwt from "jsonwebtoken";

import { env } from "@/lib/env";
import { Errors } from "./errors";

/**
 * Short-lived, single-use tokens for handing an identity across a boundary the
 * normal credentials cannot cross.
 *
 * Two callers today, both mobile:
 *
 *   - `github_handoff` — an in-app browser tab starting `GET /auth/github`,
 *     which otherwise authenticates by refresh cookie (doc/SYNC_MOBILE.md §6).
 *   - `google_exchange` — the Google OAuth callback handing a completed login
 *     back to the app, without putting a refresh token in a redirect URL.
 *
 * ## Why these are single-use, when re-auth tokens are not
 *
 * `reauth.service.ts` documents at length why it stays stateless and accepts
 * replay inside a five-minute window. These cannot make that trade: both travel
 * in a URL — a query parameter or a redirect target — which is the one place a
 * credential is guaranteed to be written to an access log and to whatever
 * history the browser keeps. Spending the token on first use means a copy
 * recovered from either is already dead.
 *
 * The spent set is in-process, like `rateLimit.middleware.ts`'s store and for
 * the same reason: this build has no Redis, and a table for a 60-second value
 * would be a migration plus a cleanup job. Correct for the single-process
 * deployment; scaling out would let a spent token be replayed on another
 * instance. Written down rather than assumed.
 */

export type HandoffPurpose = "github_handoff" | "google_exchange";

/** Deliberately tiny: the token is spent on the very next request the client
 *  makes, so anything longer is only exposure. */
export const HANDOFF_TTL_SECONDS = 60;

interface HandoffPayload {
  sub: string;
  purpose: HandoffPurpose;
  jti: string;
}

/** jti → expiry, for tokens already spent. Bounded by the TTL: entries are
 *  swept on every write and nothing outlives it. */
const spent = new Map<string, number>();

function sweep(now: number): void {
  for (const [jti, expiresAt] of spent) {
    if (expiresAt <= now) spent.delete(jti);
  }
}

export function signHandoff(
  purpose: HandoffPurpose,
  userId: string,
): { token: string; expiresInSeconds: number } {
  const payload: HandoffPayload = {
    sub: userId,
    purpose,
    jti: crypto.randomUUID(),
  };
  const token = jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: HANDOFF_TTL_SECONDS,
  });
  return { token, expiresInSeconds: HANDOFF_TTL_SECONDS };
}

/**
 * Verify and burn a handoff token, returning the user it belongs to.
 *
 * @param purpose must match what the token was minted for. Everything under
 *   this secret shares a signature, so without this check an access token — or
 *   the *other* handoff purpose — would satisfy the gate, and a reusable one
 *   would erase the single-use property entirely.
 */
export function consumeHandoff(
  purpose: HandoffPurpose,
  token: unknown,
): string {
  if (typeof token !== "string" || token.length === 0) {
    throw Errors.unauthorized("Authentication required");
  }
  let decoded: HandoffPayload;
  try {
    decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    }) as HandoffPayload;
  } catch {
    throw Errors.unauthorized("That link expired. Try again.");
  }
  if (decoded.purpose !== purpose || !decoded.sub || !decoded.jti) {
    throw Errors.unauthorized("Authentication required");
  }

  const now = Date.now();
  sweep(now);
  if (spent.has(decoded.jti)) {
    throw Errors.unauthorized("That link was already used.");
  }
  spent.set(decoded.jti, now + HANDOFF_TTL_SECONDS * 1000);

  return decoded.sub;
}
