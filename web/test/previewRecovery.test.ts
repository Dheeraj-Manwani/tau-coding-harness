import { describe, expect, test } from "bun:test";
import { createPreviewRecovery, type PreviewRecoveryState } from "../src/features/project/previewRecovery";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe("iframe bootstrap recovery", () => {
  test("missing bootstrap responses stop after two watchdog retries", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: true, onChange: (s) => states.push(s), timeoutMs: 5, retryDelayMs: 1 });
    await sleep(120);
    expect(states.map((s) => [s.attempt, s.phase])).toEqual([[1, "waiting"], [2, "waiting"], [2, "failed"]]);
    recovery.dispose();
  });
  test("navigation after recovery keeps the current iframe and gets a fresh retry budget", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: true, onChange: (s) => states.push(s), timeoutMs: 1_000, retryDelayMs: 1 });
    recovery.onHealth({ state: "failed", transient: true });
    await sleep(5);
    recovery.onHealth({ state: "loaded" });
    recovery.onHealth({ state: "waiting" });
    expect(states.at(-1)).toEqual({ attempt: 1, phase: "waiting", appError: false });
    recovery.onHealth({ state: "failed", transient: true });
    await sleep(5);
    expect(states.at(-1)?.attempt).toBe(2);
    recovery.dispose();
  });
  test("a compile error cancels a pending network retry", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: true, onChange: (s) => states.push(s), retryDelayMs: 5 });
    recovery.onHealth({ state: "failed", transient: true });
    recovery.onHealth({ state: "failed", transient: false });
    await sleep(15);
    expect(states).toEqual([{ attempt: 0, phase: "failed", appError: true }]);
    recovery.dispose();
  });
  test("document load does not reveal an unmounted monitored app", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: true, onChange: (s) => states.push(s), timeoutMs: 100, legacyDelayMs: 1 });
    recovery.onLoad();
    await sleep(5);
    expect(states).toEqual([]);
    recovery.onHealth({ state: "loaded" });
    expect(states.at(-1)?.phase).toBe("loaded");
    recovery.dispose();
  });
  test("transient module failures remount at most twice", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: true, onChange: (s) => states.push(s), timeoutMs: 100, retryDelayMs: 1 });
    for (let i = 0; i < 3; i++) {
      recovery.onHealth({ state: "failed", transient: true });
      await sleep(5);
    }
    expect(states.map((s) => [s.attempt, s.phase])).toEqual([[1, "waiting"], [2, "waiting"], [2, "failed"]]);
    recovery.dispose();
  });
  test("real app exceptions fail immediately without reloads", () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: true, onChange: (s) => states.push(s) });
    recovery.onHealth({ state: "failed", transient: false });
    expect(states).toEqual([{ attempt: 0, phase: "failed", appError: true }]);
    recovery.dispose();
  });
  test("a working legacy preview is revealed only after its runtime identifies itself", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: false, onChange: (s) => states.push(s), timeoutMs: 100, legacyDelayMs: 1 });
    recovery.onLoad();
    recovery.onLegacyReady();
    await sleep(5);
    expect(states.at(-1)?.phase).toBe("loaded");
    recovery.dispose();
  });
  test("a legacy provider error document never becomes visible from load alone", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: false, onChange: (s) => states.push(s), timeoutMs: 1_000, legacyDelayMs: 1 });
    recovery.onLoad();
    await sleep(5);
    expect(states).toEqual([]);
    recovery.dispose();
  });
  test("monitor heartbeat cancels the legacy reveal timer", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: false, onChange: (s) => states.push(s), timeoutMs: 100, legacyDelayMs: 1 });
    recovery.onLoad();
    recovery.onHealth({ state: "waiting" });
    await sleep(5);
    expect(states).toEqual([]);
    recovery.dispose();
  });
  test("old frame timers cannot update a replacement frame", async () => {
    const states: PreviewRecoveryState[] = [];
    const recovery = createPreviewRecovery({ expectHealth: false, onChange: (s) => states.push(s), timeoutMs: 5, legacyDelayMs: 1 });
    recovery.onLoad();
    recovery.dispose();
    recovery.onHealth({ state: "loaded" });
    await sleep(10);
    expect(states).toEqual([]);
  });
});
