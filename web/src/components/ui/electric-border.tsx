import {
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";

import { octavedNoise } from "@/src/features/marketing/motion/noise";

// Adapted from BalintFerenczy's "ElectricBorder" pen. Two changes vs. the
// original: (1) the default stroke is our brand blue instead of violet, and
// (2) on top of the always-on "idle hum" perimeter we render a bright bolt that
// travels one full lap around the border every ~2-3s (see the pulse logic in
// the draw loop). Motion is gated by callers via `active` / `reducedMotion`.

function hexToRgba(hex: string, alpha: number = 1): string {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = parseInt(h, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ElectricBorderProps {
  children?: ReactNode;
  /** Hex stroke/glow color. Must be a real hex (used by the canvas + hexToRgba). */
  color?: string;
  speed?: number;
  chaos?: number;
  borderRadius?: number;
  /** When false, the canvas + glow fade out and the animation loop stops. */
  active?: boolean;
  /** When true, keep a static glow but skip the animated canvas entirely. */
  reducedMotion?: boolean;
  className?: string;
  style?: CSSProperties;
}

// A bolt travels one full lap of the perimeter in this window, then rests until
// the next pulse is scheduled 2-3s later.
const PULSE_DURATION = 900;
const PULSE_MIN_GAP = 2000;
const PULSE_MAX_GAP = 3000;

export function ElectricBorder({
  children,
  color = "#3b82f6", // --brand-violet-deep
  speed = 1,
  chaos = 0.08,
  borderRadius = 16,
  active = true,
  reducedMotion = false,
  className,
  style,
}: ElectricBorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  // Timestamp (performance.now scale) when the current/next bolt lap started.
  const pulseStartRef = useRef(0);

  const showCanvas = active && !reducedMotion;

  const getCornerPoint = useCallback(
    (
      centerX: number,
      centerY: number,
      radius: number,
      startAngle: number,
      arcLength: number,
      progress: number,
    ): { x: number; y: number } => {
      const angle = startAngle + progress * arcLength;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    },
    [],
  );

  const getRoundedRectPoint = useCallback(
    (
      t: number,
      left: number,
      top: number,
      width: number,
      height: number,
      radius: number,
    ): { x: number; y: number } => {
      const straightWidth = width - 2 * radius;
      const straightHeight = height - 2 * radius;
      const cornerArc = (Math.PI * radius) / 2;
      const totalPerimeter =
        2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
      const distance = t * totalPerimeter;

      let accumulated = 0;

      if (distance <= accumulated + straightWidth) {
        const progress = (distance - accumulated) / straightWidth;
        return { x: left + radius + progress * straightWidth, y: top };
      }
      accumulated += straightWidth;

      if (distance <= accumulated + cornerArc) {
        const progress = (distance - accumulated) / cornerArc;
        return getCornerPoint(
          left + width - radius,
          top + radius,
          radius,
          -Math.PI / 2,
          Math.PI / 2,
          progress,
        );
      }
      accumulated += cornerArc;

      if (distance <= accumulated + straightHeight) {
        const progress = (distance - accumulated) / straightHeight;
        return { x: left + width, y: top + radius + progress * straightHeight };
      }
      accumulated += straightHeight;

      if (distance <= accumulated + cornerArc) {
        const progress = (distance - accumulated) / cornerArc;
        return getCornerPoint(
          left + width - radius,
          top + height - radius,
          radius,
          0,
          Math.PI / 2,
          progress,
        );
      }
      accumulated += cornerArc;

      if (distance <= accumulated + straightWidth) {
        const progress = (distance - accumulated) / straightWidth;
        return { x: left + width - radius - progress * straightWidth, y: top + height };
      }
      accumulated += straightWidth;

      if (distance <= accumulated + cornerArc) {
        const progress = (distance - accumulated) / cornerArc;
        return getCornerPoint(
          left + radius,
          top + height - radius,
          radius,
          Math.PI / 2,
          Math.PI / 2,
          progress,
        );
      }
      accumulated += cornerArc;

      if (distance <= accumulated + straightHeight) {
        const progress = (distance - accumulated) / straightHeight;
        return { x: left, y: top + height - radius - progress * straightHeight };
      }
      accumulated += straightHeight;

      const progress = (distance - accumulated) / cornerArc;
      return getCornerPoint(
        left + radius,
        top + radius,
        radius,
        Math.PI,
        Math.PI / 2,
        progress,
      );
    },
    [getCornerPoint],
  );

  useEffect(() => {
    if (!showCanvas) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const octaves = 10;
    const lacunarity = 1.6;
    const gain = 0.7;
    const amplitude = chaos;
    const frequency = 10;
    const baseFlatness = 0;
    const displacement = 60;
    const borderOffset = 60;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width + borderOffset * 2;
      const height = rect.height + borderOffset * 2;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);

      return { width, height };
    };

    let { width, height } = updateSize();
    let lastDpr = Math.min(window.devicePixelRatio || 1, 2);

    // Kick off the first bolt shortly after mount, then reschedule 2-3s apart.
    pulseStartRef.current = performance.now() + 500;
    let pulseTimeout: number | undefined;
    const scheduleNextPulse = () => {
      const gap = PULSE_MIN_GAP + Math.random() * (PULSE_MAX_GAP - PULSE_MIN_GAP);
      pulseTimeout = window.setTimeout(() => {
        pulseStartRef.current = performance.now();
        scheduleNextPulse();
      }, gap);
    };
    scheduleNextPulse();

    const drawElectricBorder = (currentTime: number) => {
      if (!canvas || !ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (dpr !== lastDpr) {
        lastDpr = dpr;
        const newSize = updateSize();
        width = newSize.width;
        height = newSize.height;
      }

      const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
      timeRef.current += deltaTime * speed;
      lastFrameTimeRef.current = currentTime;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const scale = displacement;
      const left = borderOffset;
      const top = borderOffset;
      const borderWidth = width - 2 * borderOffset;
      const borderHeight = height - 2 * borderOffset;
      const maxRadius = Math.min(borderWidth, borderHeight) / 2;
      const radius = Math.min(borderRadius, maxRadius);

      const approximatePerimeter =
        2 * (borderWidth + borderHeight) + 2 * Math.PI * radius;
      const sampleCount = Math.floor(approximatePerimeter / 2);

      // Border point + fractal-noise displacement at perimeter fraction `t`.
      const displacedPoint = (t: number) => {
        const point = getRoundedRectPoint(t, left, top, borderWidth, borderHeight, radius);
        const xNoise = octavedNoise(t * 8, octaves, lacunarity, gain, amplitude, frequency, timeRef.current, 0, baseFlatness);
        const yNoise = octavedNoise(t * 8, octaves, lacunarity, gain, amplitude, frequency, timeRef.current, 1, baseFlatness);
        return { x: point.x + xNoise * scale, y: point.y + yNoise * scale };
      };

      // --- Pass 1: idle hum (subtle full perimeter) ---
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = 0; i <= sampleCount; i++) {
        const p = displacedPoint(i / sampleCount);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;

      // --- Pass 2: traveling bolt ---
      const pulseElapsed = currentTime - pulseStartRef.current;
      if (pulseElapsed >= 0 && pulseElapsed <= PULSE_DURATION) {
        const p = pulseElapsed / PULSE_DURATION; // 0..1, head does one lap
        const head = p;
        const env = Math.sin(Math.PI * p); // fade in then out over the lap
        const SEGMENT = 0.1; // fraction of the perimeter lit behind the head
        const BOLT_SAMPLES = 48;

        const drawBolt = (lineWidth: number, stroke: string, alpha: number, blur: number) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lineWidth;
          ctx.shadowBlur = blur;
          ctx.shadowColor = color;
          ctx.beginPath();
          for (let k = 0; k <= BOLT_SAMPLES; k++) {
            const f = k / BOLT_SAMPLES; // 0 tail -> 1 head
            let prog = head - SEGMENT * (1 - f);
            prog = ((prog % 1) + 1) % 1;
            const pt = displacedPoint(prog);
            if (k === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
          ctx.restore();
        };

        drawBolt(4, color, env * 0.8, 16); // outer glow
        drawBolt(1.8, "#dbeafe", env, 8); // bright near-white core
      }

      animationRef.current = requestAnimationFrame(drawElectricBorder);
    };

    const resizeObserver = new ResizeObserver(() => {
      const newSize = updateSize();
      width = newSize.width;
      height = newSize.height;
    });
    resizeObserver.observe(container);

    lastFrameTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(drawElectricBorder);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (pulseTimeout) clearTimeout(pulseTimeout);
      resizeObserver.disconnect();
    };
  }, [showCanvas, color, speed, chaos, borderRadius, getRoundedRectPoint]);

  return (
    <div
      ref={containerRef}
      className={`relative isolate overflow-visible ${className ?? ""}`}
      style={{ borderRadius, ...style }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
        style={{ opacity: showCanvas ? 1 : 0 }}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] transition-opacity duration-300"
        style={{ opacity: active ? 1 : 0 }}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ border: `2px solid ${hexToRgba(color, 0.6)}`, filter: "blur(1px)" }}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ border: `2px solid ${color}`, filter: "blur(4px)" }}
        />
        <div
          className="pointer-events-none absolute inset-0 z-[-1] scale-110 rounded-[inherit] opacity-30"
          style={{
            filter: "blur(32px)",
            background: `linear-gradient(-30deg, ${color}, transparent, ${color})`,
          }}
        />
      </div>
      <div className="relative z-1 rounded-[inherit]">{children}</div>
    </div>
  );
}

export default ElectricBorder;
