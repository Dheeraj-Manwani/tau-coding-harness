import { useEffect, useRef, useState } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { useIsVisible } from "./useRafLoop";

/**
 * The separator between landing bands: a hairline rule with a bright segment
 * that occasionally runs down it and fades out.
 *
 * The meteor is a CSS transition on a single absolutely-positioned span rather
 * than a rAF loop — one moving element every 6-11s does not deserve a frame
 * budget. It only schedules itself while the divider is on screen.
 */

const MIN_GAP_MS = 6000;
const MAX_GAP_MS = 11000;
const TRAVEL_MS = 1400;

export function MeteorDivider({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useIsVisible(ref, "0px");
  const reduceMotion = useReduceMotion();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!visible || reduceMotion) return;

    let timeout: number;
    const schedule = (delay: number) => {
      timeout = window.setTimeout(() => {
        setRunning(true);
        window.setTimeout(() => setRunning(false), TRAVEL_MS);
        schedule(MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
      }, delay);
    };

    schedule(Math.random() * MAX_GAP_MS);
    return () => window.clearTimeout(timeout);
  }, [visible, reduceMotion]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("relative h-px w-full overflow-hidden", className)}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-silver-200 to-transparent" />
      {!reduceMotion && (
        <span
          className="absolute top-0 h-px w-10 bg-gradient-to-r from-transparent via-blue-300 to-transparent"
          style={{
            left: running ? "100%" : "-10%",
            opacity: running ? 1 : 0,
            transition: running
              ? `left ${TRAVEL_MS}ms linear, opacity 300ms ease-out`
              : "none",
          }}
        />
      )}
    </div>
  );
}

export default MeteorDivider;
