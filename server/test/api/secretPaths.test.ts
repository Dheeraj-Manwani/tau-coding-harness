import { describe, expect, test } from "bun:test";
import { isSecretPath } from "@/api/lib/projectFiles.ts";

// ── Drift guard ────────────────────────────────────────────────────────────────
// This file is duplicated verbatim in api/ and worker-service/ (only the import
// line differs), the same way pricing.test.ts is. `isSecretPath` exists twice —
// api/src/lib/projectFiles.ts and
// worker-service/src/agent/tools/functions/utils.ts — and the two must agree:
// the worker decides what gets *persisted*, the api decides what gets *pushed*.
// If they diverge, one service starts storing what the other refuses to, and the
// gap is exactly where a credential leaks. Change one copy, change both, and
// keep these vectors identical.
//
// Background: doc/AI_FOR_GENERATED_APPS.md §7.1.

describe("isSecretPath", () => {
  test("catches every dotenv flavor, at any depth", () => {
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath(".env.local")).toBe(true);
    expect(isSecretPath(".env.production")).toBe(true);
    // Deliberately included: the template's .gitignore excludes `.env.*`
    // anyway, so allowing it would buy nothing.
    expect(isSecretPath(".env.example")).toBe(true);
    // A nested one is exactly as dangerous as a root one.
    expect(isSecretPath("server/.env")).toBe(true);
    expect(isSecretPath("packages/api/.env.local")).toBe(true);
  });

  test("catches key and certificate material", () => {
    expect(isSecretPath("certs/server.pem")).toBe(true);
    expect(isSecretPath("private.key")).toBe(true);
    expect(isSecretPath("keystore.p12")).toBe(true);
    expect(isSecretPath("id_rsa")).toBe(true);
    expect(isSecretPath("id_ed25519.pub")).toBe(true);
    expect(isSecretPath(".ssh/known_hosts")).toBe(true);
  });

  test("catches tool credential files", () => {
    expect(isSecretPath(".npmrc")).toBe(true);
    expect(isSecretPath(".netrc")).toBe(true);
    expect(isSecretPath(".aws/credentials")).toBe(true);
  });

  test("excludes the whole .git subtree", () => {
    expect(isSecretPath(".git/config")).toBe(true);
    expect(isSecretPath(".git/refs/heads/main")).toBe(true);
  });

  test("leaves ordinary project files alone", () => {
    // False positives here silently drop real source from the user's repo, so
    // this matters as much as the catches above.
    expect(isSecretPath("src/App.tsx")).toBe(false);
    expect(isSecretPath("package.json")).toBe(false);
    expect(isSecretPath(".gitignore")).toBe(false);
    expect(isSecretPath("server/index.ts")).toBe(false);
    expect(isSecretPath(".tau/CONTEXT.md")).toBe(false);
    expect(isSecretPath("src/lib/keyboard.ts")).toBe(false);
    expect(isSecretPath("src/components/Environment.tsx")).toBe(false);
    expect(isSecretPath("public/monkey.png")).toBe(false);
  });

  test("is not fooled by a leading slash", () => {
    expect(isSecretPath("/.env")).toBe(true);
    expect(isSecretPath("/src/App.tsx")).toBe(false);
  });
});
