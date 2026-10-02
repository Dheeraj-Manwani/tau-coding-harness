import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

const globalForR2 = globalThis as unknown as { r2: S3Client | undefined };

export const r2 =
  globalForR2.r2 ??
  new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    // AWS SDK >= 3.729 defaults this to "WHEN_SUPPORTED", which signs a CRC32
    // of the (absent) body into every presigned PUT — `x-amz-checksum-crc32`
    // for zero bytes. The browser then uploads real bytes and R2 rejects the
    // mismatch with a 403. "WHEN_REQUIRED" restores the older behaviour.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

if (env.NODE_ENV !== "production") {
  globalForR2.r2 = r2;
}

const BUCKET = env.R2_BUCKET;

export const BLOB_PREFIX = "tau/project-files";

export function blobKey(
  userId: string,
  projectId: string,
  hash: string,
): string {
  return `${BLOB_PREFIX}/${userId}/${projectId}/${hash}`;
}

export const ATTACHMENT_PREFIX = "tau/attachments";

/** Scoped to the user, not a project — attachments are uploaded from the Home
 *  composer before any project exists. */
export function attachmentKey(userId: string, hash: string): string {
  return `${ATTACHMENT_PREFIX}/${userId}/${hash}`;
}

export const AVATAR_PREFIX = "tau/avatars";

/** Content-addressed, so a new picture is a new key and no cache can serve the
 *  old one under it. */
export function avatarKey(userId: string, hash: string): string {
  return `${AVATAR_PREFIX}/${userId}/${hash}`;
}

/** Server-side fallback when the bucket's CORS policy blocks browser PUTs. */
export async function putAttachmentBytes(key: string, body: Buffer, mimeType: string): Promise<void> {
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: mimeType }));
}

export async function deleteObject(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Read by full key; the project-file helpers below take components instead. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`);
  return res.Body.transformToByteArray();
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export function blobExists(
  userId: string,
  projectId: string,
  hash: string,
): Promise<boolean> {
  return objectExists(blobKey(userId, projectId, hash));
}

export interface PutBlobResult {
  key: string;
  /** true when the blob already existed and no PUT was performed. */
  skipped: boolean;
}

/**
 * Content-addressed blob upload. Mirrors `worker-service/src/lib/s3.ts:putBlob`
 * — keep the two in sync (see OVERVIEW.md #7, duplicated libs).
 */
export async function putBlob(
  userId: string,
  projectId: string,
  hash: string,
  body: string | Uint8Array,
): Promise<PutBlobResult> {
  const key = blobKey(userId, projectId, hash);

  if (await objectExists(key)) {
    return { key, skipped: true };
  }

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
    }),
  );

  return { key, skipped: false };
}

export async function getBlob(
  userId: string,
  projectId: string,
  hash: string,
): Promise<Uint8Array> {
  const key = blobKey(userId, projectId, hash);
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`);
  return res.Body.transformToByteArray();
}

export async function getBlobText(
  userId: string,
  projectId: string,
  hash: string,
): Promise<string> {
  const key = blobKey(userId, projectId, hash);
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`);
  return res.Body.transformToString("utf-8");
}

const DEFAULT_EXPIRY_SECONDS = 3600;

export function presignGet(
  key: string,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

/**
 * Only `host` ends up in X-Amz-SignedHeaders, so the client is free to send
 * whatever headers it likes — including the `Content-Type` that actually sets
 * the stored object's type. Don't pass ContentType to the command: the signer
 * drops it for presigned URLs, so it reads as load-bearing when it isn't.
 */
export function presignPut(
  key: string,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
): Promise<string> {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

/** Every key under `prefix`, following pagination. Empty prefix = whole bucket. */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of list.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/** S3 caps DeleteObjects at 1000 keys per call. */
const DELETE_BATCH = 1000;

export interface DeleteKeysResult {
  deleted: number;
  errors: { key: string; message: string }[];
}

export async function deleteKeys(
  keys: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<DeleteKeysResult> {
  const errors: DeleteKeysResult["errors"] = [];
  let deleted = 0;

  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH);
    const res = await r2.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    for (const err of res.Errors ?? []) {
      errors.push({
        key: err.Key ?? "(unknown)",
        message: `${err.Code ?? ""} ${err.Message ?? ""}`.trim(),
      });
    }
    deleted += batch.length - (res.Errors?.length ?? 0);
    onProgress?.(Math.min(i + DELETE_BATCH, keys.length), keys.length);
  }

  return { deleted, errors };
}

/** Delete every R2 blob stored under `tau/project-files/{userId}/{projectId}/`. */
export async function deleteProjectBlobs(
  userId: string,
  projectId: string,
): Promise<void> {
  const keys = await listKeys(`${BLOB_PREFIX}/${userId}/${projectId}/`);
  if (keys.length > 0) await deleteKeys(keys);
}

// ── Published sites ───────────────────────────────────────────────────────────

export interface SiteObject {
  /** Body bytes, plus the metadata the HTTP response needs. */
  body: Uint8Array;
  contentType: string;
  etag?: string;
}

/**
 * Upload one file of a published build.
 *
 * Unlike `putBlob` this is not content-addressed and never skips: a deployment
 * prefix is written exactly once, by exactly one job, so there is nothing to
 * deduplicate against and a "already exists" short-circuit would only be able
 * to hide a bug.
 */
export async function putSiteObject(
  key: string,
  body: Uint8Array,
  contentType: string,
  cacheControl: string,
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

/** Read one published file, or null when it is not there. */
export async function getSiteObject(key: string): Promise<SiteObject | null> {
  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    if (!res.Body) return null;
    return {
      body: await res.Body.transformToByteArray(),
      contentType: res.ContentType ?? "application/octet-stream",
      etag: res.ETag,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Delete every object under one deployment's prefix. */
export async function deleteSitePrefix(storagePrefix: string): Promise<number> {
  const keys = await listKeys(`${storagePrefix}/`);
  if (keys.length === 0) return 0;
  const { deleted } = await deleteKeys(keys);
  return deleted;
}

interface MaybeAwsError {
  name?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
}

function isNotFound(err: unknown): boolean {
  const e = err as MaybeAwsError;
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.Code === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

// ── Preview thumbnails ────────────────────────────────────────────────────────
// Formerly worker-only; the two copies of this file were otherwise the same
// module with different subsets of it.

export function screenshotKey(userId: string, projectId: string): string {
  return `${BLOB_PREFIX}/${userId}/${projectId}/screenshots/latest.jpg`;
}

/** Upload (overwrite) the latest preview thumbnail; returns its key. */
export async function putScreenshot(
  userId: string,
  projectId: string,
  body: Buffer,
): Promise<string> {
  const key = screenshotKey(userId, projectId);
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/jpeg",
    }),
  );
  return key;
}
