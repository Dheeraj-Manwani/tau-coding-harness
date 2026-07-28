import { allocateHeadSequence } from "@/lib/headSequence";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/publish";
import { putBlob } from "@/lib/s3";
import { createHash } from "crypto";

export const CHUNK_SIZE = 80;
export const WORK_DIR = "/home/user/app";

/** Where background run_command output is captured, relative to WORK_DIR. */
export const LOG_DIR = ".tau/logs";

/** Strip the sandbox WORK_DIR prefix so all stored/published paths are relative. */
export function toRelativePath(p: string): string {
  return p.startsWith(`${WORK_DIR}/`) ? p.slice(WORK_DIR.length + 1) : p;
}

/**
 * Resolve a tool-supplied path (documented as "relative to the project root")
 * to an absolute sandbox path under WORK_DIR.
 *
 * The E2B `files.*` API has no `cwd` option — it resolves relative paths against
 * the user's home dir (`/home/user`), NOT WORK_DIR (`/home/user/app`). So unlike
 * `run_command` (which pins `cwd: WORK_DIR`), the filesystem tools must anchor
 * the path themselves or they'd read/write one level above the app. Absolute
 * paths are passed through unchanged.
 */
export function toWorkdirPath(p: string): string {
  if (p.startsWith("/")) return p;
  const rel = p.trim().replace(/^\.\//, "");
  return rel === "" || rel === "." ? WORK_DIR : `${WORK_DIR}/${rel}`;
}

export function chunkString(s: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += size) {
    chunks.push(s.slice(i, i + size));
  }
  return chunks;
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Tool input '${field}' must be a string`);
  }
  return value;
}

/** Validates an array-of-strings tool param and trims/drops blank entries. */
export function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Tool input '${field}' must be an array of strings`);
  }
  return value
    .map((v, i) => asString(v, `${field}[${i}]`))
    .map((s) => s.trim())
    .filter(Boolean);
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * File extensions whose contents are binary and must NOT go through the UTF-8
 * text pipeline (persist/rehydrate/serve/commit would corrupt them). Downloaded
 * assets (images, fonts, media) live here. Note SVG is deliberately absent — it
 * is XML text and round-trips fine as a string. This classification is by path
 * alone, so it needs no schema column and stays consistent across the api and
 * worker services.
 */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "webm",
  "mov",
  "pdf",
]);

export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Persist a binary file (downloaded asset) to R2 + the manifest, the binary
 * counterpart to {@link persistFile}. Hashes and stores the raw bytes so the
 * blob round-trips losslessly; rehydrate reads it back with `getBlob` (bytes),
 * not `getBlobText`. Publishes only `file_done` — binary content is never
 * streamed as `file_chunk` (the chat/code panel treat chunks as UTF-8 text).
 */
export async function persistBinaryFile(
  jobId: string,
  projectId: string,
  userId: string,
  path: string,
  bytes: Uint8Array,
  indexer: () => number,
): Promise<void> {
  const hash = sha256HexBytes(bytes);
  const sizeBytes = bytes.byteLength;

  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });

  if (existing?.contentHash === hash) {
    await publish(jobId, { type: "file_done", path });
    return;
  }

  await putBlob(userId, projectId, hash, bytes);

  const seq = await prisma.$transaction(async (tx) => {
    const s = await allocateHeadSequence(tx, projectId);
    await tx.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: {
        projectId,
        path,
        contentHash: hash,
        sizeBytes,
        lastSequence: s,
      },
      update: { contentHash: hash, sizeBytes, lastSequence: s },
    });
    return s;
  });

  await publish(jobId, { type: "file_done", path, headSequence: seq });
}

export function isLongRunning(command: string): boolean {
  return (
    /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/.test(
      command,
    ) ||
    /\bvite\b/.test(command) ||
    /\bnext\s+(dev|start)\b/.test(command) ||
    /--port\b/.test(command)
  );
}

export async function persistFile(
  jobId: string,
  projectId: string,
  userId: string,
  path: string,
  content: string,
  indexer: () => number,
): Promise<void> {
  const hash = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });

  if (existing?.contentHash === hash) {
    await publish(jobId, { type: "file_done", path });
    return;
  }

  await putBlob(userId, projectId, hash, content);

  const seq = await prisma.$transaction(async (tx) => {
    const s = await allocateHeadSequence(tx, projectId);
    await tx.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: {
        projectId,
        path,
        contentHash: hash,
        sizeBytes,
        lastSequence: s,
      },
      update: { contentHash: hash, sizeBytes, lastSequence: s },
    });
    return s;
  });

  await publish(jobId, { type: "file_done", path, headSequence: seq });
}
