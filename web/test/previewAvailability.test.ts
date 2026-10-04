import { describe, expect, test } from "bun:test";
import { resolvePreviewSurface } from "../src/features/project/previewAvailability";

const healthy = { hasUrl: true, alive: true, streaming: false, restoring: false, restoreFailed: false, starting: false, checkFailed: false };
describe("preview surface gating", () => {
  test("chat start never makes a dead URL eligible for an iframe", () => {
    expect(resolvePreviewSurface({ ...healthy, alive: false })).toBe("stopped");
    expect(resolvePreviewSurface({ ...healthy, alive: false, streaming: true })).toBe("restoring");
  });
  test("unknown URLs are checked even if a chat is already running", () => {
    expect(resolvePreviewSurface({ ...healthy, alive: undefined, streaming: true })).toBe("checking");
  });
  test("an explicit restoring event masks even a stale positive cache", () => {
    expect(resolvePreviewSurface({ ...healthy, restoring: true, streaming: true })).toBe("restoring");
  });
  test("the replacement is eligible while the chat keeps streaming", () => {
    expect(resolvePreviewSurface({ ...healthy, streaming: true })).toBe("frame");
  });
  test("normal chat keeps a healthy preview mounted", () => {
    expect(resolvePreviewSurface(healthy)).toBe("frame");
    expect(resolvePreviewSurface({ ...healthy, streaming: true })).toBe("frame");
  });
  test("restart click hides the previous frame before the job is dispatched", () => {
    expect(resolvePreviewSurface({ ...healthy, starting: true })).toBe("restoring");
  });
  test("recovery failure has a Tau retry state", () => {
    expect(resolvePreviewSurface({ ...healthy, alive: false, restoreFailed: true })).toBe("failed");
  });
  test("failed checks never reveal an unchecked URL", () => {
    expect(resolvePreviewSurface({ ...healthy, alive: undefined, checkFailed: true })).toBe("failed");
  });
  test("a new project retains its normal empty preview", () => {
    expect(resolvePreviewSurface({ ...healthy, hasUrl: false, alive: undefined, streaming: true })).toBe("empty");
  });
});
