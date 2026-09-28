import { describe, expect, test } from "bun:test";

import {
  availableSteps,
  isTourDue,
  pickTour,
  TOUR_VERSIONS,
  TOURS,
  type TourGate,
} from "../src/features/tour/tours";

const seen = (version = 1) => ({
  version,
  outcome: "completed" as const,
  at: "2026-09-28T00:00:00.000Z",
});

function gate(overrides: Partial<TourGate> = {}): TourGate {
  return {
    request: null,
    wide: true,
    layout: "workspace",
    hasSeenMotionIntro: true,
    tours: {},
    blocked: false,
    isChatOpen: true,
    activeTab: "preview",
    previewReady: false,
    ...overrides,
  };
}

describe("isTourDue", () => {
  test("is due when never seen or seen at an older version", () => {
    expect(isTourDue("workspace", undefined)).toBe(true);
    expect(isTourDue("workspace", seen(TOUR_VERSIONS.workspace - 1))).toBe(true);
    expect(isTourDue("workspace", seen(TOUR_VERSIONS.workspace))).toBe(false);
  });

  test("a skip counts as seen", () => {
    expect(
      isTourDue("preview", { ...seen(), outcome: "skipped" }),
    ).toBe(false);
  });
});

describe("pickTour", () => {
  test("first workspace visit starts the workspace tour", () => {
    expect(pickTour(gate())).toBe("workspace");
  });

  test("never runs on small screens, even when asked", () => {
    expect(pickTour(gate({ wide: false }))).toBeNull();
    expect(pickTour(gate({ wide: false, request: "preview" }))).toBeNull();
  });

  test("waits for the full workspace, not the pre-build chat", () => {
    expect(pickTour(gate({ layout: "chat" }))).toBeNull();
    expect(pickTour(gate({ layout: "loading" }))).toBeNull();
  });

  test("waits for the motion intro and for anything asking for attention", () => {
    expect(pickTour(gate({ hasSeenMotionIntro: false }))).toBeNull();
    expect(pickTour(gate({ blocked: true }))).toBeNull();
  });

  test("waits for the chat to be open before touring it", () => {
    expect(pickTour(gate({ isChatOpen: false }))).toBeNull();
  });

  test("preview tour follows the workspace tour, never before it", () => {
    expect(pickTour(gate({ previewReady: true }))).toBe("workspace");
    expect(
      pickTour(gate({ previewReady: true, tours: { workspace: seen() } })),
    ).toBe("preview");
  });

  test("preview tour needs a ready preview on the Preview tab", () => {
    const afterWorkspace = { tours: { workspace: seen() } };
    expect(pickTour(gate({ ...afterWorkspace, previewReady: false }))).toBeNull();
    expect(
      pickTour(gate({ ...afterWorkspace, previewReady: true, activeTab: "code" })),
    ).toBeNull();
  });

  test("nothing runs once both tours are seen", () => {
    expect(
      pickTour(
        gate({ previewReady: true, tours: { workspace: seen(), preview: seen() } }),
      ),
    ).toBeNull();
  });

  test("a replay runs regardless of history or the motion intro", () => {
    const done = { workspace: seen(), preview: seen() };
    expect(pickTour(gate({ request: "preview", tours: done }))).toBe("preview");
    expect(
      pickTour(gate({ request: "workspace", layout: "chat", hasSeenMotionIntro: false })),
    ).toBe("workspace");
  });
});

describe("availableSteps", () => {
  // A minimal stand-in for the document: which targets exist, and their size.
  function root(present: Record<string, { width: number; height: number }>) {
    return {
      querySelector(selector: string) {
        const target = /data-tour="([^"]+)"/.exec(selector)?.[1] ?? "";
        const rect = present[target];
        return rect ? { getBoundingClientRect: () => rect } : null;
      },
    } as unknown as ParentNode;
  }

  test("keeps only targets that are on screen, in tour order", () => {
    const steps = availableSteps(
      "preview",
      root({
        "url-bar": { width: 300, height: 30 },
        // Collapsed or hidden: present in the DOM but zero-sized.
        "select-element": { width: 0, height: 0 },
        ship: { width: 60, height: 28 },
      }),
    );
    expect(steps.map((s) => s.target)).toEqual(["url-bar", "ship"]);
  });

  test("every step target is unique within its tour", () => {
    for (const steps of Object.values(TOURS)) {
      const targets = steps.map((s) => s.target);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});
