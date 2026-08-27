import { describe, expect, test } from "bun:test";

import { env } from "@/lib/env";
import { modelForEffort } from "@/worker/agent/config";

describe("modelForEffort", () => {
  test("uses flash for LOW and DeepSeek pro for HIGH and MAX", () => {
    expect(modelForEffort("LOW")).toBe(env.DEEPSEEK_MODEL_FLASH);
    expect(modelForEffort("HIGH")).toBe(env.DEEPSEEK_MODEL);
    expect(modelForEffort("MAX")).toBe(env.DEEPSEEK_MODEL);
  });
});
