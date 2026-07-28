import { beforeEach, describe, expect, test } from "bun:test";

// env.ts reads process.env at import time, so this must be set before the
// dynamic imports below pull it in. A throwaway value — these tests only need
// the encryption path to be *configured*, not to match anything real.
process.env.TAU_KEY_ENC_SECRET =
  process.env.TAU_KEY_ENC_SECRET ??
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.GATEWAY_MAX_OUTPUT_TOKENS = "4096";
process.env.GATEWAY_RPM = "60";
process.env.GATEWAY_MAX_CONCURRENT = "8";

const {
  decryptKey,
  displayPrefix,
  encryptKey,
  generateRawKey,
  isApiKeyFormat,
  keyEncryptionConfigured,
  lookupHashFor,
} = await import("../src/lib/apiKeys");

const { listModels, isModelAlias, MODEL_ALIASES } = await import(
  "../src/lib/gatewayModels"
);

const { validateChatRequest, dailyCapFor, __resetGatewayLimiters } =
  await import("../src/services/gateway.service");

const { GatewayRequestError } = await import("../src/lib/gatewayErrors");

beforeEach(() => __resetGatewayLimiters());

const messages = [{ role: "user" as const, content: "hi" }];

describe("api key format and crypto", () => {
  test("encryption is configured for these tests", () => {
    expect(keyEncryptionConfigured()).toBe(true);
  });

  test("round-trips through AES-256-GCM", () => {
    const raw = generateRawKey();
    expect(decryptKey(encryptKey(raw))).toBe(raw);
  });

  test("ciphertext is versioned and non-deterministic", () => {
    const raw = generateRawKey();
    const a = encryptKey(raw);
    const b = encryptKey(raw);

    expect(a.startsWith("v1:")).toBe(true);
    // A fresh IV per encryption — identical plaintext must not produce
    // identical ciphertext, or the store leaks which users share a key value.
    expect(a).not.toBe(b);
    expect(decryptKey(b)).toBe(raw);
  });

  test("a tampered auth tag fails closed", () => {
    const stored = encryptKey(generateRawKey());
    const [v, iv, , ct] = stored.split(":");
    const forged = [v, iv, Buffer.alloc(16).toString("base64"), ct].join(":");

    expect(() => decryptKey(forged)).toThrow();
  });

  test("keys are recognizably tau's and long enough to be unguessable", () => {
    const raw = generateRawKey();
    expect(raw.startsWith("tau_sk_live_")).toBe(true);
    expect(raw.length).toBeGreaterThan(50);
    expect(isApiKeyFormat(raw)).toBe(true);
  });

  test("rejects things that are not tau keys", () => {
    expect(isApiKeyFormat("sk-proj-abc123")).toBe(false);
    expect(isApiKeyFormat("tau_sk_live_")).toBe(false);
    expect(isApiKeyFormat("")).toBe(false);
  });

  test("the display prefix reveals nothing usable", () => {
    const raw = generateRawKey();
    const prefix = displayPrefix(raw);

    expect(raw.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(raw.length / 2);
    expect(isApiKeyFormat(prefix)).toBe(false);
  });

  test("lookupHash is stable, and distinct per key", () => {
    const a = generateRawKey();
    const b = generateRawKey();

    expect(lookupHashFor(a)).toBe(lookupHashFor(a));
    expect(lookupHashFor(a)).not.toBe(lookupHashFor(b));
    // sha256 hex — the column is the unique auth index.
    expect(lookupHashFor(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("model aliases", () => {
  test("only tau-* aliases are accepted", () => {
    expect(isModelAlias("tau-fast")).toBe(true);
    expect(isModelAlias("tau-smart")).toBe(true);
    expect(isModelAlias("tau-max")).toBe(true);
    // The whole point of the indirection: vendor ids are not part of the
    // contract, so an app can never bake one in.
    expect(isModelAlias("deepseek-v4-flash")).toBe(false);
    expect(isModelAlias("gpt-4")).toBe(false);
    expect(isModelAlias("")).toBe(false);
  });

  test("GET /v1/models lists exactly the aliases", () => {
    const listed = listModels();
    expect(listed.object).toBe("list");
    expect(listed.data.map((m) => m.id)).toEqual([...MODEL_ALIASES]);
    expect(listed.data.every((m) => m.owned_by === "tau")).toBe(true);
  });
});

describe("validateChatRequest", () => {
  test("defaults to tau-fast when no model is given", () => {
    const { resolved } = validateChatRequest({ messages });
    expect(resolved.alias).toBe("tau-fast");
  });

  test("rejects an unknown model with the available list", () => {
    try {
      validateChatRequest({ model: "gpt-4", messages });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayRequestError);
      const e = err as InstanceType<typeof GatewayRequestError>;
      expect(e.status).toBe(400);
      expect(e.body.code).toBe("model_not_found");
      // The message has to name the alternatives or the app author is stuck.
      expect(e.body.message).toContain("tau-fast");
    }
  });

  test("rejects streaming explicitly rather than silently ignoring it", () => {
    // Silently returning a non-streamed body would hand the OpenAI SDK a shape
    // it is not expecting, which fails much further from the cause.
    try {
      validateChatRequest({ model: "tau-fast", messages, stream: true });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as InstanceType<typeof GatewayRequestError>;
      expect(e.body.code).toBe("stream_not_supported");
    }
  });

  test("stream: false is fine", () => {
    expect(() =>
      validateChatRequest({ model: "tau-fast", messages, stream: false }),
    ).not.toThrow();
  });

  test("requires a non-empty messages array", () => {
    for (const bad of [undefined, [], "hello", {}]) {
      try {
        validateChatRequest({ model: "tau-fast", messages: bad });
        throw new Error(`should have thrown for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as InstanceType<typeof GatewayRequestError>).body.code).toBe(
          "invalid_messages",
        );
      }
    }
  });

  test("rejects n > 1, which would break the per-request cost bound", () => {
    try {
      validateChatRequest({ model: "tau-fast", messages, n: 3 });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as InstanceType<typeof GatewayRequestError>).body.code).toBe(
        "invalid_n",
      );
    }
  });

  test("clamps max_tokens instead of failing the request", () => {
    // The ceiling exists to bound cost. Rejecting outright would be a worse
    // experience than capping, and the caller still gets a usable completion.
    const { body } = validateChatRequest({
      model: "tau-fast",
      messages,
      max_tokens: 1_000_000,
    });
    expect(body.max_tokens).toBe(4096);
  });

  test("honors a max_tokens under the ceiling", () => {
    const { body } = validateChatRequest({
      model: "tau-fast",
      messages,
      max_tokens: 256,
    });
    expect(body.max_tokens).toBe(256);
  });

  test("accepts max_completion_tokens as the newer spelling", () => {
    const { body } = validateChatRequest({
      model: "tau-fast",
      messages,
      max_completion_tokens: 128,
    });
    expect(body.max_tokens).toBe(128);
  });

  test("applies the ceiling when no limit is requested", () => {
    // An unbounded default would make the overshoot window unbounded too.
    const { body } = validateChatRequest({ model: "tau-fast", messages });
    expect(body.max_tokens).toBe(4096);
  });

  test("forces stream off on the upstream body", () => {
    const { body } = validateChatRequest({ model: "tau-fast", messages });
    expect(body.stream).toBe(false);
  });

  test("passes tools and response_format through", () => {
    // Function calling is just tokens, and apps genuinely want it.
    const tools = [
      { type: "function", function: { name: "get_weather", parameters: {} } },
    ];
    const { body } = validateChatRequest({
      model: "tau-fast",
      messages,
      tools,
      response_format: { type: "json_object" },
    });
    expect(body.tools).toEqual(tools as never);
    expect(body.response_format).toEqual({ type: "json_object" } as never);
  });

  test("drops unknown fields rather than forwarding them upstream", () => {
    const { body } = validateChatRequest({
      model: "tau-fast",
      messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ user: "spoofed", logit_bias: { 1: 1 } } as any),
    });
    expect("user" in body).toBe(false);
    expect("logit_bias" in body).toBe(false);
  });
});

describe("dailyCapFor", () => {
  const key = (dailyCapMicro: bigint | null) =>
    ({ dailyCapMicro }) as Parameters<typeof dailyCapFor>[0];

  test("uses the per-key cap when set", () => {
    expect(dailyCapFor(key(5_000_000n))).toBe(5_000_000n);
  });

  test("falls back to the global default", () => {
    expect(dailyCapFor(key(null))).toBe(20n * 1_000_000n);
  });

  test("a zero cap means zero, not 'unset'", () => {
    // ?? not ||, or a user setting the cap to 0 to pause a runaway app would
    // silently get the default instead.
    expect(dailyCapFor(key(0n))).toBe(0n);
  });
});
