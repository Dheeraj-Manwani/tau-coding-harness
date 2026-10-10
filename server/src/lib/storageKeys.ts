/**
 * Keys for tau's `/storage` endpoint (doc/TAU_CLOUD_STORAGE.md D3).
 *
 * One usable key per project and environment, held by the app's server. Unlike
 * the gateway key the project is read from the key and nothing else: a request
 * header can never change which project's files a key opens. Stored the same
 * way as `ApiKey` (reversible, with a separate lookup hash) because tau writes
 * the plaintext into the sandbox and, later, the published function.
 *
 * The prefix differs from `tau_sk_`, so neither surface can accept the other's key.
 */
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ApiKeyStatus } from "@/generated/prisma/enums";
import type { StorageKey } from "@/generated/prisma/client";
import {
  LAST_USED_THROTTLE_MS,
  ROTATION_GRACE_MS,
  decryptKey,
  encryptKey,
  lookupHashFor,
} from "@/lib/apiKeys";

export type StorageEnvName = "PREVIEW" | "LIVE";

const KEY_PREFIX = "tau_st_";
const SECRET_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8;

export function generateStorageKey(): string {
  return KEY_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
}

export function isStorageKeyFormat(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length > DISPLAY_PREFIX_LENGTH;
}

export interface MintedStorageKey {
  record: StorageKey;
  key: string;
}

async function create(projectId: string, userId: string, env: StorageEnvName): Promise<MintedStorageKey> {
  const key = generateStorageKey();
  const record = await prisma.storageKey.create({
    data: {
      projectId,
      userId,
      env,
      lookupHash: lookupHashFor(key),
      ciphertext: encryptKey(key),
      prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
    },
  });
  return { record, key };
}

/** The project's ACTIVE key for an environment, minted when there is none. Idempotent. */
export async function ensureStorageKey(
  projectId: string,
  userId: string,
  env: StorageEnvName,
): Promise<MintedStorageKey> {
  const existing = await prisma.storageKey.findFirst({
    where: { projectId, env, status: ApiKeyStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { record: existing, key: decryptKey(existing.ciphertext) };
  return create(projectId, userId, env);
}

/**
 * Resolve a presented key, or null when it is unknown, revoked, or a ROTATING
 * key whose grace window has closed.
 */
export async function verifyStorageKey(raw: string): Promise<StorageKey | null> {
  if (!isStorageKeyFormat(raw)) return null;
  const record = await prisma.storageKey.findUnique({ where: { lookupHash: lookupHashFor(raw) } });
  if (!record) return null;
  if (record.status === ApiKeyStatus.REVOKED) return null;
  if (record.status === ApiKeyStatus.ROTATING) {
    if (record.revokeAfter === null || record.revokeAfter <= new Date()) return null;
  }
  return record;
}

/** Fire-and-forget `lastUsedAt` bump, throttled so it isn't a write per call. */
export async function touchStorageKey(record: StorageKey): Promise<void> {
  const now = Date.now();
  if (record.lastUsedAt !== null && now - record.lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;
  await prisma.storageKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date(now) } });
}

/** Replace an environment's key, keeping the old one alive for the grace window. */
export async function rotateStorageKey(
  projectId: string,
  userId: string,
  env: StorageEnvName,
): Promise<MintedStorageKey> {
  const key = generateStorageKey();
  return prisma.$transaction(async (tx) => {
    await tx.storageKey.updateMany({
      where: { projectId, env, status: ApiKeyStatus.ACTIVE },
      data: { status: ApiKeyStatus.ROTATING, revokeAfter: new Date(Date.now() + ROTATION_GRACE_MS) },
    });
    const record = await tx.storageKey.create({
      data: {
        projectId,
        userId,
        env,
        lookupHash: lookupHashFor(key),
        ciphertext: encryptKey(key),
        prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
      },
    });
    return { record, key };
  });
}

/** Kill every key a project holds, at once. */
export async function revokeStorageKeys(projectId: string): Promise<number> {
  const { count } = await prisma.storageKey.updateMany({
    where: { projectId, status: { not: ApiKeyStatus.REVOKED } },
    data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
  });
  return count;
}
