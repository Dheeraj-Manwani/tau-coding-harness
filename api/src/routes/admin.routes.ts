import { Router } from "express";
import { createPromoCode } from "../controllers/credits.controller";

const router = Router();

router.post("/promo-codes", createPromoCode);

export default router;
