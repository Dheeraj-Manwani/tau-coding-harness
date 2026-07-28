/**
 * Per-user API keys for the `/v1` gateway.
 *
 * Keys are stored **reversibly** (AES-256-GCM), not hashed like a password.
 * That is forced by the product: tau has to inject the plaintext into a sandbox
 * and, later, into a deploy — so it must be able to read the key back. The
 * mitigations that buys back are: a separate `lookupHash` for authentication
 * (so the ciphertext is never touched on the hot path), a `prefix` for display
 * (so nothing has to decrypt just to render the profile), and revealing being
 * an explicit, rate-limited, audited action rather than a page load.
 *
 * See doc/AI_FOR_GENERATED_APPS.md §5.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { env } from "./env";
import { ApiKeyStatus } from "../generated/prisma/enums";
import type { ApiKey } from "../generated/prisma/client";

const KEY_PREFIX = "tau_sk_live_";
/** Random bytes behind the prefix. 32 bytes ≈ 43 base64url chars. */
const SECRET_BYTES = 32;
/** How much of the key is safe to store and display verbatim. */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8;

const ENC_VERSION = "v1";

/** How long a rotated key keeps working, so deployed apps can be redeployed. */
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** `lastUsedAt` drives a profile timestamp, not an audit trail — don't write it
 *  on every single request. */
export const LAST_USED_THROTTLE_MS = 60_000;

export class KeyEncryptionUnavailableError extends Error {
  readonly code = "KEY_ENCRYPTION_UNAVAILABLE";
  constructor() {
    super(
      "TAU_KEY_ENC_SECRET is not set. Generate one with `openssl rand -hex 32`.",
    );
    this.name = "KeyEncryptionUnavailableError";
  }
}

/** True when the gateway has what it needs to store keys at all. */
export function keyEncryptionConfigured(): boolean {
  const secret = env.TAU_KEY_ENC_SECRET;
  return typeof secret === "string" && /^[0-9a-fA-F]{64}$/.test(secret);
}

function encryptionKey(): Buffer {
  if (!keyEncryptionConfigured()) throw new KeyEncryptionUnavailableError();
  return Buffer.from(env.TAU_KEY_ENC_SECRET as string, "hex");
}

/** `v1:{iv}:{tag}:{ciphertext}`, all base64. Versioned so the encryption key
 *  itself can be rotated without guessing at the old format. */
export function encryptKey(raw: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(raw, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptKey(stored: string): string {
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== ENC_VERSION || !iv || !tag || !ct) {
    throw new Error(`Unrecognized key ciphertext format: ${version ?? "(empty)"}`);
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf-8");
}

/** The authentication index. Hashing means the lookup is a single indexed
 *  equality — no scan, and no timing side channel from comparing secrets. */
export function lookupHashFor(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

export function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
}

export function displayPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function isApiKeyFormat(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length > DISPLAY_PREFIX_LENGTH;
}

/** A key row plus the plaintext, which is only ever available at mint time. */
export interface MintedKey {
  record: ApiKey;
  key: string;
}

/**
 * The user's currently usable key, or null.
 *
 * "Usable" is ACTIVE, or ROTATING within its grace window. The DB can't express
 * that (`revokeAfter` is a moving comparison), which is exactly why `userId`
 * carries no unique constraint and this invariant lives here.
 */
export async function findUsableKey(userId: string): Promise<ApiKey | null> {
  const rows = await prisma.apiKey.findMany({
    where: { userId, status: { in: [ApiKeyStatus.ACTIVE, ApiKeyStatus.ROTATING] } },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  return (
    rows.find(
      (r) =>
        r.status === ApiKeyStatus.ACTIVE ||
        (r.revokeAfter !== null && r.revokeAfter > now),
    ) ?? null
  );
}

/**
 * Mint a key for a user, or return the existing ACTIVE one.
 *
 * Idempotent by design: `enable_ai` will call this on every AI-enabled build,
 * and a user must never end up with two live keys from ordinary use — only from
 * an explicit rotation.
 */
export async function ensureApiKey(userId: string): Promise<MintedKey> {
  const existing = await prisma.apiKey.findFirst({
    where: { userId, status: ApiKeyStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { record: existing, key: decryptKey(existing.ciphertext) };
  }

  const key = generateRawKey();
  const record = await prisma.apiKey.create({
    data: {
      userId,
      lookupHash: lookupHashFor(key),
      ciphertext: encryptKey(key),
      prefix: displayPrefix(key),
    },
  });
  return { record, key };
}

export interface VerifiedKey {
  record: ApiKey;
  userId: string;
}

/**
 * Resolve a presented key to its row, or null when it is unknown, revoked, or a
 * ROTATING key whose grace window has closed.
 */
export async function verifyApiKey(raw: string): Promise<VerifiedKey | null> {
  if (!isApiKeyFormat(raw)) return null;

  const record = await prisma.apiKey.findUnique({
    where: { lookupHash: lookupHashFor(raw) },
  });
  if (!record) return null;

  if (record.status === ApiKeyStatus.REVOKED) return null;
  if (record.status === ApiKeyStatus.ROTATING) {
    if (record.revokeAfter === null || record.revokeAfter <= new Date()) {
      return null;
    }
  }

  return { record, userId: record.userId };
}

/** Fire-and-forget `lastUsedAt` bump, throttled so it isn't a write per call. */
export async function touchApiKey(record: ApiKey): Promise<void> {
  const now = Date.now();
  if (
    record.lastUsedAt !== null &&
    now - record.lastUsedAt.getTime() < LAST_USED_THROTTLE_MS
  ) {
    return;
  }
  await prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(now) },
  });
}

/**
 * Replace a user's key, keeping the old one alive for {@link ROTATION_GRACE_MS}.
 *
 * The overlap is the whole point: a deployed app holds the old key baked into
 * its environment, so an instant revoke breaks every one of them with no window
 * to redeploy.
 */
export async function rotateApiKey(userId: string): Promise<MintedKey> {
  const key = generateRawKey();

  return prisma.$transaction(async (tx) => {
    await tx.apiKey.updateMany({
      where: { userId, status: ApiKeyStatus.ACTIVE },
      data: {
        status: ApiKeyStatus.ROTATING,
        revokeAfter: new Date(Date.now() + ROTATION_GRACE_MS),
      },
    });

    const record = await tx.apiKey.create({
      data: {
        userId,
        lookupHash: lookupHashFor(key),
        ciphertext: encryptKey(key),
        prefix: displayPrefix(key),
      },
    });

    return { record, key };
  });
}

/** Immediately kill every key a user holds — the "it leaked" button. */
export async function revokeAllApiKeys(userId: string): Promise<number> {
  const { count } = await prisma.apiKey.updateMany({
    where: { userId, status: { not: ApiKeyStatus.REVOKED } },
    data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
  });
  return count;
}
