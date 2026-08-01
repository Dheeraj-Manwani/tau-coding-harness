import jwt from "jsonwebtoken";
import * as authRepository from "../repositories/auth.repository";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import {
  consumeHandoff as consumeHandoffToken,
  signHandoff as signHandoffToken,
} from "../lib/handoff";

/**
 * GitHub "Connect account" flow — implemented directly over GitHub's OAuth Web
 * Application flow (no passport strategy). This links a GitHub account to an
 * ALREADY-logged-in user, so instead of a passport login we carry the user id
 * in a short-TTL signed `state` param and resolve it in the callback.
 *
 * Only the api needs the client id/secret (to mint the consent URL and exchange
 * the code). The stored token is all the worker needs later to call the Git
 * Data API. OAuth App tokens don't expire, so there is no refresh flow.
 */

const PROVIDER = "github";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER = "https://api.github.com/user";
const USER_AGENT = "tau-app";

const STATE_TTL_SECONDS = 600; // 10 minutes to complete consent
const STATE_PURPOSE = "github_link";

/** Which app started the flow — decides where `callback` sends the browser. */
export type OAuthClient = "web" | "mobile";

interface StatePayload {
  sub: string; // userId
  purpose: typeof STATE_PURPOSE;
  returnTo?: string;
  client?: OAuthClient;
}

// ── Mobile handoff ───────────────────────────────────────────────────────────

/**
 * Mint a one-shot credential that lets an in-app browser tab start the GitHub
 * consent flow.
 *
 * `GET /auth/github` runs on a top-level navigation and so authenticates by
 * refresh cookie. Mobile has no cookie jar — it sends the refresh token in the
 * request body (`clientType: "mobile"`, see mobile/src/api/client.ts) — so the
 * cookie path is not available to it. This token is the substitute: obtained
 * over ordinary Bearer auth, then handed to the tab in the URL it opens.
 *
 * Single-use and 60 seconds; see lib/handoff.ts for why.
 */
export function signHandoff(userId: string): {
  token: string;
  expiresInSeconds: number;
} {
  return signHandoffToken("github_handoff", userId);
}

/** Verify and burn a GitHub handoff token, returning the user it belongs to. */
export function consumeHandoff(token: unknown): string {
  return consumeHandoffToken("github_handoff", token);
}

export function isConfigured(): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function requireConfigured(): { clientId: string; clientSecret: string } {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw Errors.badRequest("GitHub integration is not configured");
  }
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}

/** Sign a short-lived state that binds the consent round-trip to this user. */
export function signState(
  userId: string,
  returnTo?: string,
  client: OAuthClient = "web",
): string {
  const payload: StatePayload = {
    sub: userId,
    purpose: STATE_PURPOSE,
    ...(returnTo ? { returnTo } : {}),
    // Carried in the signed state rather than re-derived in `callback`, which
    // GitHub calls with only `code` and `state` — there is nothing else there
    // to tell a phone from a browser, and a client-supplied hint at that point
    // would be an open redirect into any scheme.
    ...(client === "mobile" ? { client } : {}),
  };
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: STATE_TTL_SECONDS,
  });
}

/** Verify the `state` returned by GitHub → the userId (+ optional returnTo). */
export function verifyState(state: string): {
  userId: string;
  returnTo?: string;
  client: OAuthClient;
} {
  let decoded: StatePayload;
  try {
    decoded = jwt.verify(state, env.ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    }) as StatePayload;
  } catch {
    throw Errors.badRequest("Invalid or expired GitHub authorization state");
  }
  if (decoded.purpose !== STATE_PURPOSE || !decoded.sub) {
    throw Errors.badRequest("Invalid GitHub authorization state");
  }
  return {
    userId: decoded.sub,
    returnTo: decoded.returnTo,
    client: decoded.client === "mobile" ? "mobile" : "web",
  };
}

/** The GitHub consent URL to redirect the browser to. */
export function buildAuthorizeUrl(state: string): string {
  const { clientId } = requireConfigured();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: env.GITHUB_REDIRECT_URI,
    scope: env.GITHUB_SCOPE,
    state,
    allow_signup: "false",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchange the OAuth `code` for a user access token. */
async function exchangeCodeForToken(code: string): Promise<string> {
  const { clientId, clientSecret } = requireConfigured();
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: env.GITHUB_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    throw Errors.badRequest(`GitHub token exchange failed (${res.status})`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw Errors.badRequest(
      data.error_description || data.error || "GitHub did not return a token",
    );
  }
  return data.access_token;
}

interface GithubUser {
  id: number;
  login: string;
}

/** Look up the account behind a token. Returns null on 401 (revoked/invalid). */
async function fetchGithubUser(token: string): Promise<GithubUser | null> {
  const res = await fetch(GITHUB_API_USER, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw Errors.badRequest(`GitHub user lookup failed (${res.status})`);
  }
  const data = (await res.json()) as GithubUser;
  return { id: data.id, login: data.login };
}

/**
 * Complete the callback: exchange code, identify the account, persist the token
 * on OAuthAccount(provider:"github"). Returns the linked username.
 */
export async function linkFromCallback(
  userId: string,
  code: string,
): Promise<string> {
  const token = await exchangeCodeForToken(code);
  const ghUser = await fetchGithubUser(token);
  if (!ghUser) {
    throw Errors.badRequest("Could not verify the GitHub account");
  }

  await authRepository.upsertOAuthAccount({
    userId,
    provider: PROVIDER,
    providerAccountId: String(ghUser.id),
    accessToken: token,
  });

  return ghUser.login;
}

/**
 * Connection status for the "Connect GitHub" button. When a token is present we
 * confirm it against GitHub so a revoked token surfaces as disconnected (and we
 * clean up the stale row) rather than a false "connected".
 */
export async function getStatus(
  userId: string,
): Promise<{ connected: boolean; username: string | null }> {
  const account = await authRepository.findOAuthAccountByUser(userId, PROVIDER);
  if (!account?.accessToken) return { connected: false, username: null };

  const ghUser = await fetchGithubUser(account.accessToken);
  if (!ghUser) {
    // Token revoked upstream — drop the dead link so the UI prompts a reconnect.
    await authRepository.deleteOAuthAccountsByUser(userId, PROVIDER);
    return { connected: false, username: null };
  }
  return { connected: true, username: ghUser.login };
}

export async function disconnect(userId: string): Promise<void> {
  await authRepository.deleteOAuthAccountsByUser(userId, PROVIDER);
}
