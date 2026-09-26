import { useEffect, useRef, useState } from "react";
import { useScroll, useSpring } from "motion/react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { CometTrail } from "@/src/features/marketing/motion/CometTrail";
import { LightningArc } from "@/src/features/marketing/motion/LightningArc";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";

/**
 * §4.3: "How it works": four stages strung along a flight path.
 *
 * The spine is a single `<path>` whose `d` is generated from the section's
 * *measured* box rather than a fixed viewBox. That is the detail that makes it
 * responsive without distorting anything: the viewBox equals the element's CSS
 * pixel size, so the comet, the nodes and the curve all share one undistorted
 * coordinate system at every breakpoint.
 *
 * Scroll drives everything. The path draws itself, the comet sits at the
 * drawing tip, and each node lights as the comet reaches it: the user is
 * flying the trajectory, not watching a video of it.
 */

interface Waypoint {
  title: string;
  copy: string;
  detail: string;
}

const WAYPOINTS: Waypoint[] = [
  {
    title: "Share your idea",
    copy: "Tell Tau what you want to make. You can also share a picture or document.",
    detail: "Start with your idea",
  },
  {
    title: "See the steps",
    copy: "Tau turns your idea into a clear plan and shows you what happens next.",
    detail: "A simple step-by-step plan",
  },
  {
    title: "Watch it come together",
    copy: "Tau creates your app while you follow the progress from start to finish.",
    detail: "Your idea becomes a working app",
  },
  {
    title: "Try it and improve it",
    copy: "Open your app, try it, and ask for changes in everyday language.",
    detail: "Keep improving it by chatting",
  },
];

/** Below this container width the spine runs down the left margin. */
const NARROW_PX = 560;
/**
 * Vertical space each stage gets. One constant for every breakpoint on
 * purpose: the rows are laid out from it directly, so the section's height is
 * known before measurement and nothing shifts when the geometry arrives (§10
 * wants CLS at zero). Only the horizontal weave is responsive, and that lives
 * entirely in absolutely-positioned elements.
 */
const ROW_H = 240;
/** Where the spine sits when it runs down the left margin. */
const NODE_X_NARROW = 28;
/** Clearance between a node and the card beside it. */
const CARD_GAP = 32;

interface Geometry {
  width: number;
  height: number;
  narrow: boolean;
  nodes: Array<{ x: number; y: number }>;
  d: string;
  /** Fraction along the path where each node sits. */
  waypointFractions: number[];
}

interface Point {
  x: number;
  y: number;
}

/**
 * Arc length of one cubic segment, by chord summation.
 *
 * Needed because the segments are not the same length: the first and last run
 * half a row, and the weave adds horizontal travel that varies per segment.
 * Assuming uniform fractions would light each waypoint at the wrong moment -
 * the comet would visibly pass a node before, or after, it flashed.
 */
function cubicLength(p0: Point, c1: Point, c2: Point, p3: Point): number {
  const SAMPLES = 32;
  let length = 0;
  let previous = p0;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const point = {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function buildGeometry(width: number): Geometry {
  const narrow = width < NARROW_PX;
  const height = ROW_H * WAYPOINTS.length;

  const nodes = WAYPOINTS.map((_, i) => ({
    // Weave either side of centre on wide screens; hug the left margin when
    // the cards go full-width.
    x: narrow ? NODE_X_NARROW : width * (0.5 + (i % 2 === 0 ? -0.08 : 0.08)),
    y: ROW_H * (i + 0.5),
  }));

  const start = { x: narrow ? NODE_X_NARROW : width * 0.5, y: 0 };
  const end = { x: narrow ? NODE_X_NARROW : width * 0.5, y: height };
  const points = [start, ...nodes, end];

  // Smooth cubic through the points: each segment's control handles sit on the
  // vertical, which keeps the curve flowing downward instead of looping.
  let d = `M${start.x.toFixed(1)},${start.y.toFixed(1)}`;
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const point = points[i]!;
    const midY = (previous.y + point.y) / 2;
    const c1 = { x: previous.x, y: midY };
    const c2 = { x: point.x, y: midY };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    cumulative.push(
      cumulative[i - 1]! + cubicLength(previous, c1, c2, point),
    );
  }

  // Node i is the end of segment i+1, measured along the real curve.
  const total = cumulative[cumulative.length - 1] || 1;
  const waypointFractions = nodes.map((_, i) => cumulative[i + 1]! / total);

  return { width, height, narrow, nodes, d, waypointFractions };
}

const ALL_LIT = WAYPOINTS.map(() => true);

export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Stable handles for the one bolt on the page: Build → Preview.
  const buildNodeRef = useRef<HTMLDivElement | null>(null);
  const previewNodeRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReduceMotion();

  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [scrolledLit, setScrolledLit] = useState<boolean[]>(() =>
    WAYPOINTS.map(() => false),
  );
  // Reduced motion is the composed final frame: every node already lit, every
  // card already in place. Derived rather than pushed into state so there is no
  // render where the section is briefly dark.
  const lit = reduceMotion ? ALL_LIT : scrolledLit;

  // Measure, then regenerate the path from real pixels.
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setGeometry((current) => (current?.width === width ? current : buildGeometry(width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.8", "end 0.4"],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 60, damping: 20 });

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="mx-auto w-full max-w-5xl px-6 py-24"
    >
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          How it works
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Four stages, one sentence of input.
        </h2>
      </ScrollReveal>

      <div ref={trackRef} className="relative mt-16">
        {geometry && (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0"
            width={geometry.width}
            height={geometry.height}
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          >
            {/* The unflown remainder of the route, always faintly visible. */}
            <path
              d={geometry.d}
              fill="none"
              stroke="var(--silver-200)"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            {/* The flown part, drawn by CometTrail via stroke-dashoffset. */}
            <path
              ref={pathRef}
              d={geometry.d}
              fill="none"
              stroke="var(--blue-500)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeOpacity={0.85}
            />
            <CometTrail
              pathRef={pathRef}
              progress={progress}
              waypoints={geometry.waypointFractions}
              onWaypoint={(index) =>
                setScrolledLit((current) =>
                  current[index]
                    ? current
                    : current.map((v, i) => (i === index ? true : v)),
                )
              }
            />
          </svg>
        )}

        <ol className="relative">
          {WAYPOINTS.map((waypoint, index) => {
            const node = geometry?.nodes[index];
            const onLeft = index % 2 === 0;
            // Cards are placed off the node's own x, not off the container's
            // midpoint: the spine weaves, so a card measured from 50% would sit
            // on top of the path on whichever side the weave leans into.
            const cardStyle =
              !geometry || !node
                ? undefined
                : geometry.narrow
                  ? { left: NODE_X_NARROW + CARD_GAP, right: 0 }
                  : onLeft
                    ? { right: geometry.width - node.x + CARD_GAP, left: 0 }
                    : { left: node.x + CARD_GAP, right: 0 };
            return (
              <li key={waypoint.title} className="relative" style={{ height: ROW_H }}>
                {/* The node is centred in its own row. Its `y` in the geometry
                    is in track space for the path's benefit; here the row is
                    the containing block, so vertical centring is 50%. */}
                <div
                  ref={(el) => {
                    nodeRefs.current[index] = el;
                    if (index === 2) buildNodeRef.current = el;
                    if (index === 3) previewNodeRef.current = el;
                  }}
                  className={cn(
                    "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-300",
                    lit[index]
                      ? "size-4 border-blue-500 bg-space-void shadow-[0_0_24px_6px_rgba(96,165,250,0.35)]"
                      : "size-3 border-silver-200 bg-space-void",
                  )}
                  style={{ left: node?.x ?? 0 }}
                />

                <div
                  style={cardStyle}
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 transition-all duration-500",
                    !geometry?.narrow && onLeft && "text-right",
                    lit[index]
                      ? "translate-x-0 opacity-100"
                      : cn(
                          "opacity-0",
                          geometry?.narrow
                            ? "translate-x-4"
                            : onLeft
                              ? "-translate-x-4"
                              : "translate-x-4",
                        ),
                  )}
                >
                  <p className="font-mono text-xs text-blue-500">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-silver-900">
                    {waypoint.title}
                  </h3>
                  <p className="mt-2 text-sm text-silver-600">{waypoint.copy}</p>
                  <p className="mt-3 font-mono text-[0.7rem] text-silver-400">
                    {waypoint.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* The "it's alive" moment: one bolt from Build to Preview, and only one
          on the whole page at a time (§2: lightning is punctuation). */}
      <LightningArc
        from={buildNodeRef}
        to={previewNodeRef}
        trigger={lit[3] === true}
      />
    </section>
  );
}

export default HowItWorks;
