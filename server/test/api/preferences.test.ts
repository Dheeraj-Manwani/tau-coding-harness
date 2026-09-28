import { describe, expect, mock, test } from "bun:test";

// Preferences are a jsonb column the database does not shape, so the schema is
// the contract: writes must be strict, reads must be forgiving.

const merges: { userId: string; top: unknown; tours: unknown }[] = [];
let storedAfterMerge: unknown = {};

mock.module("@/api/repositories/auth.repository", () => ({
  mergeUserPreferences: async (
    userId: string,
    top: unknown,
    tours: unknown,
  ) => {
    merges.push({ userId, top, tours });
    return storedAfterMerge;
  },
}));

const { patchPreferencesSchema, readPreferences } = await import(
  "@/api/schemas/preferences.schema"
);
const { updatePreferences } = await import(
  "@/api/services/preferences.service"
);

describe("patchPreferencesSchema", () => {
  test("accepts a partial patch", () => {
    expect(patchPreferencesSchema.safeParse({ reduceMotion: true }).success).toBe(true);
    expect(
      patchPreferencesSchema.safeParse({
        tours: { workspace: { version: 1, outcome: "skipped" } },
      }).success,
    ).toBe(true);
  });

  test("rejects unknown keys so the column never collects junk", () => {
    expect(patchPreferencesSchema.safeParse({ theme: "dark" }).success).toBe(false);
    expect(
      patchPreferencesSchema.safeParse({
        tours: { onboarding: { version: 1, outcome: "completed" } },
      }).success,
    ).toBe(false);
  });

  test("rejects a client-supplied completion time", () => {
    expect(
      patchPreferencesSchema.safeParse({
        tours: { preview: { version: 1, outcome: "completed", at: "2020-01-01" } },
      }).success,
    ).toBe(false);
  });

  test("rejects an empty patch and bad values", () => {
    expect(patchPreferencesSchema.safeParse({}).success).toBe(false);
    expect(patchPreferencesSchema.safeParse({ lastEffort: "ULTRA" }).success).toBe(false);
    expect(
      patchPreferencesSchema.safeParse({
        tours: { workspace: { version: 0, outcome: "completed" } },
      }).success,
    ).toBe(false);
  });
});

describe("readPreferences", () => {
  test("returns empty preferences for missing or non-object values", () => {
    expect(readPreferences(null)).toEqual({});
    expect(readPreferences("nope")).toEqual({});
    expect(readPreferences({})).toEqual({});
  });

  test("drops one bad field without losing the rest", () => {
    const prefs = readPreferences({
      reduceMotion: "yes",
      hasSeenMotionIntro: true,
      lastEffort: "HIGH",
      tours: {
        workspace: { version: 1, outcome: "completed", at: "2026-09-28T00:00:00.000Z" },
        preview: { version: "one" },
      },
      legacyKey: 42,
    });
    expect(prefs).toEqual({
      hasSeenMotionIntro: true,
      lastEffort: "HIGH",
      tours: {
        workspace: { version: 1, outcome: "completed", at: "2026-09-28T00:00:00.000Z" },
      },
    });
  });
});

describe("updatePreferences", () => {
  test("splits tours from top-level keys and stamps completion time", async () => {
    merges.length = 0;
    const now = new Date("2026-09-28T12:00:00.000Z");
    storedAfterMerge = {
      reduceMotion: true,
      tours: { workspace: { version: 1, outcome: "completed", at: now.toISOString() } },
    };

    const result = await updatePreferences(
      "user-1",
      { reduceMotion: true, tours: { workspace: { version: 1, outcome: "completed" } } },
      now,
    );

    expect(merges).toEqual([
      {
        userId: "user-1",
        top: { reduceMotion: true },
        tours: { workspace: { version: 1, outcome: "completed", at: now.toISOString() } },
      },
    ]);
    expect(result).toEqual(storedAfterMerge as object);
  });

  test("passes no tours object when the patch has none", async () => {
    merges.length = 0;
    storedAfterMerge = { lastEffort: "MAX" };
    await updatePreferences("user-1", { lastEffort: "MAX" });
    expect(merges[0]?.tours).toBeUndefined();
  });

  test("404s when the user is gone", async () => {
    storedAfterMerge = null;
    await expect(updatePreferences("ghost", { reduceMotion: false })).rejects.toThrow(
      "User not found",
    );
  });
});
