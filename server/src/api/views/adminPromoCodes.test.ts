import { describe, expect, test } from "bun:test";
import { renderAdminPromoCodes } from "./adminPromoCodes";

describe("renderAdminPromoCodes", () => {
  test("renders every supported promo-code field", () => {
    const html = renderAdminPromoCodes();
    for (const id of [
      "code",
      "credits",
      "description",
      "maxRedemptions",
      "perUserLimit",
      "expiresAt",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("submits to the protected promo-code endpoint", () => {
    const html = renderAdminPromoCodes();
    expect(html).toContain('fetch("/admin/promo-codes"');
    expect(html).toContain('credentials: "same-origin"');
    expect(html).toContain('replace(/\\s+/g, "")');
  });

  test("explains fields and converts local expiry to unambiguous UTC", () => {
    const html = renderAdminPromoCodes();
    expect(html).toContain("Credits added to a customer's non-expiring bonus balance");
    expect(html).toContain("Leave blank to keep the code valid indefinitely");
    expect(html).toContain('id="expiryPreview"');
    expect(html).toContain("new Date(year, month - 1, day, hour, minute, 0, 0)");
    expect(html).toContain("Expiration must be in the future");
    expect(html).toContain("date.toISOString()");
  });

  test("ships valid browser JavaScript", () => {
    const script = renderAdminPromoCodes().match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
  });
});
