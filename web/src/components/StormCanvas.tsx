import { useEffect, useRef } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { rnd, spawnBolt, drawBolts, type Bolt } from "@/src/lib/stormPrimitives";

/**
 * Home's persistent background: stars, rain, and ambient lightning. Rain is
 * constant (no weather cycling) and ported 1:1 from landing's own hero
 * canvas (`SpaceCanvas.tsx`) - same density, speed, drift and color - so it
 * reads identically, including the splash where drops cross the top edge of
 * `target` (the prompt composer) and burst into a few gravity-arced droplets.
 * Lightning keeps web's own ambient tuning (never aimed at `target`).
 */

interface StormCanvasProps {
  /** Element the rain should splash against (the prompt composer). */
  target?: () => HTMLElement | null;
  className?: string;
}

interface Star {
  x: number;
  y: number;
  z: number;
  a: number;
}
interface Drop {
  x: number;
  y: number;
  l: number;
  v: number;
}
interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface StormState {
  stars: Star[];
  rain: Drop[];
  splashes: Splash[];
  bolts: Bolt[];
  next: number;
  flash: number;
}

export function StormCanvas({ target, className }: StormCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReduceMotion();
  // Callers tend to pass an inline `() => el` that's a new function identity
  // every render (e.g. Home's placeholder rotation re-renders every 4s). Read
  // it through a ref instead of a prop the draw effect depends on, or the
  // canvas (and its lightning timer, which needs 8-12s to fire) would reset
  // before it ever got a chance to.
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let W = 0;
    let H = 0;
    let ctx: CanvasRenderingContext2D | null = null;
    let state: StormState | null = null;

    const relRect = (el: HTMLElement | null) => {
      if (!el) return null;
      const c = canvas.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const k = W / (c.width || W);
      return {
        x: (r.left - c.left) * k,
        y: (r.top - c.top) * k,
        w: r.width * k,
        h: r.height * k,
      };
    };

    const setup = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const stars: Star[] = [];
      for (let k = 0; k < (W * H) / 3800; k++) {
        stars.push({
          x: rnd(0, W),
          y: rnd(0, H),
          z: rnd(0.4, 1.3),
          a: rnd(0.15, 0.6),
        });
      }
      // Same density/speed/drift as landing's SpaceCanvas - rain is meant to
      // look identical, not just "similarly busy".
      const rain: Drop[] = [];
      for (let k = 0; k < (W * H) / 12000; k++) {
        rain.push({ x: rnd(0, W), y: rnd(0, H), l: rnd(16, 32), v: rnd(320, 520) });
      }

      state = { stars, rain, splashes: [], bolts: [], next: rnd(8, 12), flash: 0 };
    };

    /** Ambient only - never aimed at anything. */
    const spawn = () => {
      if (!state) return;
      const x1 = rnd(60, W - 60);
      state.bolts.push(spawnBolt(x1, H + 10));
      state.flash = Math.max(state.flash, 0.8);
    };

    const drawFrame = (dt: number) => {
      if (!ctx || !state) return;

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);

      for (const p of state.stars) {
        ctx.fillStyle = `rgba(220,230,255,${p.a})`;
        ctx.fillRect(p.x, p.y, p.z, p.z);
      }

      const composerRect = targetRef.current
        ? relRect(targetRef.current() ?? null)
        : null;

      if (state.rain.length) {
        ctx.strokeStyle = "rgba(170,200,255,0.22)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const d of state.rain) {
          const prevY = d.y;
          d.y += d.v * dt;
          d.x -= d.v * dt * 0.12;

          if (
            composerRect &&
            prevY < composerRect.y &&
            d.y >= composerRect.y &&
            d.x >= composerRect.x - 6 &&
            d.x <= composerRect.x + composerRect.w + 6
          ) {
            const splashCount = 2 + Math.floor(rnd(0, 3));
            for (let s = 0; s < splashCount; s++) {
              state.splashes.push({
                x: d.x + rnd(-5, 5),
                y: composerRect.y,
                vx: rnd(-70, 70),
                vy: rnd(-170, -60),
                life: 1,
              });
            }
            d.y = -20;
            d.x = rnd(0, W + 100);
            d.v = rnd(320, 520);
            continue;
          }

          if (d.y > H) {
            d.y = -20;
            d.x = rnd(0, W + 100);
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + d.l * 0.12, d.y - d.l);
        }
        ctx.stroke();
      }

      state.splashes = state.splashes.filter((s) => (s.life -= dt * 1.8) > 0);
      if (state.splashes.length) {
        for (const s of state.splashes) {
          s.vy += 520 * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          ctx.fillStyle = `rgba(190,215,255,${(0.55 * s.life).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      state.next -= dt;
      if (state.next <= 0) {
        spawn();
        // Roughly every 10s.
        state.next = rnd(8, 12);
      }

      state.bolts = state.bolts.filter((b) => (b.life -= dt * 2.2) > 0);
      drawBolts(ctx, state.bolts);

      if (state.flash > 0) {
        ctx.fillStyle = `rgba(150,190,255,${state.flash * 0.12})`;
        ctx.fillRect(0, 0, W, H);
        state.flash = Math.max(0, state.flash - dt * 3);
      }
    };

    setup();

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      drawFrame(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(setup, 200);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, [reduceMotion]);

  if (reduceMotion) {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 -z-10 ${className ?? ""}`}
        style={{
          background: "#000000",
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, #fafafa80 0%, transparent 100%), radial-gradient(1px 1px at 75% 15%, #d4d4d860 0%, transparent 100%), radial-gradient(1px 1px at 50% 80%, #fafafa50 0%, transparent 100%)",
          backgroundSize: "300px 250px",
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 size-full ${className ?? ""}`}
    />
  );
}

export default StormCanvas;
