import { Router } from "express";
import {
  initializeProject,
  listProjects,
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
import {
  visualEditRateLimiter,
  assetImportRateLimiter,
} from "../middleware/rateLimit.middleware";

const router = Router();

router.post("/", initializeProject);
router.get("/", listProjects);
// User-scoped, not project-scoped — declared before the `/:projectId` routes so
// "jobs" is never captured as a projectId.
router.post("/jobs/cancel-all", cancelAllJobs);
router.get("/:projectId", getProject);
router.get("/:projectId/job-status", getProjectJobStatus);
router.get("/:projectId/messages", listMessages);
router.post("/:projectId/message", addMessage);
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
router.get("/:projectId/secrets", listSecrets);
router.put("/:projectId/secrets/:name", setSecret);
router.delete("/:projectId/secrets/:name", deleteSecret);

// Publish panel. The site itself is served by the public routes in
// `sites.routes.ts`, which sit outside this authenticated router.
router.get("/:projectId/deploy", deploy.getStatus);
router.post("/:projectId/deploy", deploy.publish);

// GitHub panel
router.get("/:projectId/github", github.getInfo);
router.post("/:projectId/github/push", github.push);
router.get("/:projectId/github/repos", github.repos);
router.post("/:projectId/github/link", github.link);
router.delete("/:projectId/github/link", github.unlink);
router.patch("/:projectId/github", github.patch);

export default router;
