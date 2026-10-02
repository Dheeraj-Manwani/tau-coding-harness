import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dotenvValue,
  redactSecretValues,
  renderDotenv,
  secretNameError,
  secretValueError,
} from "@/lib/projectSecrets.ts";

// User-supplied keys reach the generated app only through a tau-written `.env`
// that Bun parses at boot. A value Bun reads back differently is a key that
// silently fails to authenticate — so these round-trip through a real Bun
// process rather than asserting on the rendered text.

const ROUND_TRIP: Record<string, string> = {
  PLAIN: "sk_live_51HxYzAbCdEfGh",
  URL: "https://api.example.com/v1?x=1&y=2",
  DOLLAR: "pa$$word$HOME",
  SPACES: "  leading and trailing  ",
  HASH: "abc # not a comment",
  QUOTES: `he said "hi" and 'bye'`,
  PEM: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nAbCdEf==\n-----END PRIVATE KEY-----",
  // A service-account JSON: literal backslash-n sequences inside, and quotes.
  JSON_CREDS: `{"type":"service_account","private_key":"-----BEGIN KEY-----\\nMIIE\\n-----END KEY-----\\n","client_email":"a@b.iam"}`,
};

describe("renderDotenv", () => {
  test("every value round-trips through Bun's .env parser exactly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tau-dotenv-"));
    try {
      writeFileSync(join(dir, ".env"), renderDotenv(ROUND_TRIP));
      writeFileSync(
        join(dir, "read.ts"),
        `const keys = ${JSON.stringify(Object.keys(ROUND_TRIP))};
         console.log(JSON.stringify(Object.fromEntries(keys.map((k) => [k, process.env[k]]))));`,
      );
      const proc = Bun.spawn([process.execPath, "read.ts"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        // Nothing inherited may shadow what the file says.
        env: { PATH: process.env.PATH ?? "" },
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      expect(JSON.parse(out)).toEqual(ROUND_TRIP);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("leaves URL-safe values bare", () => {
    expect(dotenvValue("sk_test_abc-123.x:y/z+w=")).toBe("sk_test_abc-123.x:y/z+w=");
  });
});

describe("secretNameError", () => {
  test("accepts ordinary provider names", () => {
    expect(secretNameError("STRIPE_SECRET_KEY")).toBeNull();
    expect(secretNameError("OPENWEATHER_API_KEY")).toBeNull();
  });

  test("rejects names that are not UPPER_SNAKE_CASE", () => {
    expect(secretNameError("stripeKey")).not.toBeNull();
    expect(secretNameError("1KEY")).not.toBeNull();
    expect(secretNameError("A")).not.toBeNull();
  });

  test("rejects VITE_ names, which Vite bundles into the browser", () => {
    expect(secretNameError("VITE_STRIPE_KEY")).toContain("browser");
  });

  test("rejects tau's own and system variables", () => {
    expect(secretNameError("TAU_API_KEY")).not.toBeNull();
    expect(secretNameError("PATH")).not.toBeNull();
    expect(secretNameError("PORT")).not.toBeNull();
  });
});

describe("secretValueError", () => {
  test("rejects empty, NUL-bearing and oversized values", () => {
    expect(secretValueError("")).not.toBeNull();
    expect(secretValueError("a\0b")).not.toBeNull();
    expect(secretValueError("x".repeat(20_000))).not.toBeNull();
    expect(secretValueError("sk_live_ok")).toBeNull();
  });
});

describe("redactSecretValues", () => {
  const KEY = "sk_live_51HxYzAbCdEfGhIjKl";

  test("redacts a value anywhere in a nested tool result", () => {
    const out = redactSecretValues(
      { stdout: `STRIPE_SECRET_KEY=${KEY}\nPORT=3000`, nested: [`Bearer ${KEY}`] },
      [KEY],
    );
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.stdout).toContain("PORT=3000");
  });

  test("redacts each line of a multi-line key printed on its own", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const out = redactSecretValues("line: MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", [pem]);
    expect(out).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
  });

  test("ignores values too short to redact without mangling output", () => {
    expect(redactSecretValues("abc def abc", ["abc"])).toBe("abc def abc");
  });
});
