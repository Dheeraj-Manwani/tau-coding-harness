import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import {
  attachmentKey,
  deleteObject,
  objectExists,
  presignGet,
  presignPut,
  putAttachmentBytes,
} from "@/lib/s3";
import {
  isAllowedUpload,
  kindForMime,
  maxBytesForMime,
  runExtraction,
  truncate,
  PREVIEW_CHARS,
} from "../lib/attachments";
import { AttachmentKind, AttachmentStatus } from "@/generated/prisma/enums";

/** Attachments older than this that never reached a message are swept. */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
/** An EXTRACTING row older than this lost its process; reset and retry. */
const STUCK_EXTRACTING_MS = 2 * 60 * 1000;

export interface SignResult {
  attachmentId: string;
  uploadUrl: string | null;
  alreadyUploaded: boolean;
}

/** Accept only the exact bytes signed by this user for an unsent attachment. */
export async function uploadBytes(userId: string, attachmentId: string, body: Buffer): Promise<void> {
  if (!env.ATTACHMENTS_ENABLED) throw Errors.forbidden("ATTACHMENTS_DISABLED");
  const row = await requireOwned(userId, attachmentId);
  if (row.messageId || row.feedbackId || row.status !== AttachmentStatus.PENDING) {
    throw Errors.conflict("ATTACHMENT_ALREADY_SENT_OR_PROCESSING");
  }
  if (!Buffer.isBuffer(body) || body.length !== row.sizeBytes || body.length > maxBytesForMime(row.mimeType)) {
    throw Errors.badRequest("UPLOAD_SIZE_MISMATCH");
  }
  const hash = createHash("sha256").update(body).digest("hex");
  if (hash !== row.contentHash || row.blobKey !== attachmentKey(userId, hash)) {
    throw Errors.badRequest("UPLOAD_CONTENT_MISMATCH");
  }
  await putAttachmentBytes(row.blobKey, body, row.mimeType);
}

export async function signUpload(
  userId: string,
  input: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  },
): Promise<SignResult> {
  if (!env.ATTACHMENTS_ENABLED) {
    throw Errors.forbidden("ATTACHMENTS_DISABLED");
  }
  // Checked against the filename too — browsers mistype `.log` and `.ts`.
  if (!isAllowedUpload(input.filename, input.mimeType)) {
    throw Errors.badRequest("UNSUPPORTED_FILE_TYPE");
  }

  const limit = maxBytesForMime(input.mimeType);
  if (input.sizeBytes > limit) {
    throw Errors.badRequest("FILE_TOO_LARGE");
  }

  const key = attachmentKey(userId, input.contentHash);
  const alreadyUploaded = await objectExists(key);

  const attachment = await prisma.attachment.create({
    data: {
      userId,
      kind: kindForMime(input.mimeType),
      status: AttachmentStatus.PENDING,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      blobKey: key,
      contentHash: input.contentHash,
    },
    select: { id: true },
  });

  return {
    attachmentId: attachment.id,
    // The client sends Content-Type as an unsigned header on the PUT; that's
    // what sets the stored object's type.
    uploadUrl: alreadyUploaded ? null : await presignPut(key, 900),
    alreadyUploaded,
  };
}

/** Called once the bytes are in R2. Kicks off extraction and returns
 *  immediately; the client polls `get`. */
export async function completeUpload(
  userId: string,
  attachmentId: string,
  userMessage?: string,
): Promise<{ status: AttachmentStatus }> {
  const row = await requireOwned(userId, attachmentId);

  if (row.status === AttachmentStatus.READY) {
    return { status: row.status };
  }
  if (!row.blobKey || !(await objectExists(row.blobKey))) {
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: {
        status: AttachmentStatus.FAILED,
        extractionError: "Upload did not complete",
      },
    });
    throw Errors.badRequest("UPLOAD_INCOMPLETE");
  }

  // Fire-and-forget — one process, no worker to hand off to. The hourly sweep
  // resets whatever a restart strands.
  void runExtraction(attachmentId, userMessage);

  return { status: AttachmentStatus.EXTRACTING };
}

/** Pasted text needs no upload and no model — it's already the payload. */
export async function createPaste(
  userId: string,
  text: string,
  filename?: string,
): Promise<AttachmentSummary> {
  if (!env.ATTACHMENTS_ENABLED) {
    throw Errors.forbidden("ATTACHMENTS_DISABLED");
  }

  const row = await prisma.attachment.create({
    data: {
      userId,
      kind: AttachmentKind.PASTED,
      status: AttachmentStatus.READY,
      filename: filename ?? "Pasted content",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(text, "utf-8"),
      extractedText: text,
      preview: text.slice(0, PREVIEW_CHARS),
    },
  });

  return toSummary(row);
}

export interface AttachmentSummary {
  id: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractionError: string | null;
  /** Short preview for the chip; the full text is fetched by the modal. */
  preview: string | null;
  lineCount: number | null;
}

interface SummaryRow {
  id: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractionError: string | null;
  extractedText: string | null;
  preview: string | null;
}

export function toSummary(row: SummaryRow): AttachmentSummary {
  const text = row.extractedText;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    extractionError: row.extractionError,
    // Images and files show a thumbnail/icon instead, so sending their
    // extracted text here would be kilobytes per row for nothing. The `??`
    // covers rows written before the preview column existed.
    preview:
      row.kind === AttachmentKind.PASTED
        ? (row.preview ?? text?.slice(0, PREVIEW_CHARS) ?? null)
        : null,
    lineCount:
      row.kind === AttachmentKind.PASTED && text
        ? text.split("\n").length
        : null,
  };
}

export async function getAttachment(
  userId: string,
  attachmentId: string,
): Promise<AttachmentSummary> {
  return toSummary(await requireOwned(userId, attachmentId));
}

/** Full body for the preview modal — pasted text, or the extracted text. */
export async function getAttachmentContent(
  userId: string,
  attachmentId: string,
): Promise<{ text: string | null; extractionError: string | null }> {
  const row = await requireOwned(userId, attachmentId);
  return { text: row.extractedText, extractionError: row.extractionError };
}

/** Presigned GET for the image preview or the file download button. */
export async function getAttachmentUrl(
  userId: string,
  attachmentId: string,
): Promise<{ url: string; filename: string; mimeType: string }> {
  const row = await requireOwned(userId, attachmentId);
  if (!row.blobKey) throw Errors.badRequest("ATTACHMENT_HAS_NO_FILE");
  return {
    url: await presignGet(row.blobKey, 600),
    filename: row.filename,
    mimeType: row.mimeType,
  };
}

/** Removing a chip before send. Only unattached rows may be deleted. */
export async function deleteAttachment(
  userId: string,
  attachmentId: string,
): Promise<void> {
  const row = await requireOwned(userId, attachmentId);
  if (row.messageId || row.feedbackId) throw Errors.conflict("ATTACHMENT_ALREADY_SENT");

  const deleted = await prisma.attachment.deleteMany({ where: { id: attachmentId, messageId: null, feedbackId: null } });
  if (!deleted.count) throw Errors.conflict("ATTACHMENT_ALREADY_SENT");
  // Content-addressed, so the same image dropped twice shares one blob.
  await deleteBlobIfUnreferenced(row.blobKey);
}

async function deleteBlobIfUnreferenced(blobKey: string | null): Promise<void> {
  if (!blobKey) return;
  const remaining = await prisma.attachment.count({ where: { blobKey } });
  if (remaining > 0) return;
  await deleteObject(blobKey).catch(() => undefined);
}

async function requireOwned(userId: string, attachmentId: string) {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
  });
  // 404 rather than 403 on a mismatch — don't confirm the id exists to a stranger.
  if (!row || row.userId !== userId) {
    throw Errors.notFound("ATTACHMENT_NOT_FOUND");
  }
  return row;
}

export interface SweepResult {
  orphansDeleted: number;
  stuckReset: number;
  errors: string[];
}

/** Hourly, alongside `sweepStuckHolds`: drop never-sent attachments and reset
 *  extractions stranded by a restart. */
export async function sweepAttachments(): Promise<SweepResult> {
  const errors: string[] = [];
  let orphansDeleted = 0;
  let stuckReset = 0;

  const orphans = await prisma.attachment.findMany({
    where: {
      messageId: null,
      feedbackId: null,
      createdAt: { lt: new Date(Date.now() - ORPHAN_TTL_MS) },
    },
    select: { id: true, blobKey: true },
    take: 500,
  });

  for (const o of orphans) {
    try {
      const deleted = await prisma.attachment.deleteMany({ where: { id: o.id, messageId: null, feedbackId: null } });
      if (!deleted.count) continue;
      await deleteBlobIfUnreferenced(o.blobKey);
      orphansDeleted++;
    } catch (err) {
      errors.push(
        `orphan ${o.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const stuck = await prisma.attachment.updateMany({
    where: {
      status: AttachmentStatus.EXTRACTING,
      updatedAt: { lt: new Date(Date.now() - STUCK_EXTRACTING_MS) },
    },
    data: { status: AttachmentStatus.PENDING },
  });
  stuckReset = stuck.count;

  return { orphansDeleted, stuckReset, errors };
}

/** Remove every attachment blob owned by a user (account deletion). */
export async function deleteUserAttachmentBlobs(
  userId: string,
): Promise<void> {
  const rows = await prisma.attachment.findMany({
    where: { userId, blobKey: { not: null } },
    select: { blobKey: true },
  });
  await Promise.all(
    [...new Set(rows.map((r) => r.blobKey!))].map((key) =>
      deleteObject(key).catch(() => undefined),
    ),
  );
}

export { truncate };
