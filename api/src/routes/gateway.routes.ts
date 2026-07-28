import { Router } from "express";
import { chatCompletions, models } from "../controllers/gateway.controller";
import { requireApiKey } from "../middleware/apiKey.middleware";

const router = Router();

// Both routes sit behind the key check. `/models` reveals nothing sensitive,
// but leaving it open would make the gateway's existence and model list
// enumerable by anyone, for no benefit to a legitimate caller.
router.use(requireApiKey);

router.get("/models", models);
router.post("/chat/completions", chatCompletions);

export default router;
