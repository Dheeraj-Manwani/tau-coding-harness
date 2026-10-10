/**
 * The storage allowance (doc/TAU_CLOUD_STORAGE.md D6). `roomFor` is pure; the
 * rest reads usage from the database.
 */
import { prisma } from "@/lib/prisma";
import {
  STORAGE_MAX_FILE_BYTES,
  STORAGE_PREVIEW_QUOTA_BYTES,
  STORAGE_QUOTA_BYTES,
  type StoragePlan,
} from "@/lib/pricing";

export type RoomResult =
  | { ok: true }
  | { ok: false; code: "file_too_large" | "storage_full"; message: string };

export interface RoomInput {
  plan: StoragePlan;
  /** Bytes the account already holds, PENDING included. */
  usedBytes: number;
  /** Bytes this project's preview environment already holds. */
  previewUsedBytes: number;
  env: "PREVIEW" | "LIVE";
  size: number;
  /** Bytes of the file this upload will replace, which free up when it lands. */
  replacingBytes?: number;
}

export function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export function roomFor(i: RoomInput): RoomResult {
  const maxFile = STORAGE_MAX_FILE_BYTES[i.plan];
  if (i.size > maxFile) {
    return { ok: false, code: "file_too_large", message: `Files can be at most ${mb(maxFile)} on this plan.` };
  }
  const freed = Math.max(0, i.replacingBytes ?? 0);
  const quota = STORAGE_QUOTA_BYTES[i.plan];
  if (i.usedBytes - freed + i.size > quota) {
    return { ok: false, code: "storage_full", message: `This account's storage allowance (${mb(quota)}) is used up. Delete files to make room.` };
  }
  if (i.env === "PREVIEW" && i.previewUsedBytes - freed + i.size > STORAGE_PREVIEW_QUOTA_BYTES) {
    return { ok: false, code: "storage_full", message: `The preview environment is limited to ${mb(STORAGE_PREVIEW_QUOTA_BYTES)}. Delete files to make room.` };
  }
  return { ok: true };
}

export async function planFor(userId: string): Promise<StoragePlan> {
  const account = await prisma.billingAccount.findUnique({ where: { userId }, select: { plan: true } });
  return account?.plan === "PRO" ? "PRO" : "FREE";
}

/** Bytes in PENDING and READY rows: an address that was handed out counts. */
export async function storageUsage(
  userId: string,
  scope?: { projectId: string; env: "PREVIEW" | "LIVE" },
): Promise<number> {
  const sum = await prisma.storageObject.aggregate({
    _sum: { sizeBytes: true },
    where: { userId, status: { in: ["PENDING", "READY"] }, ...(scope ?? {}) },
  });
  return Number(sum._sum.sizeBytes ?? 0n);
}

export function limitsFor(plan: StoragePlan) {
  return { quotaBytes: STORAGE_QUOTA_BYTES[plan], maxFileBytes: STORAGE_MAX_FILE_BYTES[plan] };
}
