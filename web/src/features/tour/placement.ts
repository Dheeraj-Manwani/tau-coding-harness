/**
 * Where a tour card goes, guaranteed on screen.
 *
 * The library's own placement doesn't clamp to the viewport: for a "bottom"
 * card it subtracts the popover padding from an x that already had it
 * subtracted, so a target near the left edge (the project switcher) pushes the
 * card off-screen by that padding, and targets hugging the right edge or the
 * bottom (the device switcher, Ship, the avatar, the composer) fall through to
 * fallback paths with no clamp at all. Passing a function as `position` makes
 * the library use our coordinates verbatim.
 */
import type { TourPosition } from "@/src/features/tour/tours";

/** Keep at least this much air between the card and the window edge. */
export const VIEWPORT_MARGIN = 12;
/** The card's size before it has been measured (it is `w-72`). */
const FALLBACK_WIDTH = 288;
const FALLBACK_HEIGHT = 170;

type Side = Exclude<TourPosition, "center">;

export interface PlacementInput {
  /** The card's measured size (0 before the first measure). */
  width: number;
  height: number;
  /** The target's rect, already grown by the popover padding (the gap). */
  top: number;
  right: number;
  bottom: number;
  left: number;
  windowWidth: number;
  windowHeight: number;
}

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Preferred side first, then its opposite, then the other two; the first side
 * with room wins. Whatever the side, the result is clamped into the viewport,
 * so a card can overlap its target a little but never leave the screen.
 */
export function placePopover(
  preferred: TourPosition | undefined,
  p: PlacementInput,
): [number, number] {
  const m = VIEWPORT_MARGIN;
  const w = p.width || FALLBACK_WIDTH;
  const h = p.height || FALLBACK_HEIGHT;
  const vw = p.windowWidth;
  const vh = p.windowHeight;

  const fits: Record<Side, boolean> = {
    top: p.top - m >= h,
    bottom: vh - p.bottom - m >= h,
    left: p.left - m >= w,
    right: vw - p.right - m >= w,
  };

  const centerX = (p.left + p.right) / 2;
  const centerY = (p.top + p.bottom) / 2;

  let x = vw / 2 - w / 2;
  let y = vh / 2 - h / 2;

  if (preferred !== "center") {
    const first: Side = preferred ?? "bottom";
    const order: Side[] = [first, OPPOSITE[first]];
    for (const side of ["bottom", "right", "top", "left"] as const) {
      if (!order.includes(side)) order.push(side);
    }
    const side = order.find((s) => fits[s]);

    if (side === "top" || side === "bottom") {
      x = centerX - w / 2;
      y = side === "top" ? p.top - h : p.bottom;
    } else if (side === "left" || side === "right") {
      x = side === "left" ? p.left - w : p.right;
      y = centerY - h / 2;
    }
    // No side fits (a target nearly the size of the window): stay centred.
  }

  return [clamp(x, m, vw - w - m), clamp(y, m, vh - h - m)];
}
