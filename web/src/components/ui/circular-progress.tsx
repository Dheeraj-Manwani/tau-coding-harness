import { useEffect, useState } from "react";

import { cn } from "@/src/lib/utils";
import { colorForPercent } from "@/src/components/ui/circular-progress-color";

/** How long the flash pulse (triggered by an auto-run) stays visible. */
const FLASH_DURATION_MS = 900;

export interface CircularProgressProps {
  /** 0-100. Values outside that range are clamped. */
  percent: number;
  /** Set when an auto-compaction/auto-summarization just ran, to pulse the
   *  ring so the user understands why usage just dropped. */
  flashKind?: "compact" | "summarize" | null;
  /** Bumped by the caller on every flash, even when `flashKind` repeats, so
   *  this component can always detect a *new* flash and restart the pulse. */
  flashToken?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Ring showing how full the model's context window is right now. See
 * doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md for the product rationale and
 * where the percentage comes from (SSE mid-job, or directly from the
 * clear/summarize response otherwise).
 */
export function CircularProgress({
  percent,
  flashKind,
  flashToken = 0,
  size = 20,
  strokeWidth = 2.5,
  className,
}: CircularProgressProps) {
  const [flashing, setFlashing] = useState(false);
  // "Adjust state on prop change during render" — react.dev's documented
  // alternative to an effect for this: lets a *repeated* flashKind (e.g. two
  // "compact" auto-runs in a row) still restart the pulse, since it's keyed
  // on the ever-increasing token rather than the kind's value.
  const [seenToken, setSeenToken] = useState(flashToken);
  if (flashKind && flashToken !== seenToken) {
    setSeenToken(flashToken);
    setFlashing(true);
  }

  // The effect only ever schedules a timer; the actual setFlashing(false)
  // happens in that timer's callback, not synchronously in the effect body.
  useEffect(() => {
    if (!flashing) return;
    const t = setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, [flashing]);

  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const color = colorForPercent(clamped);

  return (
    <svg
      role="img"
      aria-label={`${Math.round(clamped)}% of context window used`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(
        "shrink-0 -rotate-90 transition-transform",
        flashing && "scale-125",
        className,
      )}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-[var(--silver-200)]"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn(
          "stroke-current transition-[stroke-dashoffset,color] duration-300",
          color,
          flashing && "animate-pulse",
        )}
      />
    </svg>
  );
}
