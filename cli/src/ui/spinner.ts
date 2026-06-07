import chalk from "chalk";

/** The τ brand mark (U+03C4). Static — it never rotates or animates. */
const TAU = "τ";
/** Brand violet for the τ mark; stays solid at all times. */
const TAU_COLOR = "#8075E8";
/** Flux green for the success message. */
const FLUX_GREEN = "#28A874";
/** Red for the failure message. */
const FLUX_RED = "#E84855";
/** Frame interval for the shimmer animation. */
const FRAME_MS = 120;
/**
 * How many shimmer frames pass before the trailing ellipsis advances. At
 * FRAME_MS this is ~360ms per dot, slow enough to read as a "thinking…" beat
 * while the colour wave keeps moving underneath it.
 */
const DOT_FRAMES = 3;
/** Maximum number of trailing dots before the ellipsis wraps back to none. */
const MAX_DOTS = 3;

/**
 * Colour wave applied across the text characters. Each character samples this
 * palette at `(frame + charIndex) % length`, so the bright crest travels
 * left-to-right with a per-character phase offset.
 */
const SHIMMER_WAVE = [
  "#8075E8",
  "#9D94EE",
  "#B8B0F4",
  "#D4D0F8",
  "#B8B0F4",
  "#9D94EE",
  "#8075E8",
  "#6B60D4",
  "#5B4FCF",
] as const;

export interface Spinner {
  /** Stop the spinner and print a success message in green. */
  succeed(msg: string): void;
  /** Stop the spinner and print a failure message in red. */
  fail(msg: string): void;
  /**
   * Stop the animation and clear the line. If `finalMsg` is given, print
   * `τ  <finalMsg>` with the message in flux green; otherwise leave the line
   * cleared.
   * @deprecated Use `.succeed(msg)` or `.fail(msg)` instead.
   */
  stop(finalMsg?: string): void;
  /** Update the text displayed alongside the spinner (retains current tick). */
  setText(text: string): void;
  /**
   * Temporarily hide the spinner: clear its line and halt the animation, but
   * keep it alive so it can be {@link Spinner.resume}d. Use this to stream
   * free-form output (e.g. the model's reply) where the spinner would otherwise
   * fight the cursor for the bottom line.
   */
  pause(): void;
  /** Re-show and re-animate a paused spinner on a fresh bottom line. */
  resume(): void;
  /**
   * Print a finished line *above* the pinned spinner: clear the spinner line,
   * write `line`, then redraw the spinner beneath it. Falls back to a plain
   * write when the spinner isn't currently visible.
   */
  log(line: string, stream?: "stdout" | "stderr"): void;
  /** Whether the spinner is currently drawn on the bottom line. */
  visible(): boolean;
}

/** Whether stdout is a TTY — if not, spinner output is suppressed. */
const isTTY = Boolean(process.stdout.isTTY);

/**
 * The spinner that currently owns the bottom line, if any. Output helpers route
 * through this so they can print above the pinned spinner instead of corrupting
 * its line. Only one spinner is live at a time in this CLI's flow.
 */
let active: Spinner | null = null;

/**
 * Print a completed line without disturbing a pinned spinner. If a spinner owns
 * the bottom line, this clears it, writes the line, and redraws the spinner
 * underneath; otherwise it writes straight to the stream. This is the seam the
 * branded `tau.*` line helpers use so they stay "above" the live spinner.
 */
export function printAbove(
  line: string,
  stream: "stdout" | "stderr" = "stdout",
): void {
  if (active && active.visible()) {
    active.log(line, stream);
    return;
  }
  (stream === "stderr" ? process.stderr : process.stdout).write(line + "\n");
}

/**
 * A spinner whose τ mark is static and solid violet; only the text shimmers,
 * as a colour wave travelling left-to-right. While running it pins itself to the
 * bottom line: other output should go through {@link printAbove} (or the
 * spinner's own {@link Spinner.log}) so it scrolls above the live spinner.
 *
 * Automatically cleans up on process exit (SIGINT / SIGTERM / beforeExit).
 */
export function createSpinner(text: string): Spinner {
  const mark = chalk.hex(TAU_COLOR)(TAU);
  let chars = [...text];
  // Monotonic frame counter; the colour wave and the ellipsis are both derived
  // from it so they share a single timer but advance at different rates.
  let tick = 0;
  let stopped = false;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const isVisible = (): boolean => isTTY && !stopped && !paused;

  const render = (): void => {
    if (!isVisible()) return;
    const frame = tick % SHIMMER_WAVE.length;
    const dots = ".".repeat(Math.floor(tick / DOT_FRAMES) % (MAX_DOTS + 1));
    // Shimmer flows across the message and the trailing dots as one string, so
    // the colour wave continues uninterrupted into the ellipsis.
    const glyphs = [...chars, ...dots];
    let painted = "";
    for (let i = 0; i < glyphs.length; i++) {
      const color = SHIMMER_WAVE[(frame + i) % SHIMMER_WAVE.length] ?? TAU_COLOR;
      painted += chalk.hex(color)(glyphs[i] ?? "");
    }
    process.stdout.write(`\r\x1B[2K${mark}  ${painted}`);
  };

  /** Erase the current bottom line (the spinner's line). */
  const clearLine = (): void => {
    if (!isTTY) return;
    process.stdout.write("\r\x1B[2K");
  };

  const startTimer = (): void => {
    if (timer !== undefined) return;
    timer = setInterval(() => {
      tick++;
      render();
    }, FRAME_MS);
  };

  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const removeExitHandlers = (): void => {
    process.off("beforeExit", cleanup);
    process.off("SIGINT", cleanup);
    process.off("SIGTERM", cleanup);
  };

  const stop = (finalMsg?: string, color?: string): void => {
    if (stopped) return;
    stopped = true;
    stopTimer();
    clearLine();
    if (finalMsg !== undefined) {
      const c = color ?? FLUX_GREEN;
      process.stdout.write(`${mark}  ${chalk.hex(c)(finalMsg)}\n`);
    }
    if (active === api) active = null;
    removeExitHandlers();
  };

  const cleanup = (): void => {
    clearLine();
    stopTimer();
    stopped = true;
    if (active === api) active = null;
  };

  const api: Spinner = isTTY
    ? {
        succeed(msg: string): void {
          stop(msg, FLUX_GREEN);
        },
        fail(msg: string): void {
          stop(msg, FLUX_RED);
        },
        stop(finalMsg?: string): void {
          stop(finalMsg);
        },
        setText(next: string): void {
          chars = [...next];
          render();
        },
        pause(): void {
          if (stopped || paused) return;
          stopTimer();
          clearLine();
          paused = true;
        },
        resume(): void {
          if (stopped || !paused) return;
          paused = false;
          render();
          startTimer();
        },
        log(line: string, stream: "stdout" | "stderr" = "stdout"): void {
          const showing = isVisible();
          if (showing) clearLine();
          (stream === "stderr" ? process.stderr : process.stdout).write(
            line + "\n",
          );
          if (showing) render();
        },
        visible(): boolean {
          return isVisible();
        },
      }
    : // Non-TTY fallback: no animation, just print plain lines.
      {
        succeed(msg: string): void {
          console.log(`${mark}  ${chalk.hex(FLUX_GREEN)(msg)}`);
        },
        fail(msg: string): void {
          console.error(`${mark}  ${chalk.hex(FLUX_RED)(msg)}`);
        },
        stop(finalMsg?: string): void {
          if (finalMsg !== undefined) {
            console.log(`${mark}  ${chalk.hex(FLUX_GREEN)(finalMsg)}`);
          }
        },
        setText(): void {},
        pause(): void {},
        resume(): void {},
        log(line: string, stream: "stdout" | "stderr" = "stdout"): void {
          (stream === "stderr" ? process.stderr : process.stdout).write(
            line + "\n",
          );
        },
        visible(): boolean {
          return false;
        },
      };

  if (isTTY) {
    active = api;
    render();
    startTimer();
    // Ensure the line is cleared if the process exits while spinning.
    process.on("beforeExit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  return api;
}
