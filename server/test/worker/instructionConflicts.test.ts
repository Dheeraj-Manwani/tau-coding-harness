import { describe, expect, test } from "bun:test";
import { conflictInput, conflictPrompt, parseConflicts } from "@/api/lib/instructionConflicts";

// Standing instructions are free text. One cheap model call reads them against
// each other after a save and says where two cannot both be followed. These
// cover what is asked, and how the reply is read; the model itself is not called.

describe("what the model is asked", () => {
  test("is told what a conflict is and is not, and that none is the usual answer", () => {
    const prompt = conflictPrompt();
    expect(prompt).toContain("Be conservative");
    expect(prompt).toContain("a general rule and a specific exception");
    expect(prompt).toContain('{"conflicts": []}');
    expect(prompt).toContain("takes priority over the account");
  });

  test("reads the two lists, labelled, and leaves out one that is empty", () => {
    expect(conflictInput({ account: "Dark.", project: "Light." })).toBe("ACCOUNT:\nDark.\n\nPROJECT:\nLight.");
    expect(conflictInput({ account: "  ", project: "Light." })).toBe("PROJECT:\nLight.");
    expect(conflictInput({})).toBe("");
  });
});

describe("what the model says", () => {
  const reply = (conflicts: unknown) => JSON.stringify({ conflicts });

  test("a conflict is kept with its two lines and its note", () => {
    expect(parseConflicts(reply([{ a: "Dark.", b: "Light.", note: "Not both.", overrides: true }]))).toEqual([
      { a: "Dark.", b: "Light.", note: "Not both.", overrides: true },
    ]);
  });

  test("anything unusable is dropped, and no answer is no conflicts", () => {
    expect(parseConflicts("I could not tell.")).toEqual([]);
    expect(parseConflicts("{not json}")).toEqual([]);
    expect(parseConflicts(reply("none"))).toEqual([]);
    expect(parseConflicts(reply([{ a: "Dark.", b: "", note: "x" }, { a: "A", b: "A", note: "same" }, null, 3]))).toEqual([]);
  });

  test("wording around the object is tolerated, long lines are cut, and there are few", () => {
    const wrapped = `Here you go:\n${reply(Array.from({ length: 9 }, (_, i) => ({ a: `Line ${i} ${"x".repeat(400)}`, b: `Other ${i}`, note: "n" })))}\nDone.`;
    const found = parseConflicts(wrapped);
    expect(found).toHaveLength(4);
    expect(found[0]!.a.length).toBeLessThanOrEqual(240);
    expect(found.every((c) => c.overrides === false)).toBe(true);
  });
});
