-- Job liveness: heartbeat + turn counter + finish reason.
--
-- The in-process runner has no durability, so a crash or redeploy used to leave
-- a Job at RUNNING forever: the project's shimmer never cleared and every later
-- prompt was rejected with 409 "generation in progress". These columns let the
-- reaper distinguish "still working" from "the process that owned this is gone".
CREATE TYPE "FinishReason" AS ENUM (
  'DONE',
  'BUDGET',
  'INSUFFICIENT_CREDITS',
  'CANCELLED',
  'TURN_CAP',
  'TRUNCATION_CAP',
  'WALL_CLOCK',
  'ERROR',
  'ABANDONED'
);

ALTER TABLE "Job" ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN     "currentTurn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN     "finishReason" "FinishReason";

-- The reaper's query: non-terminal rows ordered by how cold the heartbeat is.
CREATE INDEX "Job_status_lastHeartbeatAt_idx" ON "Job"("status", "lastHeartbeatAt");

-- Backfill: every pre-existing non-terminal row predates the heartbeat, so it
-- can only be a stranded job from a previous deploy. Terminate them here rather
-- than waiting for the reaper's grace period to elapse — each one is currently
-- blocking new prompts on its project and pinning a concurrency slot.
--
-- Capture the ids first: the UPDATE below changes the very predicate that
-- selects them, so the hold cleanup can't re-derive the set afterwards.
CREATE TEMPORARY TABLE "_stranded_jobs" AS
SELECT "id" FROM "Job" WHERE "status" IN ('QUEUED', 'RUNNING');

UPDATE "Job"
SET "status"       = 'FAILED',
    "error"        = COALESCE("error", 'Stranded by a restart before job liveness tracking existed'),
    "finishReason" = 'ABANDONED',
    "completedAt"  = COALESCE("completedAt", NOW())
WHERE "id" IN (SELECT "id" FROM "_stranded_jobs");

-- Release the credit holds those stranded jobs were holding open. Pay-as-you-go:
-- settling only frees the concurrency slot, it never refunds consumed credits.
UPDATE "CreditHold"
SET "status"    = 'SETTLED',
    "settledAt" = NOW()
WHERE "status" = 'ACTIVE'
  AND "jobId" IN (SELECT "id" FROM "_stranded_jobs");

DROP TABLE "_stranded_jobs";
