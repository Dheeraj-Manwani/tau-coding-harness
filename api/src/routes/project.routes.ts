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
router.post("/:projectId/jobs/:jobId/answer", submitJobAnswer);

export default router;
