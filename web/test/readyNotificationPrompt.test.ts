import { describe, expect, test } from "bun:test";

import { shouldShowReadyNotificationPrompt } from "../src/features/project/readyNotificationPrompt";

const base = {
  currentJobId: "job-1",
  thresholdJobId: "job-1",
  status: "streaming" as const,
  isPreviewJob: false,
  notificationsEnabled: false,
  permissionGranted: false,
  supported: true,
  snoozedUntil: null,
  now: 1_000_000,
};

describe("shouldShowReadyNotificationPrompt", () => {
  test("never offers itself for a preview restart", () => {
    expect(
      shouldShowReadyNotificationPrompt({ ...base, isPreviewJob: true }),
    ).toBe(false);
  });

  test("'Not now' hides it until the snooze runs out, then it returns", () => {
    const snoozedUntil = base.now + 3 * 24 * 60 * 60 * 1000;
    expect(
      shouldShowReadyNotificationPrompt({ ...base, snoozedUntil }),
    ).toBe(false);
    expect(
      shouldShowReadyNotificationPrompt({ ...base, snoozedUntil, now: snoozedUntil }),
    ).toBe(true);
  });

  test("shows after the threshold when notifications are off", () => {
    expect(shouldShowReadyNotificationPrompt(base)).toBe(true);
  });

  test("stays hidden when notifications and permission are enabled", () => {
    expect(
      shouldShowReadyNotificationPrompt({
        ...base,
        notificationsEnabled: true,
        permissionGranted: true,
      }),
    ).toBe(false);
  });

  test("reappears when the saved setting outlives browser permission", () => {
    expect(
      shouldShowReadyNotificationPrompt({
        ...base,
        notificationsEnabled: true,
        permissionGranted: false,
      }),
    ).toBe(true);
  });

  test("stays hidden before this job reaches the threshold", () => {
    expect(
      shouldShowReadyNotificationPrompt({
        ...base,
        thresholdJobId: null,
      }),
    ).toBe(false);
    expect(
      shouldShowReadyNotificationPrompt({
        ...base,
        thresholdJobId: "older-job",
      }),
    ).toBe(false);
  });

  test("stays hidden after the run ends", () => {
    expect(
      shouldShowReadyNotificationPrompt({ ...base, status: "done" }),
    ).toBe(false);
  });

  test("stays hidden where browser notifications are unavailable", () => {
    expect(
      shouldShowReadyNotificationPrompt({ ...base, supported: false }),
    ).toBe(false);
  });
});
