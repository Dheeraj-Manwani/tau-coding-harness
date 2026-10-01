import { Router, raw } from "express";
import { env } from "@/lib/env";
import {
  signUpload,
  uploadBytes,
  completeUpload,
  createPaste,
  getAttachment,
  getAttachmentContent,
  getAttachmentUrl,
  deleteAttachment,
} from "../controllers/attachment.controller";
import { attachmentRateLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

// Creating work is rate limited; reading status isn't — the composer polls it
// once a second while a chip is pending.
router.post("/sign", attachmentRateLimiter, signUpload);
router.put("/:attachmentId/upload", attachmentRateLimiter, raw({
  type: "application/octet-stream",
  limit: Math.max(env.ATTACHMENT_MAX_BYTES, env.ATTACHMENT_MAX_IMAGE_BYTES),
  inflate: false,
}), uploadBytes);
router.post("/paste", attachmentRateLimiter, createPaste);
router.post("/:attachmentId/complete", attachmentRateLimiter, completeUpload);

router.get("/:attachmentId", getAttachment);
router.get("/:attachmentId/content", getAttachmentContent);
router.get("/:attachmentId/url", getAttachmentUrl);
router.delete("/:attachmentId", deleteAttachment);

export default router;
