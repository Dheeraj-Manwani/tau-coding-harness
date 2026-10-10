/**
 * The user-facing half of API keys: what the profile shows, and the four
 * actions it offers. The gateway's own auth path lives in `lib/apiKeys.ts`.
 *
 * See doc/AI_FOR_GENERATED_APPS.md §5.
 */
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import { log } from "../lib/log";
import { toCredits } from "@/lib/pricing";
import { gatewaySpentToday } from "@/lib/credits";
import {
  decryptKey,
  ensureApiKey,
  findUsableKey,
  keyEncryptionConfigured,
  rotateApiKey,
  revokeAllApiKeys,
  ROTATION_GRACE_MS,
} from "@/lib/apiKeys";
import { ApiKeyStatus } from "@/generated/prisma/enums";

export interface ApiKeyView {
  exists: boolean;
  /** Safe to render anywhere — never the full key. */
  prefix: string | null;
  status: ApiKeyStatus | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  /** Set while a rotated key is still inside its grace window. */
  revokeAfter: string | null;
  dailyCapCredits: number;
  /** Whether the cap is the account's own or the global default. */
  dailyCapIsDefault: boolean;
  spentTodayCredits: number;
}

function assertConfigured(): void {
  if (!keyEncryptionConfigured()) {
    throw Errors.badRequest(
      "AI features are not configured on this tau instance.",
    );
  }
}

export async function getApiKeyView(userId: string): Promise<ApiKeyView> {
  const key = await findUsableKey(userId);
  const capMicro = key?.dailyCapMicro ?? env.GATEWAY_DEFAULT_DAILY_CAP_MICRO;

  if (!key) {
    return {
      exists: false,
      prefix: null,
      status: null,
      createdAt: null,
      lastUsedAt: null,
      revokeAfter: null,
      dailyCapCredits: toCredits(capMicro),
      dailyCapIsDefault: true,
      spentTodayCredits: 0,
    };
  }

  return {
    exists: true,
    prefix: key.prefix,
    status: key.status,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokeAfter: key.revokeAfter?.toISOString() ?? null,
    dailyCapCredits: toCredits(capMicro),
    dailyCapIsDefault: key.dailyCapMicro === null,
    spentTodayCredits: toCredits(await gatewaySpentToday(key.id)),
  };
}

/** Mint on demand from the profile. Idempotent — returns the existing key. */
export async function createApiKey(
  userId: string,
): Promise<{ key: string; view: ApiKeyView }> {
  assertConfigured();
  const { key } = await ensureApiKey(userId);
  log.info("apikey.created", { userId });
  return { key, view: await getApiKeyView(userId) };
}

/**
 * Decrypt and return the full key.
 *
 * Deliberately a POST and not part of the GET: a page load must never cause a
 * decrypt. Rate-limited at the route, and logged here — every reveal puts a
 * live spend credential into an HTTP response and usually a clipboard.
 */
export async function revealApiKey(userId: string): Promise<{ key: string }> {
  assertConfigured();
  const key = await findUsableKey(userId);
  if (!key) throw Errors.notFound("No API key to reveal");

  log.info("apikey.revealed", { userId, apiKeyId: key.id, prefix: key.prefix });
  return { key: decryptKey(key.ciphertext) };
}

export interface RotateResult {
  key: string;
  /** When the previous key stops working. Null when there wasn't one. */
  previousKeyExpiresAt: string | null;
  view: ApiKeyView;
}

export async function rotate(userId: string): Promise<RotateResult> {
  assertConfigured();
  const had = await prisma.apiKey.findFirst({
    where: { userId, status: ApiKeyStatus.ACTIVE },
  });

  const { key } = await rotateApiKey(userId);
  log.warn("apikey.rotated", { userId, replacedPrevious: had !== null });
  // Published apps hold the old key in their environment; hand them the new one
  // while the old one still works. Not awaited: the person is waiting for a key.
  void import("@/lib/refreshSecrets").then((m) => m.refreshUserBackends(userId)).catch(() => {});

  return {
    key,
    previousKeyExpiresAt: had
      ? new Date(Date.now() + ROTATION_GRACE_MS).toISOString()
      : null,
    view: await getApiKeyView(userId),
  };
}

/** The "it leaked" button: kill every key now, with no grace window. */
export async function revokeAll(userId: string): Promise<{ revoked: number }> {
  const revoked = await revokeAllApiKeys(userId);
  log.warn("apikey.revoked_all", { userId, revoked });
  return { revoked };
}

/** Max daily cap a user may set, so a typo can't uncap the account entirely. */
const MAX_DAILY_CAP_CREDITS = 100_000;

export async function setDailyCap(
  userId: string,
  credits: number | null,
): Promise<ApiKeyView> {
  const key = await findUsableKey(userId);
  if (!key) throw Errors.notFound("No API key to configure");

  let capMicro: bigint | null = null;
  if (credits !== null) {
    if (!Number.isFinite(credits) || credits < 0) {
      throw Errors.badRequest("Daily cap must be zero or a positive number");
    }
    if (credits > MAX_DAILY_CAP_CREDITS) {
      throw Errors.badRequest(
        `Daily cap cannot exceed ${MAX_DAILY_CAP_CREDITS} credits`,
      );
    }
    // Round to whole micro-credits; the column is an integer type.
    capMicro = BigInt(Math.round(credits * 1_000_000));
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { dailyCapMicro: capMicro },
  });
  log.info("apikey.cap_changed", {
    userId,
    apiKeyId: key.id,
    capMicro: capMicro?.toString() ?? "default",
  });

  return getApiKeyView(userId);
}
