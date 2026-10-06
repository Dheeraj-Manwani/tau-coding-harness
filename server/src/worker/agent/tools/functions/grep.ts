import Sandbox, { CommandExitError } from "e2b";
import { asString, WORK_DIR } from "./utils";
import { MAX_GREP_LINE_CHARS, MAX_GREP_LINES, shellQuote } from "./output";

/** Matches per file, so one generated or minified file cannot fill the result. */
const MAX_MATCHES_PER_FILE = 50;
const MAX_CONTEXT_LINES = 5;

/** Never worth searching; `rg` skips most of these itself via .gitignore. */
const SKIP_DIRS = ["node_modules", ".git", "dist", "build", "data"];

export interface GrepInput {
  pattern: string;
  path: string;
  glob?: string;
  ignoreCase: boolean;
  context: number;
}

export function parseGrepInput(input: unknown): GrepInput {
  const { pattern, path, glob, ignoreCase, context } = (input ?? {}) as {
    pattern?: unknown;
    path?: unknown;
    glob?: unknown;
    ignoreCase?: unknown;
    context?: unknown;
  };
  return {
    pattern: asString(pattern, "pattern"),
    path: typeof path === "string" && path.trim() ? path.trim() : ".",
    ...(typeof glob === "string" && glob.trim() ? { glob: glob.trim() } : {}),
    ignoreCase: ignoreCase === true,
    context:
      typeof context === "number" && context > 0
        ? Math.min(Math.floor(context), MAX_CONTEXT_LINES)
        : 0,
  };
}

/**
 * The shell command for a search.
 *
 * ripgrep where the sandbox has it — the generation-2 image installs it — and
 * plain `grep -r` where it does not, so the tool works on every project
 * whichever image it was built on. Both print `path:line:text`.
 *
 * Every model-supplied value is shell-quoted and the pattern is passed with
 * `-e`, so a pattern that starts with a dash or contains a quote searches for
 * that text instead of being read as an option or ending the string.
 */
export function buildGrepCommand(g: GrepInput): string {
  const pattern = shellQuote(g.pattern);
  const path = shellQuote(g.path);

  const rg = [
    "rg",
    "--line-number",
    "--no-heading",
    "--color never",
    `--max-count ${MAX_MATCHES_PER_FILE}`,
    `--max-columns ${MAX_GREP_LINE_CHARS}`,
    "--max-columns-preview",
    ...(g.ignoreCase ? ["--ignore-case"] : []),
    ...(g.context > 0 ? [`--context ${g.context}`] : []),
    ...(g.glob ? [`--glob ${shellQuote(g.glob)}`] : []),
    `-e ${pattern}`,
    "--",
    path,
  ].join(" ");

  const grep = [
    "grep",
    "-rnIE",
    `-m ${MAX_MATCHES_PER_FILE}`,
    ...SKIP_DIRS.map((d) => `--exclude-dir=${d}`),
    ...(g.ignoreCase ? ["-i"] : []),
    ...(g.context > 0 ? [`-C ${g.context}`] : []),
    ...(g.glob ? [`--include=${shellQuote(g.glob)}`] : []),
    `-e ${pattern}`,
    "--",
    path,
  ].join(" ");

  return `if command -v rg >/dev/null 2>&1; then ${rg}; else ${grep}; fi`;
}

/** Trim a search's raw output to what is worth returning. */
export function shapeGrepOutput(stdout: string) {
  // Searching `.` makes both tools print `./src/App.tsx:…`. The prefix is noise
  // on every line, and the bare path is what the file tools take.
  const lines = stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^\.\//, ""));
  const shown = lines
    .slice(0, MAX_GREP_LINES)
    .map((l) =>
      l.length > MAX_GREP_LINE_CHARS ? `${l.slice(0, MAX_GREP_LINE_CHARS)}…` : l,
    );
  return {
    matches: shown.join("\n"),
    lines: shown.length,
    ...(lines.length > shown.length
      ? {
          truncated: true,
          note: `Showing the first ${shown.length} of ${lines.length} lines. Narrow the pattern, the path or the glob to see the rest.`,
        }
      : {}),
  };
}

/**
 * Search file contents in the project.
 *
 * Exists so the agent can find where something lives without opening files one
 * by one — the cheapest way to locate code is a search that returns the three
 * lines that matter, not a read that returns the whole file.
 */
export async function grepTool(input: unknown, sandbox: Sandbox) {
  const parsed = parseGrepInput(input);

  try {
    const result = await sandbox.commands.run(buildGrepCommand(parsed), {
      cwd: WORK_DIR,
      timeoutMs: 30_000,
    });
    return shapeGrepOutput(result.stdout);
  } catch (err) {
    if (err instanceof CommandExitError) {
      // Both tools exit 1 for "searched fine, found nothing".
      if (err.exitCode === 1 && !err.stderr.trim()) {
        return { matches: "", lines: 0, note: "No matches." };
      }
      // Some files matched and some could not be read: keep what was found.
      if (err.stdout.trim()) return shapeGrepOutput(err.stdout);
      return {
        matches: "",
        lines: 0,
        error: err.stderr.trim().slice(0, 600) || `search failed (exit ${err.exitCode})`,
      };
    }
    throw err;
  }
}
