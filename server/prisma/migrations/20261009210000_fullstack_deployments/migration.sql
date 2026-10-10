-- CreateEnum
CREATE TYPE "DeployTarget" AS ENUM ('STATIC', 'FULLSTACK');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('LAMBDA_FUNCTION', 'IAM_ROLE');

-- AlterEnum
ALTER TYPE "DeploymentStatus" ADD VALUE 'VALIDATING';
ALTER TYPE "DeploymentStatus" ADD VALUE 'PROVISIONING';
ALTER TYPE "DeploymentStatus" ADD VALUE 'VERIFYING';

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "backendUrl" TEXT,
ADD COLUMN     "backendVersion" TEXT,
ADD COLUMN     "target" "DeployTarget" NOT NULL DEFAULT 'STATIC';

-- CreateTable
CREATE TABLE "ProjectResource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "providerId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "secretCiphertext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectResource_projectId_idx" ON "ProjectResource"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectResource_kind_providerId_key" ON "ProjectResource"("kind", "providerId");

-- AddForeignKey
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
