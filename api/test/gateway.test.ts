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

const {
  validateChatRequest,
  dailyCapFor,
  estimateTokensFromText,
  extractDeltaText,
  extractDisplayText,
  toChatCompletionRequest,
  __resetGatewayLimiters,
} = await import("../src/services/gateway.service");

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

  test("flags a streaming request without changing the base body", () => {
    const { stream, body } = validateChatRequest({
      model: "tau-fast",
      messages,
      stream: true,
    });
    expect(stream).toBe(true);
    // The streaming path overlays `stream`/`stream_options` itself; the shared
    // validated body stays non-streaming so both paths agree on everything else.
    expect(body.stream).toBe(false);
  });

  test("stream: false and omitted both mean non-streaming", () => {
    expect(validateChatRequest({ model: "tau-fast", messages }).stream).toBe(
      false,
    );
    expect(
      validateChatRequest({ model: "tau-fast", messages, stream: false }).stream,
    ).toBe(false);
  });

  test("rejects a non-boolean stream rather than coercing it", () => {
    // `stream: "true"` is a real mistake to make from an untyped client, and
    // coercing it would silently pick a wire format the caller didn't ask for.
    try {
      validateChatRequest({
        model: "tau-fast",
        messages,
        stream: "true" as unknown as boolean,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as InstanceType<typeof GatewayRequestError>).body.code).toBe(
        "invalid_stream",
      );
    }
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

describe("extractDeltaText", () => {
  // Regression: this counted only `delta.content`, so for Deepseek — which
  // streams into `reasoning_content` and leaves `content` null for most of a
  // response — the disconnect estimate came out as 0 tokens. A live 183-frame
  // stream billed as input-only until this was fixed.
  test("counts reasoning_content, which reasoning models bill as output", () => {
    expect(
      extractDeltaText({
        choices: [{ delta: { content: null, reasoning_content: "We" } }],
      }),
    ).toBe("We");
  });

  test("counts ordinary content", () => {
    expect(
      extractDeltaText({
        choices: [{ delta: { content: "hello", reasoning_content: null } }],
      }),
    ).toBe("hello");
  });

  test("counts both when a chunk carries both", () => {
    expect(
      extractDeltaText({
        choices: [{ delta: { content: "ab", reasoning_content: "cd" } }],
      }),
    ).toBe("abcd");
  });

  test("survives the shapes a real stream actually sends", () => {
    // Role-only opener, the terminal empty delta, and the usage chunk (which
    // has no choices at all) must all contribute nothing rather than throw.
    expect(extractDeltaText({ choices: [{ delta: { role: "assistant" } }] })).toBe("");
    expect(extractDeltaText({ choices: [] })).toBe("");
    expect(extractDeltaText({})).toBe("");
    expect(extractDeltaText({ choices: null })).toBe("");
    expect(extractDeltaText({ choices: [{}] })).toBe("");
  });

  test("ignores non-string deltas rather than stringifying them", () => {
    expect(
      extractDeltaText({
        choices: [{ delta: { content: 42, reasoning_content: { a: 1 } } }],
      }),
    ).toBe("");
  });
});

describe("extractDisplayText", () => {
  // The billing/display split. `tau-*` are reasoning models: they stream their
  // working into reasoning_content before the answer lands in content. Billing
  // must count both; a chat bubble must show only the answer, or the end user
  // of a generated app watches the model think out loud.
  const chunk = (delta: unknown) => ({ choices: [{ delta }] });

  test("excludes reasoning_content that extractDeltaText includes", () => {
    const c = chunk({ content: null, reasoning_content: "We need to..." });
    expect(extractDeltaText(c)).toBe("We need to...");
    expect(extractDisplayText(c)).toBe("");
  });

  test("returns the answer once content arrives", () => {
    const c = chunk({ content: "1 2 3", reasoning_content: null });
    expect(extractDisplayText(c)).toBe("1 2 3");
    expect(extractDeltaText(c)).toBe("1 2 3");
  });

  test("takes only content when a chunk carries both", () => {
    expect(
      extractDisplayText(chunk({ content: "answer", reasoning_content: "think" })),
    ).toBe("answer");
  });

  test("tolerates the empty shapes a real stream sends", () => {
    expect(extractDisplayText({ choices: [] })).toBe("");
    expect(extractDisplayText({})).toBe("");
    expect(extractDisplayText({ choices: null })).toBe("");
    expect(extractDisplayText(chunk({ role: "assistant" }))).toBe("");
  });
});

describe("toChatCompletionRequest", () => {
  // Maps the plain-fetch surface onto the OpenAI one, so both dialects converge
  // on a single validated body and one place decides what is billed.
  const msgs = (r: ReturnType<typeof toChatCompletionRequest>) =>
    r.messages as { role: string; content: string }[];

  test("turns a prompt into a single user message", () => {
    const r = toChatCompletionRequest({ prompt: "hi" }, false);
    expect(msgs(r)).toEqual([{ role: "user", content: "hi" }]);
    expect(r.stream).toBe(false);
  });

  test("puts system before the prompt", () => {
    const r = toChatCompletionRequest({ prompt: "hi", system: "Be terse." }, false);
    expect(msgs(r)).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" },
    ]);
  });

  test("passes a messages array through for multi-turn", () => {
    const conversation = [
      { role: "user", content: "My name is Ada." },
      { role: "assistant", content: "Hello Ada!" },
      { role: "user", content: "What is my name?" },
    ];
    expect(msgs(toChatCompletionRequest({ messages: conversation }, false))).toEqual(
      conversation,
    );
  });

  test("prepends system to a messages array too", () => {
    const r = toChatCompletionRequest(
      { messages: [{ role: "user", content: "hi" }], system: "Be terse." },
      false,
    );
    expect(msgs(r)[0]).toEqual({ role: "system", content: "Be terse." });
  });

  test("requires exactly one of prompt or messages", () => {
    const codes: string[] = [];
    for (const input of [
      {},
      { prompt: "" },
      { messages: [] },
      { prompt: "a", messages: [{ role: "user", content: "b" }] },
    ]) {
      try {
        toChatCompletionRequest(input, false);
        throw new Error(`should have thrown for ${JSON.stringify(input)}`);
      } catch (err) {
        codes.push((err as InstanceType<typeof GatewayRequestError>).body.code);
      }
    }
    expect(codes).toEqual([
      "missing_prompt",
      "missing_prompt",
      "missing_prompt",
      "ambiguous_prompt",
    ]);
  });

  test("rejects a non-string system", () => {
    try {
      toChatCompletionRequest({ prompt: "hi", system: 42 }, false);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as InstanceType<typeof GatewayRequestError>).body.code).toBe(
        "invalid_system",
      );
    }
  });

  test("`json: true` becomes OpenAI's response_format", () => {
    // So an app never has to know the nested vendor shape.
    expect(
      toChatCompletionRequest({ prompt: "hi", json: true }, false).response_format,
    ).toEqual({ type: "json_object" });
    expect(
      toChatCompletionRequest({ prompt: "hi" }, false).response_format,
    ).toBeUndefined();
  });

  test("floors maxTokens so a reasoning model still reaches an answer", () => {
    // Regression: maxTokens 30 returned finishReason "length" and text "" —
    // the whole budget went on reasoning_content before any answer was written.
    expect(toChatCompletionRequest({ prompt: "hi", maxTokens: 30 }, false).max_tokens).toBe(256);
    // A caller asking for more than the floor keeps their value.
    expect(toChatCompletionRequest({ prompt: "hi", maxTokens: 1000 }, false).max_tokens).toBe(1000);
  });

  test("carries the stream flag through", () => {
    expect(toChatCompletionRequest({ prompt: "hi" }, true).stream).toBe(true);
  });
});

describe("estimateTokensFromText", () => {
  // Only reached when a stream ends with no usage chunk — a client that hung up,
  // or an upstream that ignored stream_options. Billing zero there would make
  // "disconnect early" a free-inference exploit, so an approximate charge beats
  // no charge.
  test("approximates chars/4, rounding up", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
    expect(estimateTokensFromText("a".repeat(400))).toBe(100);
  });

  test("never returns a negative or fractional count", () => {
    for (const s of ["", "a", "ab", "abc", "abcd", "hello world"]) {
      const n = estimateTokensFromText(s);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  test("is monotonic in length, so a longer stream never bills less", () => {
    let prev = -1;
    for (let i = 0; i < 50; i += 1) {
      const n = estimateTokensFromText("x".repeat(i));
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
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
