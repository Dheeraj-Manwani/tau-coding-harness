import { Box, Text } from "ink";
import { BRAND_VIOLET, TAU } from "../theme.ts";

export interface BannerProps {
  provider: string;
  model: string;
  mode: string;
  cwd: string;
}

/**
 * The brand mark: a large τ (the torque glyph), drawn in block art — a solid
 * crossbar, a centred stem, and a small foot curling left. Each row takes a
 * lighter-to-darker violet shade for a subtle top-to-bottom gradient.
 */
const LOGO: ReadonlyArray<readonly [string, string]> = [
  ["█████████", "#C9C3F7"],
  ["    ██", "#A99FF0"],
  ["    ██", "#8075E8"],
  ["  ▄▄██", "#6B60D4"],
];

/**
 * The one-time intro banner at the top of the scrollback (the first
 * {@link Static} item): a large τ/tau brand logo, the provider · model · mode
 * summary, the cwd, and a hint line.
 */
export function Banner({ provider, model, mode, cwd }: BannerProps) {
  return (
    <Box marginTop={1} marginBottom={1}>
      <Box flexDirection="column">
        {LOGO.map(([line, color], i) => (
          <Text key={i} color={color} bold>
            {`  ${line}`}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text color={BRAND_VIOLET} bold>{`${TAU} tau`}</Text>
        <Text dimColor>{`${provider} · ${model} · ${mode} mode`}</Text>
        <Text dimColor>{`cwd: ${cwd}`}</Text>
        <Text dimColor>
          {"Type a request, or /help for commands. Ctrl+C to exit."}
        </Text>
      </Box>
    </Box>
  );
}
