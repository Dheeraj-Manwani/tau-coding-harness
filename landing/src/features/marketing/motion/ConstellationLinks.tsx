import { useCallback, useEffect, useRef } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { useIsVisible, useRafLoop } from "./useRafLoop";

/**
 * A drifting point cloud that draws lines between near neighbours, and brighter
 * ones near the cursor (§5.7).
 *
 * The motif behind the workspace tour: "wired together". Cheap by construction
 *: the whole thing is one canvas, the point count is small, and the loop is
 * gated on both visibility and tab focus through `useRafLoop`, so scrolling
 * past it stops the work entirely.
 *
 * The naive version of this is O(n²) every frame. At 60 points that is 1,770
 * pair checks, which is fine; it is why the count stays where it is rather than
 * scaling with the container.
 */

const POINT_COUNT = 56;
/** Pairs closer than this get a line, fading out with distance. */
const LINK_RADIUS = 110;
/** Points within this of the cursor link to it more brightly. */
const CURSOR_RADIUS = 160;
/** Pixels per second of idle drift. */
const DRIFT = 8;

interface CloudPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function ConstellationLinks({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<CloudPoint[]>([]);
  const sizeRef = useRef({ width: 0, height: 0 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  const reduceMotion = useReduceMotion();
  const visible = useIsVisible(wrapperRef, "100px");

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const { width, height } = wrapper.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeRef.current = { width, height };

    if (pointsRef.current.length === 0) {
      pointsRef.current = Array.from({ length: POINT_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * DRIFT,
        vy: (Math.random() - 0.5) * DRIFT,
      }));
    }
  }, []);

  const draw = useCallback((deltaMs: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    const { width, height } = sizeRef.current;
    if (!ctx || width === 0) return;

    const points = pointsRef.current;
    const seconds = deltaMs / 1000;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      point.x += point.vx * seconds;
      point.y += point.vy * seconds;
      // Wrap rather than bounce: a bounce reads as a wall, a wrap reads as a
      // field that continues past the edge.
      if (point.x < 0) point.x += width;
      if (point.x > width) point.x -= width;
      if (point.y < 0) point.y += height;
      if (point.y > height) point.y -= height;
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > LINK_RADIUS) continue;
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.18 * (1 - distance / LINK_RADIUS)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(148, 163, 184, 0.45)";
      ctx.beginPath();
      ctx.arc(a.x, a.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const cursor = cursorRef.current;
    if (cursor) {
      for (const point of points) {
        const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
        if (distance > CURSOR_RADIUS) continue;
        ctx.strokeStyle = `rgba(96, 165, 250, ${0.35 * (1 - distance / CURSOR_RADIUS)})`;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(cursor.x, cursor.y);
        ctx.stroke();
      }
    }
  }, []);

  useRafLoop(draw, visible && !reduceMotion);

  useEffect(() => {
    resize();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => resize());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    if (reduceMotion) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = wrapper.getBoundingClientRect();
      cursorRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };
    const onLeave = () => {
      cursorRef.current = null;
    };
    wrapper.addEventListener("pointermove", onMove, { passive: true });
    wrapper.addEventListener("pointerleave", onLeave);
    return () => {
      wrapper.removeEventListener("pointermove", onMove);
      wrapper.removeEventListener("pointerleave", onLeave);
    };
  }, [reduceMotion]);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      {/* Reduced motion drops the canvas entirely. A frozen point cloud is
          visual noise with no meaning: the section reads fine without it. */}
      {!reduceMotion && <canvas ref={canvasRef} className="block" />}
    </div>
  );
}

export default ConstellationLinks;
