import Sandbox, { CommandExitError } from "e2b";
import { asString, isLongRunning, WORK_DIR } from "./utils";

export async function runCommand(input: unknown, sandbox: Sandbox) {
  const command = asString((input as { command?: unknown }).command, "command");

  if (isLongRunning(command)) {
    const handle = await sandbox.commands.run(command, {
      background: true,
      cwd: WORK_DIR,
    });
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      background: true,
      pid: handle.pid,
    };
  }

  try {
    const result = await sandbox.commands.run(command, { cwd: WORK_DIR });
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
