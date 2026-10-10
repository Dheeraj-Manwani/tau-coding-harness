import { Router } from "express";
import * as c from "../controllers/storage.controller";
import { requireStorageKey } from "../middleware/storageKey.middleware";

const router = Router();

// Every route sits behind the key; which project and environment a request
// touches is decided by the key and nothing else.
router.use(requireStorageKey);

router.post("/uploads", c.createUpload);
router.post("/uploads/:id/complete", c.completeUpload);
router.get("/files", c.listFiles);
router.get("/files/info", c.fileInfo);
router.post("/files/url", c.fileUrl);
router.post("/files/urls", c.fileUrls);
router.post("/files/move", c.moveFile);
router.post("/files/delete", c.deleteFiles);
router.get("/usage", c.usage);

export default router;
