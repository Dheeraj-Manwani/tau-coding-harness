import { describe, expect, test } from "bun:test";

import { screenshotLooksUseful } from "@/worker/lib/screenshotQuality";

describe("screenshot quality", () => {
  test("rejects white, black, and compression-noise-only frames", () => {
    expect(
      screenshotLooksUseful({ mean: 255, variance: 0, range: 0, buckets: 1 }),
    ).toBe(false);
    expect(
      screenshotLooksUseful({ mean: 0, variance: 0, range: 0, buckets: 1 }),
    ).toBe(false);
    expect(
      screenshotLooksUseful({ mean: 249, variance: 4, range: 9, buckets: 2 }),
    ).toBe(false);
  });

  test("accepts a rendered page with meaningful tonal structure", () => {
    expect(
      screenshotLooksUseful({
        mean: 132,
        variance: 860,
        range: 211,
        buckets: 12,
      }),
    ).toBe(true);
  });

  test("accepts restrained designs when two quality signals are strong", () => {
    expect(
      screenshotLooksUseful({
        mean: 239,
        variance: 24,
        range: 41,
        buckets: 3,
      }),
    ).toBe(true);
  });
});
