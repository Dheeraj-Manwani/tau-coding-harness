import { describe, expect, test } from "bun:test";

import type { Activity } from "../src/features/account/profile";
import {
  dayDetail,
  levelScale,
  personaFor,
  quietLine,
  streakLine,
} from "../src/features/account/personality";
import {
  firstNameOf,
  initialsOf,
  nameOf,
} from "../src/features/account/identity";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    timeZone: "UTC",
    start: "2025-09-28",
    today: "2026-10-02",
    days: [],
    totals: { builds: 0, ships: 0, projects: 0, activeDays: 0 },
    streak: { current: 0, longest: 0, activeToday: false },
    hours: Array(24).fill(0),
    weekdays: Array(7).fill(0),
    busiestDay: null,
    ...overrides,
  };
}

const totals = (builds: number, ships = 0, projects = 1) => ({
  builds,
  ships,
  projects,
  activeDays: 1,
});

describe("persona", () => {
  test("a brand-new account is on the launchpad", () => {
    expect(personaFor(activity()).title).toBe("Fresh off the launchpad");
  });

  test("night owls are spotted from the hour histogram", () => {
    const hours = Array(24).fill(0);
    hours[23] = 8;
    hours[14] = 4;
    const p = personaFor(activity({ totals: totals(12), hours }));
    expect(p.title).toBe("Night owl");
    expect(p.line).toContain("67%");
  });

  test("habits need enough builds to mean anything", () => {
    const hours = Array(24).fill(0);
    hours[23] = 6;
    expect(personaFor(activity({ totals: totals(6), hours })).title).toBe("Builder");
  });

  test("shippers outrank streaks", () => {
    const hours = Array(24).fill(0);
    hours[14] = 30;
    const p = personaFor(
      activity({
        totals: totals(30, 5),
        hours,
        streak: { current: 0, longest: 9, activeToday: false },
      }),
    );
    expect(p.title).toBe("Shipper");
  });
});

describe("streak copy", () => {
  test("an unfinished today still counts the streak", () => {
    expect(streakLine({ current: 3, longest: 5, activeToday: false })).toBe(
      "3 days and counting. Build today to keep it alive.",
    );
  });

  test("a personal best is called out", () => {
    expect(streakLine({ current: 6, longest: 6, activeToday: true })).toContain(
      "Your best yet",
    );
  });

  test("a cold streak remembers the best", () => {
    expect(streakLine({ current: 0, longest: 4, activeToday: false })).toContain(
      "Best: 4 days",
    );
  });
});

describe("graph", () => {
  test("levels use the user's own quartiles", () => {
    const days = [1, 2, 3, 4, 10].map((builds, i) => ({
      date: `2026-09-0${i + 1}`,
      builds,
      ships: 0,
      projects: 0,
    }));
    const level = levelScale(days);
    expect(level(0)).toBe(0);
    expect(level(1)).toBe(1);
    expect(level(10)).toBe(4);
  });

  test("empty days get a stable quip; busy days get counts", () => {
    expect(quietLine("2026-09-01")).toBe(quietLine("2026-09-01"));
    expect(
      dayDetail({ date: "x", builds: 2, ships: 1, projects: 0 }, "x"),
    ).toBe("2 builds · 1 ship");
  });
});

describe("identity", () => {
  const base = { id: "u1", email: "ada@example.com", avatarPath: null };

  test("names fall back to the email", () => {
    expect(nameOf({ ...base, displayName: null })).toBe("ada");
    expect(nameOf({ ...base, displayName: "Ada Lovelace" })).toBe("Ada Lovelace");
    expect(firstNameOf({ displayName: "Ada Lovelace" })).toBe("Ada");
    expect(firstNameOf({ displayName: null })).toBeNull();
  });

  test("initials prefer first + last name", () => {
    expect(initialsOf({ ...base, displayName: "Ada King Lovelace" })).toBe("AL");
    expect(initialsOf({ ...base, displayName: null })).toBe("AD");
  });
});
