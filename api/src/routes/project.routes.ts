import { Router } from "express";
import {
  initializeProject,
  listProjects,
  getProject,
  listMessages,
  addMessage,
  deleteProject,
  getProjectTree,
  getProjectFile,
  saveProjectFile,
  applyVisualEdit,
  getProjectTheme,
  applyThemeEdit,
  importVisualAsset,
  getPreviewStatus,
  restartPreview,
  submitJobAnswer,
  cancelAllJobs,
} from "../controllers/project.controller";
import * as github from "../controllers/githubProject.controller";
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
router.get("/:projectId/messages", listMessages);
router.post("/:projectId/message", addMessage);
router.delete("/:projectId", deleteProject);
router.get("/:projectId/tree", getProjectTree);
router.get("/:projectId/file", getProjectFile);
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

// GitHub panel
router.get("/:projectId/github", github.getInfo);
router.post("/:projectId/github/push", github.push);
router.get("/:projectId/github/repos", github.repos);
router.post("/:projectId/github/link", github.link);
router.delete("/:projectId/github/link", github.unlink);
router.patch("/:projectId/github", github.patch);

export default router;
