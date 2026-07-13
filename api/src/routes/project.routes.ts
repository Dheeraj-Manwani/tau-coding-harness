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

export default router;
