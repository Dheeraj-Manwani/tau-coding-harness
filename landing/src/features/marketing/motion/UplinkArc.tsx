import { useCallback, useEffect, useRef } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { useIsVisible, useRafLoop } from "./useRafLoop";

/**
 * Files flying from tau to GitHub along a dotted arc (§4.7).
 *
 * Two things happen on the same path. Most packets make the trip and land, and
 * the arriving glyph pulses. One packet: the `.env`: hits a shield midway,
 * flashes red and dissolves. That second beat is the whole point of the band:
 * the secret-path filter is a hard floor that runs *before* your own
 * `.gitignore`, so deleting your `.gitignore` still cannot publish a key.
 *
 * Drawn in one canvas sized to its container, with the loop gated on
 * visibility. Reduced motion renders the static arc, the shield and a landed
 * packet: the diagram, minus the flight.
 */

/** Bezier in normalised container space, so it scales with the box. */
const FROM = { x: 0.08, y: 0.5 };
const TO = { x: 0.92, y: 0.5 };
// Well above the box: a quadratic's peak only reaches a quarter of the way to
// its control point, so a control inside the box gives a barely-bent line.
const CONTROL = { x: 0.5, y: -0.35 };
/** Where the shield sits along the curve. */
const SHIELD_T = 0.45;

const PACKET_INTERVAL_MS = 400;
const PACKET_SPEED = 0.55; // path fraction per second
/** Every nth packet is the one that gets stopped. */
const SECRET_EVERY = 5;

interface Packet {
  t: number;
  secret: boolean;
  /** Counts down once a secret packet is destroyed, for the flash. */
  dying: number;
  jitter: number;
}

function pointAt(t: number, width: number, height: number) {
  const u = 1 - t;
  return {
    x: (u * u * FROM.x + 2 * u * t * CONTROL.x + t * t * TO.x) * width,
    y: (u * u * FROM.y + 2 * u * t * CONTROL.y + t * t * TO.y) * height,
  };
}

interface UplinkArcProps {
  /** Called when a non-secret packet lands, so the target can pulse. */
  onArrive?: () => void;
  className?: string;
}

export function UplinkArc({ onArrive, className }: UplinkArcProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const packetsRef = useRef<Packet[]>([]);
  const spawnedRef = useRef(0);
  const sinceSpawnRef = useRef(0);
  const dashRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  const reduceMotion = useReduceMotion();
  const visible = useIsVisible(wrapperRef, "100px");

  // Read through a ref so an inline `onArrive` doesn't restart the loop.
  const onArriveRef = useRef(onArrive);
  useEffect(() => {
    onArriveRef.current = onArrive;
  });

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return null;
    const { width, height } = wrapper.getBoundingClientRect();
    if (width === 0 || height === 0) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    sizeRef.current = { width, height };
    return { width, height };
  }, []);

  const paint = useCallback(
    (deltaMs: number, still: boolean) => {
      const ctx = canvasRef.current?.getContext("2d");
      const size = measure();
      if (!ctx || !size) return;
      const { width, height } = size;
      const seconds = deltaMs / 1000;

      ctx.clearRect(0, 0, width, height);

      // ── The route: marching ants from tau to GitHub ──────────────────────
      if (!still) dashRef.current = (dashRef.current + seconds * 18) % 14;
      ctx.save();
      ctx.setLineDash([3, 11]);
      ctx.lineDashOffset = -dashRef.current;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const start = pointAt(0, width, height);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i <= 60; i++) {
        const p = pointAt(i / 60, width, height);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();

      // ── The shield ───────────────────────────────────────────────────────
      const shield = pointAt(SHIELD_T, width, height);
      const anyDying = packetsRef.current.some((p) => p.dying > 0);
      ctx.save();
      ctx.translate(shield.x, shield.y);
      ctx.strokeStyle = anyDying ? "var(--error-red)" : "rgba(148, 163, 184, 0.7)";
      ctx.fillStyle = anyDying ? "rgba(248, 113, 113, 0.15)" : "rgba(30, 37, 50, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const x = Math.cos(angle) * 13;
        const y = Math.sin(angle) * 13;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (still) {
        // The static frame: one packet, landed.
        const landed = pointAt(0.86, width, height);
        ctx.fillStyle = "var(--blue-500)";
        ctx.fillRect(landed.x - 4, landed.y - 4, 8, 8);
        return;
      }

      // ── Packets ──────────────────────────────────────────────────────────
      sinceSpawnRef.current += deltaMs;
      if (sinceSpawnRef.current >= PACKET_INTERVAL_MS) {
        sinceSpawnRef.current = 0;
        spawnedRef.current += 1;
        packetsRef.current.push({
          t: 0,
          secret: spawnedRef.current % SECRET_EVERY === 0,
          dying: 0,
          jitter: (Math.random() - 0.5) * 10,
        });
      }

      const packets = packetsRef.current;
      for (let i = packets.length - 1; i >= 0; i--) {
        const packet = packets[i]!;

        if (packet.dying > 0) {
          packet.dying -= deltaMs;
          if (packet.dying <= 0) {
            packets.splice(i, 1);
            continue;
          }
          const p = pointAt(packet.t, width, height);
          const fade = packet.dying / 300;
          ctx.globalAlpha = fade;
          ctx.fillStyle = "var(--error-red)";
          ctx.fillRect(p.x - 5 * fade, p.y - 5 * fade + packet.jitter, 10 * fade, 10 * fade);
          ctx.globalAlpha = 1;
          continue;
        }

        packet.t += PACKET_SPEED * seconds;

        // A secret never gets past the shield. This is the floor, not a filter
        // the project can opt out of.
        if (packet.secret && packet.t >= SHIELD_T) {
          packet.t = SHIELD_T;
          packet.dying = 300;
          continue;
        }

        if (packet.t >= 1) {
          packets.splice(i, 1);
          onArriveRef.current?.();
          continue;
        }

        const p = pointAt(packet.t, width, height);
        ctx.fillStyle = packet.secret ? "var(--error-red)" : "var(--blue-500)";
        ctx.fillRect(p.x - 3, p.y - 3 + packet.jitter, 6, 6);
        if (packet.secret) {
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = "rgba(248, 113, 113, 0.9)";
          ctx.fillText(".env", p.x + 6, p.y + 3 + packet.jitter);
        }
      }
    },
    [measure],
  );

  useRafLoop((delta) => paint(delta, false), visible && !reduceMotion);

  // Paint the still frame once for reduced motion, and whenever the box changes.
  const stillPaintedRef = useRef(false);
  useRafLoop(
    () => {
      if (stillPaintedRef.current) return;
      stillPaintedRef.current = true;
      paint(0, true);
    },
    reduceMotion && visible,
  );

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      className={cn("relative w-full", className)}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}

export default UplinkArc;
