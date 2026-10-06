/**
 * Bounding what a tool hands back to the model, at the source.
 *
 * A tool result is paid for on every later turn of the run, not once. Before
 * this, `run_command` returned a command's entire stdout and `read_file` a
 * file's entire contents, and the only thing that ever trimmed them was context
 * compaction — which runs late, once the window is already a third full, and
 * cuts a hole in the middle with no way to get the missing part back.
 *
 * So the bound moves here, and it is a *restorable* one: what does not fit in
 * the result still exists on the sandbox's disk, and the result says where.
 * A long file is read a page at a time (`offset` / `limit`); long command
 * output is saved under `.tau/logs/` and can be paged, searched or tailed.
 *
 * Pure functions, no sandbox — the tools call these and do the I/O themselves.
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §7.
 */

/** Per stream (stdout, stderr) of one `run_command`. About 2k tokens each. */
export const MAX_COMMAND_STREAM_CHARS = 8_000;

/** One `read_file` page. About 7.5k tokens at most. */
export const MAX_READ_LINES = 600;
export const MAX_READ_CHARS = 30_000;

/** `tail_command_output`, however many lines were asked for. */
export const MAX_TAIL_CHARS = 16_000;

/** `list_dir` at any depth. */
export const MAX_DIR_ENTRIES = 400;

/** `grep`: matching lines returned, and how much of each. */
export const MAX_GREP_LINES = 100;
export const MAX_GREP_LINE_CHARS = 300;

export interface Capped {
  text: string;
  truncated: boolean;
}

/**
 * Keep the start and the end of `text`, cutting the middle.
 *
 * The end gets the larger share: a build or a test run puts what went wrong
 * last, while the start mostly says which command ran.
 */
export function headTail(text: string, maxChars: number): Capped {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.4);
  const tail = maxChars - head;
  const cut = text.length - head - tail;
  return {
    text: `${text.slice(0, head)}\n\n…[${cut} characters cut]…\n\n${text.slice(-tail)}`,
    truncated: true,
  };
}

/** Keep only the end of `text` — for a log, where the end is the point. */
export function tailOnly(text: string, maxChars: number): Capped {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `…[${text.length - maxChars} earlier characters cut]…\n${text.slice(-maxChars)}`,
    truncated: true,
  };
}

export interface ReadPage {
  content: string;
  /** 1-based, inclusive. Present whenever the result is not the whole file. */
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  /** The page stops short of what was asked for (or of the file, if no range was). */
  truncated?: boolean;
  note?: string;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

/**
 * One page of a file for `read_file`.
 *
 * A file that fits is returned exactly as it always was — `{ content }`, byte
 * for byte, so `edit_file` can match against it. Only a file that does not fit,
 * or an explicit `offset` / `limit`, produces a page with line numbers around
 * it. The content itself is never prefixed with line numbers, for the same
 * reason: it has to be copyable into `edit_file` as-is.
 */
export function pageOf(
  content: string,
  range: { offset?: unknown; limit?: unknown } = {},
): ReadPage {
  const offset = positiveInt(range.offset);
  const limit = positiveInt(range.limit);

  // A trailing newline ends the last line; it does not start an empty one.
  const endsWithNewline = content.endsWith("\n");
  const lines = (endsWithNewline ? content.slice(0, -1) : content).split("\n");
  const totalLines = content === "" ? 0 : lines.length;

  if (
    offset === undefined &&
    limit === undefined &&
    content.length <= MAX_READ_CHARS &&
    totalLines <= MAX_READ_LINES
  ) {
    return { content };
  }

  const startLine = offset ?? 1;
  if (startLine > totalLines) {
    return {
      content: "",
      totalLines,
      note: `Nothing to read at line ${startLine}: the file has ${totalLines} line${totalLines === 1 ? "" : "s"}.`,
    };
  }

  const wanted = Math.min(limit ?? MAX_READ_LINES, MAX_READ_LINES);
  const taken: string[] = [];
  let chars = 0;
  let lineCut = false;
  for (let i = startLine - 1; i < lines.length && taken.length < wanted; i++) {
    const line = lines[i]!;
    if (chars + line.length + 1 > MAX_READ_CHARS) {
      // Always return something: a single enormous line (minified code, a data
      // blob) is cut rather than skipped.
      if (taken.length === 0) {
        taken.push(`${line.slice(0, MAX_READ_CHARS)}…[line cut]`);
        lineCut = true;
      }
      break;
    }
    taken.push(line);
    chars += line.length + 1;
  }

  const endLine = startLine + taken.length - 1;
  const reachedEnd = endLine >= totalLines;
  // What was asked for: `limit` lines if given, otherwise the rest of the file.
  const askedThrough =
    limit === undefined ? totalLines : Math.min(startLine + limit - 1, totalLines);
  const truncated = lineCut || endLine < askedThrough;

  const body = taken.join("\n");
  const notes: string[] = [];
  if (!reachedEnd || startLine > 1) {
    notes.push(`Showing lines ${startLine}–${endLine} of ${totalLines}.`);
  }
  if (lineCut) {
    notes.push("That line is too long to return whole; use grep to find what you need in it.");
  } else if (!reachedEnd) {
    notes.push(
      `Read on with offset=${endLine + 1}, or use grep to find the part you need.`,
    );
  }

  return {
    content: reachedEnd && endsWithNewline && !lineCut ? `${body}\n` : body,
    startLine,
    endLine,
    totalLines,
    ...(truncated ? { truncated } : {}),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/** Quote a string for a POSIX shell, so it reaches the program unchanged. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
