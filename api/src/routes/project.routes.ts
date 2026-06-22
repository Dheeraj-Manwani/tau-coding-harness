import { Router } from "express";
import { initializeProject } from "../controllers/project.controller";

const router = Router();

router.post("/", initializeProject);
export default router;
