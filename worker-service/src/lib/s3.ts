import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

/**
 * Cloudflare R2 blob store (S3-compatible API).
 *
 * Blobs are content-addressed: the object key embeds the sha256 of the content,
 * so a given (userId, projectId, hash) always maps to the same object and uploads
 * are idempotent. Blobs are stored under `tau/project-files/{userId}/{projectId}/{hash}`,
 * deduped per project. File bodies live here; the DB ProjectFile manifest only
 * stores the hash. See docs/file-storage-redesign-plan.md (Phase 2).
 */

const globalForR2 = globalThis as unknown as {
  r2: S3Client | undefined;
};

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
  });

if (env.NODE_ENV !== "production") {
  globalForR2.r2 = r2;
}

const BUCKET = env.R2_BUCKET;

export const BLOB_PREFIX = "tau/project-files";

/** Content-addressed key for a file blob, scoped to a user + project. */
export function blobKey(
  userId: string,
  projectId: string,
  hash: string,
): string {
  return `${BLOB_PREFIX}/${userId}/${projectId}/${hash}`;
}

/** True if an object exists at `key`. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** True if the blob for (userId, projectId, hash) already exists. */
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

/** Fetch a blob's raw bytes by (userId, projectId, hash). Throws if absent. */
export async function getBlob(
  userId: string,
  projectId: string,
  hash: string,
): Promise<Uint8Array> {
  const key = blobKey(userId, projectId, hash);
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) {
    throw new Error(`R2 object has no body: ${key}`);
  }
  return res.Body.transformToByteArray();
}

/** Fetch a blob's content decoded as UTF-8 text. */
export async function getBlobText(
  userId: string,
  projectId: string,
  hash: string,
): Promise<string> {
  const key = blobKey(userId, projectId, hash);
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) {
    throw new Error(`R2 object has no body: ${key}`);
  }
  return res.Body.transformToString("utf-8");
}

const DEFAULT_EXPIRY_SECONDS = 3600;

/** Presigned GET URL for `key`. */
export function presignGet(
  key: string,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

/** Presigned PUT URL for `key`. */
export function presignPut(
  key: string,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
): Promise<string> {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

interface MaybeAwsError {
  name?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
}

/** Detect an S3/R2 "object not found" error across the various shapes the SDK uses. */
function isNotFound(err: unknown): boolean {
  const e = err as MaybeAwsError;
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.Code === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}
