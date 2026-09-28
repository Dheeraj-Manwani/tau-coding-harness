/**
 * Read/write a single file in a project's manifest, outside a turn.
 *
 * Deterministic transforms over an existing project — `migrateTemplate`
 * (frontend → fullstack) and `retrofitVisualEdit` (Phase 5 of
 * doc/archive/VISUAL_EDIT_PLAN.md) — all need the same two operations: pull one file's
 * bytes out of R2, and put one file's bytes back into R2 + the `ProjectFile`
 * manifest. They live here so there is one copy rather than one per transform.
 */
import { prisma } from "@/lib/prisma";
import { log } from "./log";
import { getBlobText, putBlob } from "@/lib/s3";
import { allocateHeadSequence } from "@/lib/headSequence";
import { sha256Hex } from "../agent/tools/functions/utils";

export interface ManifestFileRow {
  path: string;
  contentHash: string;
}

/** Fetch a manifest file's contents, or `null` if the blob can't be read. A
 *  missing blob is a reason to skip a transform, never a reason to fail a job. */
export async function readManifestFile(
  userId: string,
  projectId: string,
  row: ManifestFileRow,
): Promise<string | null> {
  try {
    return await getBlobText(userId, projectId, row.contentHash);
  } catch (err) {
    log.warn("manifest.blob_read_failed", {
      projectId,
      path: row.path,
      error: String(err),
    });
    return null;
  }
}

/**
 * Write one file into the manifest.
 *
 * Deliberately not `persistFile`: that publishes `file_done` events to a job's
 * event stream, and these transforms run outside a turn — the agent is not
 * watching, and a burst of phantom file events would show up in the UI as edits
 * nobody made.
 */
export async function writeManifestFile(
  userId: string,
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const hash = sha256Hex(content);
  await putBlob(userId, projectId, hash, content);

  await prisma.$transaction(async (tx) => {
    const seq = await allocateHeadSequence(tx, projectId);
    await tx.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: {
        projectId,
        path,
        contentHash: hash,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        lastSequence: seq,
      },
      update: {
        contentHash: hash,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        lastSequence: seq,
      },
    });
  });
}
