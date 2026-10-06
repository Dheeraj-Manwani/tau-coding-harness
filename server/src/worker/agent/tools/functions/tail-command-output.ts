import Sandbox, { CommandExitError } from "e2b";
import { asString, WORK_DIR } from "./utils";
import { MAX_TAIL_CHARS, shellQuote, tailOnly } from "./output";

const DEFAULT_LINES = 200;

export async function tailCommandOutput(input: unknown, sandbox: Sandbox) {
  const { logPath: rawLogPath, lines: rawLines } = input as {
    logPath?: unknown;
    lines?: unknown;
  };
  const logPath = asString(rawLogPath, "logPath");
  const lines =
    typeof rawLines === "number" && rawLines > 0
      ? Math.floor(rawLines)
      : DEFAULT_LINES;

  try {
    const result = await sandbox.commands.run(
      `tail -n ${lines} ${shellQuote(logPath)}`,
      { cwd: WORK_DIR },
    );
    // A line count is not a size: 200 lines of a bundler's output can be 200
    // very long lines. Keep the end, which is what a tail is for.
    const capped = tailOnly(result.stdout, MAX_TAIL_CHARS);
    return {
      content: capped.text,
      ...(capped.truncated
        ? {
            truncated: true,
            note: `Only the last ${MAX_TAIL_CHARS} characters are shown. Use grep on ${logPath} to find something specific, or read_file with offset/limit to page through it.`,
          }
        : {}),
    };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return { content: "", error: err.stderr || `${logPath} not found` };
    }
    throw err;
  }
}
