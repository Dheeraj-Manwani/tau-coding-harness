-- AlterEnum
ALTER TYPE "ResourceKind" ADD VALUE 'NEON_PROJECT';

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "databaseBranchId" TEXT,
ADD COLUMN     "schemaChanges" JSONB,
ADD COLUMN     "schemaHash" TEXT,
ADD COLUMN     "schemaSql" TEXT;

-- AlterTable
ALTER TABLE "ProjectResource" ADD COLUMN     "deleteAfter" TIMESTAMP(3),
ALTER COLUMN "projectId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "ProjectResource" DROP CONSTRAINT "ProjectResource_projectId_fkey";

-- AddForeignKey
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
