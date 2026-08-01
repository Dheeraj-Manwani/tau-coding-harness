import jwt from "jsonwebtoken";

import { env } from "@/lib/env";

/**
 * Sending a browser back into the native app.
 *
 * Both OAuth flows mobile uses (Google sign-in, GitHub connect) finish in an
 * in-app browser tab. Redirecting that tab to `APP_URL` would strand the user
 * in a web page with no way back, so it goes to a `tau://` deep link instead.
 */

/** Build a deep link into the app. `path` must name a real expo-router route:
 *  the OS may have killed the app mid-consent, in which case this cold-starts
 *  it and anything unresolvable lands on not-found. */
export function mobileDeepLink(path: string): string {
  const route = path.replace(/^\/+/, "");
  const base = env.MOBILE_APP_URL.replace(/\/+$/, "");
  // MOBILE_APP_URL is normally the bare scheme `tau://`, and trimming its
  // trailing slashes leaves `tau:` — appending a single `/` to that yields
  // `tau:/route`, which no OS will route. Put the authority separator back.
  return base.endsWith(":") ? `${base}//${route}` : `${base}/${route}`;
}

/**
 * Append a query param to a URL that may use a custom scheme.
 *
 * `new URL` parses `tau://callback` fine but normalizes it to `tau://callback/`,
 * which is a different route to expo-router — so custom schemes are built by
 * hand.
 */
export function withParam(url: string, key: string, value: string): string {
  if (!url.startsWith("http")) {
    return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  }
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}

// ── OAuth state ──────────────────────────────────────────────────────────────

const OAUTH_STATE_PURPOSE = "oauth_client";
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes to complete consent

interface OAuthStatePayload {
  purpose: typeof OAUTH_STATE_PURPOSE;
  client: "mobile";
}

/**
 * Mark an OAuth round trip as mobile-initiated.
 *
 * Signed, not a plain `?client=mobile` echo: the callback picks a redirect
 * *scheme* from this, so an attacker-supplied value would be an open redirect
 * into an arbitrary app. Google returns `state` verbatim, so signing it here is
 * the only thing that makes it trustworthy on the way back.
 */
export function signMobileOAuthState(): string {
  const payload: OAuthStatePayload = {
    purpose: OAUTH_STATE_PURPOSE,
    client: "mobile",
  };
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: OAUTH_STATE_TTL_SECONDS,
  });
}

/** Did this callback come from a mobile-initiated consent? Anything unsigned,
 *  expired, or absent reads as web — the pre-existing behaviour. */
export function isMobileOAuthState(state: unknown): boolean {
  if (typeof state !== "string" || state.length === 0) return false;
  try {
    const decoded = jwt.verify(state, env.ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    }) as OAuthStatePayload;
    return decoded.purpose === OAUTH_STATE_PURPOSE && decoded.client === "mobile";
  } catch {
    return false;
  }
}
