import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

/**
 * A dashed ring with satellites tracking round it (§5.6).
 *
 * The gateway motif: something of yours in the middle, tau's inference orbiting
 * it. Pure SVG with a CSS rotation — one composited transform, no rAF, so it
 * costs nothing to leave running behind a code block.
 *
 * Under reduced motion the ring and its satellites stay exactly where they are.
 * A stopped orbit still reads as an orbit; that is the static frame.
 */

interface OrbitRingProps {
  size?: number;
  /** Angles, in degrees, at which satellites sit on the ring. */
  satellites?: number[];
  /** Seconds for one full revolution. */
  periodSeconds?: number;
  className?: string;
}

export function OrbitRing({
  size = 320,
  satellites = [0, 140],
  periodSeconds = 30,
  className,
}: OrbitRingProps) {
  const reduceMotion = useReduceMotion();
  const radius = size / 2 - 6;
  const centre = size / 2;

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("pointer-events-none", className)}
    >
      <g
        className={reduceMotion ? undefined : "orbit-spin"}
        style={{
          transformOrigin: "center",
          animationDuration: `${periodSeconds}s`,
        }}
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="var(--silver-400)"
          strokeWidth={1}
          strokeDasharray="2 8"
          opacity={0.5}
        />
        {satellites.map((angle) => {
          const radians = (angle * Math.PI) / 180;
          return (
            <circle
              key={angle}
              cx={centre + radius * Math.cos(radians)}
              cy={centre + radius * Math.sin(radians)}
              r={3}
              fill="var(--blue-500)"
              style={{ filter: "drop-shadow(0 0 6px var(--blue-500))" }}
            />
          );
        })}
      </g>
    </svg>
  );
}

export default OrbitRing;
