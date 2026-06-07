import { renderMarkdown } from "./markdown.ts";

/** Whether stdout is a TTY — gates the erase-and-redraw behaviour. */
const isTTY = Boolean(process.stdout.isTTY);

/** Match ANSI SGR escapes so width math counts visible characters only. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*m/g;

/** Number of terminal rows `text` occupies when printed from column 0. */
function rowsFor(text: string, cols: number): number {
  let rows = 0;
  for (const line of text.split("\n")) {
    const width = line.replace(ANSI, "").length;
    rows += Math.max(1, Math.ceil(width / cols));
  }
  return rows;
}

export interface LiveText {
  /** Append a streamed delta; echoed raw to the terminal in a TTY. */
  push(delta: string): void;
  /**
   * Finish the stream: in a TTY, erase the raw text and reprint it as rendered
   * markdown; otherwise print the rendered markdown once. No-op if nothing was
   * streamed. Emits a trailing blank line so following output stays separated.
   */
  finish(): void;
}

/**
 * A live response region: raw tokens stream in for instant feedback, then on
 * {@link LiveText.finish} the raw text is erased and replaced with rendered
 * markdown. The erase walks the cursor back up over the streamed rows, so it
 * assumes that text hasn't scrolled past the top of the viewport — the
 * documented trade-off of live-then-render. In a non-TTY it simply buffers and
 * prints the rendered markdown once.
 */
export function createLiveText(): LiveText {
  let buf = "";
  let started = false;

  return {
    push(delta: string): void {
      buf += delta;
      if (!isTTY) return;
      if (!started) {
        process.stdout.write("\n"); // blank line above the response
        started = true;
      }
      process.stdout.write(delta);
    },

    finish(): void {
      if (!buf.trim()) return;
      const rendered = renderMarkdown(buf.trimEnd());

      if (!isTTY) {
        process.stdout.write(`\n${rendered}\n\n`);
        return;
      }

      // Erase the raw streamed text, then reprint it rendered. The leading
      // blank line written on the first push is left in place as separation.
      const cols = process.stdout.columns || 80;
      const rows = rowsFor(buf, cols);
      if (rows > 1) process.stdout.write(`\x1B[${rows - 1}A`);
      process.stdout.write(`\r\x1B[0J${rendered}\n\n`);
    },
  };
}
