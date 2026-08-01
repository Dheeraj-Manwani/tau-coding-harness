-- Deploys: a user can finally ship the app they just built.
--
-- Shape notes:
--   * `Deployment` is append-only and each row owns an immutable R2 prefix keyed
--     by its own id, so a build never overwrites bytes a live site is serving.
--     Publishing is "upload everything, then move Project.liveDeploymentId" —
--     the live site never observes a half-uploaded build, and a rollback is that
--     same pointer moving back rather than a rebuild.
--   * `Project.slug` is UNIQUE and allocated once, on the first publish. It is
--     never reused: recycling a slug would silently repoint links people have
--     already shared at somebody else's app.
--   * `Deployment.userId` is denormalised from Project because the public site
--     handler builds an R2 key on every request to a published app, and should
--     not need a join to do it.

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'BUILDING', 'UPLOADING', 'READY', 'FAILED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "liveDeploymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "storagePrefix" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "outputDir" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "jobId" TEXT,
    "error" TEXT,
    "buildLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_jobId_key" ON "Deployment"("jobId");

-- CreateIndex
CREATE INDEX "Deployment_projectId_createdAt_idx" ON "Deployment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE INDEX "Deployment_purgedAt_completedAt_idx" ON "Deployment"("purgedAt", "completedAt");

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
