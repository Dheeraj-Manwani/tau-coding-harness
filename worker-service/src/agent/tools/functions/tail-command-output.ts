import Sandbox, { CommandExitError } from "e2b";
import { asString, WORK_DIR } from "./utils";

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
    const result = await sandbox.commands.run(`tail -n ${lines} "${logPath}"`, {
      cwd: WORK_DIR,
    });
    return { content: result.stdout };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return { content: "", error: err.stderr || `${logPath} not found` };
    }
    throw err;
  }
}
