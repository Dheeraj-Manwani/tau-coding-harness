import { describe, expect, test } from "bun:test";

import { costMicro, PRICING, RESERVE_CEILING_BY_EFFORT } from "@/lib/pricing";

const FLASH = "deepseek-v4-flash"; // LOW
const PRO = "deepseek-v4-pro"; // HIGH and MAX
const KIMI = "kimi-k2.7-code"; // legacy usage compatibility

// A representative turn: mostly input, some output.
const IN = 100_000;
const OUT = 10_000;

describe("model pricing", () => {
  test("the production model rates match the margin-backed catalog", () => {
    expect(PRICING[FLASH]).toEqual({
      inputPerM: 450_000_000n,
      outputPerM: 1_400_000_000n,
    });
    expect(PRICING[PRO]).toEqual({
      inputPerM: 1_400_000_000n,
      outputPerM: 4_200_000_000n,
    });
    expect(PRICING[KIMI]).toEqual({
      inputPerM: 1_000_000_000n,
      outputPerM: 4_000_000_000n,
    });
    expect(PRICING[FLASH]!.inputPerM).toBeLessThan(PRICING[PRO]!.inputPerM);
    expect(PRICING[FLASH]!.outputPerM).toBeLessThan(PRICING[PRO]!.outputPerM);
  });

  test("an identical pro turn has the same token cost on HIGH and MAX", () => {
    const low = costMicro(FLASH, IN, OUT);
    const high = costMicro(PRO, IN, OUT);
    const max = costMicro(PRO, IN, OUT);
    expect(low).toBeLessThan(high);
    expect(max).toBe(high);
  });

  // Reserve ceilings still differ because MAX can run for longer and use more
  // sub-agents even though HIGH and MAX now share the same upstream model.
  test("reserve ceilings keep the same ordering", () => {
    expect(RESERVE_CEILING_BY_EFFORT.LOW).toBeLessThan(
      RESERVE_CEILING_BY_EFFORT.HIGH,
    );
    expect(RESERVE_CEILING_BY_EFFORT.HIGH).toBeLessThan(
      RESERVE_CEILING_BY_EFFORT.MAX,
    );
  });
});

describe("costMicro", () => {
  test("HIGH billing uses the margin-backed rates", () => {
    expect(costMicro(PRO, 1_000_000, 0)).toBe(1_400_000_000n);
    expect(costMicro(PRO, 0, 1_000_000)).toBe(4_200_000_000n);
  });

  test("an unknown model falls back to the baseline rate, not zero", () => {
    expect(costMicro("some-new-model", 1_000_000, 0)).toBe(1_400_000_000n);
  });

  test("negative counts clamp to zero and fractional tokens truncate", () => {
    expect(costMicro(PRO, -5, -5)).toBe(0n);
    // 1 token (1.9 truncated) at 1.4B micro per 1M tokens = 1,400 micro.
    expect(costMicro(PRO, 1.9, 0)).toBe(1_400n);
  });
});
