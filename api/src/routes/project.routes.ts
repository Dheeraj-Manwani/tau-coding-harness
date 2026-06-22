import { Router } from "express";
import {
  initializeProject,
  getProject,
  listMessages,
  addMessage,
} from "../controllers/project.controller";

const router = Router();

router.post("/", initializeProject);
router.get("/:projectId", getProject);
router.get("/:projectId/messages", listMessages);
router.post("/:projectId/message", addMessage);

export default router;
