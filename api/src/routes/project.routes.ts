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
  getPreviewStatus,
  restartPreview,
  submitJobAnswer,
} from "../controllers/project.controller";
import * as github from "../controllers/githubProject.controller";

const router = Router();

router.post("/", initializeProject);
router.get("/", listProjects);
router.get("/:projectId", getProject);
router.get("/:projectId/messages", listMessages);
router.post("/:projectId/message", addMessage);
router.delete("/:projectId", deleteProject);
router.get("/:projectId/tree", getProjectTree);
router.get("/:projectId/file", getProjectFile);
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
