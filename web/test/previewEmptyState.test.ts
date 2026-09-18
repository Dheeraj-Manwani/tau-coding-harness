import { describe, expect, test } from "bun:test";

import { getEmptyPreviewState } from "@/src/features/project/previewEmptyState";

const base = {
  status: "idle" as const,
  hydrated: true,
  activity: null,
  isStalled: false,
  interruptedForCredits: false,
  availableCredits: 0,
};

describe("empty preview state", () => {
  test("shows live activity only while a job is actually streaming", () => {
    expect(
      getEmptyPreviewState({
        ...base,
        status: "streaming",
        activity: "Designing the navigation",
      }),
    ).toMatchObject({
      title: "Designing the navigation…",
      animated: true,
    });
  });

  test("offers a top-up when an out-of-credits run is still unfunded", () => {
    expect(
      getEmptyPreviewState({
        ...base,
        status: "error",
        interruptedForCredits: true,
      }),
    ).toMatchObject({
      title: "Build paused — out of credits",
      action: "add_credits",
      animated: false,
    });
  });

  test("offers continuation after credits have been restored", () => {
    expect(
      getEmptyPreviewState({
        ...base,
        interruptedForCredits: true,
        availableCredits: 25,
      }),
    ).toMatchObject({
      title: "Credits restored",
      action: "continue",
      animated: false,
    });
  });

  test("shows a stopped action instead of a building animation when stalled", () => {
    expect(
      getEmptyPreviewState({
        ...base,
        status: "streaming",
        isStalled: true,
      }),
    ).toMatchObject({
      title: "Build may be stuck",
      action: "stop",
      animated: false,
    });
  });
});
