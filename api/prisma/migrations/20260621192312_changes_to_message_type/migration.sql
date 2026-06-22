-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageType" ADD VALUE 'TOOL_REQ';
ALTER TYPE "MessageType" ADD VALUE 'TOOL_RES';
ALTER TYPE "MessageType" ADD VALUE 'USER';

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "type" DROP NOT NULL;
