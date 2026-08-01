import { Router } from "express";
import {
  signUpload,
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
router.post("/paste", attachmentRateLimiter, createPaste);
router.post("/:attachmentId/complete", attachmentRateLimiter, completeUpload);

router.get("/:attachmentId", getAttachment);
router.get("/:attachmentId/content", getAttachmentContent);
router.get("/:attachmentId/url", getAttachmentUrl);
router.delete("/:attachmentId", deleteAttachment);

export default router;
