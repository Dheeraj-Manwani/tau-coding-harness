import { useEffect, useRef } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { rnd } from "@/src/lib/stormPrimitives";

/**
 * Confined weather for the build-loader card: continuous light rain, scoped
 * to the card's own bounds rather than the page. Uses the exact same
 * density/speed/color/drift as Home's `StormCanvas` so the two read as the
 * same rain, just windowed smaller. No lightning here - it read as noisy
 * flashing in a card this size.
 *
 * Sized via ResizeObserver (not `window resize`): this canvas fills a card,
 * not the viewport.
 */

interface Drop {
  x: number;
  y: number;
  l: number;
  v: number;
}

interface CardState {
  rain: Drop[];
  /** Fades in on mount instead of starting at full intensity. */
  intensity: number;
}

export function BuildWeatherCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let W = 0;
    let H = 0;
    let ctx: CanvasRenderingContext2D | null = null;
    let state: CardState | null = null;

    const setup = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = parent.clientWidth || 1;
      H = parent.clientHeight || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const rain: Drop[] = [];
      // Half Home's density - the same rain, just thinner in a card this size.
      for (let k = 0; k < (W * H) / 24000; k++) {
        rain.push({ x: rnd(0, W), y: rnd(0, H), l: rnd(16, 32), v: rnd(320, 520) });
      }
      state = state ? { ...state, rain } : { rain, intensity: 0 };
    };

    const drawFrame = (dt: number) => {
      if (!ctx || !state) return;

      ctx.clearRect(0, 0, W, H);

      state.intensity = Math.min(1, state.intensity + dt * 0.7);

      ctx.strokeStyle = `rgba(170,200,255,${0.22 * state.intensity})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const d of state.rain) {
        d.y += d.v * dt;
        d.x -= d.v * dt * 0.12;
        if (d.y > H) {
          d.y = -20;
          d.x = rnd(0, W + 100);
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.l * 0.12, d.y - d.l);
      }
      ctx.stroke();
    };

    setup();
    const ro = new ResizeObserver(() => setup());
    ro.observe(parent);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      drawFrame(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduceMotion]);

  if (reduceMotion) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}

export default BuildWeatherCanvas;
