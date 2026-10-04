import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export interface SpaceCanvasHandle {
  /** Fires a shooting star toward `target`. */
  pulse: () => void;
}

interface SpaceCanvasProps {
  /** Element a pulsed shooting star should streak toward. */
  target?: () => HTMLElement | null;
  className?: string;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Star {
  x: number;
  y: number;
  r: number;
  baseA: number;
  tw: number;
  vx: number;
  vy: number;
}
interface Drop {
  x: number;
  y: number;
  l: number;
  v: number;
}
interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface SpaceState {
  stars: Star[];
  rain: Drop[];
  shooters: Shooter[];
  splashes: Splash[];
  bg: CanvasGradient;
  t: number;
}

/**
 * Canvas-2D space background: a dark gradient sky, slowly drifting
 * twinkling stars, and a light scatter of rain. `pulse()` sends a
 * shooting star toward `target`.
 */
export const SpaceCanvas = forwardRef<SpaceCanvasHandle, SpaceCanvasProps>(
  function SpaceCanvas({ target, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pulseRef = useRef(0);

    useImperativeHandle(ref, () => ({
      pulse: () => {
        pulseRef.current = 1;
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      const W = canvas.clientWidth || 800;
      const H = canvas.clientHeight || 600;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#050816");
      bg.addColorStop(0.55, "#03050f");
      bg.addColorStop(1, "#010208");

      const state: SpaceState = {
        stars: [],
        rain: [],
        shooters: [],
        splashes: [],
        bg,
        t: 0,
      };
      for (let k = 0; k < (W * H) / 9000; k++) {
        state.stars.push({
          x: rnd(0, W),
          y: rnd(0, H),
          r: rnd(0.5, 1.8),
          baseA: rnd(0.2, 0.9),
          tw: rnd(0.4, 1.6),
          vx: rnd(-2, 2),
          vy: rnd(1, 4),
        });
      }
      for (let k = 0; k < (W * H) / 12000; k++) {
        state.rain.push({
          x: rnd(0, W),
          y: rnd(0, H),
          l: rnd(16, 32),
          v: rnd(320, 520),
        });
      }

      const spawnShooter = (toTarget: boolean) => {
        const el = toTarget ? (target?.() ?? null) : null;
        const r = el ? relRect(el) : null;
        const x0 = rnd(0, W * 0.6);
        const y0 = rnd(-20, H * 0.3);
        const x1 = r ? rnd(r.x, r.x + r.w) : x0 + rnd(200, 400);
        const y1 = r ? r.y : y0 + rnd(150, 300);
        const dist = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
        const speed = rnd(900, 1300);
        state.shooters.push({
          x: x0,
          y: y0,
          vx: ((x1 - x0) / dist) * speed,
          vy: ((y1 - y0) / dist) * speed,
          life: 1,
        });
      };

      const drawFrame = (dt: number) => {
        state.t += dt;
        if (pulseRef.current) {
          pulseRef.current = 0;
          spawnShooter(true);
        }
        if (!reduceMotion && Math.random() < dt * 0.12) spawnShooter(false);

        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = state.bg;
        ctx.fillRect(0, 0, W, H);

        for (const s of state.stars) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.y > H) {
            s.y = -4;
            s.x = rnd(0, W);
          }
          if (s.x < -4) s.x = W + 4;
          if (s.x > W + 4) s.x = -4;
          const tw = 0.5 + 0.5 * Math.sin(state.t * s.tw + s.x);
          ctx.fillStyle = `rgba(226,235,255,${(s.baseA * (0.5 + 0.5 * tw)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }

        const composerRect = target ? relRect(target() ?? null) : null;

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

        ctx.globalCompositeOperation = "lighter";
        state.shooters = state.shooters.filter((sh) => (sh.life -= dt * 0.9) > 0);
        for (const sh of state.shooters) {
          sh.x += sh.vx * dt;
          sh.y += sh.vy * dt;
          const tailX = sh.x - sh.vx * 0.05;
          const tailY = sh.y - sh.vy * 0.05;
          const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
          grad.addColorStop(0, `rgba(235,244,255,${sh.life})`);
          grad.addColorStop(1, "rgba(235,244,255,0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sh.x, sh.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      };

      if (reduceMotion) {
        drawFrame(0);
        return;
      }

      let raf = 0;
      let last = 0;
      let visible = false;
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        drawFrame(dt);
        if (visible) raf = requestAnimationFrame(frame);
      };
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting && !visible) {
            visible = true;
            last = performance.now();
            raf = requestAnimationFrame(frame);
          } else if (!entry?.isIntersecting) {
            visible = false;
            cancelAnimationFrame(raf);
          }
        },
        { rootMargin: "300px" },
      );
      io.observe(canvas);
      drawFrame(0);

      return () => {
        io.disconnect();
        cancelAnimationFrame(raf);
      };
    }, [target]);

    return (
      <canvas
        ref={canvasRef}
        className={`storm-canvas ${className ?? ""}`}
        aria-hidden="true"
      />
    );
  },
);

export default SpaceCanvas;
