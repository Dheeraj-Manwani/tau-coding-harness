import type { AttachmentDraft, MessageAttachment } from "./types";

/** What a composer draft and a persisted message attachment both collapse to,
 *  so one chip component can render either. */
export interface ChipModel {
  key: string;
  id: string | null;
  kind: "IMAGE" | "PASTED" | "FILE";
  status: "PENDING" | "EXTRACTING" | "READY" | "FAILED";
  filename: string;
  mimeType: string;
  preview?: string | null;
  localUrl?: string;
  uploading?: boolean;
}

export function draftToChip(a: AttachmentDraft): ChipModel {
  return {
    key: a.key,
    id: a.id,
    kind: a.kind,
    status: a.status,
    filename: a.filename,
    mimeType: a.mimeType,
    preview: a.preview,
    localUrl: a.localUrl,
    uploading: a.uploading,
  };
}

/**
 * Composer drafts → the shape a persisted turn uses, so an optimistic bubble
 * can render its chips before the server round-trip. Drafts without a server id
 * are dropped: they were never sent.
 */
export function toMessageAttachments(
  drafts: AttachmentDraft[],
): MessageAttachment[] {
  return drafts
    .filter((a) => a.id !== null)
    .map((a) => ({
      id: a.id!,
      kind: a.kind,
      status: a.status,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      extractionError: a.extractionError,
      preview: a.preview,
    }));
}

export function messageAttachmentToChip(a: MessageAttachment): ChipModel {
  return {
    key: a.id,
    id: a.id,
    kind: a.kind,
    status: a.status,
    filename: a.filename,
    mimeType: a.mimeType,
    preview: a.preview,
  };
}
