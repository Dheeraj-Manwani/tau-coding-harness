import { useState, type PointerEvent } from "react";
import { int } from "@/lib/format";

/**
 * Requests per minute over the telemetry window — one series, so the card's
 * title names it and there is no legend. 2px line over a soft area in the
 * accent, a crosshair + tooltip on hover, and a text equivalent for screen
 * readers. Width is fluid: the path is drawn in a fixed viewBox and stretched,
 * with non-scaling strokes so the line stays 2px at any size.
 */
export function Sparkline({
  values,
  endsAt,
  unit = "requests",
  height = 72,
}: {
  values: number[];
  /** Timestamp of the last point (the current minute). */
  endsAt: Date;
  unit?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const W = 600;
  const H = height;
  const peak = Math.max(0, ...values);
  // Scale against at least 1 so an idle hour draws a flat baseline, not NaN.
  const max = Math.max(1, peak);
  const x = (i: number) => (n <= 1 ? W : (i / (n - 1)) * W);
  const y = (v: number) => H - 2 - (v / max) * (H - 6);

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const minuteAt = (i: number) => new Date(endsAt.getTime() - (n - 1 - i) * 60_000);
  const fmtMinute = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))));
  };

  const total = values.reduce((a, b) => a + b, 0);
  const point = hover === null ? null : { i: hover, v: values[hover] ?? 0 };

  return (
    <figure className="m-0">
      <div
        className="relative cursor-crosshair touch-none"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="var(--accent)" opacity="0.14" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1="0"
              y2={H}
              stroke="var(--fg-3)"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {point && (
          <>
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent"
              style={{ left: `${(x(point.i) / W) * 100}%`, top: y(point.v) }}
            />
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-lg"
              style={{
                left: `${(x(point.i) / W) * 100}%`,
                // Flip to the left of the crosshair near the right edge so it never clips.
                transform: `translate(${point.i > n * 0.5 ? "calc(-100% - 8px)" : "8px"}, 0)`,
              }}
            >
              <span className="text-fg-3">{fmtMinute(minuteAt(point.i))}</span>{" "}
              <span className="num font-medium text-fg">{int(point.v)}</span> <span className="text-fg-2">{unit}</span>
            </div>
          </>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-fg-3">
        <span>{n}m ago</span>
        <span>peak {int(peak)}/min</span>
        <span>now</span>
      </div>
      <figcaption className="sr-only">
        {int(total)} {unit} over the last {n} minutes, peaking at {int(peak)} per minute.
      </figcaption>
    </figure>
  );
}
