-- CreateEnum
CREATE TYPE "Effort" AS ENUM ('LOW', 'HIGH', 'MAX');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "effort" "Effort" NOT NULL DEFAULT 'LOW';
