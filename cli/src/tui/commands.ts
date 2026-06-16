import type { Mode } from "../agent/session.ts";

/** A parsed slash command from the input box. */
export type SlashCommand =
  | { kind: "help" }
  | { kind: "info" }
  | { kind: "clear" }
  | { kind: "exit" }
  | { kind: "switch-mode"; target: Mode }
  /** `/mode` with no arg → toggle relative to the current mode. */
  | { kind: "toggle-mode" }
  | { kind: "unknown"; name: string };

/**
 * Parse a leading-slash input into a {@link SlashCommand}. Mirrors the terminal
 * REPL's `handleSlash` vocabulary: /help /plan /build /mode /clear /info /exit
 * (+ /quit /q). The caller (the App) performs the side effects, since mode
 * switches and clears touch the live Session.
 */
export function parseSlash(input: string): SlashCommand {
  const [cmd, arg] = input.slice(1).trim().split(/\s+/, 2);
  switch (cmd) {
    case "exit":
    case "quit":
    case "q":
      return { kind: "exit" };
    case "help":
      return { kind: "help" };
    case "info":
      return { kind: "info" };
    case "clear":
      return { kind: "clear" };
    case "plan":
      return { kind: "switch-mode", target: "plan" };
    case "build":
      return { kind: "switch-mode", target: "build" };
    case "mode":
      return arg === "plan" || arg === "build"
        ? { kind: "switch-mode", target: arg }
        : { kind: "toggle-mode" };
    default:
      return { kind: "unknown", name: cmd ?? "" };
  }
}

/** One selectable entry in the `/` command menu and the `/help` panel. */
export interface SlashSpec {
  /** The full command token, including the leading slash. */
  name: string;
  /** Optional argument hint shown after the name (e.g. `[plan|build]`). */
  arg?: string;
  /** One-line description. */
  hint: string;
}

/** The command palette, in display order. Drives the menu and `/help`. */
export const SLASH_COMMANDS: SlashSpec[] = [
  { name: "/plan", hint: "switch to plan mode (read-only)" },
  { name: "/build", hint: "switch to build mode (all tools)" },
  { name: "/mode", arg: "[plan|build]", hint: "toggle or set the agent mode" },
  { name: "/clear", hint: "start a fresh conversation" },
  { name: "/info", hint: "show the current model & mode" },
  { name: "/help", hint: "show the command list" },
  { name: "/exit", hint: "quit" },
];

/**
 * Commands matching the current input, for the live `/` menu. Returns matches
 * only while the input is a bare slash-word (a `/` followed by word chars, no
 * space yet) — once an argument is being typed the menu steps aside.
 */
export function filterCommands(input: string): SlashSpec[] {
  if (!/^\/\w*$/.test(input)) return [];
  const q = input.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(q));
}

/** The in-app `/help` panel text, derived from {@link SLASH_COMMANDS}. */
export const HELP_TEXT = [
  "Commands",
  ...SLASH_COMMANDS.map((c) => {
    const label = `${c.name}${c.arg ? " " + c.arg : ""}`;
    return `  ${label.padEnd(18)}  ${c.hint}`;
  }),
].join("\n");
