import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";

// Google sign-in on mobile. An in-app browser tab can accept neither half of
// the web handoff — no cookie jar for the refresh token, no way to read a URL
// fragment — so the callback hands back a one-shot code the app exchanges for a
// real token pair.
// Background: doc/SYNC_MOBILE.md (post-§7 gap review).

const { env } = await import("@/lib/env");
const { signMobileOAuthState, isMobileOAuthState, mobileDeepLink, withParam } =
  await import("@/api/lib/mobileLink");
const { signHandoff, consumeHandoff } = await import("@/api/lib/handoff");

const USER = "user-1";

describe("mobile OAuth state", () => {
  test("round-trips a signed mobile marker", () => {
    expect(isMobileOAuthState(signMobileOAuthState())).toBe(true);
  });

  test("absent state reads as web — the pre-existing flow is untouched", () => {
    expect(isMobileOAuthState(undefined)).toBe(false);
    expect(isMobileOAuthState("")).toBe(false);
  });

  test("an unsigned client claim cannot be injected", () => {
    // The callback picks a redirect *scheme* from this. Google echoes `state`
    // back verbatim, so if this were trusted unsigned, anyone could aim the
    // redirect at an arbitrary app and collect the code.
    const forged = jwt.sign(
      { purpose: "oauth_client", client: "mobile" },
      "not-the-secret",
      { expiresIn: 600 },
    );
    expect(isMobileOAuthState(forged)).toBe(false);
  });

  test("an ordinary access token is not a mobile marker", () => {
    const accessToken = jwt.sign(
      { sub: USER, email: "a@b.c" },
      env.ACCESS_TOKEN_SECRET,
      { expiresIn: 900 },
    );
    expect(isMobileOAuthState(accessToken)).toBe(false);
  });

  test("an expired marker reads as web", () => {
    const stale = jwt.sign(
      { purpose: "oauth_client", client: "mobile" },
      env.ACCESS_TOKEN_SECRET,
      { expiresIn: -1 },
    );
    expect(isMobileOAuthState(stale)).toBe(false);
  });
});

describe("google_exchange handoff", () => {
  test("is single-use", () => {
    // It arrives on a deep link, so it is in the OS's URL handling and in logs.
    const { token } = signHandoff("google_exchange", USER);
    expect(consumeHandoff("google_exchange", token)).toBe(USER);
    expect(() => consumeHandoff("google_exchange", token)).toThrow(
      /already used/,
    );
  });

  test("purposes do not cross", () => {
    // Both are 60-second tokens under the same secret. Without the purpose
    // check, a GitHub handoff — obtainable by any logged-in user over Bearer
    // auth — would mint a full session for that user through the Google tail.
    const gh = signHandoff("github_handoff", USER).token;
    expect(() => consumeHandoff("google_exchange", gh)).toThrow(
      /Authentication required/,
    );

    const google = signHandoff("google_exchange", USER).token;
    expect(() => consumeHandoff("github_handoff", google)).toThrow(
      /Authentication required/,
    );
  });

  test("rejects a missing or malformed code", () => {
    expect(() => consumeHandoff("google_exchange", undefined)).toThrow(
      /Authentication required/,
    );
    expect(() => consumeHandoff("google_exchange", "not.a.jwt")).toThrow(
      /expired/,
    );
  });
});

describe("deep links", () => {
  test("builds a route the app can actually resolve", () => {
    // A cold start goes through this URL, so it has to name a real route.
    expect(mobileDeepLink("callback")).toBe("tau://callback");
    expect(mobileDeepLink("/account")).toBe("tau://account");
  });

  test("withParam leaves a custom scheme unnormalised", () => {
    // `new URL` would turn this into `tau://account/`, which is a different
    // route to expo-router.
    expect(withParam("tau://account", "github", "connected")).toBe(
      "tau://account?github=connected",
    );
  });

  test("withParam still handles http urls", () => {
    expect(withParam("https://app.example/x", "github", "connected")).toBe(
      "https://app.example/x?github=connected",
    );
  });
});

const { signOAuthClientState, oauthClientFromState } = await import("@/api/lib/mobileLink");

describe("admin OAuth state", () => {
  test("round-trips an admin marker, distinct from mobile", () => {
    const state = signOAuthClientState("admin");
    expect(oauthClientFromState(state)).toBe("admin");
    expect(isMobileOAuthState(state)).toBe(false);
  });

  test("a forged admin marker reads as web", () => {
    const forged = jwt.sign({ purpose: "oauth_client", client: "admin" }, "not-the-secret", {
      algorithm: "HS256",
    });
    expect(oauthClientFromState(forged)).toBeNull();
  });

  test("an unknown client in a validly signed state reads as web", () => {
    const odd = jwt.sign({ purpose: "oauth_client", client: "evil" }, env.ACCESS_TOKEN_SECRET, {
      algorithm: "HS256",
    });
    expect(oauthClientFromState(odd)).toBeNull();
  });
});
