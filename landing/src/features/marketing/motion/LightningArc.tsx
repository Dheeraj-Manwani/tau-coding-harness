import { useEffect, useRef, useState, type RefObject } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { useRafLoop } from "./useRafLoop";
import { noise2D } from "./noise";

/**
 * A bolt that cracks between two elements (§5.3).
 *
 * This is the reusable extraction of what makes `ElectricBorder` good: the same
 * `noise2D` kernel displacing a polyline, and the same three-pass stroke recipe
 * (wide dim glow, mid-weight body, hot near-white core). A bolt drawn here and
 * a bolt lapping the MAX composer are the same phenomenon.
 *
 * Rendered into a fixed, full-viewport SVG because the two endpoints are
 * arbitrary elements anywhere on the page: there is no shared positioned
 * ancestor to draw inside.
 *
 * Reduced motion renders nothing at all. A lightning strike has no meaningful
 * static frame: a frozen bolt is not a calmer bolt, it is a scribble.
 */

/** Segments along the bolt. More reads as noise, fewer as a zigzag. */
const SEGMENTS = 14;
/** Peak lateral displacement, as a fraction of the endpoint distance. */
const AMPLITUDE = 0.12;
/** The polyline is reseeded this often during the hold: that's the crackle. */
const RESEED_MS = 40;

const FLASH_IN_MS = 60;
const HOLD_MS = 120;
const FADE_MS = 170;
const DEFAULT_DURATION = FLASH_IN_MS + HOLD_MS + FADE_MS;

interface Point {
  x: number;
  y: number;
}

/**
 * A jagged line from `a` to `b`, fat in the middle and pinned at both ends -
 * `sin(πt)` is what keeps the ends from wandering off their anchors.
 */
function boltPoints(a: Point, b: Point, seed: number): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 1;
  // Unit normal to the a→b direction.
  const nx = -dy / distance;
  const ny = dx / distance;
  const amplitude = distance * AMPLITUDE;

  const points: Point[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const offset =
      (noise2D(t * 8, seed) * 2 - 1) * amplitude * Math.sin(Math.PI * t);
    points.push({
      x: a.x + dx * t + nx * offset,
      y: a.y + dy * t + ny * offset,
    });
  }
  return points;
}

/** Forks off the main line between 30% and 60%, running 40% of its length. */
function branchPoints(main: Point[], seed: number): Point[] {
  const startIndex = Math.floor(
    SEGMENTS * (0.3 + (noise2D(seed, 3.1) % 0.3)),
  );
  const from = main[startIndex] ?? main[0]!;
  const towards = main[main.length - 1]!;
  const spread = (noise2D(seed, 7.7) * 2 - 1) * 0.6;
  const end: Point = {
    x: from.x + (towards.x - from.x) * 0.4 - (towards.y - from.y) * 0.4 * spread,
    y: from.y + (towards.y - from.y) * 0.4 + (towards.x - from.x) * 0.4 * spread,
  };
  return boltPoints(from, end, seed + 11);
}

function toPathData(points: Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

interface LightningArcProps {
  from: RefObject<Element | null>;
  to: RefObject<Element | null>;
  /** Rising edge fires a strike. */
  trigger: boolean;
  color?: string;
  /** Extra forks off the main line. */
  branches?: number;
  /** Total life in ms, including flash-in and fade. */
  duration?: number;
}

export function LightningArc({
  from,
  to,
  trigger,
  color = "#3b82f6",
  branches = 2,
  duration = DEFAULT_DURATION,
}: LightningArcProps) {
  const reduceMotion = useReduceMotion();
  const [playing, setPlaying] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [opacity, setOpacity] = useState(0);

  const startedAt = useRef(0);
  const lastSeed = useRef(0);
  const previousTrigger = useRef(trigger);

  useEffect(() => {
    const rising = trigger && !previousTrigger.current;
    previousTrigger.current = trigger;
    if (!rising || reduceMotion) return;
    startedAt.current = performance.now();
    lastSeed.current = 0;
    setPlaying(true);
  }, [trigger, reduceMotion]);

  useRafLoop((_delta, now) => {
    const elapsed = now - startedAt.current;
    if (elapsed >= duration) {
      setPlaying(false);
      setPaths([]);
      setOpacity(0);
      return;
    }

    // Envelope: snap on, hold, fall away.
    const nextOpacity =
      elapsed < FLASH_IN_MS
        ? elapsed / FLASH_IN_MS
        : elapsed < FLASH_IN_MS + HOLD_MS
          ? 1
          : 1 - (elapsed - FLASH_IN_MS - HOLD_MS) / FADE_MS;
    setOpacity(Math.max(0, nextOpacity));

    // Reseed on a coarse clock so the shape flickers rather than boiling.
    const seedBucket = Math.floor(elapsed / RESEED_MS);
    if (seedBucket === lastSeed.current && paths.length > 0) return;
    lastSeed.current = seedBucket;

    const a = from.current?.getBoundingClientRect();
    const b = to.current?.getBoundingClientRect();
    if (!a || !b) return;

    const start = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    const end = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const main = boltPoints(start, end, seedBucket * 3.7);

    const next = [toPathData(main)];
    for (let i = 0; i < branches; i++) {
      next.push(toPathData(branchPoints(main, seedBucket * 3.7 + i * 5.3)));
    }
    setPaths(next);
  }, playing);

  if (reduceMotion || !playing || paths.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 h-full w-full"
      style={{ opacity }}
    >
      {/* Three passes, same recipe as the border's bolt: dim halo, body, core. */}
      {paths.map((d, i) => (
        <g key={i}>
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeOpacity={0.25}
            strokeLinecap="round"
            style={{ filter: "blur(6px)" }}
          />
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeOpacity={0.8}
            strokeLinecap="round"
          />
          <path
            d={d}
            fill="none"
            stroke="#dbeafe"
            strokeWidth={1}
            strokeLinecap="round"
          />
        </g>
      ))}
    </svg>
  );
}

export default LightningArc;
