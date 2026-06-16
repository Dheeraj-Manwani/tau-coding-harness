import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Mode } from "../../agent/session.ts";
import { filterCommands } from "../commands.ts";
import { BRAND_VIOLET, FIELD_VIOLET, FLUX_GREEN, TAU } from "../theme.ts";

/** Mode badge colour: green = plan (read-only/safe), amber = build (mutating). */
const AMBER = "#D08B3C";

const PLACEHOLDER = "type a request, or / for commands (/help /mode /clear /exit)";

/** Render the current value with a block cursor at `cursor` (or a placeholder). */
function Value({
  value,
  cursor,
}: {
  value: string;
  cursor: number;
}) {
  if (value.length === 0) {
    return (
      <Text>
        <Text inverse> </Text>
        <Text dimColor>{PLACEHOLDER}</Text>
      </Text>
    );
  }
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

/**
 * Single-line input with a block cursor, left/right editing, ↑/↓ history, and
 * Enter to submit. Hand-rolled (no extra dependency) and gated by `isActive`,
 * so an open overlay can take the keyboard. The mode label and inverse-mode
 * hint mirror the terminal REPL's prompt.
 */
export function Input({
  mode,
  isActive,
  onSubmit,
}: {
  mode: Mode;
  isActive: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);

  const other = mode === "plan" ? "build" : "plan";

  // The live `/` command menu. When open it claims ↑/↓ and Tab/Enter; selection
  // is clamped here so it stays valid as the filtered list shrinks while typing.
  const matches = filterCommands(value);
  const menuOpen = matches.length > 0;
  const selected = Math.min(menuIdx, matches.length - 1);

  /** Replace the buffer (e.g. on history recall) and park the cursor at its end. */
  const setBuffer = (next: string): void => {
    setValue(next);
    setCursor(next.length);
    setMenuIdx(0);
  };

  useInput(
    (input, key) => {
      if (key.return) {
        const submitted = menuOpen ? (matches[selected]?.name ?? value) : value;
        if (submitted.trim()) setHistory((h) => [...h, submitted]);
        setValue("");
        setCursor(0);
        setHistIdx(null);
        setMenuIdx(0);
        onSubmit(submitted);
        return;
      }
      // Tab completes the highlighted command without submitting.
      if (key.tab && menuOpen) {
        setBuffer(matches[selected]?.name ?? value);
        return;
      }
      // Esc dismisses the menu by clearing the partial command.
      if (key.escape && menuOpen) {
        setBuffer("");
        return;
      }
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }
      if (key.upArrow) {
        if (menuOpen) {
          setMenuIdx(() => Math.max(0, selected - 1));
          return;
        }
        if (history.length === 0) return;
        const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(next);
        setBuffer(history[next] ?? "");
        return;
      }
      if (key.downArrow) {
        if (menuOpen) {
          setMenuIdx(() => Math.min(matches.length - 1, selected + 1));
          return;
        }
        if (histIdx === null) return;
        const next = histIdx + 1;
        if (next >= history.length) {
          setHistIdx(null);
          setBuffer("");
        } else {
          setHistIdx(next);
          setBuffer(history[next] ?? "");
        }
        return;
      }
      // Ctrl/Alt+Backspace (and Ctrl+W) delete the word before the cursor.
      // Kitty keyboard protocol reports these as backspace + ctrl/meta, so this
      // must come before the plain-backspace branch, which ignores modifiers.
      const wordDelete =
        ((key.backspace || key.delete) && (key.ctrl || key.meta)) ||
        (input === "w" && key.ctrl);
      if (wordDelete) {
        if (cursor > 0) {
          const before = value.slice(0, cursor);
          // Drop trailing whitespace, then the preceding run of non-whitespace.
          const start = before.replace(/\s+$/, "").search(/\S+$/);
          const from = start === -1 ? 0 : start;
          setValue(value.slice(0, from) + value.slice(cursor));
          setCursor(from);
          setMenuIdx(0);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
          setMenuIdx(0);
        }
        return;
      }
      // Printable input (ignore control chords like Ctrl+C, which Ink handles).
      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + input.length);
        setMenuIdx(0);
      }
    },
    { isActive },
  );

  const modeColor = mode === "plan" ? FLUX_GREEN : AMBER;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={FIELD_VIOLET} paddingX={1}>
        <Text color={BRAND_VIOLET} bold>{`${TAU} `}</Text>
        <Value value={value} cursor={cursor} />
      </Box>

      {menuOpen ? (
        <Box flexDirection="column" marginBottom={1}>
          {matches.map((c, i) => {
            const active = i === selected;
            const label = `${c.name}${c.arg ? " " + c.arg : ""}`;
            return (
              <Box key={c.name}>
                <Text color={active ? BRAND_VIOLET : undefined}>
                  {active ? "❯ " : "  "}
                </Text>
                <Text color={active ? BRAND_VIOLET : undefined} bold={active}>
                  {label.padEnd(18)}
                </Text>
                <Text dimColor>{c.hint}</Text>
              </Box>
            );
          })}
          <Text dimColor>{"  ↑↓ select · Tab complete · Enter run · Esc clear"}</Text>
        </Box>
      ) : null}

      {/* Mode badge pinned at the bottom (Claude Code style). */}
      <Box paddingX={1}>
        <Text color={modeColor} bold>{`${mode} mode`}</Text>
        <Text dimColor>{`  ·  /${other} to switch · ↑↓ history · Ctrl+C exit`}</Text>
      </Box>
    </Box>
  );
}
