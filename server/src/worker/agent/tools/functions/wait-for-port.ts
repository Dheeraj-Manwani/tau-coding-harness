import Sandbox, { CommandExitError } from "e2b";
import { WORK_DIR } from "./utils";

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const CURL_TIMEOUT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPort(input: unknown, sandbox: Sandbox) {
  const { port: rawPort, timeoutMs: rawTimeoutMs } = input as {
    port?: unknown;
    timeoutMs?: unknown;
  };
  const port = Number(rawPort);
  if (!Number.isFinite(port)) {
    throw new Error("Tool input 'port' must be a number");
  }

  const totalTimeoutMs =
    typeof rawTimeoutMs === "number" && rawTimeoutMs > 0
      ? rawTimeoutMs
      : DEFAULT_TIMEOUT_MS;

  const start = Date.now();
  while (true) {
    try {
      await sandbox.commands.run(`curl -s -o /dev/null localhost:${port}`, {
        cwd: WORK_DIR,
        timeoutMs: CURL_TIMEOUT_MS,
      });
      return { ready: true, elapsedMs: Date.now() - start };
    } catch (err) {
      // A non-zero curl exit just means "not up yet" — keep polling. Any
      // other error (e.g. a dead sandbox) should surface immediately.
      if (!(err instanceof CommandExitError)) throw err;
    }

    const elapsed = Date.now() - start;
    if (elapsed >= totalTimeoutMs) {
      return { ready: false, elapsedMs: elapsed };
    }
    await sleep(Math.min(POLL_INTERVAL_MS, totalTimeoutMs - elapsed));
  }
}
