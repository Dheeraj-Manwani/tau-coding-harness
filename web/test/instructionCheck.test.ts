import { describe, expect, test } from "bun:test";

import { conflictSummary, type InstructionConflict } from "../src/features/settings/instructionCheck";

// After instructions are saved the server says whether two of them cannot both
// be followed. In a dialog that is closing there is room for one sentence.

const conflict = (over: Partial<InstructionConflict> = {}): InstructionConflict => ({
  a: "I prefer dark interfaces.",
  b: "Use a light, airy page.",
  note: "A dark interface cannot also be light.",
  overrides: false,
  ...over,
});

describe("saying what the check found", () => {
  test("nothing found is nothing said", () => {
    expect(conflictSummary([])).toBeNull();
  });

  test("two lines that disagree are said as such", () => {
    expect(conflictSummary([conflict()])).toBe("Two of your instructions disagree: A dark interface cannot also be light.");
  });

  test("a project line over an account line is information, not a fault", () => {
    expect(conflictSummary([conflict({ overrides: true })])).toContain("This project's instructions replace one of your account's");
  });

  test("the rest are counted", () => {
    expect(conflictSummary([conflict(), conflict(), conflict()])).toContain("(and 2 more)");
  });
});
