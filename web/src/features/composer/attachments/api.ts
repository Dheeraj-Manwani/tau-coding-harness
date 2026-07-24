import { api } from "@/src/lib/api-client";
import type { AttachmentSummary } from "./types";

interface SignResponse {
  attachmentId: string;
  uploadUrl: string | null;
  alreadyUploaded: boolean;
}

export function signUpload(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
}): Promise<SignResponse> {
  return api
    .post<SignResponse>("/attachments/sign", input)
    .then((r) => r.data);
}

/** Bare `fetch`, not the axios instance — its interceptor would add an
 *  Authorization header and break the signature. */
export async function uploadToR2(
  uploadUrl: string,
  file: File | Blob,
  mimeType: string,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": mimeType },
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
}

export function completeUpload(
  attachmentId: string,
  userMessage?: string,
): Promise<{ status: string }> {
  return api
    .post<{ status: string }>(`/attachments/${attachmentId}/complete`, {
      ...(userMessage ? { userMessage } : {}),
    })
    .then((r) => r.data);
}

export function createPaste(
  text: string,
  filename?: string,
): Promise<AttachmentSummary> {
  return api
    .post<AttachmentSummary>("/attachments/paste", {
      text,
      ...(filename ? { filename } : {}),
    })
    .then((r) => r.data);
}

export function getAttachment(id: string): Promise<AttachmentSummary> {
  return api.get<AttachmentSummary>(`/attachments/${id}`).then((r) => r.data);
}

export function getAttachmentContent(
  id: string,
): Promise<{ text: string | null; extractionError: string | null }> {
  return api
    .get<{ text: string | null; extractionError: string | null }>(
      `/attachments/${id}/content`,
    )
    .then((r) => r.data);
}

export function getAttachmentUrl(
  id: string,
): Promise<{ url: string; filename: string; mimeType: string }> {
  return api
    .get<{ url: string; filename: string; mimeType: string }>(
      `/attachments/${id}/url`,
    )
    .then((r) => r.data);
}

export function deleteAttachment(id: string): Promise<void> {
  return api.delete(`/attachments/${id}`).then(() => undefined);
}

/** SHA-256 of arbitrary bytes, hex — mirrors `lib/hash.ts` for binary input. */
export async function sha256Bytes(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
