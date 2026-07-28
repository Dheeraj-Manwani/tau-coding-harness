import { Router } from "express";
import { chat, chatStream, models } from "../controllers/ai.controller";
import { requireApiKeySimple } from "../middleware/apiKey.middleware";

const router = Router();

// Same credential as /v1, but auth failures must use THIS surface's flat error
// shape — an app reading `data.error` as a string everywhere else should not get
// an object back precisely when its key is wrong.
router.use(requireApiKeySimple);

router.get("/models", models);
router.post("/chat", chat);
router.post("/chat/stream", chatStream);

export default router;
