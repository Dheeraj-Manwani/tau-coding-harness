import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

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

export function presignPut(
  key: string,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
): Promise<string> {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

/** Delete every R2 blob stored under `tau/project-files/{userId}/{projectId}/`. */
export async function deleteProjectBlobs(
  userId: string,
  projectId: string,
): Promise<void> {
  const prefix = `${BLOB_PREFIX}/${userId}/${projectId}/`;
  let continuationToken: string | undefined;

  do {
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: keys, Quiet: true },
        }),
      );
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
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
