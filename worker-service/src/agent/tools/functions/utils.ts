import { allocateHeadSequence } from "@/lib/headSequence";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/publish";
import { putBlob } from "@/lib/s3";
import { createHash } from "crypto";

export const CHUNK_SIZE = 80;
export const WORK_DIR = "/home/user/app";

/** Strip the sandbox WORK_DIR prefix so all stored/published paths are relative. */
export function toRelativePath(p: string): string {
  return p.startsWith(`${WORK_DIR}/`) ? p.slice(WORK_DIR.length + 1) : p;
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

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
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
    await publish(jobId, { type: "file_done", path }, indexer());
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

  await publish(
    jobId,
    { type: "file_done", path, headSequence: seq },
    indexer(),
  );
}
