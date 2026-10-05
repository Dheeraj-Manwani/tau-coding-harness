-- CreateEnum
CREATE TYPE "ContextCheckpointReason" AS ENUM ('AUTO_SUMMARIZE', 'MANUAL_SUMMARIZE', 'MANUAL_CLEAR');

-- AlterTable
ALTER TABLE "ContextCheckpoint" ADD COLUMN     "reason" "ContextCheckpointReason" NOT NULL DEFAULT 'AUTO_SUMMARIZE';
