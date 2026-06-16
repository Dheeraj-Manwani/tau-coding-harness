import { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { BRAND_VIOLET, SHIMMER_FRAME_MS, SHIMMER_WAVE, TAU } from "../theme.ts";

/** Static prompt shown while the agent is paused waiting on the user. */
const WAITING_TEXT = "please respond to proceed";

/**
 * The "thinking" status line: a static violet τ followed by a label whose
 * glyphs shimmer as a colour wave travelling left-to-right — the React port of
 * the CLI's {@link file://./../../ui/spinner.ts}. Renders nothing when not busy.
 *
 * When `waiting` is set the agent is paused on a user prompt, so we drop the
 * shimmer and elapsed timer and show a calm, static violet call to action.
 */
export function StatusLine({
  busy,
  label = "Thinking",
  waiting = false,
}: {
  busy: boolean;
  label?: string;
  waiting?: boolean;
}) {
  const [frame, setFrame] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!busy) return;
    startRef.current = Date.now();
    setFrame(0);
    setSeconds(0);
    const timer = setInterval(() => {
      setFrame((f) => f + 1);
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, SHIMMER_FRAME_MS);
    return () => clearInterval(timer);
  }, [busy]);

  if (!busy) return null;

  if (waiting) {
    return (
      <Box>
        <Text color={BRAND_VIOLET}>{`${TAU}  `}</Text>
        <Text color={BRAND_VIOLET}>{WAITING_TEXT}</Text>
      </Box>
    );
  }

  const glyphs = [...label];

  return (
    <Box>
      <Text color={BRAND_VIOLET}>{`${TAU}  `}</Text>
      {glyphs.map((g, i) => (
        <Text key={i} color={SHIMMER_WAVE[(frame + i) % SHIMMER_WAVE.length]}>
          {g}
        </Text>
      ))}
      {/* Elapsed seconds hidden for now. */}
      {/* {seconds > 0 && <Text dimColor>{`  ${seconds}s`}</Text>} */}
    </Box>
  );
}
