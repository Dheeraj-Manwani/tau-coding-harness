import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import {
  CosmosContext,
  CosmosRegistryContext,
  CosmosSceneContext,
  DEFAULT_SCENE,
  type CosmosControls,
  type CosmosScene,
} from "./cosmos";
import { useRafLoop } from "./useRafLoop";

/**
 * The one starfield behind every public page.
 *
 * Mounted once, above the router's public outlet, so navigating from the
 * landing page to the docs does not reseed the sky — the stars stay exactly
 * where they were. Everything that wants to affect it (a MAX effort selector
 * ramping density, a CTA firing a warp, a button popping a burst) goes through
 * `useCosmos()` rather than mounting a second canvas of its own.
 *
 * Deliberately hand-written rather than reusing the app's `SparkleParticles`:
 * tsparticles is ~90-120KB gzipped, which is acceptable behind a login but not
 * as the first thing a stranger downloads. The palette below is copied from
 * `pages/Home.tsx` so the landing sky and the app sky are the same sky.
 */

// ── Configuration ───────────────────────────────────────────────────────────

interface LayerConfig {
  /** Star count at 1× density on a desktop viewport. */
  count: number;
  radius: [number, number];
  /** Fraction of scroll distance this layer travels. Depth = speed. */
  parallax: number;
}

const LAYERS: LayerConfig[] = [
  { count: 120, radius: [0.4, 0.9], parallax: 0.15 },
  { count: 60, radius: [0.7, 1.3], parallax: 0.4 },
  { count: 25, radius: [1.0, 1.8], parallax: 0.8 },
];

/**
 * Density headroom. Stars up to this multiple are generated once and simply not
 * drawn until a boost asks for them, so `setDensityBoost` never allocates.
 */
const MAX_DENSITY_BOOST = 1.6;
/** Stars fade in over this many indices, so a density ramp isn't a pop. */
const DENSITY_FADE_BAND = 8;
/** Time constant for the density ramp — ~400ms to settle. */
const DENSITY_RAMP_MS = 400;

/** `[r,g,b]` weights from Home.tsx's STAR_COLORS. */
const STAR_COLORS: Array<{ rgb: string; weight: number }> = [
  { rgb: "rgb(203, 213, 225)", weight: 0.7 },
  { rgb: "rgb(226, 232, 240)", weight: 0.15 },
  { rgb: "rgb(186, 230, 253)", weight: 0.1 },
  { rgb: "rgb(253, 230, 138)", weight: 0.05 },
];

/** Only a fifth of the sky twinkles; a fully twinkling field reads as noise. */
const TWINKLE_FRACTION = 0.2;
const TWINKLE_MIN_HZ = 0.5;
const TWINKLE_MAX_HZ = 2;

/** Peak cursor-parallax displacement, in px, for a 1.0-parallax layer. */
const CURSOR_PARALLAX_PX = 6;

const WARP_RAMP_MS = 600;
/** How far a star's tail reaches toward the vanishing point at full warp. */
const WARP_REACH = 0.35;

const BURST_PARTICLES = 12;
const BURST_LIFE_MS = 600;
const BURST_COLOR = "rgb(96, 165, 250)"; // --blue-500

/**
 * Five preset meteor tracks, as fractions of the viewport. Fixed tracks rather
 * than fully random ones because random angles produce the occasional streak
 * that reads as a rendering glitch — heading straight up, or crawling along the
 * horizontal. All five run down-and-across, which is what a meteor looks like.
 *
 * `startY` stays inside the top 60vh (§4.1): a meteor at eye level while you're
 * reading the composer is a distraction, not atmosphere.
 */
const SHOOTING_TRACKS: Array<{ startX: number; startY: number; angleDeg: number }> = [
  { startX: -0.05, startY: 0.08, angleDeg: 22 },
  { startX: 0.25, startY: 0.02, angleDeg: 35 },
  { startX: 0.6, startY: 0.05, angleDeg: 28 },
  { startX: 0.95, startY: 0.14, angleDeg: 152 },
  { startX: 0.45, startY: 0.2, angleDeg: 18 },
];

const SHOOTING_MIN_GAP_MS = 4000;
const SHOOTING_MAX_GAP_MS = 9000;
const SHOOTING_SPEED_PX_S = 780;
const SHOOTING_TAIL_PX = 140;
const SHOOTING_LIFE_MS = 1100;

// ── Provider ────────────────────────────────────────────────────────────────

export function CosmosProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<CosmosControls | null>(null);
  const [scene, setScene] = useState<CosmosScene>(DEFAULT_SCENE);

  const controls = useMemo<CosmosControls>(
    () => ({
      setDensityBoost: (boost) => registryRef.current?.setDensityBoost(boost),
      warp: (ms) => registryRef.current?.warp(ms),
      burst: (x, y) => registryRef.current?.burst(x, y),
    }),
    [],
  );

  const sceneValue = useMemo(() => ({ scene, setScene }), [scene]);

  return (
    <CosmosRegistryContext.Provider value={registryRef}>
      <CosmosSceneContext.Provider value={sceneValue}>
        <CosmosContext.Provider value={controls}>
          {children}
        </CosmosContext.Provider>
      </CosmosSceneContext.Provider>
    </CosmosRegistryContext.Provider>
  );
}

// ── The canvas ──────────────────────────────────────────────────────────────

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
  /** 0 when this star does not twinkle. */
  twinkleHz: number;
  phase: number;
}

interface Layer {
  stars: Star[];
  /** Star count at boost 1. `stars` holds up to `MAX_DENSITY_BOOST` times this. */
  baseCount: number;
  parallax: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life in ms. */
  life: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life in ms. */
  life: number;
}

function pickColor(): string {
  let r = Math.random();
  for (const entry of STAR_COLORS) {
    if (r < entry.weight) return entry.rgb;
    r -= entry.weight;
  }
  return STAR_COLORS[0]!.rgb;
}

/**
 * Low-end devices get a thinner sky. A phone repainting 205 stars a frame under
 * a 4× CPU handicap is the difference between "coasting" and "stuttering".
 */
function densityScale(width: number): number {
  let scale = width < 768 ? 0.5 : 1;
  const cores = navigator.hardwareConcurrency;
  if (typeof cores === "number" && cores <= 4) scale *= 0.6;
  return scale;
}

function seedLayers(width: number, height: number): Layer[] {
  const scale = densityScale(width);
  return LAYERS.map((config) => {
    const baseCount = Math.max(1, Math.round(config.count * scale));
    const total = Math.ceil(baseCount * MAX_DENSITY_BOOST);
    const stars: Star[] = [];
    for (let i = 0; i < total; i++) {
      const [minRadius, maxRadius] = config.radius;
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: minRadius + Math.random() * (maxRadius - minRadius),
        alpha: 0.35 + Math.random() * 0.45,
        color: pickColor(),
        twinkleHz:
          Math.random() < TWINKLE_FRACTION
            ? TWINKLE_MIN_HZ + Math.random() * (TWINKLE_MAX_HZ - TWINKLE_MIN_HZ)
            : 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return { stars, baseCount, parallax: config.parallax };
  });
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Ease-in-out, for the warp envelope. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function CosmosBackdrop({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const registryRef = useContext(CosmosRegistryContext);
  const { scene } = useContext(CosmosSceneContext);
  const { density, parallax, shootingStars } = scene;
  const reduceMotion = useReduceMotion();

  const layersRef = useRef<Layer[]>([]);
  const sizeRef = useRef({ width: 0, height: 0 });
  const elapsedRef = useRef(0);

  const boostRef = useRef(1);
  const boostTargetRef = useRef(1);

  const warpStartRef = useRef(0);
  const warpDurationRef = useRef(0);

  const particlesRef = useRef<Particle[]>([]);
  const meteorsRef = useRef<Meteor[]>([]);
  const nextMeteorRef = useRef(0);

  // Cursor parallax target vs. current, so the field eases toward the pointer
  // instead of tracking it rigidly. Disabled on touch (no hover, no pointer).
  const cursorRef = useRef({ x: 0, y: 0 });
  const cursorTargetRef = useRef({ x: 0, y: 0 });

  // ── Sizing + seeding ──────────────────────────────────────────────────────

  const resize = useCallback((reseed: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (reseed || layersRef.current.length === 0) {
      layersRef.current = seedLayers(width, height);
    }
    sizeRef.current = { width, height };
  }, []);

  const draw = useCallback(
    (deltaMs: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;

      const now = performance.now();
      elapsedRef.current += deltaMs;
      const seconds = elapsedRef.current / 1000;

      // Ease density and cursor toward their targets. Exponential smoothing, so
      // the result is frame-rate independent.
      const k = 1 - Math.exp(-deltaMs / (DENSITY_RAMP_MS / 3));
      boostRef.current += (boostTargetRef.current - boostRef.current) * k;
      cursorRef.current.x +=
        (cursorTargetRef.current.x - cursorRef.current.x) * k;
      cursorRef.current.y +=
        (cursorTargetRef.current.y - cursorRef.current.y) * k;

      // Warp envelope: ramp up, hold, ramp back down.
      let warp = 0;
      if (warpDurationRef.current > 0) {
        const total = warpDurationRef.current;
        const t = now - warpStartRef.current;
        if (t >= total) {
          warpDurationRef.current = 0;
        } else {
          const ramp = Math.min(WARP_RAMP_MS, total / 2);
          warp =
            t < ramp
              ? easeInOut(t / ramp)
              : t > total - ramp
                ? easeInOut((total - t) / ramp)
                : 1;
        }
      }

      const scrollY = parallax ? window.scrollY : 0;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";

      for (const layer of layersRef.current) {
        const visible = layer.baseCount * boostRef.current * density;
        const cursorX = cursorRef.current.x * CURSOR_PARALLAX_PX * layer.parallax;
        const cursorY = cursorRef.current.y * CURSOR_PARALLAX_PX * layer.parallax;
        const offsetY = scrollY * layer.parallax;

        for (let i = 0; i < layer.stars.length; i++) {
          if (i >= visible) break;
          const star = layer.stars[i]!;

          // Stars past the current density threshold fade in over a short band
          // of indices rather than appearing all at once.
          let alpha = star.alpha * clamp01((visible - i) / DENSITY_FADE_BAND);
          if (star.twinkleHz > 0) {
            alpha *=
              0.45 +
              0.55 *
                (0.5 +
                  0.5 * Math.sin(seconds * star.twinkleHz * Math.PI * 2 + star.phase));
          }
          if (alpha <= 0.01) continue;

          // The canvas is fixed, so a layer "moves at 0.15× scroll" by being
          // drawn 0.15× of the scroll offset away, wrapped to tile forever.
          const x = (((star.x + cursorX) % width) + width) % width;
          const y = (((star.y - offsetY + cursorY) % height) + height) % height;

          ctx.globalAlpha = alpha;
          ctx.fillStyle = star.color;

          if (warp > 0) {
            // Streak length scales with depth, so the near layer smears most —
            // that's what sells forward motion.
            const reach = warp * WARP_REACH * layer.parallax;
            const tailX = x + (centerX - x) * reach;
            const tailY = y + (centerY - y) * reach;
            ctx.strokeStyle = star.color;
            ctx.lineWidth = star.radius * 2;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(x, y);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, star.radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // ── Shooting stars ─────────────────────────────────────────────────────
      const meteors = meteorsRef.current;
      if (shootingStars) {
        if (nextMeteorRef.current === 0) {
          nextMeteorRef.current =
            now + SHOOTING_MIN_GAP_MS + Math.random() * SHOOTING_MAX_GAP_MS;
        } else if (now >= nextMeteorRef.current) {
          const track =
            SHOOTING_TRACKS[Math.floor(Math.random() * SHOOTING_TRACKS.length)]!;
          const radians = (track.angleDeg * Math.PI) / 180;
          meteors.push({
            x: track.startX * width,
            y: track.startY * height,
            vx: Math.cos(radians) * SHOOTING_SPEED_PX_S,
            vy: Math.sin(radians) * SHOOTING_SPEED_PX_S,
            life: SHOOTING_LIFE_MS,
          });
          nextMeteorRef.current =
            now +
            SHOOTING_MIN_GAP_MS +
            Math.random() * (SHOOTING_MAX_GAP_MS - SHOOTING_MIN_GAP_MS);
        }
      }

      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]!;
        m.life -= deltaMs;
        if (m.life <= 0) {
          meteors.splice(i, 1);
          continue;
        }
        m.x += (m.vx * deltaMs) / 1000;
        m.y += (m.vy * deltaMs) / 1000;

        // Fade in over the first 15% of the life and out over the rest, so a
        // meteor never pops into existence mid-screen.
        const t = 1 - m.life / SHOOTING_LIFE_MS;
        const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;

        const speed = Math.hypot(m.vx, m.vy) || 1;
        const tailX = m.x - (m.vx / speed) * SHOOTING_TAIL_PX;
        const tailY = m.y - (m.vy / speed) * SHOOTING_TAIL_PX;

        const gradient = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
        gradient.addColorStop(0, "rgba(226, 232, 240, 0)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0.9)");

        ctx.globalAlpha = clamp01(fade);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
      }

      // ── Burst particles ────────────────────────────────────────────────────
      const particles = particlesRef.current;
      if (particles.length > 0) {
        ctx.fillStyle = BURST_COLOR;
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i]!;
          p.life -= deltaMs;
          if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
          }
          const progress = p.life / BURST_LIFE_MS;
          p.x += (p.vx * deltaMs) / 1000;
          p.y += (p.vy * deltaMs) / 1000;
          ctx.globalAlpha = progress;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5 * progress + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
    },
    [density, parallax, shootingStars],
  );

  // Under reduced motion the field is a composed static frame: seeded, drawn
  // once, and left alone. No loop, no twinkle, no parallax.
  useRafLoop(draw, !reduceMotion);

  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });

  // Seeding and sizing. Deliberately independent of `draw`: `draw` changes
  // identity whenever the scene does, and reseeding on a scene change would
  // make the whole sky jump the moment you click through to the docs — the one
  // thing mounting this canvas above the router was meant to prevent.
  useEffect(() => {
    resize(true);
    drawRef.current(0);

    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;
    const onResize = () => {
      // Mobile browsers fire resize every time the URL bar slides. Reseeding on
      // those would make the sky flicker while you scroll, so only a real
      // change of shape earns a new field.
      const reseed =
        window.innerWidth !== lastWidth ||
        Math.abs(window.innerHeight - lastHeight) > 120;
      lastWidth = window.innerWidth;
      lastHeight = window.innerHeight;
      resize(reseed);
      // Resizing the backing store clears it. The loop repaints on the next
      // frame; under reduced motion there is no next frame, so paint now.
      drawRef.current(0);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resize]);

  // The static frame has to be repainted when the scene changes, since nothing
  // else will redraw it.
  useEffect(() => {
    if (reduceMotion) draw(0);
  }, [reduceMotion, draw]);

  // ── Cursor parallax (pointer devices only) ────────────────────────────────

  useEffect(() => {
    if (reduceMotion) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const onPointerMove = (event: PointerEvent) => {
      cursorTargetRef.current = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: (event.clientY / window.innerHeight) * 2 - 1,
      };
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [reduceMotion]);

  // ── Register the imperative controls ──────────────────────────────────────

  useEffect(() => {
    if (!registryRef) return;
    if (reduceMotion) {
      // Density ramps, warps and bursts are all pure motion. There is no
      // meaningful static frame for them, so under reduced motion they stay
      // unregistered and `useCosmos()` keeps returning no-ops.
      return;
    }

    registryRef.current = {
      setDensityBoost: (boost) => {
        boostTargetRef.current = Math.max(
          0,
          Math.min(boost, MAX_DENSITY_BOOST),
        );
      },
      warp: (ms) => {
        warpStartRef.current = performance.now();
        warpDurationRef.current = Math.max(0, ms);
      },
      burst: (x, y) => {
        for (let i = 0; i < BURST_PARTICLES; i++) {
          const angle = (i / BURST_PARTICLES) * Math.PI * 2 + Math.random() * 0.4;
          const speed = 40 + Math.random() * 80;
          particlesRef.current.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: BURST_LIFE_MS,
          });
        }
      },
    };
    return () => {
      registryRef.current = null;
    };
  }, [registryRef, reduceMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 ${className ?? ""}`}
    />
  );
}

export default CosmosBackdrop;
