import { useEffect, useRef, useState } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { useRafLoop } from "./useRafLoop";

/**
 * Types text out a few characters at a time (§5.11).
 *
 * Batched at 3 characters per frame rather than one, deliberately. One per
 * frame looks like a slow modem and, more importantly, ties the duration to the
 * refresh rate: the same code block would take twice as long on a 120Hz
 * display. Batching by frame keeps it honest and keeps the cost to one state
 * write per frame regardless of how much text lands.
 *
 * Under reduced motion it prints instantly. Text appearing letter by letter is
 * a motion effect with no informational content, so the final frame *is* the
 * content.
 */

const CHARS_PER_FRAME = 3;

interface TypewriterProps {
  text: string;
  /** Pause before the first character. */
  delayMs?: number;
  /** Set false to hold at zero characters until something turns it on. */
  active?: boolean;
  className?: string;
  onComplete?: () => void;
}

export function Typewriter({
  text,
  delayMs = 0,
  active = true,
  className,
  onComplete,
}: TypewriterProps) {
  const reduceMotion = useReduceMotion();
  const [count, setCount] = useState(0);
  const startedAt = useRef<number | null>(null);
  const done = useRef(false);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  // Text that grows: a file streaming in chunk by chunk: must keep typing
  // from where it was. Only a genuinely different string restarts the effect,
  // otherwise every arriving chunk would rewind the whole pane.
  const previousText = useRef("");
  useEffect(() => {
    if (!text.startsWith(previousText.current)) {
      setCount(0);
      startedAt.current = null;
    }
    previousText.current = text;
    done.current = false;
  }, [text]);

  const running = active && !reduceMotion && count < text.length;

  useRafLoop((_delta, now) => {
    if (startedAt.current === null) startedAt.current = now;
    if (now - startedAt.current < delayMs) return;
    setCount((current) => {
      const next = Math.min(current + CHARS_PER_FRAME, text.length);
      if (next === text.length && !done.current) {
        done.current = true;
        onCompleteRef.current?.();
      }
      return next;
    });
  }, running);

  // Reduced motion prints the whole thing; otherwise `count` holds at 0 until
  // the caller activates it, so a block below the fold stays empty until seen.
  const shown = reduceMotion ? text : text.slice(0, count);

  return (
    <span className={className}>
      {shown}
      {running && (
        <span
          aria-hidden="true"
          className="ml-px inline-block h-[1em] w-[0.45em] translate-y-[0.12em] bg-blue-500/70"
        />
      )}
    </span>
  );
}

export default Typewriter;
