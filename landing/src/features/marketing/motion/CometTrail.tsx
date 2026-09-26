import { useEffect, useRef, type RefObject } from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";

/**
 * A comet that rides an SVG path as you scroll (§5.4).
 *
 * The path draws itself and the comet sits at the drawing tip, so the
 * trajectory is being *flown*, not revealed. Both come from the same progress
 * value: `stroke-dashoffset` interpolates it, and `getPointAtLength` places the
 * head at exactly the same distance along the curve.
 *
 * Everything is written straight to the DOM from a `MotionValue` subscription.
 * A scroll-scrubbed animation that re-rendered React on every frame would be
 * the single most expensive thing on the page.
 *
 * Must be rendered inside the same `<svg>` as `pathRef`, so head and path share
 * a coordinate system.
 */

/** Trailing samples behind the head, each smaller and fainter than the last. */
const TAIL_SAMPLES = 6;
/** How far behind the head the tail reaches, as a fraction of path length. */
const TAIL_SPAN = 0.05;
/** A waypoint lights when the head comes within this much of it. */
const WAYPOINT_RADIUS = 0.06;

interface CometTrailProps {
  pathRef: RefObject<SVGPathElement | null>;
  /** 0 → 1 along the path. */
  progress: MotionValue<number>;
  /** Fractions along the path where the waypoint nodes sit. */
  waypoints?: number[];
  /** Fires once, the first time the head reaches each waypoint. */
  onWaypoint?: (index: number) => void;
  color?: string;
}

export function CometTrail({
  pathRef,
  progress,
  waypoints = [],
  onWaypoint,
  color = "#60a5fa",
}: CometTrailProps) {
  const reduceMotion = useReduceMotion();
  const groupRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const tailRefs = useRef<(SVGCircleElement | null)[]>([]);
  const lengthRef = useRef(0);
  const reachedRef = useRef<Set<number>>(new Set());

  // Callbacks are read through a ref so a caller passing an inline arrow
  // doesn't resubscribe the motion value on every render.
  const onWaypointRef = useRef(onWaypoint);
  useEffect(() => {
    onWaypointRef.current = onWaypoint;
  });

  const render = (value: number) => {
    const path = pathRef.current;
    if (!path) return;
    if (lengthRef.current === 0) lengthRef.current = path.getTotalLength();
    const total = lengthRef.current;
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;

    // The path draws itself up to the head.
    path.style.strokeDasharray = `${total}`;
    path.style.strokeDashoffset = `${total * (1 - clamped)}`;

    const head = path.getPointAtLength(total * clamped);
    headRef.current?.setAttribute("cx", String(head.x));
    headRef.current?.setAttribute("cy", String(head.y));

    for (let i = 0; i < TAIL_SAMPLES; i++) {
      const back = clamped - (TAIL_SPAN * (i + 1)) / TAIL_SAMPLES;
      const circle = tailRefs.current[i];
      if (!circle) continue;
      if (back <= 0) {
        circle.setAttribute("opacity", "0");
        continue;
      }
      const point = path.getPointAtLength(total * back);
      circle.setAttribute("cx", String(point.x));
      circle.setAttribute("cy", String(point.y));
      circle.setAttribute("opacity", String(0.5 * (1 - i / TAIL_SAMPLES)));
    }

    // The comet only exists once it has left the start.
    groupRef.current?.setAttribute("opacity", clamped > 0.001 ? "1" : "0");

    waypoints.forEach((waypoint, index) => {
      if (reachedRef.current.has(index)) return;
      if (Math.abs(clamped - waypoint) <= WAYPOINT_RADIUS || clamped > waypoint) {
        reachedRef.current.add(index);
        onWaypointRef.current?.(index);
      }
    });
  };

  // Under reduced motion the scroll value is ignored entirely: scrolling must
  // not drag the comet back off its parked final position.
  useMotionValueEvent(progress, "change", (value) =>
    render(reduceMotion ? 1 : value),
  );

  // Reduced motion is the composed final frame (§2): path fully drawn, every
  // waypoint lit, comet parked at the end.
  useEffect(() => {
    if (reduceMotion) {
      render(1);
    } else {
      render(progress.get());
    }
    // `render` closes over refs only; re-running it on reduceMotion changes is
    // the whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <g ref={groupRef} opacity={0}>
      {Array.from({ length: TAIL_SAMPLES }, (_, i) => (
        <circle
          key={i}
          ref={(el) => {
            tailRefs.current[i] = el;
          }}
          r={3.2 - (i * 2.4) / TAIL_SAMPLES}
          fill={color}
          opacity={0}
        />
      ))}
      <circle
        ref={headRef}
        r={4}
        fill="#dbeafe"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </g>
  );
}

export default CometTrail;
