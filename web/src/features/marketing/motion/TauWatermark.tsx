import { useEffect, useRef, useState } from "react";

import { TAU_PATH_D, TAU_VIEWBOX } from "@/src/components/ui/tau-glyph";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

/**
 * The τ mark, drawn once behind the hero headline and then left as a watermark.
 *
 * Not `tauAnimation.tsx`: that one loops a comet around the outline forever,
 * which behind a headline is a distraction. This ignites — the stroke draws
 * itself over 1.4s — and then holds still at a few percent opacity, which is
 * what a watermark should do.
 *
 * The draw is a CSS transition on `stroke-dashoffset` rather than JS, so it
 * costs nothing after the first 1.4s.
 */

const DRAW_MS = 1400;

interface TauWatermarkProps {
  /** Rendered width in px. Height follows the glyph's aspect. */
  size?: number;
  /** Resting opacity once the draw finishes. */
  opacity?: number;
  className?: string;
}

export function TauWatermark({
  size = 96,
  opacity = 0.08,
  className,
}: TauWatermarkProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const reduceMotion = useReduceMotion();
  const [length, setLength] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    setLength(path.getTotalLength());
  }, []);

  useEffect(() => {
    if (length === null) return;
    // One frame at the undrawn state before flipping, or the browser collapses
    // the two style writes into one and the transition never runs.
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [length]);

  // Reduced motion gets the composed final frame: the mark, drawn.
  const settled = reduceMotion || drawn;
  const height = Math.round((size * TAU_VIEWBOX.height) / TAU_VIEWBOX.width);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${TAU_VIEWBOX.width} ${TAU_VIEWBOX.height}`}
      width={size}
      height={height}
      className={cn("pointer-events-none block overflow-visible", className)}
      style={{ opacity }}
    >
      <path
        ref={pathRef}
        d={TAU_PATH_D}
        fill="none"
        stroke="var(--silver-900)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          length === null
            ? // Until the length is measured the path is fully hidden, so the
              // glyph never flashes in complete before the draw starts.
              { strokeDasharray: 1, strokeDashoffset: 1 }
            : {
                strokeDasharray: length,
                strokeDashoffset: settled ? 0 : length,
                transition: reduceMotion
                  ? undefined
                  : `stroke-dashoffset ${DRAW_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
              }
        }
      />
    </svg>
  );
}

export default TauWatermark;
