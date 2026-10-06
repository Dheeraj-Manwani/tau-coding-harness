import Sandbox, { CommandExitError } from "e2b";
import { asString, isLongRunning, LOG_DIR, WORK_DIR } from "./utils";
import { headTail, MAX_COMMAND_STREAM_CHARS } from "./output";

function slugify(command: string): string {
  const slug = command
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "cmd";
}

interface CommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Bound a finished command's output before it reaches the model.
 *
 * Short output passes through untouched. Long output keeps its start and end
 * in the result, and the whole thing is written to `.tau/logs/` in the sandbox
 * so nothing is lost: the agent can page through it with `read_file`, search it
 * with `grep`, or look at the end with `tail_command_output`. The log directory
 * is not part of the project — it is never persisted or pushed.
 */
async function capOutput(
  sandbox: Sandbox,
  command: string,
  result: CommandOutput,
) {
  const stdout = headTail(result.stdout, MAX_COMMAND_STREAM_CHARS);
  const stderr = headTail(result.stderr, MAX_COMMAND_STREAM_CHARS);
  if (!stdout.truncated && !stderr.truncated) return result;

  const logPath = `${LOG_DIR}/${Date.now()}-${slugify(command)}.out`;
  // stdout first and, when there is no stderr, nothing after it — so the end of
  // the file is the end of the output, which is what `tail_command_output` shows.
  const body = !result.stderr
    ? result.stdout
    : !result.stdout
      ? result.stderr
      : `${result.stdout}\n--- stderr ---\n${result.stderr}`;
  const full = `$ ${command}\n\n${body}`;
  let saved = true;
  try {
    await sandbox.files.write(`${WORK_DIR}/${logPath}`, full);
  } catch {
    // The capped result is still correct; it just cannot point anywhere.
    saved = false;
  }

  const size = result.stdout.length + result.stderr.length;
  return {
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: true,
    ...(saved
      ? {
          logPath,
          note: `The output was long (${size} characters), so its middle is cut here. All of it is in ${logPath}: page through it with read_file (offset/limit), search it with grep, or see the end with tail_command_output.`,
        }
      : {
          note: `The output was long (${size} characters), so its middle is cut here. Re-run the command with a filter (| tail, | grep) to see the part you need.`,
        }),
  };
}

export async function runCommand(input: unknown, sandbox: Sandbox) {
  const {
    command: rawCommand,
    timeoutMs: rawTimeoutMs,
    background: rawBackground,
  } = input as { command?: unknown; timeoutMs?: unknown; background?: unknown };
  const command = asString(rawCommand, "command");

  const timeoutMs =
    typeof rawTimeoutMs === "number" && rawTimeoutMs > 0
      ? rawTimeoutMs
      : undefined;

  // An explicit `background` always wins; the regex is only a fallback default
  // so commands like `bun run server/index.ts &` don't need to match it.
  const shouldBackground =
    typeof rawBackground === "boolean" ? rawBackground : isLongRunning(command);

  if (shouldBackground) {
    const logPath = `${LOG_DIR}/${Date.now()}-${slugify(command)}.log`;
    await sandbox.commands.run(`mkdir -p "${LOG_DIR}"`, { cwd: WORK_DIR });
    const handle = await sandbox.commands.run(
      `(${command}) > "${logPath}" 2>&1`,
      { background: true, cwd: WORK_DIR },
    );
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      background: true,
      pid: handle.pid,
      logPath,
    };
  }

  try {
    const result = await sandbox.commands.run(command, {
      cwd: WORK_DIR,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return await capOutput(sandbox, command, {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (err) {
    if (err instanceof CommandExitError) {
      return await capOutput(sandbox, command, {
        exitCode: err.exitCode,
        stdout: err.stdout,
        stderr: err.stderr,
      });
    }
    throw err;
  }
}
