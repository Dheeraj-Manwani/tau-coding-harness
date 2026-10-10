/**
 * The storage bucket (doc/TAU_CLOUD_STORAGE.md D1). A module of its own on
 * purpose: `s3.ts` can only name the main bucket and this can only name this
 * one, so a file of a visitor's can never be read or written with the wrong helper.
 */
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

export function storageConfigured(): boolean {
  return Boolean(env.R2_STORAGE_BUCKET);
}

let client: S3Client | undefined;

function r2(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_STORAGE_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_STORAGE_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    // Without this a presigned PUT signs a checksum of the empty body and R2
    // rejects the real upload (see lib/s3.ts).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

function bucket(): string {
  if (!env.R2_STORAGE_BUCKET) throw new Error("R2_STORAGE_BUCKET is not set");
  return env.R2_STORAGE_BUCKET;
}

export const STORAGE_PREFIX = "apps/";

/** `apps/{projectId}/{env}/{objectId}`. The app's own name for the file is a
 *  database column and never part of this. */
export function storageObjectKey(projectId: string, storageEnv: "PREVIEW" | "LIVE", objectId: string): string {
  return `${STORAGE_PREFIX}${projectId}/${storageEnv.toLowerCase()}/${objectId}`;
}

export function projectStoragePrefix(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}/`;
}

/**
 * A signed upload address. Both the size and the type are signed (measured in
 * S0: R2 answers 403 to a body of another length or a different type), so the
 * holder can send exactly the file that was declared and nothing else.
 */
export function presignStoragePut(
  key: string,
  opts: { size: number; contentType: string; expiresIn: number },
): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentLength: opts.size, ContentType: opts.contentType }),
    { expiresIn: opts.expiresIn, signableHeaders: new Set(["content-length", "content-type"]) },
  );
}

export function presignStorageGet(
  key: string,
  opts: { expiresIn: number; contentType: string; disposition: string },
): Promise<string> {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: opts.disposition,
    }),
    { expiresIn: opts.expiresIn },
  );
}

interface MaybeAwsError {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

/** The real size of an object, or null when it is not there. */
export async function headStorageObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (err) {
    const e = err as MaybeAwsError;
    if (e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

const DELETE_BATCH = 1000;

/** Delete objects by key. Returns the keys that could not be deleted. */
export async function deleteStorageObjects(keys: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH);
    const res = await r2().send(
      new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    );
    for (const err of res.Errors ?? []) if (err.Key) failed.push(err.Key);
  }
  return failed;
}

export async function listStorageKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Delete everything under a prefix. Throws when anything is left behind. */
export async function deleteStoragePrefix(prefix: string): Promise<number> {
  if (!prefix.startsWith(STORAGE_PREFIX) || prefix === STORAGE_PREFIX) {
    throw new Error("deleteStoragePrefix needs a project prefix");
  }
  const keys = await listStorageKeys(prefix);
  const failed = await deleteStorageObjects(keys);
  if (failed.length > 0) throw new Error(`${failed.length} storage objects could not be deleted`);
  return keys.length;
}
