import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_WEEKS,
  addDays,
  buildActivity,
  localParts,
  weekdayOf,
} from "./activity";
import { normalizeDisplayName, safeTimeZone } from "../schemas/profile.schema";

const NOW = new Date("2026-10-02T12:00:00Z"); // a Friday

function at(iso: string): Date {
  return new Date(iso);
}

function empty(overrides: Partial<Parameters<typeof buildActivity>[0]> = {}) {
  return buildActivity({
    builds: [],
    ships: [],
    projects: [],
    now: NOW,
    timeZone: "UTC",
    ...overrides,
  });
}

describe("activity grid", () => {
  test("starts on a Sunday and covers the full window", () => {
    const a = empty();
    expect(a.today).toBe("2026-10-02");
    expect(weekdayOf(a.start)).toBe(0);
    // The grid's last column is this week; today is a Friday.
    expect(addDays(a.start, (ACTIVITY_WEEKS - 1) * 7 + 5)).toBe(a.today);
  });

  test("buckets by the user's local day, not UTC", () => {
    // 20:00 UTC on Oct 1 is 01:30 on Oct 2 in Kolkata.
    const build = at("2026-10-01T20:00:00Z");
    const utc = empty({ builds: [build] });
    const ist = empty({ builds: [build], timeZone: "Asia/Kolkata" });

    expect(utc.days.map((d) => d.date)).toEqual(["2026-10-01"]);
    expect(ist.days.map((d) => d.date)).toEqual(["2026-10-02"]);
    expect(ist.hours[1]).toBe(1);
    expect(localParts(build, "Asia/Kolkata")).toEqual({
      date: "2026-10-02",
      hour: 1,
    });
  });

  test("drops anything outside the grid", () => {
    const a = empty({
      builds: [at("2024-01-01T00:00:00Z"), at("2026-12-01T00:00:00Z")],
    });
    expect(a.days).toEqual([]);
    expect(a.totals.builds).toBe(0);
  });

  test("counts builds, ships and new projects separately", () => {
    const a = empty({
      builds: [at("2026-09-30T09:00:00Z"), at("2026-09-30T10:00:00Z")],
      ships: [at("2026-09-30T11:00:00Z")],
      projects: [at("2026-09-29T08:00:00Z")],
    });
    expect(a.days).toEqual([
      { date: "2026-09-29", builds: 0, ships: 0, projects: 1 },
      { date: "2026-09-30", builds: 2, ships: 1, projects: 0 },
    ]);
    expect(a.totals).toEqual({ builds: 2, ships: 1, projects: 1, activeDays: 2 });
    expect(a.busiestDay).toEqual({ date: "2026-09-30", count: 3 });
    expect(a.weekdays[3]).toBe(2); // Wednesday
  });
});

describe("streaks", () => {
  const day = (date: string) => at(`${date}T12:00:00Z`);

  test("a streak survives an empty today", () => {
    const a = empty({
      builds: [day("2026-09-29"), day("2026-09-30"), day("2026-10-01")],
    });
    expect(a.streak).toEqual({ current: 3, longest: 3, activeToday: false });
  });

  test("today extends the streak", () => {
    const a = empty({
      builds: [day("2026-10-01"), at("2026-10-02T08:00:00Z")],
    });
    expect(a.streak).toEqual({ current: 2, longest: 2, activeToday: true });
  });

  test("a gap before yesterday breaks it, but the longest run is remembered", () => {
    const a = empty({
      builds: [
        day("2026-09-01"),
        day("2026-09-02"),
        day("2026-09-03"),
        day("2026-09-04"),
        day("2026-09-29"),
      ],
    });
    expect(a.streak).toEqual({ current: 0, longest: 4, activeToday: false });
  });
});

describe("profile input", () => {
  test("display names are cleaned, not rejected", () => {
    expect(normalizeDisplayName("  Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(normalizeDisplayName("A​da‮")).toBe("Ada");
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(Array.from(normalizeDisplayName("é".repeat(60))!)).toHaveLength(40);
  });

  test("unknown time zones fall back to UTC", () => {
    expect(safeTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(safeTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });
});
