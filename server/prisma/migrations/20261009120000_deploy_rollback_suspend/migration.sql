-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "siteSuspendedAt" TIMESTAMP(3),
ADD COLUMN     "siteSuspendedReason" TEXT;
