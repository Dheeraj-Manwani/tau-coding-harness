import { Router } from "express";
import { subscribe, fetchSubscription, cancel, plans } from "../controllers/billing.controller";

const router = Router();

router.get("/plans", plans);
router.post("/subscribe", subscribe);
router.get("/subscription", fetchSubscription);
router.post("/cancel", cancel);

export default router;
