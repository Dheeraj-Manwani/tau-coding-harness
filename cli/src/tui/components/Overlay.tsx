import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { BRAND_VIOLET, TAU } from "../theme.ts";

/** A pending interaction request the App is showing as an overlay. */
export type OverlayState =
  | { type: "confirm"; id: number; message: string }
  | { type: "select"; id: number; question: string; options?: string[] };

/** Free-text escape label on a multiple-choice prompt (matches the CLI). */
const OTHER = "Other…";

export function Overlay({
  overlay,
  onResolve,
}: {
  overlay: OverlayState;
  onResolve: (value: boolean | string | null) => void;
}) {
  return overlay.type === "confirm" ? (
    <Confirm message={overlay.message} onResolve={onResolve} />
  ) : (
    <Select
      question={overlay.question}
      options={overlay.options}
      onResolve={onResolve}
    />
  );
}

/** Yes/no overlay for mode-switch confirmations. */
function Confirm({
  message,
  onResolve,
}: {
  message: string;
  onResolve: (value: boolean) => void;
}) {
  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) onResolve(true);
    else if (input === "n" || input === "N" || key.escape) onResolve(false);
  });
  return (
    <Box>
      <Text color={BRAND_VIOLET}>{`${TAU}  `}</Text>
      <Text>{`${message} `}</Text>
      <Text dimColor>(y/n)</Text>
    </Box>
  );
}

/**
 * `prompt_user` overlay: a multiple-choice list (with an "Other…" free-text
 * escape) when options are given, or a plain text prompt otherwise. Escape
 * dismisses (resolves null).
 */
function Select({
  question,
  options,
  onResolve,
}: {
  question: string;
  options?: string[];
  onResolve: (value: string | null) => void;
}) {
  const hasOptions = Boolean(options && options.length > 0);
  const items = hasOptions ? [...(options as string[]), OTHER] : [];
  const [index, setIndex] = useState(0);
  const [freetext, setFreetext] = useState(!hasOptions);
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (freetext) {
      if (key.return) {
        onResolve(value.trim() ? value : null);
        return;
      }
      if (key.escape) {
        onResolve(null);
        return;
      }
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setValue((v) => v + input);
      return;
    }
    if (key.escape) {
      onResolve(null);
      return;
    }
    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const choice = items[index];
      if (choice === OTHER) setFreetext(true);
      else onResolve(choice ?? null);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>{question}</Text>
      </Box>
      {freetext ? (
        <Box>
          <Text dimColor>{"> "}</Text>
          <Text>{value}</Text>
          <Text inverse> </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          {items.map((opt, i) => {
            const active = i === index;
            return (
              <Box key={i}>
                {/* Caret marks the highlighted row; every option carries a
                    bullet so the choices read as a list. */}
                <Text color={active ? BRAND_VIOLET : undefined} bold={active}>
                  {active ? "❯ • " : "  • "}
                </Text>
                <Text color={active ? BRAND_VIOLET : undefined} bold={active}>
                  {opt}
                </Text>
              </Box>
            );
          })}
          <Text dimColor>{"  ↑↓ select · Enter confirm · Esc cancel"}</Text>
        </Box>
      )}
    </Box>
  );
}
