import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { authPath, configDir, configPath } from "./paths.ts";

/** A stored credential for a single provider. */
export type Credential = { type: "api"; key: string };

/** Map of providerId -> credential. */
export type AuthFile = Record<string, Credential>;

/** Non-secret user preferences. */
export interface ConfigFile {
  defaultProvider?: string;
  defaultModel?: string;
  mode?: "build" | "plan";
}

async function ensureDir(): Promise<void> {
  await mkdir(configDir(), { recursive: true });
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
  // Best effort: lock down credentials on POSIX. No-op on Windows.
  try {
    await chmod(path, 0o600);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function readAuth(): Promise<AuthFile> {
  return readJson<AuthFile>(authPath(), {});
}

export async function getCredential(
  providerId: string,
): Promise<Credential | undefined> {
  const auth = await readAuth();
  return auth[providerId];
}

export async function setCredential(
  providerId: string,
  cred: Credential,
): Promise<void> {
  const auth = await readAuth();
  auth[providerId] = cred;
  await writeJson(authPath(), auth);
}

export async function removeCredential(providerId: string): Promise<boolean> {
  const auth = await readAuth();
  if (!(providerId in auth)) return false;
  delete auth[providerId];
  await writeJson(authPath(), auth);
  return true;
}

export async function clearAuth(): Promise<void> {
  await writeJson(authPath(), {});
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function readConfig(): Promise<ConfigFile> {
  return readJson<ConfigFile>(configPath(), {});
}

export async function updateConfig(
  patch: Partial<ConfigFile>,
): Promise<ConfigFile> {
  const current = await readConfig();
  const next = { ...current, ...patch };
  await writeJson(configPath(), next);
  return next;
}
