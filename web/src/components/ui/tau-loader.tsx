import React, { useEffect, useRef, useState } from "react";

import { cn } from "@/src/lib/utils";

// ---------------------------------------------------------------------------
// Constants — the τ glyph is drawn as a single SVG path, stroke-animated.
// ---------------------------------------------------------------------------

const TAU_PATH_D =
  "M6 8 C6 8 8 7 20 7 C32 7 34 8 34 8 M20 7 L20 34 C20 34 20 36 18 36 C16 36 15 34.5 15.5 33";

// Path length is in viewBox units (size-independent), so we measure once and
// share the result across every TauIcon instance regardless of `size`.
let cachedTauPathLength = 0;
let keyframesInjected = false;

// Width of one shimmer tile (px). The band advances exactly one tile per cycle,
// so the repeating gradient loops seamlessly and reads as a single travelling
// highlight. Pixel-based (not %) so the direction is unambiguous.
const SHIMMER_BAND_PX = 240;

const KEYFRAMES = `
  @keyframes drawTau {
    0%   { stroke-dashoffset: var(--tau-len); animation-timing-function: ease-in-out; }
    50%  { stroke-dashoffset: 0;              animation-timing-function: ease-in-out; }
    100% { stroke-dashoffset: calc(var(--tau-len) * -1); }
  }
  /* One highlight sweeping left→right (logo → text) by a full tile per cycle
     (increasing background-position-x moves the gradient right). Each element
     sets --shimmer-shift to its x-offset in the row, so the band stays in phase
     across the logo→text seam and looks like a single shimmer travelling. */
  @keyframes shimmerFlow {
    from { background-position-x: calc(var(--shimmer-shift, 0px) - ${SHIMMER_BAND_PX}px); }
    to   { background-position-x: calc(var(--shimmer-shift, 0px) + 0px); }
  }
`;

// Shimmer gradient tuned to the app's silver palette (silver-600 -> silver-900).
const SHIMMER_GRADIENT = `linear-gradient(
  90deg,
  rgb(148 163 184) 0%,
  rgb(148 163 184) 35%,
  rgb(226 232 240) 50%,
  rgb(148 163 184) 65%,
  rgb(148 163 184) 100%
)`;

// One shared, continuous sweep so the logo + label read as a single highlight.
const SHIMMER_ANIMATION = "shimmerFlow 1.4s linear infinite";

// Base shimmer surface shared by the logo and the text. `shiftPx` is the
// element's x-offset within the row (0 for the leftmost), keeping the travelling
// band continuous from one element to the next.
function shimmerSurface(shiftPx = 0): React.CSSProperties {
  return {
    backgroundImage: SHIMMER_GRADIENT,
    backgroundSize: `${SHIMMER_BAND_PX}px 100%`,
    backgroundRepeat: "repeat",
    animation: SHIMMER_ANIMATION,
    ["--shimmer-shift" as string]: `${shiftPx}px`,
  } as React.CSSProperties;
}

// Injects the keyframes once (idempotent). Shared by every shimmering element so
// any of them works on its own, not just when a TauIcon happens to be mounted.
function ensureKeyframes() {
  if (keyframesInjected || typeof document === "undefined") return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.innerHTML = KEYFRAMES;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// TauIcon — animated SVG τ path
// ---------------------------------------------------------------------------

interface TauIconProps {
  size?: number;
  strokeWidth?: number;
  /** Tailwind color class, e.g. "text-[var(--silver-900)]". */
  className?: string;
}

export const TauIcon = React.forwardRef<SVGSVGElement, TauIconProps>(
  ({ size = 22, strokeWidth = 3, className }, ref) => {
    const pathRef = useRef<SVGPathElement>(null);
    const [ready, setReady] = useState(cachedTauPathLength > 0);

    useEffect(() => {
      ensureKeyframes();

      if (!cachedTauPathLength && pathRef.current) {
        cachedTauPathLength = pathRef.current.getTotalLength();
        setReady(true);
      }
    }, []);

    return (
      <svg
        ref={ref}
        role="status"
        aria-label="Loading"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        className={cn("flex-shrink-0", className)}
      >
        <path
          ref={pathRef}
          d={TAU_PATH_D}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={
            ready
              ? ({
                  strokeDasharray: cachedTauPathLength,
                  strokeDashoffset: cachedTauPathLength,
                  "--tau-len": cachedTauPathLength,
                  animation: "drawTau 3s ease-in-out infinite",
                } as React.CSSProperties)
              : { opacity: 0 }
          }
        />
      </svg>
    );
  },
);
TauIcon.displayName = "TauIcon";

// ---------------------------------------------------------------------------
// ShimmerText — animated shimmer span
// ---------------------------------------------------------------------------

interface ShimmerTextProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** x-offset (px) of this text within its shimmer row — keeps the travelling
   *  band continuous with a logo to its left. 0 when used on its own. */
  shiftPx?: number;
}

function ShimmerText({
  children,
  className,
  style,
  shiftPx = 0,
}: ShimmerTextProps) {
  return (
    <span
      className={cn("bg-clip-text text-transparent select-none", className)}
      style={{ ...shimmerSurface(shiftPx), ...style }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ShimmerLogo — the brand τ logo (logo.png) filled with the shimmer gradient
// via a CSS mask, sweeping in sync with ShimmerText.
// ---------------------------------------------------------------------------

function ShimmerLogo({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  return (
    <span
      aria-hidden
      className={cn("inline-block flex-shrink-0", className)}
      style={{
        ...shimmerSurface(0),
        width: size,
        height: size,
        // Use the logo glyph as an alpha mask so the shimmer shows through it.
        WebkitMask: "url(/logo.png) no-repeat center / contain",
        mask: "url(/logo.png) no-repeat center / contain",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ChatLoader — inline τ + shimmer label, for the "tau is working" chat bubble.
// ---------------------------------------------------------------------------

const LOGO_SIZE = 20;
const ROW_GAP = 10; // px — must match the `gap-2.5` (0.625rem) on the row below.

export function ChatLoader({
  text = "Processing",
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <ShimmerLogo size={LOGO_SIZE} />
      {/* The text sits one logo + gap to the right; shifting its gradient back
          by that much keeps the single highlight continuous across the seam. */}
      <ShimmerText
        shiftPx={-(LOGO_SIZE + ROW_GAP)}
        className="inline-block max-w-[220px] truncate align-middle text-sm font-medium tracking-wide"
      >
        {text}
      </ShimmerText>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TauSplash — large centered τ animation, for the empty preview pane.
// ---------------------------------------------------------------------------

export function TauSplash({
  text,
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-5",
        className,
      )}
    >
      <TauIcon
        size={72}
        strokeWidth={2.5}
        className="text-[var(--silver-900)]"
      />
      {text && (
        <ShimmerText className="text-sm font-medium tracking-wide">
          {text}
        </ShimmerText>
      )}
    </div>
  );
}
