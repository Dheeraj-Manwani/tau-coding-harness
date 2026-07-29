import { type CSSProperties, useEffect, useId, useMemo, useRef } from "react";

import { TAU_PATH_D } from "@/src/components/ui/tau-glyph";

// --- Animation shape, precomputed once in fraction-of-length space ---
// (so it never depends on the rendered pixel size of the SVG)
const PEAK = 0.95;
const PLATEAU_FRAC = 0.48; // how far the bright core + matching glow extend
const FALLOFF_FRAC = 0.32; // how far the glow takes to fade out after that
const BAND_COUNT = 26; // number of thin slices used to fake a smooth gradient

interface Band {
  windowFrac: number;
  midFrac: number;
  opacity: number;
}

type Rgb = [number, number, number];

function smoothstepDown(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - c * c * (3 - 2 * c);
}

function opacityAt(xFrac: number): number {
  if (xFrac <= PLATEAU_FRAC) return PEAK;
  const u = (xFrac - PLATEAU_FRAC) / FALLOFF_FRAC;
  return PEAK * smoothstepDown(u);
}

function buildBands(): Band[] {
  const maxFrac = PLATEAU_FRAC + FALLOFF_FRAC;
  const windowFracs: number[] = [];
  for (let j = 1; j <= BAND_COUNT; j++)
    windowFracs.push((j / BAND_COUNT) * maxFrac);

  const mids: number[] = [];
  let prev = 0;
  for (let i = 0; i < BAND_COUNT; i++) {
    mids.push((prev + windowFracs[i]) / 2);
    prev = windowFracs[i];
  }

  const cumulative = mids.map(opacityAt);
  const bands: Band[] = [];
  for (let i = 0; i < BAND_COUNT; i++) {
    const next = i + 1 < BAND_COUNT ? cumulative[i + 1] : 0;
    const opacity = Math.max(0, cumulative[i] - next);
    if (opacity < 0.001) continue;
    bands.push({ windowFrac: windowFracs[i], midFrac: mids[i], opacity });
  }
  return bands;
}

const BANDS = buildBands();

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const int = parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function mixRgb(a: Rgb, b: Rgb, t: number): string {
  const tt = Math.min(1, Math.max(0, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * tt);
  const g = Math.round(a[1] + (b[1] - a[1]) * tt);
  const bch = Math.round(a[2] + (b[2] - a[2]) * tt);
  return `rgb(${r}, ${g}, ${bch})`;
}

interface TauLogoAnimationProps {
  /** Numeric px size or any CSS size string (e.g. 360 or "60%"). */
  size?: number | string;
  /** Duration of one full loop around the border, in ms. */
  periodMs?: number;
  /** Hex color for the glow + always-on dim outline. */
  accentColor?: string;
  /** Hex color for the bright core + spark. */
  coreColor?: string;
  /** Opacity of the always-visible dim outline (0-1). */
  baseOpacity?: number;
  className?: string;
  style?: CSSProperties;
}

export default function TauLogoAnimation({
  size = 360,
  periodMs = 3900,
  accentColor = "#8b7bff",
  coreColor = "#f3f0ff",
  baseOpacity = 0.26,
  className = "",
  style = {},
}: TauLogoAnimationProps) {
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const coreRef = useRef<SVGPathElement | null>(null);
  const ghostRef = useRef<SVGPathElement | null>(null);
  const cometRef = useRef<SVGCircleElement | null>(null);
  const bandRefs = useRef<(SVGPathElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);

  const accentRgb = useMemo(() => hexToRgb(accentColor), [accentColor]);
  const coreRgb = useMemo(() => hexToRgb(coreColor), [coreColor]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core) return undefined;

    const length = core.getTotalLength();
    const coreLen = PLATEAU_FRAC * length;
    core.style.strokeDasharray = `${coreLen} ${length - coreLen}`;

    bandRefs.current.forEach((el, i) => {
      if (!el) return;
      const w = BANDS[i].windowFrac * length;
      el.style.strokeDasharray = `${w} ${length - w}`;
    });

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      // Show a settled, non-animating version instead of forcing motion.
      core.style.strokeDashoffset = "0";
      bandRefs.current.forEach((el) => {
        if (!el) return;
        el.style.strokeDashoffset = "0";
      });
      if (cometRef.current) cometRef.current.style.opacity = "0";
      return undefined;
    }

    let start: number | null = null;

    function frame(now: number) {
      if (!core) return;
      if (start === null) start = now;
      const elapsed = (now - start) % periodMs;
      const headPos = (elapsed / periodMs) * length;

      bandRefs.current.forEach((el, i) => {
        if (!el) return;
        const w = BANDS[i].windowFrac * length;
        el.style.strokeDashoffset = String(w - headPos);
      });
      core.style.strokeDashoffset = String(coreLen - headPos);

      const pt = core.getPointAtLength(headPos);
      if (cometRef.current) {
        cometRef.current.setAttribute("cx", String(pt.x));
        cometRef.current.setAttribute("cy", String(pt.y));
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [periodMs]);

  const isNumericSize = typeof size === "number";

  return (
    <svg
      viewBox="0 0 735 751"
      width={isNumericSize ? (size as number) : undefined}
      height={
        isNumericSize ? Math.round(((size as number) * 751) / 735) : undefined
      }
      className={className}
      style={{
        display: "block",
        overflow: "visible",
        ...(isNumericSize ? {} : { width: size, aspectRatio: "735 / 751" }),
        ...style,
      }}
    >
      <defs>
        <filter
          id={`${uid}-blurWide`}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
        >
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter
          id={`${uid}-blurTight`}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
        >
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter
          id={`${uid}-blurComet`}
          x="-200%"
          y="-200%"
          width="500%"
          height="500%"
        >
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Always-on dim outline so the full mark is legible at every frame */}
      <path
        ref={ghostRef}
        d={TAU_PATH_D}
        fill="none"
        stroke={accentColor}
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${uid}-blurTight)`}
        opacity={baseOpacity}
      />

      {/* Soft trailing glow, built from layered bands that fade out gradually */}
      <g>
        {BANDS.map((band, i) => (
          <path
            key={i}
            ref={(el) => {
              bandRefs.current[i] = el;
            }}
            d={TAU_PATH_D}
            fill="none"
            stroke={mixRgb(coreRgb, accentRgb, band.midFrac / PLATEAU_FRAC)}
            strokeWidth={13}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${uid}-blurWide)`}
            style={{ opacity: band.opacity }}
          />
        ))}
      </g>

      {/* Bright core */}
      <path
        ref={coreRef}
        d={TAU_PATH_D}
        fill="none"
        stroke={coreColor}
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${uid}-blurTight)`}
      />

      {/* Leading spark at the tip of the core */}
      <circle
        ref={cometRef}
        r={9}
        fill={coreColor}
        filter={`url(#${uid}-blurComet)`}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------
USAGE

  import TauLogoAnimation from "./tauAnimation";

  // Drop in as-is (transparent background):
  <TauLogoAnimation size={320} />

  // Over a dark backdrop, e.g. a hero section:
  <div style={{ background: "#070a1c", padding: "4rem" }}>
    <TauLogoAnimation size={400} />
  </div>

  // Responsive width:
  <TauLogoAnimation size="60%" />

  // Custom palette / speed:
  <TauLogoAnimation
    accentColor="#22d3ee"
    coreColor="#ffffff"
    periodMs={5000}
  />

PROPS
  size         number (px) or CSS size string, e.g. 360 or "50%"   default: 360
  periodMs     duration of one full loop around the border, in ms  default: 3900
  accentColor  hex color for the glow + always-on dim outline      default: "#8b7bff"
  coreColor    hex color for the bright core + spark                default: "#f3f0ff"
  baseOpacity  opacity of the always-visible dim outline (0-1)      default: 0.26
  className    passthrough class for the <svg>
  style        passthrough style object for the <svg>

NOTES
  - No CSS file or external assets needed; everything is inline.
  - Uses requestAnimationFrame directly (no animation library).
  - If you're on Next.js App Router, add "use client"; as the very
    first line of this file, since it relies on browser APIs.
------------------------------------------------------------------ */
