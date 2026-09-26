import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

/**
 * Three enormous, barely-there colour clouds drifting behind the starfield.
 *
 * Pure CSS keyframes (see `.nebula-blob` in index.css) — no JS, no canvas, no
 * rAF. Counter-rotating periods of 40/55/70s mean the three never resynchronise,
 * so the background never visibly repeats.
 *
 * Colours come from the chart scale, held at 6% opacity behind a 90px blur.
 * They are background only: never put text on one without re-checking contrast.
 */

interface Blob {
  color: string;
  className: string;
  /** Drift animation duration. */
  duration: string;
  reverse?: boolean;
}

const BLOBS: Blob[] = [
  {
    color: "#3b82f6", // --brand-violet-deep
    className: "left-[-10%] top-[-15%] h-[55vh] w-[55vw]",
    duration: "40s",
  },
  {
    color: "#818cf8", // --chart-3
    className: "right-[-15%] top-[10%] h-[60vh] w-[50vw]",
    duration: "55s",
    reverse: true,
  },
  {
    color: "#22d3ee", // --chart-5
    className: "bottom-[-20%] left-[20%] h-[50vh] w-[60vw]",
    duration: "70s",
  },
];

export function NebulaDrift({ className }: { className?: string }) {
  const reduceMotion = useReduceMotion();

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {BLOBS.map((blob) => (
        <div
          key={blob.color}
          className={cn("nebula-blob absolute", blob.className)}
          style={{
            background: `radial-gradient(closest-side, ${blob.color}, transparent)`,
            animationDuration: blob.duration,
            animationDirection: blob.reverse ? "reverse" : "normal",
            // A static frame, not a missing one — the clouds are still there,
            // they just stop moving.
            animationPlayState: reduceMotion ? "paused" : "running",
          }}
        />
      ))}
    </div>
  );
}

export default NebulaDrift;
