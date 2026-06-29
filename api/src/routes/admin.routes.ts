import { Router } from "express";
import { createPromoCode } from "../controllers/credits.controller";
import {
  reconcileUser,
  reconcileAll,
  reconcileJobHandler,
  sweep,
} from "../controllers/admin.controller";

const router = Router();

router.post("/promo-codes", createPromoCode);

router.get("/reconcile", reconcileUser); // ?userId=xxx
router.get("/reconcile/all", reconcileAll); // all accounts, returns drifted only
router.get("/reconcile/job", reconcileJobHandler); // ?jobId=xxx
router.post("/reconcile/sweep", sweep); // sweep stuck holds

export default router;
