/**
 * Tools → Storage: what a project's owner sees and does with the files their
 * app has stored (doc/TAU_CLOUD_STORAGE.md D8, S3).
 *
 * The same functions the app's key reaches (`storage.service.ts`), called with
 * the owner's project and a chosen environment. Nothing here uses or returns
 * the app's storage key.
 */
import { prisma } from "@/lib/prisma";
import { Errors, AppError } from "../lib/errors";
import { limitsFor, planFor, storageUsage } from "@/lib/storageQuota";
import * as storage from "./storage.service";
import { StorageError } from "../lib/storageErrors";
import { storageConfigured } from "@/lib/storageBucket";

export type OwnerEnv = "PREVIEW" | "LIVE";

/** 404 for a missing project and for someone else's alike: a stranger learns nothing. */
async function ownedProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, storageEnabled: true, storageSuspendedAt: true },
  });
  if (!project || project.userId !== userId) throw Errors.notFound("Project not found");
  return project;
}

/** The service speaks `StorageError`; the owner's routes speak `AppError`. */
async function asOwnerError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StorageError) throw new AppError(err.message, err.status);
    throw err;
  }
}

/** Reading the list needs only the database; touching bytes needs the bucket. */
function requireBucket(): void {
  if (!storageConfigured()) throw new AppError("File storage is not available on this server.", 503);
}

const ctxFor = (projectId: string, userId: string, env: OwnerEnv): storage.StorageCtx => ({ projectId, userId, env });

export interface StorageOverview {
  enabled: boolean;
  suspended: boolean;
  usage: { usedBytes: number; quotaBytes: number; maxFileBytes: number };
  /** PREVIEW always; LIVE only once a live key or live files exist (S5). */
  environments: { env: OwnerEnv; fileCount: number; usedBytes: number }[];
}

export async function overview(projectId: string, userId: string): Promise<StorageOverview> {
  const project = await ownedProject(projectId, userId);
  const [plan, usedBytes, liveKey, groups] = await Promise.all([
    planFor(userId),
    storageUsage(userId),
    prisma.storageKey.findFirst({ where: { projectId, env: "LIVE" }, select: { id: true } }),
    prisma.storageObject.groupBy({
      by: ["env"],
      where: { projectId, status: "READY" },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    }),
  ]);
  const of = (env: OwnerEnv) => {
    const g = groups.find((x) => x.env === env);
    return { env, fileCount: g?._count._all ?? 0, usedBytes: Number(g?._sum.sizeBytes ?? 0n) };
  };
  const { quotaBytes, maxFileBytes } = limitsFor(plan);
  return {
    enabled: project.storageEnabled,
    suspended: project.storageSuspendedAt !== null,
    usage: { usedBytes, quotaBytes, maxFileBytes },
    environments: liveKey || of("LIVE").fileCount > 0 ? [of("PREVIEW"), of("LIVE")] : [of("PREVIEW")],
  };
}

export async function listFiles(
  projectId: string,
  userId: string,
  env: OwnerEnv,
  q: { prefix?: string; cursor?: string; limit?: number },
) {
  await ownedProject(projectId, userId);
  return asOwnerError(() => storage.listFiles(ctxFor(projectId, userId, env), q));
}

export async function fileUrl(
  projectId: string,
  userId: string,
  input: { env: OwnerEnv; key: string; download?: boolean },
) {
  requireBucket();
  const project = await ownedProject(projectId, userId);
  // Suspended means no new download addresses, for the owner too.
  if (project.storageSuspendedAt) throw new AppError("Storage for this app has been suspended by tau.", 403);
  return asOwnerError(() =>
    storage.fileUrl(ctxFor(projectId, userId, input.env), { key: input.key, download: input.download }),
  );
}

export async function deleteFiles(
  projectId: string,
  userId: string,
  input: { env: OwnerEnv; keys?: string[]; prefix?: string },
) {
  requireBucket();
  await ownedProject(projectId, userId);
  return asOwnerError(() =>
    storage.deleteFiles(ctxFor(projectId, userId, input.env), { keys: input.keys, prefix: input.prefix }),
  );
}

/** Everything in the PREVIEW environment. Live files are never cleared in bulk. */
export async function clearPreview(projectId: string, userId: string) {
  requireBucket();
  await ownedProject(projectId, userId);
  return storage.clearFiles(ctxFor(projectId, userId, "PREVIEW"));
}
