/**
 * Tau Cloud Storage (doc/TAU_CLOUD_STORAGE.md). One function per row of the
 * app-facing API, each acting for one project and one environment.
 *
 * Tau's database is the list of files; R2 holds bytes under ids that mean
 * nothing by themselves. A request can only reach the project and environment
 * its key was minted for, because the caller builds a {@link StorageCtx} from
 * the key and nothing in a request body can change it.
 */
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Prisma } from "@/generated/prisma/client";
import type { StorageObject } from "@/generated/prisma/client";
import {
  deleteStorageObjects,
  headStorageObject,
  presignStorageGet,
  presignStoragePut,
  storageObjectKey,
} from "@/lib/storageBucket";
import { limitsFor, planFor, roomFor, storageUsage } from "@/lib/storageQuota";
import {
  dispositionFor,
  nameOf,
  normalizeContentType,
  normalizeObjectKey,
  normalizePrefix,
} from "../lib/storagePaths";
import { StorageError, storageErrors } from "../lib/storageErrors";
import { log } from "../lib/log";

export interface StorageCtx {
  projectId: string;
  userId: string;
  env: "PREVIEW" | "LIVE";
}

export interface StorageFile {
  id: string;
  key: string;
  name: string;
  contentType: string;
  size: number;
  metadata: unknown;
  createdAt: string;
}

const MAX_METADATA_BYTES = 2048;
const MAX_LIST_LIMIT = 200;
const MAX_URLS = 100;
const MAX_DELETE_KEYS = 1000;

function scope(ctx: StorageCtx) {
  return { projectId: ctx.projectId, env: ctx.env };
}

export function toFile(row: StorageObject): StorageFile {
  return {
    id: row.id,
    key: row.key,
    name: nameOf(row.key),
    contentType: row.contentType,
    size: Number(row.sizeBytes),
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireKey(raw: unknown): string {
  const k = normalizeObjectKey(raw);
  if (!k.ok) throw storageErrors.invalidKey(k.reason);
  return k.key;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** R2 delete for rows already marked DELETING; the rows of the objects that
 *  went are removed, the rest stay for the sweep. */
async function finishDeleting(rows: { id: string; projectId: string; env: "PREVIEW" | "LIVE" }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const keyOf = (r: (typeof rows)[number]) => storageObjectKey(r.projectId, r.env, r.id);
  let failed: Set<string>;
  try {
    failed = new Set(await deleteStorageObjects(rows.map(keyOf)));
  } catch (err) {
    log.warn("storage.delete_failed", { count: rows.length, error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
  const done = rows.filter((r) => !failed.has(keyOf(r))).map((r) => r.id);
  if (done.length > 0) await prisma.storageObject.deleteMany({ where: { id: { in: done }, status: "DELETING" } });
  if (failed.size > 0) log.warn("storage.delete_failed", { count: failed.size });
  return done.length;
}

// ── uploads ───────────────────────────────────────────────────────────────────

export interface UploadInput {
  key?: unknown;
  contentType?: unknown;
  size?: unknown;
  metadata?: unknown;
}

export async function createUpload(ctx: StorageCtx, input: UploadInput) {
  const key = requireKey(input.key);
  const contentType = input.contentType === undefined ? "application/octet-stream" : normalizeContentType(input.contentType);
  if (!contentType) throw storageErrors.invalid("contentType is not a valid media type.");
  const size = input.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw storageErrors.invalid("size must be a whole number of bytes.");
  }
  let metadata: Prisma.InputJsonValue | undefined;
  if (input.metadata !== undefined && input.metadata !== null) {
    const json = JSON.stringify(input.metadata);
    if (json === undefined || Buffer.byteLength(json) > MAX_METADATA_BYTES) {
      throw storageErrors.invalid(`metadata must be JSON of at most ${MAX_METADATA_BYTES} bytes.`);
    }
    metadata = input.metadata as Prisma.InputJsonValue;
  }

  const [plan, usedBytes, previewUsedBytes, replacing] = await Promise.all([
    planFor(ctx.userId),
    storageUsage(ctx.userId),
    ctx.env === "PREVIEW" ? storageUsage(ctx.userId, scope(ctx)) : Promise.resolve(0),
    prisma.storageObject.findFirst({
      where: { ...scope(ctx), key, status: "READY" },
      select: { sizeBytes: true },
    }),
  ]);
  const room = roomFor({
    plan,
    usedBytes,
    previewUsedBytes,
    env: ctx.env,
    size,
    replacingBytes: replacing ? Number(replacing.sizeBytes) : 0,
  });
  if (!room.ok) {
    throw new StorageError(413, room.code, room.message);
  }

  const row = await prisma.storageObject.create({
    data: { ...scope(ctx), userId: ctx.userId, key, contentType, sizeBytes: BigInt(size), metadata },
  });
  const expiresIn = env.STORAGE_UPLOAD_TTL_SECONDS;
  const uploadUrl = await presignStoragePut(storageObjectKey(ctx.projectId, ctx.env, row.id), {
    size,
    contentType,
    expiresIn,
  });
  log.info("storage.upload_created", { projectId: ctx.projectId, env: ctx.env, size });
  return {
    id: row.id,
    key,
    uploadUrl,
    method: "PUT" as const,
    headers: { "Content-Type": contentType },
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function completeUpload(ctx: StorageCtx, id: string, attempt = 0): Promise<{ file: StorageFile }> {
  const row = await prisma.storageObject.findFirst({
    where: { id, ...scope(ctx), status: { in: ["PENDING", "READY"] } },
  });
  if (!row) throw storageErrors.notFound();
  if (row.status === "READY") return { file: toFile(row) };

  const r2Key = storageObjectKey(ctx.projectId, ctx.env, row.id);
  const head = await headStorageObject(r2Key);
  if (!head) {
    throw storageErrors.incomplete("The file has not been uploaded. PUT the bytes to the upload address first.");
  }
  if (head.size !== Number(row.sizeBytes)) {
    // The address signs the size, so this is not expected; refuse and clean up anyway.
    await prisma.storageObject.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "DELETING" } });
    await finishDeleting([{ id: row.id, projectId: row.projectId, env: row.env }]);
    log.warn("storage.size_mismatch", { projectId: ctx.projectId, env: ctx.env, declared: Number(row.sizeBytes), actual: head.size });
    throw storageErrors.incomplete(
      `The uploaded file is ${head.size} bytes but ${Number(row.sizeBytes)} were declared. Start the upload again.`,
    );
  }

  let retired: { id: string; projectId: string; env: "PREVIEW" | "LIVE" }[] = [];
  try {
    retired = await prisma.$transaction(async (tx) => {
      // The old file goes first: the partial unique index allows one READY row
      // per name, and is checked statement by statement.
      const previous = await tx.storageObject.findMany({
        where: { ...scope(ctx), key: row.key, status: "READY", id: { not: row.id } },
        select: { id: true, projectId: true, env: true },
      });
      if (previous.length > 0) {
        await tx.storageObject.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: "DELETING" } });
      }
      const claimed = await tx.storageObject.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "READY" } });
      if (claimed.count !== 1) throw storageErrors.notFound();
      return previous;
    });
  } catch (err) {
    // Two completions of the same name raced; the loser retries once against the winner.
    if (isUniqueViolation(err) && attempt === 0) return completeUpload(ctx, id, 1);
    throw err;
  }
  await finishDeleting(retired);

  const done = await prisma.storageObject.findUniqueOrThrow({ where: { id: row.id } });
  log.info("storage.upload_completed", { projectId: ctx.projectId, env: ctx.env, size: Number(done.sizeBytes), replaced: retired.length });
  return { file: toFile(done) };
}

// ── reading ───────────────────────────────────────────────────────────────────

export async function listFiles(ctx: StorageCtx, q: { prefix?: unknown; cursor?: unknown; limit?: unknown }) {
  const prefix = normalizePrefix(q.prefix);
  if (!prefix.ok) throw storageErrors.invalid(`prefix: ${prefix.reason}.`);
  const limit = q.limit === undefined ? 50 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw storageErrors.invalid(`limit must be between 1 and ${MAX_LIST_LIMIT}.`);
  }
  const cursor = typeof q.cursor === "string" && q.cursor !== "" ? q.cursor : undefined;

  const rows = await prisma.storageObject.findMany({
    where: {
      ...scope(ctx),
      status: "READY",
      ...(prefix.key || cursor
        ? {
            key: {
              ...(prefix.key ? { startsWith: prefix.key } : {}),
              ...(cursor ? { gt: cursor } : {}),
            },
          }
        : {}),
    },
    orderBy: { key: "asc" },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    files: page.map(toFile),
    nextCursor: rows.length > limit ? page[page.length - 1]!.key : null,
  };
}

async function readyRow(ctx: StorageCtx, key: string): Promise<StorageObject> {
  const row = await prisma.storageObject.findFirst({ where: { ...scope(ctx), key, status: "READY" } });
  if (!row) throw storageErrors.notFound();
  return row;
}

export async function fileInfo(ctx: StorageCtx, rawKey: unknown): Promise<{ file: StorageFile }> {
  return { file: toFile(await readyRow(ctx, requireKey(rawKey))) };
}

function ttlFor(raw: unknown): number {
  if (raw === undefined) return env.STORAGE_URL_TTL_SECONDS;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw storageErrors.invalid("expiresIn must be a whole number of seconds.");
  }
  return Math.min(raw, env.STORAGE_URL_TTL_MAX_SECONDS);
}

async function signRow(row: StorageObject, expiresIn: number, download: boolean): Promise<string> {
  const d = dispositionFor(row.contentType, nameOf(row.key), download);
  return presignStorageGet(storageObjectKey(row.projectId, row.env, row.id), {
    expiresIn,
    contentType: d.contentType,
    disposition: d.header,
  });
}

export async function fileUrl(ctx: StorageCtx, input: { key?: unknown; expiresIn?: unknown; download?: unknown }) {
  const expiresIn = ttlFor(input.expiresIn);
  const row = await readyRow(ctx, requireKey(input.key));
  const url = await signRow(row, expiresIn, input.download === true);
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export async function fileUrls(ctx: StorageCtx, input: { keys?: unknown; expiresIn?: unknown }) {
  if (!Array.isArray(input.keys) || input.keys.length === 0 || input.keys.length > MAX_URLS) {
    throw storageErrors.invalid(`keys must be a list of 1 to ${MAX_URLS} file keys.`);
  }
  const keys = input.keys.map(requireKey);
  const expiresIn = ttlFor(input.expiresIn);
  const rows = await prisma.storageObject.findMany({ where: { ...scope(ctx), key: { in: keys }, status: "READY" } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const urls = await Promise.all(
    keys.map(async (key) => {
      const row = byKey.get(key);
      return { key, url: row ? await signRow(row, expiresIn, false) : null };
    }),
  );
  return { urls, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

// ── changing ──────────────────────────────────────────────────────────────────

/** Rename. A file already at the new name is replaced, as an upload would. */
export async function moveFile(ctx: StorageCtx, input: { from?: unknown; to?: unknown }): Promise<{ file: StorageFile }> {
  const from = requireKey(input.from);
  const to = requireKey(input.to);
  const source = await readyRow(ctx, from);
  if (from === to) return { file: toFile(source) };

  const retired = await prisma.$transaction(async (tx) => {
    const previous = await tx.storageObject.findMany({
      where: { ...scope(ctx), key: to, status: "READY" },
      select: { id: true, projectId: true, env: true },
    });
    if (previous.length > 0) {
      await tx.storageObject.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: "DELETING" } });
    }
    const moved = await tx.storageObject.updateMany({ where: { id: source.id, status: "READY" }, data: { key: to } });
    if (moved.count !== 1) throw storageErrors.notFound();
    return previous;
  });
  await finishDeleting(retired);
  return { file: toFile(await prisma.storageObject.findUniqueOrThrow({ where: { id: source.id } })) };
}

export async function deleteFiles(ctx: StorageCtx, input: { keys?: unknown; prefix?: unknown }): Promise<{ deleted: number }> {
  let where: Prisma.StorageObjectWhereInput;
  if (input.keys !== undefined) {
    if (!Array.isArray(input.keys) || input.keys.length === 0 || input.keys.length > MAX_DELETE_KEYS) {
      throw storageErrors.invalid(`keys must be a list of 1 to ${MAX_DELETE_KEYS} file keys.`);
    }
    where = { key: { in: input.keys.map(requireKey) } };
  } else if (typeof input.prefix === "string" && input.prefix !== "") {
    const prefix = normalizePrefix(input.prefix);
    if (!prefix.ok || prefix.key === "") throw storageErrors.invalid("prefix is not valid.");
    where = { key: { startsWith: prefix.key } };
  } else {
    throw storageErrors.invalid("Pass keys, or a non-empty prefix.");
  }

  const rows = await prisma.storageObject.findMany({
    where: { ...scope(ctx), ...where, status: "READY" },
    select: { id: true, projectId: true, env: true },
  });
  if (rows.length === 0) return { deleted: 0 };
  await prisma.storageObject.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "READY" }, data: { status: "DELETING" } });
  await finishDeleting(rows);
  // Marked DELETING means gone to the app, whether or not R2 has caught up.
  log.info("storage.deleted", { projectId: ctx.projectId, env: ctx.env, count: rows.length });
  return { deleted: rows.length };
}

export async function usage(ctx: StorageCtx) {
  const [plan, usedBytes, fileCount] = await Promise.all([
    planFor(ctx.userId),
    storageUsage(ctx.userId),
    prisma.storageObject.count({ where: { ...scope(ctx), status: "READY" } }),
  ]);
  return { usedBytes, fileCount, ...limitsFor(plan) };
}

// ── sweep ─────────────────────────────────────────────────────────────────────

/** Hourly: remove uploads that were never confirmed, and retry deletes that failed. */
export async function sweepStorage(): Promise<{ stale: number; deleted: number }> {
  const cutoff = new Date(Date.now() - env.STORAGE_PENDING_TTL_MS);
  const stale = await prisma.storageObject.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });
  // Claim before deleting, so a completion arriving now finds nothing to confirm.
  const claimed =
    stale.length === 0
      ? { count: 0 }
      : await prisma.storageObject.updateMany({
          where: { id: { in: stale.map((s) => s.id) }, status: "PENDING", createdAt: { lt: cutoff } },
          data: { status: "DELETING" },
        });

  const rows = await prisma.storageObject.findMany({
    where: { status: "DELETING" },
    select: { id: true, projectId: true, env: true },
    take: 500,
  });
  const deleted = await finishDeleting(rows);
  return { stale: claimed.count, deleted };
}
