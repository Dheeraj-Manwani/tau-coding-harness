import { describe, expect, test } from "bun:test";

// The admin promo-code table must agree with redeem(): a code it calls "active"
// has to be one redemption would accept. These mirror redeem()'s checks.
const { promoCodeStatus } = await import("@/api/services/credits.service");

const now = new Date("2026-10-02T12:00:00Z");
const code = (over: Partial<Parameters<typeof promoCodeStatus>[0]> = {}) => ({
  isActive: true,
  expiresAt: null,
  maxRedemptions: null,
  redeemedCount: 0,
  ...over,
});

describe("promoCodeStatus", () => {
  test("active when nothing stops redemption", () => {
    expect(promoCodeStatus(code(), now)).toBe("active");
    expect(promoCodeStatus(code({ maxRedemptions: 10, redeemedCount: 9 }), now)).toBe("active");
    expect(promoCodeStatus(code({ expiresAt: new Date("2026-10-02T12:00:01Z") }), now)).toBe("active");
  });

  test("expired at the exact expiry instant, as redeem() treats it", () => {
    expect(promoCodeStatus(code({ expiresAt: now }), now)).toBe("expired");
  });

  test("used up once redemptions reach the cap", () => {
    expect(promoCodeStatus(code({ maxRedemptions: 10, redeemedCount: 10 }), now)).toBe("used_up");
  });

  test("an inactive code reads inactive whatever else is true, as redeem() checks it first", () => {
    expect(
      promoCodeStatus(code({ isActive: false, expiresAt: now, maxRedemptions: 1, redeemedCount: 5 }), now),
    ).toBe("inactive");
  });
});
