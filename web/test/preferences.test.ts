import { describe, expect, test } from "bun:test";

import { mergePreferences } from "../src/features/settings/preferences";

// The optimistic cache write must match what the server's jsonb merge will
// return, or the UI flickers when the response lands.

const now = new Date("2026-09-28T12:00:00.000Z");

describe("mergePreferences", () => {
  test("replaces top-level keys and keeps the rest", () => {
    expect(
      mergePreferences({ reduceMotion: true, lastEffort: "LOW" }, { lastEffort: "MAX" }, now),
    ).toEqual({ reduceMotion: true, lastEffort: "MAX" });
  });

  test("merges tours one level deep, so one tour never erases another", () => {
    const prev = {
      tours: { workspace: { version: 1, outcome: "completed" as const, at: "earlier" } },
    };
    expect(
      mergePreferences(prev, { tours: { preview: { version: 1, outcome: "skipped" } } }, now),
    ).toEqual({
      tours: {
        workspace: { version: 1, outcome: "completed", at: "earlier" },
        preview: { version: 1, outcome: "skipped", at: now.toISOString() },
      },
    });
  });

  test("standing instructions are trimmed, and an empty string clears them", () => {
    expect(mergePreferences({}, { instructions: "  Prices in pounds.  " }, now)).toEqual({
      instructions: "Prices in pounds.",
    });
    expect(
      mergePreferences({ reduceMotion: true, instructions: "Prices in pounds." }, { instructions: " " }, now),
    ).toEqual({ reduceMotion: true });
  });

  test("a default look is replaced whole, and null clears it", () => {
    const prev = { defaultDesign: { style: "neon", accent: "#d63cff" } };
    expect(mergePreferences(prev, { defaultDesign: { mode: "dark" } }, now)).toEqual({
      defaultDesign: { mode: "dark" },
    });
    expect(mergePreferences(prev, { defaultDesign: null }, now)).toEqual({});
    expect(mergePreferences(prev, { reduceMotion: true }, now)).toEqual({ ...prev, reduceMotion: true });
  });

  test("does not mutate the previous object", () => {
    const prev = { reduceMotion: false };
    mergePreferences(prev, { reduceMotion: true }, now);
    expect(prev).toEqual({ reduceMotion: false });
  });
});
