import { Router } from "express";
import { createPromoCode } from "../controllers/credits.controller";
import {
  reconcileUser,
  reconcileAll,
  reconcileJobHandler,
  sweep,
  health,
  listJobs,
  jobDetail,
  jobEvents,
  metrics,
  sandboxes,
  userDetail,
  projectDetail,
  gatewayOverview,
  stream,
  killJob,
  reconcileStuckJobs,
  releaseHolds,
  destroySession,
  ui,
  costsUi,
} from "../controllers/admin.controller";

const router = Router();

router.post("/promo-codes", createPromoCode);

// ── credits reconciliation ───────────────────────────────────────────────────
router.get("/reconcile", reconcileUser); // ?userId=xxx
router.get("/reconcile/all", reconcileAll); // all accounts, returns drifted only
router.get("/reconcile/job", reconcileJobHandler); // ?jobId=xxx
router.post("/reconcile/sweep", sweep); // sweep stuck holds

// ── observability ────────────────────────────────────────────────────────────
router.get("/health", health); // the one endpoint to page on
router.get("/metrics", metrics); // 1h / 24h / 7d rollups
router.get("/stream", stream); // SSE firehose of live job phases
router.get("/sandboxes", sandboxes); // ?check=true probes E2B
router.get("/jobs", listJobs); // ?status=&userId=&projectId=&since=&limit=
router.get("/jobs/:id", jobDetail);
router.get("/jobs/:id/events", jobEvents); // replay what the browser received
router.get("/users/:id", userDetail);

// Runtime inference across every key — who is spending, on what. `?hours=`.
router.get("/gateway", gatewayOverview);
router.get("/projects/:id", projectDetail);

// ── incident tools ───────────────────────────────────────────────────────────
router.post("/jobs/reconcile-stuck", reconcileStuckJobs);
router.post("/jobs/:id/kill", killJob);
router.post("/users/:id/holds/release", releaseHolds);

// ── console ──────────────────────────────────────────────────────────────────
router.get("/ui", ui);
router.get("/costs", costsUi);
router.post("/session/end", destroySession);

export default router;
