import { describe, expect, test } from "bun:test";

import {
  chooseDelivery,
  shouldNotifyForRun,
} from "../src/features/project/readyNotificationRouting";

describe("shouldNotifyForRun", () => {
  const build = {
    wasPreviewJob: false,
    cancelledByUser: false,
    outcome: { kind: "done" } as const,
    status: "done" as const,
  };

  test("a finished build notifies", () => {
    expect(shouldNotifyForRun(build)).toBe(true);
  });

  test("a preview restart never notifies, however it ends", () => {
    expect(shouldNotifyForRun({ ...build, wasPreviewJob: true })).toBe(false);
    expect(
      shouldNotifyForRun({
        ...build,
        wasPreviewJob: true,
        outcome: { kind: "error", message: "Sandbox failed" },
        status: "error",
      }),
    ).toBe(false);
  });

  test("a stop the user clicked is not announced back to them", () => {
    expect(
      shouldNotifyForRun({
        ...build,
        cancelledByUser: true,
        outcome: { kind: "cancelled" },
        status: "cancelled",
      }),
    ).toBe(false);
  });

  test("a cancellation from elsewhere (another tab, the server) still notifies", () => {
    expect(
      shouldNotifyForRun({
        ...build,
        outcome: { kind: "cancelled" },
        status: "cancelled",
      }),
    ).toBe(true);
  });

  test("a user's earlier stop doesn't silence a failure", () => {
    expect(
      shouldNotifyForRun({
        ...build,
        cancelledByUser: true,
        outcome: { kind: "error", message: "boom" },
        status: "error",
      }),
    ).toBe(true);
  });
});

describe("chooseDelivery", () => {
  test("looking at the project: a soft chime and nothing else", () => {
    expect(
      chooseDelivery({ attentive: true, systemEnabled: true, soundEnabled: true }),
    ).toEqual({ sound: "soft", system: false, badge: false });
  });

  test("looking at the project with sound off: silent", () => {
    expect(
      chooseDelivery({ attentive: true, systemEnabled: true, soundEnabled: false }),
    ).toEqual({ sound: null, system: false, badge: false });
  });

  test("away: system notification, full chime and a title badge", () => {
    expect(
      chooseDelivery({ attentive: false, systemEnabled: true, soundEnabled: true }),
    ).toEqual({ sound: "full", system: true, badge: true });
  });

  test("away without notification permission: the badge still marks it", () => {
    expect(
      chooseDelivery({ attentive: false, systemEnabled: false, soundEnabled: false }),
    ).toEqual({ sound: null, system: false, badge: true });
  });
});
