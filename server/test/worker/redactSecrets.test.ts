import { describe, expect, test } from "bun:test";
import { redactSecrets } from "@/worker/agent/tools/executor.ts";

// The key reaches a sandbox both as a `.env` file and as `Sandbox.create({ envs })`,
// so `run_command("env")`, `cat .env` and `read_file(".env")` can all surface it.
// A tool result is not just shown to the model — it is persisted into the job
// transcript, where it outlives the sandbox that held the key.
//
// Background: doc/AI_FOR_GENERATED_APPS.md §8.20.

const KEY = "tau_sk_live_aB3dEf6hJ9kLmN2pQr5sT8vW1xYz4A7b";

describe("redactSecrets", () => {
  test("redacts a key in a bare string", () => {
    expect(redactSecrets(KEY)).not.toContain("aB3dEf6h");
    expect(redactSecrets(KEY)).toContain("redacted");
  });

  test("redacts inside surrounding text, keeping the rest", () => {
    const out = redactSecrets(`TAU_API_KEY=${KEY}\nTAU_AI_URL=https://x/ai`);
    expect(out).not.toContain(KEY);
    expect(out).toContain("TAU_AI_URL=https://x/ai");
  });

  test("redacts every occurrence, not just the first", () => {
    const out = redactSecrets(`${KEY} and again ${KEY}`);
    expect(out).not.toContain("aB3dEf6h");
    expect(out.match(/redacted/g)).toHaveLength(2);
  });

  test("reaches into the shape run_command actually returns", () => {
    const result = redactSecrets({
      exitCode: 0,
      stdout: `TAU_API_KEY=${KEY}`,
      stderr: "",
    });
    expect(result.stdout).not.toContain(KEY);
    expect(result.exitCode).toBe(0);
  });

  test("reaches through nested objects and arrays", () => {
    const out = redactSecrets({
      files: [{ path: ".env", content: `A=${KEY}` }],
      meta: { nested: { deep: KEY } },
    });
    expect(out.files[0]!.content).not.toContain(KEY);
    expect(out.meta.nested.deep).not.toContain(KEY);
  });

  test("leaves non-string scalars alone", () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  test("does not mangle ordinary output that merely mentions the var name", () => {
    const text = "Set TAU_API_KEY in your environment (see .env.example)";
    expect(redactSecrets(text)).toBe(text);
  });

  test("catches a truncated or oddly-formatted key", () => {
    // The prefix exists so a key is recognizable on sight; the matcher does not
    // insist on exactly 32 base62 chars, because a half-printed key is still a
    // key someone can go looking for.
    expect(redactSecrets("tau_sk_live_abcdefgh")).toContain("redacted");
  });
});
