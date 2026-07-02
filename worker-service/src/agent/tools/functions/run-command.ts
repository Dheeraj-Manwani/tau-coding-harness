import Sandbox, { CommandExitError } from "e2b";
import { asString, isLongRunning, LOG_DIR, WORK_DIR } from "./utils";

function slugify(command: string): string {
  const slug = command
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "cmd";
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
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return {
        exitCode: err.exitCode,
        stdout: err.stdout,
        stderr: err.stderr,
      };
    }
    throw err;
  }
}
