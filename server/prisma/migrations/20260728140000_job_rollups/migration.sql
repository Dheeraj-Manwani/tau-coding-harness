-- Per-job operational rollups for the admin views.
--
-- All of this is derivable by joining TokenUsage and Message, but the admin job
-- list and the metrics windows read it per-row and across every job in a time
-- range. Denormalising turns those into a single indexed scan instead of a join
-- over every turn of every job.
ALTER TABLE "Job" ADD COLUMN     "model" TEXT;
ALTER TABLE "Job" ADD COLUMN     "sandboxId" TEXT;
ALTER TABLE "Job" ADD COLUMN     "inputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN     "outputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN     "costMicro" BIGINT NOT NULL DEFAULT 0;

-- Drives the time-windowed metrics queries (1h / 24h / 7d).
CREATE INDEX "Job_queuedAt_idx" ON "Job"("queuedAt");

-- Backfill token totals for jobs that already ran, so the metrics windows are
-- not blank for historical data. Cost is deliberately left at 0: the per-model
-- rates that applied at the time are not reconstructable from these rows, and a
-- wrong number is worse than an obviously-absent one.
UPDATE "Job" j
SET "inputTokens"  = t.input,
    "outputTokens" = t.output,
    "model"        = t.model
FROM (
  SELECT "jobId",
         SUM("inputTokens")::int  AS input,
         SUM("outputTokens")::int AS output,
         MAX("model")             AS model
  FROM "TokenUsage"
  GROUP BY "jobId"
) t
WHERE j.id = t."jobId";
