import { z } from "zod";

/** Pasted text is stored whole, so cap a single paste. */
const MAX_PASTE_CHARS = 500_000;
const MAX_FILENAME = 255;

export const attachmentSignSchema = z.object({
  filename: z.string().trim().min(1).max(MAX_FILENAME),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.coerce.number().int().positive(),
  /** sha256 hex of the bytes — drives dedupe and the extraction cache. */
  contentHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/, "contentHash must be a sha256 hex digest"),
});

export const attachmentPasteSchema = z.object({
  text: z
    .string()
    .min(1, "Pasted content can't be empty")
    .max(MAX_PASTE_CHARS, "Pasted content is too large"),
  filename: z.string().trim().min(1).max(MAX_FILENAME).optional(),
});

export const attachmentIdParamSchema = z.object({
  attachmentId: z.uuid("Invalid attachment id"),
});

export const attachmentCompleteSchema = z.object({
  /** The user's in-progress prompt, used to focus the extraction. Optional. */
  userMessage: z.string().max(10_000).optional(),
});

export type AttachmentSignInput = z.infer<typeof attachmentSignSchema>;
export type AttachmentPasteInput = z.infer<typeof attachmentPasteSchema>;
