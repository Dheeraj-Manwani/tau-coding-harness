import chalk from "chalk";
import pc from "picocolors";
import { printAbove } from "./spinner.ts";

/** The τ brand mark (U+03C4). */
const TAU = "τ";
/** Brand prefix: τ followed by two spaces, e.g. `τ  <message>`. */
const PREFIX = `${TAU}  `;

/**
 * Branded line output. Each method prints `τ  <message>`, with the τ prefix
 * painted in the method's brand colour (the message itself is left untouched,
 * except `dim`, which mutes the whole line).
 *
 * Lines are routed through {@link printAbove} so they appear *above* a pinned
 * spinner instead of corrupting its bottom line.
 */
export const tau = {
  /** Field violet — informational lines. */
  info(msg: string): void {
    printAbove(`${chalk.hex("#5B4FCF")(PREFIX)}${msg}`);
  },

  /** Flux green — success lines. */
  success(msg: string): void {
    printAbove(`${chalk.hex("#28A874")(PREFIX)}${msg}`);
  },

  /** Error red — failure lines (written to stderr). */
  error(msg: string): void {
    printAbove(`${chalk.hex("#C0595A")(PREFIX)}${msg}`, "stderr");
  },

  /** Muted/idle lines — whole line dimmed via picocolors. */
  dim(msg: string): void {
    printAbove(pc.dim(`${PREFIX}${msg}`));
  },

  /**
   * Compact tool-call status line: a violet wrench, a dimmed one-line summary
   * of the call, and an optional dimmed result note (e.g. `42 lines`, `exit 0`).
   * Deliberately muted so it sits beneath the actual response content.
   */
  tool(summary: string, result?: string): void {
    const icon = chalk.hex("#8075E8")("⚒");
    const tail = result ? ` ${pc.dim("·")} ${pc.dim(result)}` : "";
    printAbove(`  ${icon} ${pc.dim(summary)}${tail}`);
  },
};
