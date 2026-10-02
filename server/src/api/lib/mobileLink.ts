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

/**
 * Which non-default client started the consent. Absent (or unverifiable) means
 * the web app — the pre-existing behaviour.
 *   - `mobile`: finish on a `tau://` deep link with a one-shot code.
 *   - `admin`:  finish on ADMIN_URL with only the `/admin`-scoped cookie.
 */
export type OAuthClient = "mobile" | "admin";

interface OAuthStatePayload {
  purpose: typeof OAUTH_STATE_PURPOSE;
  client: OAuthClient;
}

/**
 * Mark an OAuth round trip as started by a particular client.
 *
 * Signed, not a plain `?client=mobile` echo: the callback picks a redirect
 * target from this, so an attacker-supplied value would be an open redirect
 * into an arbitrary app. Google returns `state` verbatim, so signing it here is
 * the only thing that makes it trustworthy on the way back.
 */
export function signOAuthClientState(client: OAuthClient): string {
  const payload: OAuthStatePayload = { purpose: OAUTH_STATE_PURPOSE, client };
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: OAUTH_STATE_TTL_SECONDS,
  });
}

/** The client a callback's `state` attests to. Anything unsigned, expired, or
 *  absent is null — i.e. web. */
export function oauthClientFromState(state: unknown): OAuthClient | null {
  if (typeof state !== "string" || state.length === 0) return null;
  try {
    const decoded = jwt.verify(state, env.ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    }) as OAuthStatePayload;
    if (decoded.purpose !== OAUTH_STATE_PURPOSE) return null;
    return decoded.client === "mobile" || decoded.client === "admin"
      ? decoded.client
      : null;
  } catch {
    return null;
  }
}

export function signMobileOAuthState(): string {
  return signOAuthClientState("mobile");
}

/** Did this callback come from a mobile-initiated consent? */
export function isMobileOAuthState(state: unknown): boolean {
  return oauthClientFromState(state) === "mobile";
}
