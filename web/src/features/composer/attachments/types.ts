export type AttachmentKind = "IMAGE" | "PASTED" | "FILE";
export type AttachmentStatus = "PENDING" | "EXTRACTING" | "READY" | "FAILED";

/** What the server knows about an attachment. */
export interface AttachmentSummary {
  id: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractionError: string | null;
  /** Chip preview text — populated for PASTED only. */
  preview: string | null;
  lineCount: number | null;
}

/** A chip in the composer: the server summary plus client-only upload state. */
export interface AttachmentDraft extends Omit<AttachmentSummary, "id"> {
  /** Stable identity assigned when the file is picked. Removal, patching and
   *  React keys all use this — `id` arrives later and would race the upload. */
  key: string;
  /** Server row id; null until the sign call returns. */
  id: string | null;
  /** Object URL for instant local preview; revoked on removal. */
  localUrl?: string;
  /** True between picking the file and the server acknowledging it. */
  uploading?: boolean;
}

/** Attachments as they come back attached to a persisted message. */
export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractionError: string | null;
  preview: string | null;
}

export function isImage(a: {
  mimeType: string;
  kind: AttachmentKind;
}): boolean {
  return a.kind === "IMAGE" || a.mimeType.startsWith("image/");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "FILE";
  return filename
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 5);
}
