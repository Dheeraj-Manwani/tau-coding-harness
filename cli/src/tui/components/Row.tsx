import { Box, Text, useStdout } from "ink";
import type { Entry } from "../state.ts";
import { renderMarkdown } from "../../ui/markdown.ts";
import { BRAND_VIOLET, ERROR_RED, FIELD_VIOLET, TAU } from "../theme.ts";

/** The violet wrench prefix on tool lines, matching `tau.tool` in the CLI. */
const WRENCH = "#8075E8";

/** User-message bubble: subtle grey fill, light readable text — no border. */
const USER_BG = "#2B2B31";
const USER_FG = "#CFCFD6";

/**
 * Render one transcript {@link Entry}. Assistant text streams raw while in
 * flight, then re-renders as terminal markdown once finalized — reproducing the
 * CLI's live-then-render effect, but driven by React rather than cursor math.
 */
export function Row({ entry }: { entry: Entry }) {
  const { stdout } = useStdout();
  switch (entry.kind) {
    case "user":
      // The user's own message sits in a filled grey bubble with a chevron
      // marker — a clear, self-contained block that the agent's reply below
      // can't blend into. An explicit terminal-column width makes the fill span
      // the whole row even for short messages (a `width="100%"` doesn't, since
      // it resolves against the unconstrained <Static> region, not the screen).
      return (
        <Box
          width={stdout?.columns ?? 80}
          marginTop={1}
          marginBottom={1}
          backgroundColor={USER_BG}
          paddingX={1}
        >
          <Text color={BRAND_VIOLET}>{"❯"}</Text>
          <Text backgroundColor={USER_BG} color={USER_FG}>
            {` ${entry.text}`}
          </Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginTop={entry.gap ? 1 : 0} marginBottom={1}>
          <Text>
            {entry.streaming ? entry.text : renderMarkdown(entry.text.trimEnd())}
          </Text>
        </Box>
      );

    case "tool":
      return (
        <Box>
          <Text color={WRENCH}>{"  ⚒ "}</Text>
          <Text dimColor>
            {entry.summary}
            {entry.result ? ` · ${entry.result}` : ""}
          </Text>
        </Box>
      );

    case "tool-error":
      return (
        <Box flexDirection="column">
          <Box>
            <Text color={WRENCH}>{"  ⚒ "}</Text>
            <Text dimColor>{`${entry.summary} · failed`}</Text>
          </Box>
          <Text color={ERROR_RED}>{`${TAU}  ${entry.output}`}</Text>
        </Box>
      );

    case "error":
      return <Text color={ERROR_RED}>{`${TAU}  ${entry.text}`}</Text>;

    case "notice":
      return (
        <Box marginBottom={1}>
          <Text color={FIELD_VIOLET}>{`${TAU}  `}</Text>
          <Text dimColor>{entry.text}</Text>
        </Box>
      );
  }
}
