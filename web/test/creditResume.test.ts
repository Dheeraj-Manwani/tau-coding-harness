import { describe, expect, test } from "bun:test";

import {
  shouldOfferCreditResume,
  wasInterruptedForCredits,
} from "@/src/features/project/creditResume";

const outOfCredits = {
  role: "ai" as const,
  content:
    "⚠️ Out of credits — this run was stopped before the task finished. Add credits, then send another message to continue.",
};

describe("credit resume", () => {
  test("offers continue when credits were added after an interrupted run", () => {
    expect(shouldOfferCreditResume([outOfCredits], 10)).toBe(true);
    expect(wasInterruptedForCredits([outOfCredits])).toBe(true);
  });

  test("does not offer continue while the balance is empty", () => {
    expect(shouldOfferCreditResume([outOfCredits], 0)).toBe(false);
  });

  test("does not offer continue after the user has already replied", () => {
    expect(
      shouldOfferCreditResume(
        [outOfCredits, { role: "user", content: "Try again" }],
        10,
      ),
    ).toBe(false);
  });

  test("does not treat a per-request budget stop as no-credit recovery", () => {
    expect(
      shouldOfferCreditResume(
        [
          {
            role: "ai",
            content:
              "⚠️ This run reached its per-request credit budget and was stopped before finishing.",
          },
        ],
        10,
      ),
    ).toBe(false);
  });

  test("ignores a trailing context divider", () => {
    expect(
      shouldOfferCreditResume(
        [outOfCredits, { role: "divider", content: "" }],
        10,
      ),
    ).toBe(true);
  });
});
