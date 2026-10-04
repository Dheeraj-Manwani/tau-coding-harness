import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export type StormMode = "LOW" | "HIGH" | "MAX";

export interface StormCanvasHandle {
  /** Forces an immediate bolt toward `target`, plus a follow-up strike. */
  pulse: () => void;
}

interface StormCanvasProps {
  /** Element the lightning should strike and crackle around. */
  target?: () => HTMLElement | null;
  mode?: StormMode;
  rain?: boolean;
  className?: string;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Point = [number, number];

/** Jagged bolt path via recursive midpoint displacement. */
function genBolt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  disp: number,
  depth: number,
): Point[] {
  let pts: Point[] = [
    [x0, y0],
    [x1, y1],
  ];
  for (let k = 0; k < depth; k++) {
    const next: Point[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      next.push(p, [
        (p[0] + q[0]) / 2 + rnd(-disp, disp),
        (p[1] + q[1]) / 2 + rnd(-disp * 0.25, disp * 0.25),
      ]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
    disp *= 0.55;
  }
  return pts;
}

interface Star {
  x: number;
  y: number;
  z: number;
  a: number;
}
interface Cloud {
  x: number;
  y: number;
  r: number;
  v: number;
}
interface Drop {
  x: number;
  y: number;
  l: number;
  v: number;
}
interface Bolt {
  paths: Point[][];
  life: number;
}

interface StormState {
  stars: Star[];
  clouds: Cloud[];
  rain: Drop[];
  bolts: Bolt[];
  next: number;
  flash: number;
  hit: number;
  bg: CanvasGradient;
  first: boolean;
}

/**
 * Canvas-2D storm background: drifting cloud glows, rain, and jagged
 * lightning that periodically strikes `target` (and crackles its outline).
 * Ported from the design's `tau-fx.js` `storm` engine.
 */
export const StormCanvas = forwardRef<StormCanvasHandle, StormCanvasProps>(
  function StormCanvas({ target, mode = "HIGH", rain = true, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const forceRef = useRef(0);

    useImperativeHandle(ref, () => ({
      pulse: () => {
        forceRef.current = 1;
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
      bg.addColorStop(0, "#061030");
      bg.addColorStop(0.6, "#03060f");
      bg.addColorStop(1, "#02030a");

      const state: StormState = {
        stars: [],
        clouds: [],
        rain: [],
        bolts: [],
        next: 0.4,
        flash: 0,
        hit: 0,
        bg,
        first: true,
      };
      for (let k = 0; k < (W * H) / 4500; k++) {
        state.stars.push({
          x: rnd(0, W),
          y: rnd(0, H * 0.75),
          z: rnd(0.4, 1.2),
          a: rnd(0.1, 0.5),
        });
      }
      for (let k = 0; k < Math.max(5, W / 150); k++) {
        state.clouds.push({
          x: rnd(-100, W + 100),
          y: rnd(-80, Math.min(300, H * 0.4)),
          r: rnd(200, 440),
          v: rnd(4, 14),
        });
      }
      if (rain) {
        for (let k = 0; k < (W * H) / 5500; k++) {
          state.rain.push({ x: rnd(0, W), y: rnd(0, H), l: rnd(10, 26), v: rnd(700, 1100) });
        }
      }

      const spawn = (force: boolean) => {
        const el = target?.() ?? null;
        const r = el ? relRect(el) : null;
        const toTarget = (force || mode === "MAX") && r && r.w > 0;
        const x1 = toTarget ? rnd(r.x + 30, r.x + r.w - 30) : rnd(60, W - 60);
        const y1 = toTarget ? r.y : H + 10;
        const x0 = x1 + rnd(-280, 280);
        const main = genBolt(x0, -10, x1, y1, 150, 7);
        const paths: Point[][] = [main];
        const branches = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < branches; k++) {
          const m = main[Math.floor(rnd(0.15, 0.7) * main.length)]!;
          paths.push(genBolt(m[0], m[1], m[0] + rnd(-200, 200), m[1] + rnd(90, 240), 50, 5));
        }
        state.bolts.push({ paths, life: 1 });
        state.flash = Math.max(state.flash, force ? 1.4 : 0.9);
        if (toTarget) state.hit = force ? 1.6 : 1;
      };

      const drawFrame = (dt: number) => {
        const max = mode === "MAX";
        state.next -= dt;
        if (state.first) {
          state.first = false;
          spawn(false);
        }
        if (forceRef.current) {
          forceRef.current = 0;
          spawn(true);
          setTimeout(() => spawn(true), 140);
        }
        if (state.next <= 0) {
          spawn(false);
          state.next = (max ? 0.38 : mode === "HIGH" ? 1.6 : 3.4) * rnd(0.5, 1.4);
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = state.bg;
        ctx.fillRect(0, 0, W, H);
        for (const p of state.stars) {
          ctx.fillStyle = `rgba(220,230,255,${p.a})`;
          ctx.fillRect(p.x, p.y, p.z, p.z);
        }
        for (const cl of state.clouds) {
          cl.x += cl.v * dt;
          if (cl.x - cl.r > W) cl.x = -cl.r;
          const g = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.r);
          g.addColorStop(
            0,
            `rgba(${40 + state.flash * 60},${62 + state.flash * 80},${120 + state.flash * 100},${0.26 + state.flash * 0.3})`,
          );
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(cl.x - cl.r, cl.y - cl.r, cl.r * 2, cl.r * 2);
        }
        if (state.rain.length) {
          ctx.strokeStyle = "rgba(160,190,255,0.12)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const d of state.rain) {
            d.y += d.v * dt;
            d.x -= d.v * dt * 0.18;
            if (d.y > H) {
              d.y = -20;
              d.x = rnd(0, W + 200);
            }
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x + d.l * 0.18, d.y - d.l);
          }
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        state.bolts = state.bolts.filter((b) => (b.life -= dt * 2.4) > 0 || dt === 0);
        for (const b of state.bolts) {
          const f = Math.max(0, b.life) * (dt ? 0.55 + 0.45 * Math.random() : 1);
          b.paths.forEach((pts, i) => {
            const m = i === 0 ? 1 : 0.55;
            (
              [
                [16 * m, `rgba(59,130,246,${0.1 * f})`],
                [6 * m, `rgba(120,180,255,${0.35 * f})`],
                [1.8 * m, `rgba(235,244,255,${f})`],
              ] as [number, string][]
            ).forEach(([w, cc]) => {
              ctx.strokeStyle = cc;
              ctx.lineWidth = w;
              ctx.beginPath();
              ctx.moveTo(pts[0]![0], pts[0]![1]);
              for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]![0], pts[k]![1]);
              ctx.stroke();
            });
          });
        }
        const el = target?.() ?? null;
        if (el && (max || state.hit > 0)) {
          const r = relRect(el);
          if (r && r.w > 0) {
            const per: Point[] = [];
            const step = 10;
            for (let px = r.x; px <= r.x + r.w; px += step) per.push([px, r.y]);
            for (let py = r.y; py <= r.y + r.h; py += step) per.push([r.x + r.w, py]);
            for (let px = r.x + r.w; px >= r.x; px -= step) per.push([px, r.y + r.h]);
            for (let py = r.y + r.h; py >= r.y; py -= step) per.push([r.x, py]);
            const amp = 2.5 + state.hit * 4;
            const f = max ? 1 : Math.min(1, state.hit);
            (
              [
                [10, `rgba(59,130,246,${0.12 * f})`],
                [3, `rgba(120,180,255,${0.45 * f})`],
                [1.1, `rgba(225,238,255,${0.9 * f})`],
              ] as [number, string][]
            ).forEach(([w, cc]) => {
              ctx.strokeStyle = cc;
              ctx.lineWidth = w;
              ctx.beginPath();
              per.forEach((p, k) => {
                const jx = p[0] + rnd(-amp, amp);
                const jy = p[1] + rnd(-amp, amp);
                if (k) ctx.lineTo(jx, jy);
                else ctx.moveTo(jx, jy);
              });
              ctx.closePath();
              ctx.stroke();
            });
          }
        }
        state.hit = Math.max(0, state.hit - dt * 2);
        ctx.globalCompositeOperation = "source-over";
        if (state.flash > 0) {
          ctx.fillStyle = `rgba(150,190,255,${state.flash * 0.16})`;
          ctx.fillRect(0, 0, W, H);
          state.flash = Math.max(0, state.flash - dt * 3.2);
        }
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
    }, [mode, rain, target]);

    return (
      <canvas
        ref={canvasRef}
        className={`storm-canvas ${className ?? ""}`}
        aria-hidden="true"
      />
    );
  },
);

export default StormCanvas;
