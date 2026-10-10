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
import { Sandbox } from "e2b";
import { keyEncryptionConfigured, ROTATION_GRACE_MS } from "@/lib/apiKeys";
import { rotateStorageKey } from "@/lib/storageKeys";
import { reinjectProjectEnv } from "@/worker/lib/aiEnv";
import { refreshLiveBackend } from "@/lib/refreshSecrets";
import { log } from "../lib/log";

export type OwnerEnv = "PREVIEW" | "LIVE";

/** 404 for a missing project and for someone else's alike: a stranger learns nothing. */
async function ownedProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, storageEnabled: true, storageSuspendedAt: true, sandboxId: true, sandboxStatus: true },
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

/**
 * Replace an environment's key and put the new one in the running app. The old key
 * keeps working for {@link ROTATION_GRACE_MS}, so an app that has not picked up
 * the new one yet is not cut off. The value is never returned.
 */
export async function rotateKey(projectId: string, userId: string, env: OwnerEnv) {
  const project = await ownedProject(projectId, userId);
  if (!project.storageEnabled) throw Errors.badRequest("This app does not use file storage.");
  if (!keyEncryptionConfigured()) throw new AppError("Secure key storage is not available on this server.", 503);

  if (env === "LIVE") return rotateLiveKey(projectId, userId);

  await rotateStorageKey(projectId, userId, "PREVIEW");
  log.info("storage.key_rotated", { projectId, env: "PREVIEW" });

  // Fire-and-forget: the restart waits for the server to come back. The key is
  // already stored, and the next provision writes it anyway.
  if (project.sandboxId && project.sandboxStatus === "READY") {
    const sandboxId = project.sandboxId;
    void (async () => {
      try {
        const sandbox = await Sandbox.connect(sandboxId);
        await reinjectProjectEnv(sandbox, projectId, userId, "storage-rotate", { restart: true });
      } catch (err) {
        log.warn("storage.rotate_apply_failed", { projectId, error: String(err) });
      }
    })();
  }
  return { rotated: true, previousKeyValidForHours: ROTATION_GRACE_MS / 3_600_000 };
}

/**
 * The published app's key. The live server's environment is fixed when a version
 * is made, so the new key reaches it through the same refresh a changed secret
 * uses (`refreshLiveBackend`, which asks `buildPublishEnv` for the LIVE key).
 * When the refresh cannot run now (a publish is in progress, hosting is off),
 * the next publish carries the new key, and the old one works for the grace window.
 */
async function rotateLiveKey(projectId: string, userId: string) {
  const live = await prisma.storageKey.findFirst({ where: { projectId, env: "LIVE", status: "ACTIVE" }, select: { id: true } });
  if (!live) throw Errors.badRequest("This app has not been published with file storage yet.");

  await rotateStorageKey(projectId, userId, "LIVE");
  log.info("storage.key_rotated", { projectId, env: "LIVE" });

  let appliedToLiveApp = false;
  try {
    appliedToLiveApp = (await refreshLiveBackend(projectId)).status === "refreshed";
  } catch (err) {
    log.warn("storage.rotate_live_apply_failed", { projectId, error: String(err) });
  }
  return { rotated: true, previousKeyValidForHours: ROTATION_GRACE_MS / 3_600_000, appliedToLiveApp };
}
