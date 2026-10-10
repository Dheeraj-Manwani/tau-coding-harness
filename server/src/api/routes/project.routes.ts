import { Router, raw } from "express";
import { env } from "@/lib/env";
import {
  initializeProject,
  listProjects,
  getProjectShowcase,
  getProject,
  getProjectJobStatus,
  listMessages,
  addMessage,
  updateProject,
  deleteProject,
  getProjectTree,
  getProjectFile,
  downloadProjectArchive,
  saveProjectFile,
  applyVisualEdit,
  getProjectTheme,
  applyThemeEdit,
  importVisualAsset,
  getPreviewStatus,
  restartPreview,
  submitJobAnswer,
  submitSecretAnswer,
  listSecrets,
  setSecret,
  deleteSecret,
  cancelAllJobs,
} from "../controllers/project.controller";
import * as github from "../controllers/githubProject.controller";
import * as deploy from "../controllers/deploy.controller";
import * as identity from "../controllers/identity.controller";
import * as domainRoutes from "../controllers/domain.controller";
import * as context from "../controllers/context.controller";
import * as design from "../controllers/design.controller";
import * as storageOwner from "../controllers/storageOwner.controller";
import {
  visualEditRateLimiter,
  publishRateLimiter,
  assetImportRateLimiter,
  attachmentRateLimiter,
} from "../middleware/rateLimit.middleware";

const router = Router();

router.post("/", initializeProject);
router.get("/", listProjects);
router.get("/showcase", getProjectShowcase);
// The styles a new project can be given. Not project-scoped, so it is declared
// before the `/:projectId` routes, like "showcase" above.
router.get("/design/styles", design.getCatalog);
// A picture to take a design from, sent as the request body. Only image types
// are read as a body here, so anything else arrives empty and is refused.
router.post(
  "/design/from-image",
  attachmentRateLimiter,
  raw({ type: "image/*", limit: env.ATTACHMENT_MAX_IMAGE_BYTES, inflate: false }),
  design.fromImage,
);
// User-scoped, not project-scoped — declared before the `/:projectId` routes so
// "jobs" is never captured as a projectId.
router.post("/jobs/cancel-all", cancelAllJobs);
router.get("/:projectId", getProject);
router.get("/:projectId/job-status", getProjectJobStatus);
router.get("/:projectId/messages", listMessages);
router.post("/:projectId/message", addMessage);
// Project-dropdown chat actions. See doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md.
router.post("/:projectId/chat/clear", context.clearChat);
router.post("/:projectId/chat/summarize", context.summarizeChat);
router.patch("/:projectId", updateProject);
router.delete("/:projectId", deleteProject);
router.get("/:projectId/tree", getProjectTree);
router.get("/:projectId/file", getProjectFile);
router.get("/:projectId/download", downloadProjectArchive);
router.put("/:projectId/file", saveProjectFile);
// Visual edit — deterministic, zero-credit source edits driven by the preview.
router.post("/:projectId/visual-edit", visualEditRateLimiter, applyVisualEdit);
router.get("/:projectId/theme", getProjectTheme);
router.post("/:projectId/theme", visualEditRateLimiter, applyThemeEdit);
// The look as a whole: which style, accent, mode, fonts and feel the app has,
// and changing them. Like a theme edit, a restyle costs no model call.
router.get("/:projectId/design", design.getDesign);
router.post("/:projectId/design", visualEditRateLimiter, design.restyle);
router.post(
  "/:projectId/visual-asset",
  assetImportRateLimiter,
  importVisualAsset,
);
router.get("/:projectId/preview/status", getPreviewStatus);
router.post("/:projectId/preview/restart", restartPreview);
router.post("/:projectId/jobs/:jobId/answer", submitJobAnswer);
// Third-party API keys. Values travel only in these request bodies — never
// through `answer`, which is persisted into the chat transcript.
router.post("/:projectId/jobs/:jobId/secrets", submitSecretAnswer);
// Tools -> Storage: the owner view of the files their app has stored.
router.get("/:projectId/storage", storageOwner.getOverview);
router.get("/:projectId/storage/files", storageOwner.listFiles);
router.post("/:projectId/storage/files/url", storageOwner.fileUrl);
router.post("/:projectId/storage/files/delete", storageOwner.deleteFiles);
router.post("/:projectId/storage/clear", storageOwner.clearPreview);
router.post("/:projectId/storage/rotate-key", storageOwner.rotateKey);
router.get("/:projectId/secrets", listSecrets);
router.put("/:projectId/secrets/:name", setSecret);
router.delete("/:projectId/secrets/:name", deleteSecret);

// Publish panel. The site itself is served by the public routes in
// `sites.routes.ts`, which sit outside this authenticated router.
router.get("/:projectId/deploy", deploy.getStatus);
// Live check behind the address field in the Publish panel.
router.get(
  "/:projectId/deploy/name-available",
  visualEditRateLimiter,
  deploy.nameAvailable,
);
// The live server's recent log lines, secrets masked (doc/PUBLISHING.md C14).
router.get("/:projectId/deploy/logs", visualEditRateLimiter, deploy.getLogs);
// Re-inject secrets into the live server without a rebuild (C7).
router.post("/:projectId/deploy/refresh-secrets", publishRateLimiter, deploy.refreshSecrets);
router.post("/:projectId/deploy", publishRateLimiter, deploy.publish);
router.delete("/:projectId/deploy", deploy.unpublish);
// The published database, as CSV files (doc/PUBLISHING.md 5.7).
router.get("/:projectId/database/export", publishRateLimiter, deploy.exportData);
router.post(
  "/:projectId/deployments/:deploymentId/rollback",
  publishRateLimiter,
  deploy.rollback,
);

// Name, description and logo of the published app (Publish panel). Saving a
// logo or generating one costs credits, so both share the import limiter.
router.get("/:projectId/identity", identity.get);
router.put("/:projectId/identity", assetImportRateLimiter, identity.save);
router.post(
  "/:projectId/identity/logo/generate",
  assetImportRateLimiter,
  identity.generateLogo,
);

// Custom domains (Tools -> Domains). Adding and checking reach DNS and
// Cloudflare, so they share the import limiter.
router.get("/:projectId/domains", domainRoutes.list);
router.post("/:projectId/domains", assetImportRateLimiter, domainRoutes.add);
router.post("/:projectId/domains/:domainId/check", assetImportRateLimiter, domainRoutes.check);
router.post("/:projectId/domains/:domainId/primary", domainRoutes.primary);
router.delete("/:projectId/domains/:domainId", domainRoutes.remove);

// GitHub panel
router.get("/:projectId/github", github.getInfo);
router.post("/:projectId/github/push", github.push);
router.get("/:projectId/github/repos", github.repos);
router.post("/:projectId/github/link", github.link);
router.delete("/:projectId/github/link", github.unlink);
router.patch("/:projectId/github", github.patch);

export default router;
