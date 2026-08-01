import { describe, expect, test } from "bun:test";

import { costMicro, PRICING, RESERVE_CEILING_BY_EFFORT } from "@/lib/pricing";

const FLASH = "deepseek-v4-flash"; // LOW
const PRO = "deepseek-v4-pro"; // HIGH
const KIMI = "kimi-k2.7-code"; // MAX

// A representative turn: mostly input, some output.
const IN = 100_000;
const OUT = 10_000;

describe("effort tiers are priced LOW < HIGH < MAX", () => {
  test("per-token input rates increase with tier", () => {
    expect(PRICING[FLASH]!.inputPerM).toBeLessThan(PRICING[PRO]!.inputPerM);
    expect(PRICING[PRO]!.inputPerM).toBeLessThan(PRICING[KIMI]!.inputPerM);
  });

  test("per-token output rates increase with tier", () => {
    expect(PRICING[FLASH]!.outputPerM).toBeLessThan(PRICING[PRO]!.outputPerM);
    expect(PRICING[PRO]!.outputPerM).toBeLessThan(PRICING[KIMI]!.outputPerM);
  });

  test("an identical turn costs strictly more at each tier up", () => {
    const low = costMicro(FLASH, IN, OUT);
    const high = costMicro(PRO, IN, OUT);
    const max = costMicro(KIMI, IN, OUT);
    expect(low).toBeLessThan(high);
    expect(high).toBeLessThan(max);
  });

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
  test("HIGH billing is unchanged by the tier split", () => {
    // 2 credits/1M in, 8 credits/1M out — the original flat rate.
    expect(costMicro(PRO, 1_000_000, 0)).toBe(2_000_000n);
    expect(costMicro(PRO, 0, 1_000_000)).toBe(8_000_000n);
  });

  test("an unknown model falls back to the baseline rate, not zero", () => {
    expect(costMicro("some-new-model", 1_000_000, 0)).toBe(2_000_000n);
  });

  test("negative counts clamp to zero and fractional tokens truncate", () => {
    expect(costMicro(PRO, -5, -5)).toBe(0n);
    // 1 token (1.9 truncated) at 2_000_000 micro per 1M tokens = 2 micro.
    expect(costMicro(PRO, 1.9, 0)).toBe(2n);
  });
});
