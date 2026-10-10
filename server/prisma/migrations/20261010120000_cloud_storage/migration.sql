-- CreateEnum
CREATE TYPE "StorageEnv" AS ENUM ('PREVIEW', 'LIVE');

-- CreateEnum
CREATE TYPE "StorageObjectStatus" AS ENUM ('PENDING', 'READY', 'DELETING');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "storageEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storageSuspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StorageKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "env" "StorageEnv" NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokeAfter" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StorageKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "env" "StorageEnv" NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "status" "StorageObjectStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageKey_lookupHash_key" ON "StorageKey"("lookupHash");

-- CreateIndex
CREATE INDEX "StorageKey_projectId_env_status_idx" ON "StorageKey"("projectId", "env", "status");

-- CreateIndex
CREATE INDEX "StorageObject_projectId_env_status_key_idx" ON "StorageObject"("projectId", "env", "status", "key");

-- CreateIndex
CREATE INDEX "StorageObject_userId_status_idx" ON "StorageObject"("userId", "status");

-- CreateIndex
CREATE INDEX "StorageObject_status_createdAt_idx" ON "StorageObject"("status", "createdAt");

-- At most one READY row per file name. Prisma cannot express a partial index;
-- completing an upload relies on this.
CREATE UNIQUE INDEX "StorageObject_ready_key_uniq" ON "StorageObject"("projectId", "env", "key") WHERE "status" = 'READY';

-- AddForeignKey
ALTER TABLE "StorageKey" ADD CONSTRAINT "StorageKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
