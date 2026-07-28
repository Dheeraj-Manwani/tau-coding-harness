import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";

// Re-auth gates the two endpoints that hand back a live spend credential, so a
// stolen session is not enough on its own.
// Background: doc/AI_FOR_GENERATED_APPS.md §5, §8.11.

const { env } = await import("../src/lib/env");
const { requireReauth } = await import("../src/services/reauth.service");

const USER = "user-1";

function sign(payload: object, opts?: jwt.SignOptions): string {
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, opts);
}

function rejects(token: unknown): string {
  try {
    requireReauth(USER, token);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected requireReauth to throw");
}

describe("requireReauth", () => {
  test("accepts a live token for this user", () => {
    const token = sign({ sub: USER, purpose: "reauth" }, { expiresIn: 300 });
    expect(() => requireReauth(USER, token)).not.toThrow();
  });

  test("rejects a missing token", () => {
    expect(rejects(undefined)).toContain("Confirm it's you");
    expect(rejects("")).toContain("Confirm it's you");
    expect(rejects(null)).toContain("Confirm it's you");
  });

  test("rejects another user's token", () => {
    // The `sub` check is the whole reason the token is bound to a user at all:
    // without it, anyone with a session could re-auth as themselves and spend
    // the token on someone else's key.
    const token = sign({ sub: "user-2", purpose: "reauth" }, { expiresIn: 300 });
    expect(rejects(token)).toContain("isn't valid for this account");
  });

  test("rejects an ordinary access token", () => {
    // Same secret, different purpose. Without the purpose check, the session
    // token the browser already holds would satisfy the gate — which would make
    // the whole feature decorative.
    const accessToken = sign({ sub: USER, email: "a@b.c" }, { expiresIn: 900 });
    expect(rejects(accessToken)).toContain("isn't valid for this account");
  });

  test("rejects an expired token", () => {
    const token = sign({ sub: USER, purpose: "reauth" }, { expiresIn: -1 });
    expect(rejects(token)).toContain("expired");
  });

  test("rejects a token signed with the wrong secret", () => {
    const forged = jwt.sign({ sub: USER, purpose: "reauth" }, "not-the-secret", {
      expiresIn: 300,
    });
    expect(rejects(forged)).toContain("expired");
  });

  test("rejects a garbage string", () => {
    expect(rejects("not.a.jwt")).toContain("expired");
  });
});
