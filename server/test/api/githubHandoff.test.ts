import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";

// The GitHub handoff token lets an in-app browser tab start the OAuth flow that
// `GET /auth/github` otherwise gates behind the refresh cookie — which mobile
// does not have. It rides in a query string, so it is deliberately 60 seconds
// long and single-use.
// Background: doc/SYNC_MOBILE.md §6.

const { env } = await import("@/lib/env");
const { signHandoff, consumeHandoff, signState, verifyState } = await import(
  "@/api/services/github.service"
);

const USER = "user-1";

function sign(payload: object, opts?: jwt.SignOptions): string {
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, opts);
}

function rejects(token: unknown): string {
  try {
    consumeHandoff(token);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected consumeHandoff to throw");
}

describe("consumeHandoff", () => {
  test("accepts a freshly minted token and returns its user", () => {
    const { token, expiresInSeconds } = signHandoff(USER);
    expect(expiresInSeconds).toBe(60);
    expect(consumeHandoff(token)).toBe(USER);
  });

  test("is single-use", () => {
    // The whole reason this is stateful. A token that reached the server has
    // been written to an access log; replaying it must not work.
    const { token } = signHandoff(USER);
    expect(consumeHandoff(token)).toBe(USER);
    expect(rejects(token)).toContain("already used");
  });

  test("burning one token does not affect another", () => {
    const a = signHandoff(USER).token;
    const b = signHandoff(USER).token;
    expect(consumeHandoff(a)).toBe(USER);
    expect(consumeHandoff(b)).toBe(USER);
  });

  test("rejects a missing token", () => {
    expect(rejects(undefined)).toContain("Authentication required");
    expect(rejects("")).toContain("Authentication required");
    expect(rejects(null)).toContain("Authentication required");
  });

  test("rejects an ordinary access token", () => {
    // Same secret, different purpose. Without the purpose check, the session
    // token the app already holds would satisfy the gate — and being reusable,
    // it would erase the single-use property entirely.
    const accessToken = sign({ sub: USER, email: "a@b.c" }, { expiresIn: 900 });
    expect(rejects(accessToken)).toContain("Authentication required");
  });

  test("rejects a re-auth token", () => {
    // The other short-lived purpose-tagged token under this secret.
    const reauth = sign({ sub: USER, purpose: "reauth" }, { expiresIn: 300 });
    expect(rejects(reauth)).toContain("Authentication required");
  });

  test("rejects an expired token", () => {
    const token = sign(
      { sub: USER, purpose: "github_handoff", jti: "j1" },
      { expiresIn: -1 },
    );
    expect(rejects(token)).toContain("expired");
  });

  test("rejects a token signed with the wrong secret", () => {
    const forged = jwt.sign(
      { sub: USER, purpose: "github_handoff", jti: "j2" },
      "not-the-secret",
      { expiresIn: 60 },
    );
    expect(rejects(forged)).toContain("expired");
  });

  test("rejects a token with no jti", () => {
    // No jti means nothing to burn, so it would be replayable forever.
    const token = sign(
      { sub: USER, purpose: "github_handoff" },
      { expiresIn: 60 },
    );
    expect(rejects(token)).toContain("Authentication required");
  });

  test("rejects garbage", () => {
    expect(rejects("not.a.jwt")).toContain("expired");
  });
});

describe("state client field", () => {
  test("defaults to web, keeping the existing flow unchanged", () => {
    expect(verifyState(signState(USER, "https://app.example/x")).client).toBe(
      "web",
    );
  });

  test("round-trips mobile", () => {
    const state = signState(USER, undefined, "mobile");
    const resolved = verifyState(state);
    expect(resolved.client).toBe("mobile");
    expect(resolved.userId).toBe(USER);
  });

  test("an unsigned client claim cannot be injected", () => {
    // `callback` decides which scheme to redirect to from this field, so a
    // forged one would be an open redirect into an arbitrary app.
    const forged = jwt.sign(
      { sub: USER, purpose: "github_link", client: "mobile" },
      "not-the-secret",
      { expiresIn: 600 },
    );
    expect(() => verifyState(forged)).toThrow();
  });

  test("an unrecognised client value falls back to web", () => {
    const odd = sign(
      { sub: USER, purpose: "github_link", client: "desktop" },
      { expiresIn: 600 },
    );
    expect(verifyState(odd).client).toBe("web");
  });
});
