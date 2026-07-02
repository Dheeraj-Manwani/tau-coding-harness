import type Sandbox from "e2b";
import { WORK_DIR } from "./utils";

const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Cheap liveness probe — swallows its own errors, since "it's dead" is a valid answer, not a failure. */
export async function checkSandbox(_input: unknown, sandbox: Sandbox) {
  try {
    await sandbox.commands.run("true", {
      cwd: WORK_DIR,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    });
    return { alive: true };
  } catch (err) {
    return {
      alive: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
