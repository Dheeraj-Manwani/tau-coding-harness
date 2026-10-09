-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'PUBLISH_FEE';
ALTER TYPE "LedgerType" ADD VALUE 'LOGO_FEE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "publishFeePaidAt" TIMESTAMP(3);

-- A project that is live or was live when the fee shipped is treated as paid,
-- from the time its first build finished.
UPDATE "Project" p
SET "publishFeePaidAt" = (
  SELECT MIN(d."completedAt") FROM "Deployment" d
  WHERE d."projectId" = p."id" AND d."status" IN ('READY', 'SUPERSEDED')
)
WHERE EXISTS (
  SELECT 1 FROM "Deployment" d
  WHERE d."projectId" = p."id" AND d."status" IN ('READY', 'SUPERSEDED')
);

-- CreateTable
CREATE TABLE "LogoGeneration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedHash" TEXT,

    CONSTRAINT "LogoGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogoGeneration_projectId_createdAt_idx" ON "LogoGeneration"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "LogoGeneration" ADD CONSTRAINT "LogoGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
