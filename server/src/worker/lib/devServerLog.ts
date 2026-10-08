import { DEV_SERVER_LOG_PATH } from "../templates/shared";
import type { FileSource } from "./appStack";

/**
 * The end of the dev server's own output, for when the app will not load.
 *
 * A browser can say that a page did not compile, or did not answer at all. It
 * cannot always say why: a dependency that would not install, a proxy with
 * nothing behind it and a config that failed to load are all things the dev
 * server prints and the page never shows. Since the base image started keeping
 * that output (`DEV_SERVER_START_CMD`), the last of it can be read here.
 *
 * Null on a sandbox from an older image, which has no such file.
 */

const MAX_LINES = 14;
const MAX_CHARS = 1_200;

/** Colour codes, in case the dev server thought it was writing to a terminal. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** `7:44:59 PM ` at the start of a line: when it was printed, not what. */
const CLOCK = /^\d{1,2}:\d{2}:\d{2}\s?(?:AM|PM)?\s+/i;

/** A stack frame inside the dev server or the runtime under it. */
const SERVER_FRAME = /^\s+at\s.*(node_modules|\(native:|node:internal)/;

/**
 * The last entries worth reading.
 *
 * An entry is a line that is not indented and the indented lines after it:
 * Vite prints an error as a headline, the plugin, the file and a few lines of
 * the source.
 *
 * Three things are dropped. Blank lines and the server's own stack frames,
 * which follow every error by the dozen. A leading fragment: the file is kept
 * to a size by starting it again (`DEV_SERVER_LOG_CAP_AWK`), so it can open
 * half-way through an entry, and half an entry is noise. And repeats: while a
 * browser has a broken app open Vite prints the same error hundreds of times a
 * second, and without this the tail would be fourteen lines of one error
 * twice over. Of identical entries the newest is the one kept.
 */
export function tailOfLog(text: string, maxLines = MAX_LINES, maxChars = MAX_CHARS): string {
  const lines = text
    .replace(ANSI, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd().replace(/\/home\/user\/app\//g, ""))
    .filter((line) => line.trim() && !SERVER_FRAME.test(line));

  const entries: string[][] = [];
  for (const line of lines) {
    const indented = /^\s/.test(line);
    if (!indented) entries.push([line]);
    else if (entries.length > 0) entries[entries.length - 1]!.push(line);
    // else: the tail end of an entry whose beginning is gone.
  }

  const seen = new Set<string>();
  const kept: string[][] = [];
  let lineCount = 0;
  let charCount = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const text = entry.join("\n");
    const key = text.replace(CLOCK, "");
    if (seen.has(key)) continue;
    seen.add(key);
    // Whole entries only, newest first, until the next would not fit in
    // either measure. An entry cut in two is a headline without its detail or
    // detail without its headline.
    if (kept.length > 0 && (lineCount + entry.length > maxLines || charCount + text.length + 1 > maxChars)) break;
    kept.unshift(entry);
    lineCount += entry.length;
    charCount += text.length + 1;
  }

  // The newest is always kept, so it alone can be over: cut it to its opening
  // lines, and those to length, keeping the headline.
  let out = kept.length === 1 ? kept[0]!.slice(0, maxLines).join("\n") : kept.flat().join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}…`;
  return out;
}

export async function readDevServerLog(sandbox: FileSource): Promise<string | null> {
  let text: string;
  try {
    text = await sandbox.files.read(DEV_SERVER_LOG_PATH);
  } catch {
    return null;
  }
  const tail = tailOfLog(text);
  return tail || null;
}
