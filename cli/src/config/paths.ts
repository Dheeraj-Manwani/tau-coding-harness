import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the directory where tau keeps its state.
 *
 * Honours `TAU_CONFIG_DIR` for tests / power users, otherwise falls back to
 * `~/.tau` which works the same on Windows, macOS and Linux.
 */
export function configDir(): string {
  return process.env.TAU_CONFIG_DIR ?? join(homedir(), ".tau");
}

/** Path to the file holding credentials (api keys). */
export function authPath(): string {
  return join(configDir(), "auth.json");
}

/** Path to the file holding non-secret preferences (default model etc). */
export function configPath(): string {
  return join(configDir(), "config.json");
}

/** Path to the persisted conversation log of the last session. */
export function sessionPath(): string {
  return join(configDir(), "session.json");
}
