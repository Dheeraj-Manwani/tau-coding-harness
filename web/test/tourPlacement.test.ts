import { describe, expect, test } from "bun:test";

import {
  placePopover,
  VIEWPORT_MARGIN,
  type PlacementInput,
} from "../src/features/tour/placement";

// A 1440×900 window and the real card size (w-72 ≈ 288 × 170). Target rects
// are passed the way the library passes them: grown by the 14px popover gap.
const VW = 1440;
const VH = 900;
const CARD = { width: 288, height: 170 };
const GAP = 14;

function input(rect: { left: number; top: number; right: number; bottom: number }): PlacementInput {
  return {
    ...CARD,
    left: rect.left - GAP,
    top: rect.top - GAP,
    right: rect.right + GAP,
    bottom: rect.bottom + GAP,
    windowWidth: VW,
    windowHeight: VH,
  };
}

function expectOnScreen([x, y]: [number, number], size = CARD) {
  expect(x).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  expect(y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  expect(x + size.width).toBeLessThanOrEqual(VW - VIEWPORT_MARGIN);
  expect(y + size.height).toBeLessThanOrEqual(VH - VIEWPORT_MARGIN);
}

describe("placePopover: the steps that used to leave the screen", () => {
  test("project switcher at the top-left edge (workspace step 4)", () => {
    const pos = placePopover("bottom", input({ left: 12, top: 10, right: 200, bottom: 40 }));
    expectOnScreen(pos);
    expect(pos[1]).toBe(40 + GAP); // still below its target
  });

  test("composer at the bottom of the chat column (workspace step 2)", () => {
    const pos = placePopover("right", input({ left: 0, top: 790, right: 360, bottom: 888 }));
    expectOnScreen(pos);
    expect(pos[0]).toBe(360 + GAP); // still beside its target
  });

  test("controls hugging the right edge (preview steps 4–6)", () => {
    for (const rect of [
      { left: 1220, top: 8, right: 1300, bottom: 36 }, // device switcher
      { left: 1320, top: 8, right: 1390, bottom: 36 }, // GitHub + Deploy
      { left: 1400, top: 6, right: 1432, bottom: 38 }, // avatar
    ]) {
      const pos = placePopover("bottom", input(rect));
      expectOnScreen(pos);
      expect(pos[1]).toBe(rect.bottom + GAP);
    }
  });
});

describe("placePopover: side selection", () => {
  test("flips to the opposite side when the preferred one has no room", () => {
    const [, y] = placePopover("bottom", input({ left: 600, top: 820, right: 700, bottom: 880 }));
    expect(y).toBe(820 - GAP - CARD.height);
  });

  test("centres when asked to", () => {
    expect(placePopover("center", input({ left: 0, top: 0, right: 10, bottom: 10 }))).toEqual([
      VW / 2 - CARD.width / 2,
      VH / 2 - CARD.height / 2,
    ]);
  });

  test("uses a fallback size before the card has been measured", () => {
    const pos = placePopover("bottom", { ...input({ left: 1400, top: 6, right: 1432, bottom: 38 }), width: 0, height: 0 });
    expectOnScreen(pos);
  });

  test("never leaves the screen, wherever the target is", () => {
    for (const side of ["top", "bottom", "left", "right", undefined] as const) {
      for (let left = 0; left < VW; left += 120) {
        for (let top = 0; top < VH; top += 90) {
          const rect = { left, top, right: Math.min(VW, left + 80), bottom: Math.min(VH, top + 30) };
          expectOnScreen(placePopover(side, input(rect)));
        }
      }
    }
  });
});
