import { Router } from "express";
import {
  getBalance,
  getHistory,
  redeemCode,
} from "../controllers/credits.controller";

const router = Router();

router.get("/balance", getBalance);
router.get("/history", getHistory);
router.post("/redeem", redeemCode);

export default router;
