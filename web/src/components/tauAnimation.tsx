import { type CSSProperties, useEffect, useId, useMemo, useRef } from "react";

const TAU_PATH_D =
  "M225.78,55.89 C219.91,56.47 214.03,57.20 208.21,58.15 C202.38,59.10 196.56,60.19 190.83,61.60 C185.10,63.00 179.42,64.70 173.83,66.59 C168.24,68.47 162.70,70.57 157.29,72.93 C151.89,75.29 146.58,77.92 141.39,80.74 C136.21,83.56 131.11,86.59 126.20,89.86 C121.30,93.14 116.56,96.70 111.96,100.40 C107.36,104.10 102.90,108.00 98.63,112.07 C94.35,116.13 90.24,120.40 86.31,124.80 C82.37,129.19 78.60,133.76 75.03,138.46 C71.46,143.15 68.04,148.00 64.88,152.98 C61.71,157.96 58.79,163.11 56.04,168.34 C53.29,173.56 50.72,178.90 48.39,184.32 C46.07,189.75 43.87,195.26 42.10,200.88 C40.32,206.50 38.43,212.24 37.75,218.03 C37.08,223.81 36.30,230.47 38.05,235.61 C39.80,240.74 43.74,247.23 48.26,248.84 C52.78,250.46 59.90,247.54 65.16,245.29 C70.41,243.05 75.09,238.93 79.79,235.38 C84.49,231.82 88.71,227.62 93.35,223.97 C97.99,220.33 102.67,216.67 107.63,213.49 C112.59,210.32 117.80,207.46 123.11,204.90 C128.42,202.34 133.92,200.09 139.48,198.14 C145.05,196.19 150.77,194.59 156.50,193.22 C162.24,191.85 168.07,190.80 173.90,189.91 C179.74,189.01 185.62,188.40 191.50,187.86 C197.38,187.32 203.30,186.69 209.18,186.66 C215.07,186.64 221.26,186.29 226.84,187.70 C232.42,189.11 238.64,191.34 242.68,195.11 C246.71,198.87 249.77,204.83 251.06,210.30 C252.35,215.77 251.20,222.11 250.41,227.92 C249.63,233.74 247.72,239.43 246.34,245.17 C244.96,250.92 243.52,256.65 242.12,262.38 C240.71,268.12 239.31,273.86 237.91,279.60 C236.52,285.34 235.13,291.09 233.73,296.82 C232.33,302.56 230.90,308.30 229.51,314.04 C228.11,319.78 226.72,325.52 225.37,331.27 C224.02,337.02 222.74,342.79 221.41,348.54 C220.08,354.30 218.72,360.05 217.37,365.80 C216.01,371.55 214.62,377.29 213.29,383.05 C211.95,388.80 210.68,394.57 209.38,400.34 C208.08,406.10 206.79,411.86 205.50,417.63 C204.21,423.39 202.86,429.15 201.62,434.92 C200.37,440.70 199.16,446.48 198.02,452.27 C196.88,458.07 195.81,463.88 194.79,469.70 C193.76,475.52 192.73,481.34 191.89,487.18 C191.05,493.03 190.32,498.90 189.73,504.77 C189.13,510.65 188.63,516.54 188.32,522.44 C188.02,528.33 187.86,534.25 187.90,540.15 C187.94,546.06 188.10,551.97 188.56,557.86 C189.01,563.74 189.69,569.63 190.63,575.45 C191.56,581.28 192.69,587.10 194.15,592.81 C195.61,598.53 197.36,604.19 199.37,609.74 C201.38,615.28 203.62,620.78 206.22,626.07 C208.81,631.36 211.73,636.54 214.94,641.49 C218.14,646.43 221.67,651.22 225.45,655.74 C229.23,660.27 233.32,664.59 237.61,668.62 C241.91,672.66 246.48,676.46 251.22,679.95 C255.97,683.44 260.97,686.65 266.10,689.55 C271.23,692.46 276.57,695.04 282.00,697.35 C287.42,699.66 293.01,701.64 298.65,703.40 C304.28,705.15 310.02,706.65 315.79,707.86 C321.56,709.08 327.42,710.01 333.28,710.69 C339.14,711.38 345.06,711.76 350.95,711.96 C356.85,712.16 362.78,712.16 368.67,711.90 C374.56,711.63 380.47,711.15 386.32,710.36 C392.16,709.57 397.99,708.50 403.74,707.16 C409.48,705.82 415.19,704.19 420.78,702.31 C426.37,700.43 431.90,698.29 437.30,695.90 C442.69,693.51 447.99,690.86 453.14,687.97 C458.29,685.09 463.31,681.95 468.18,678.61 C473.04,675.27 477.76,671.69 482.33,667.96 C486.91,664.23 491.35,660.31 495.62,656.24 C499.89,652.17 504.03,647.93 507.97,643.54 C511.91,639.14 515.65,634.55 519.25,629.87 C522.86,625.20 526.32,620.40 529.61,615.50 C532.90,610.59 536.03,605.57 538.97,600.45 C541.91,595.34 544.86,590.17 547.24,584.79 C549.61,579.40 552.16,573.84 553.23,568.15 C554.29,562.45 555.53,555.37 553.62,550.62 C551.72,545.88 546.53,540.58 541.80,539.68 C537.06,538.78 530.36,542.55 525.23,545.22 C520.09,547.89 515.57,552.01 510.97,555.70 C506.37,559.39 502.23,563.67 497.64,567.38 C493.06,571.10 488.35,574.71 483.44,577.97 C478.53,581.23 473.43,584.29 468.17,586.95 C462.92,589.61 457.47,592.01 451.91,593.94 C446.35,595.87 440.60,597.44 434.82,598.53 C429.04,599.62 423.10,600.35 417.23,600.47 C411.36,600.60 405.35,600.32 399.59,599.28 C393.82,598.24 387.98,596.61 382.65,594.23 C377.32,591.85 372.10,588.71 367.59,585.00 C363.08,581.30 359.00,576.76 355.61,572.00 C352.22,567.23 349.47,561.84 347.26,556.41 C345.04,550.98 343.57,545.16 342.34,539.41 C341.11,533.65 340.40,527.74 339.89,521.87 C339.38,516.00 339.28,510.07 339.29,504.17 C339.31,498.27 339.55,492.35 339.98,486.46 C340.41,480.57 341.09,474.70 341.87,468.84 C342.65,462.99 343.62,457.16 344.65,451.34 C345.67,445.52 346.86,439.73 348.02,433.94 C349.18,428.15 350.39,422.36 351.63,416.59 C352.87,410.81 354.18,405.05 355.48,399.29 C356.78,393.53 358.12,387.77 359.45,382.02 C360.77,376.26 362.10,370.50 363.42,364.74 C364.74,358.99 366.03,353.22 367.36,347.47 C368.70,341.71 370.09,335.97 371.44,330.22 C372.80,324.47 374.15,318.72 375.50,312.97 C376.86,307.22 378.24,301.47 379.58,295.72 C380.93,289.97 382.21,284.20 383.56,278.45 C384.91,272.70 386.31,266.96 387.68,261.21 C389.06,255.47 390.42,249.72 391.81,243.98 C393.21,238.24 394.21,232.35 396.06,226.77 C397.90,221.19 399.81,215.41 402.90,210.51 C405.98,205.60 410.01,200.88 414.56,197.33 C419.12,193.79 424.70,191.08 430.21,189.23 C435.73,187.38 441.78,186.77 447.64,186.23 C453.49,185.69 459.45,186.04 465.35,186.00 C471.26,185.96 477.17,186.00 483.08,186.00 C488.98,186.00 494.89,186.00 500.80,186.00 C506.71,186.00 512.61,186.00 518.52,186.00 C524.43,186.00 530.34,186.06 536.25,186.00 C542.15,185.94 548.06,185.90 553.96,185.67 C559.87,185.44 565.78,185.16 571.65,184.60 C577.53,184.04 583.42,183.36 589.22,182.30 C595.02,181.25 600.84,180.02 606.46,178.27 C612.08,176.53 617.65,174.39 622.93,171.81 C628.22,169.23 633.36,166.18 638.16,162.80 C642.97,159.41 647.57,155.61 651.78,151.50 C655.99,147.40 659.92,142.89 663.41,138.15 C666.90,133.42 670.02,128.32 672.73,123.10 C675.45,117.87 677.92,112.41 679.71,106.82 C681.49,101.23 683.34,95.31 683.45,89.57 C683.55,83.83 682.95,77.25 680.35,72.36 C677.74,67.47 672.71,63.12 667.83,60.22 C662.94,57.33 656.78,56.02 651.03,54.98 C645.29,53.94 639.26,54.16 633.36,54.00 C627.46,53.84 621.55,54.00 615.64,54.00 C609.73,54.00 603.82,54.00 597.92,54.00 C592.01,54.00 586.10,54.00 580.19,54.00 C574.29,54.00 568.38,54.00 562.47,54.00 C556.56,54.00 550.65,54.00 544.75,54.00 C538.84,54.00 532.93,54.00 527.02,54.00 C521.12,54.00 515.21,54.00 509.30,54.00 C503.39,54.00 497.49,54.00 491.58,54.00 C485.67,54.00 479.76,54.00 473.85,54.00 C467.95,54.00 462.04,54.00 456.13,54.00 C450.22,54.00 444.32,54.00 438.41,54.00 C432.50,54.00 426.59,54.00 420.68,54.00 C414.78,54.00 408.87,54.00 402.96,54.00 C397.05,54.00 391.15,54.00 385.24,54.00 C379.33,54.00 373.42,54.00 367.51,54.00 C361.61,54.00 355.70,54.00 349.79,54.00 C343.88,54.00 337.98,54.00 332.07,54.00 C326.16,54.00 320.25,54.00 314.35,54.00 C308.44,54.00 302.53,54.00 296.62,54.00 C290.71,54.00 284.81,53.98 278.90,54.00 C272.99,54.02 267.08,54.00 261.18,54.11 C255.27,54.22 249.36,54.39 243.46,54.69 C237.56,54.98 231.66,55.31 225.78,55.89 Z";

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
