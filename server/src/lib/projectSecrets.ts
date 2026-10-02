/**
 * Third-party credentials a generated app needs at runtime — a Stripe key, a
 * Resend key, an OpenWeather key.
 *
 * ## Where a value is allowed to exist
 *
 *   - the HTTP body of the secret form (`POST …/jobs/:jobId/secrets`, `PUT
 *     …/secrets/:name`) — never the chat, never `ask_user`;
 *   - `ProjectSecret.ciphertext`, encrypted with the same AES-256-GCM scheme as
 *     the tau gateway keys (`lib/apiKeys.ts`);
 *   - the sandbox's `.env` and process environment, written on every provision.
 *
 * Nowhere else. In particular not in a `Message` or `ToolCall` row: the
 * `request_secret` tool's input carries only names and descriptions, and its
 * output only says which names were saved. The model never sees a value, and
 * {@link redactSecretValues} strips one out of any tool result that surfaces it
 * anyway (`cat .env`, `env`, a build script that prints its config).
 */
import { prisma } from "@/lib/prisma";
import { decryptKey, encryptKey } from "@/lib/apiKeys";

/** Upper-snake env var names, the shape every provider's docs use. */
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Names the user must not be able to set.
 *
 * `TAU_*` belong to the AI gateway injection and would be silently overwritten
 * by it. `VITE_*` is the prefix Vite inlines into the browser bundle — a secret
 * under that name is published to every visitor, which is precisely the leak
 * this whole feature exists to prevent. The rest would break the sandbox.
 */
const RESERVED_PREFIXES = ["TAU_", "VITE_"];
const RESERVED_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  "PORT",
  "HOST",
  "NODE_ENV",
  "NODE_OPTIONS",
  "BUN_INSTALL",
]);

export const MAX_SECRET_VALUE_LENGTH = 16_384;
/** One request is a form the user fills in, not a bulk import. */
export const MAX_SECRETS_PER_REQUEST = 10;
export const MAX_SECRETS_PER_PROJECT = 50;

/** Null when `name` is usable, otherwise why not — phrased for the model. */
export function secretNameError(name: string): string | null {
  if (!SECRET_NAME_RE.test(name)) {
    return `"${name}" is not a valid name. Use UPPER_SNAKE_CASE, e.g. STRIPE_SECRET_KEY.`;
  }
  if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) {
    return name.startsWith("VITE_")
      ? `"${name}" would be bundled into the browser, where every visitor can read it. Use a server-side name without the VITE_ prefix and read it in server code.`
      : `"${name}" is reserved for tau's own AI integration.`;
  }
  if (RESERVED_NAMES.has(name)) {
    return `"${name}" is a system variable and cannot be set as a key.`;
  }
  return null;
}

/** Null when `value` can be stored, otherwise why not — phrased for the user. */
export function secretValueError(value: string): string | null {
  if (value.length === 0) return "The value is empty.";
  if (value.length > MAX_SECRET_VALUE_LENGTH) return "The value is too long.";
  if (value.includes("\0")) return "The value contains an invalid character.";
  return null;
}

export interface ProjectSecretSummary {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Names only. Nothing that renders a list should have to decrypt. */
export async function listProjectSecrets(
  projectId: string,
): Promise<ProjectSecretSummary[]> {
  return prisma.projectSecret.findMany({
    where: { projectId },
    select: { name: true, createdAt: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
}

export async function projectSecretNames(projectId: string): Promise<string[]> {
  const rows = await prisma.projectSecret.findMany({
    where: { projectId },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

export async function hasProjectSecrets(projectId: string): Promise<boolean> {
  return (await prisma.projectSecret.count({ where: { projectId } })) > 0;
}

export class SecretLimitError extends Error {
  constructor() {
    super(`A project can hold at most ${MAX_SECRETS_PER_PROJECT} keys.`);
    this.name = "SecretLimitError";
  }
}

/**
 * Encrypt and upsert. Callers validate names and values first; this only
 * enforces the per-project cap, because only it can see the table.
 */
export async function saveProjectSecrets(
  projectId: string,
  values: Record<string, string>,
): Promise<void> {
  const names = Object.keys(values);
  if (names.length === 0) return;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectSecret.findMany({
      where: { projectId },
      select: { name: true },
    });
    const known = new Set(existing.map((r) => r.name));
    const added = names.filter((n) => !known.has(n)).length;
    if (known.size + added > MAX_SECRETS_PER_PROJECT) throw new SecretLimitError();

    for (const name of names) {
      const ciphertext = encryptKey(values[name]!);
      await tx.projectSecret.upsert({
        where: { projectId_name: { projectId, name } },
        create: { projectId, name, ciphertext },
        update: { ciphertext },
      });
    }
  });
}

export async function deleteProjectSecret(
  projectId: string,
  name: string,
): Promise<boolean> {
  const { count } = await prisma.projectSecret.deleteMany({
    where: { projectId, name },
  });
  return count > 0;
}

/**
 * Every secret as `{ NAME: plaintext }`, for writing into the sandbox.
 *
 * A row that fails to decrypt (the encryption key was changed underneath it) is
 * skipped rather than fatal: one unreadable key must not stop the app from
 * booting with the others.
 */
export async function projectSecretEnv(
  projectId: string,
  onUnreadable?: (name: string, err: unknown) => void,
): Promise<Record<string, string>> {
  const rows = await prisma.projectSecret.findMany({
    where: { projectId },
    select: { name: true, ciphertext: true },
  });
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.name] = decryptKey(row.ciphertext);
    } catch (err) {
      onUnreadable?.(row.name, err);
    }
  }
  return out;
}

// ── Redaction ────────────────────────────────────────────────────────────────

/**
 * Values shorter than this are not redacted. A three-character "key" would
 * otherwise blank out every occurrence of those three characters in every tool
 * result — mangling the output far more than it protects anything.
 */
const MIN_REDACT_LENGTH = 8;

function redactString(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    if (out.includes(v)) out = out.split(v).join(`[redacted secret]`);
  }
  return out;
}

/**
 * Replace every literal occurrence of a stored secret value, anywhere in a tool
 * result. Pattern matching can't do this job: a third-party key has no format
 * tau knows about, so the only reliable signature is the value itself.
 *
 * Also covers a multi-line value (a PEM key) printed one line at a time by
 * redacting each sufficiently long line of it on its own.
 */
export function redactSecretValues<T>(value: T, secrets: string[]): T {
  const needles = new Set<string>();
  for (const s of secrets) {
    if (s.length >= MIN_REDACT_LENGTH) needles.add(s);
    for (const line of s.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length >= MIN_REDACT_LENGTH && t !== s) needles.add(t);
    }
  }
  if (needles.size === 0) return value;
  // Longest first, so a whole value is replaced before its own lines are.
  const list = [...needles].sort((a, b) => b.length - a.length);

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactString(v, list);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) out[k] = walk(inner);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** {@link redactSecretValues} with this project's stored values. */
export async function redactProjectSecrets<T>(
  projectId: string,
  value: T,
): Promise<T> {
  const secrets = Object.values(await projectSecretEnv(projectId));
  return secrets.length === 0 ? value : redactSecretValues(value, secrets);
}

// ── .env rendering ───────────────────────────────────────────────────────────

/** Characters that need no quoting at all in a Bun `.env`. */
const BARE_VALUE_RE = /^[A-Za-z0-9_\-.:/+=@,]*$/;

/**
 * One value as Bun's `.env` parser will read it back byte-for-byte.
 *
 * Bun's parser (measured on 1.3) has three traps for an arbitrary value:
 *   - `$NAME` is expanded in every quoting style, single quotes included; only
 *     `\$` suppresses it.
 *   - in double quotes `\n` becomes a newline, and `\\` is NOT unescaped — so a
 *     value containing a literal backslash (a service-account JSON's
 *     `"-----BEGIN…\n…"`) cannot round-trip through double quotes.
 *   - backtick quotes keep backslashes literal, but cannot hold a backtick.
 *
 * So: bare when safe, double quotes (real newlines kept as-is) when there is no
 * backslash, backticks when there is one. Every style gets `$` escaped.
 */
export function dotenvValue(raw: string): string {
  if (BARE_VALUE_RE.test(raw)) return raw;
  const escaped = raw.replace(/\$/g, "\\$");
  if (!raw.includes("\\")) return `"${escaped}"`;
  if (!raw.includes("`")) return `\`${escaped}\``;
  // Both a backslash and a backtick: no Bun quoting style preserves this
  // exactly. Double quotes keep everything but the `\n` sequences intact.
  return `"${escaped}"`;
}

export function renderDotenv(vars: Record<string, string>): string {
  return (
    "# Managed by tau. Do not edit or commit.\n" +
    "# This file is intentionally not saved with your project — tau rewrites it\n" +
    "# each time the app starts, and it is never pushed to GitHub.\n" +
    "# Change keys from the Keys tab in tau.\n" +
    Object.entries(vars)
      .map(([k, v]) => `${k}=${dotenvValue(v)}`)
      .join("\n") +
    "\n"
  );
}
