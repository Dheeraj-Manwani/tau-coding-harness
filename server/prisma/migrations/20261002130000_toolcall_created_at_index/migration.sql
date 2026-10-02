-- The admin metrics and the hourly alert sweep group ToolCall rows by a
-- `createdAt` window (api/services/admin.service.ts metricsForWindow). Without
-- an index each of those is a sequential scan of every tool call ever made.
--
-- Plain (not CONCURRENTLY) so it runs inside the migration like every other
-- index here; it briefly blocks ToolCall writes, which is milliseconds at
-- today's table size.
CREATE INDEX "ToolCall_createdAt_idx" ON "ToolCall"("createdAt");
