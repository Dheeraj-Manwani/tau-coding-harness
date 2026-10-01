import { describe, expect, test } from "bun:test";
import { isCoffeePreviewReady } from "../src/features/project/previewCoffeeReady";

const visible = {
  active: true, loaded: true, status: "streaming" as const,
  currentJobId: "build", previewReadyJobId: "build",
  starting: false, down: false, error: false, feedbackOpen: false,
  stalled: false, waitingForAnswer: false,
};

describe("coffee preview readiness", () => {
  test("opens after the current preview is revealed while cover work is still streaming", () => {
    expect(isCoffeePreviewReady(visible)).toBe(true);
  });
  test("does not treat the previous build's preview as completion of the new build", () => {
    expect(isCoffeePreviewReady({ ...visible, previewReadyJobId: "old-build" })).toBe(false);
    expect(isCoffeePreviewReady({ ...visible, currentJobId: null, previewReadyJobId: null })).toBe(false);
  });
  test("supports completed builds and restored previews without a job snapshot", () => {
    for (const status of ["done", "idle"] as const) {
      expect(isCoffeePreviewReady({ ...visible, status, currentJobId: null, previewReadyJobId: null })).toBe(true);
    }
  });
  test("waits until a usable preview is visible and other dialogs are closed", () => {
    expect(isCoffeePreviewReady({ ...visible, active: false })).toBe(false);
    expect(isCoffeePreviewReady({ ...visible, loaded: false })).toBe(false);
    for (const flag of ["starting", "down", "error", "feedbackOpen", "stalled", "waitingForAnswer"] as const) {
      expect(isCoffeePreviewReady({ ...visible, [flag]: true })).toBe(false);
    }
  });
  test("does not celebrate cancelled or failed builds", () => {
    for (const status of ["error", "cancelled"] as const) {
      expect(isCoffeePreviewReady({ ...visible, status })).toBe(false);
    }
  });
});
