-- The project page begins chat-only and reveals the workspace once generation
-- produces its first file/preview. Persist that one-way transition so a reload
-- does not derive layout from transient navigation memory.
ALTER TABLE "Project" ADD COLUMN "workspaceStartedAt" TIMESTAMP(3);

-- Existing projects with durable output have already entered workspace mode.
UPDATE "Project" AS p
SET "workspaceStartedAt" = COALESCE(
  (
    SELECT MIN(pf."createdAt")
    FROM "ProjectFile" AS pf
    WHERE pf."projectId" = p."id"
  ),
  (
    SELECT MIN(f."createdAt")
    FROM "Fragment" AS f
    INNER JOIN "Message" AS m ON m."id" = f."messageId"
    WHERE m."projectId" = p."id"
  ),
  p."updatedAt"
)
WHERE EXISTS (
  SELECT 1 FROM "ProjectFile" AS pf WHERE pf."projectId" = p."id"
)
OR EXISTS (
  SELECT 1
  FROM "Fragment" AS f
  INNER JOIN "Message" AS m ON m."id" = f."messageId"
  WHERE m."projectId" = p."id"
);
