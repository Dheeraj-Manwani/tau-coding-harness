/*
  Warnings:

  - You are about to drop the column `files` on the `Fragment` table. All the data in the column will be lost.
  - You are about to drop the column `filesS3Key` on the `Fragment` table. All the data in the column will be lost.
  - You are about to drop the column `baseSnapshotId` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `snapshotId` on the `ToolCall` table. All the data in the column will be lost.
  - You are about to drop the `Snapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_baseSnapshotId_fkey";

-- DropForeignKey
ALTER TABLE "Snapshot" DROP CONSTRAINT "Snapshot_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ToolCall" DROP CONSTRAINT "ToolCall_snapshotId_fkey";

-- DropIndex
DROP INDEX "ToolCall_snapshotId_idx";

-- AlterTable
ALTER TABLE "Fragment" DROP COLUMN "files",
DROP COLUMN "filesS3Key";

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "baseSnapshotId";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "headSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ToolCall" DROP COLUMN "snapshotId";

-- DropTable
DROP TABLE "Snapshot";

-- DropEnum
DROP TYPE "SnapshotTrigger";

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFile_projectId_path_key" ON "ProjectFile"("projectId", "path");

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
