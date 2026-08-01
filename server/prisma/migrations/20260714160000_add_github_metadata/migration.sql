-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "githubDefaultBranch" TEXT,
ADD COLUMN     "githubVisibility" TEXT,
ADD COLUMN     "lastPushedBranch" TEXT,
ADD COLUMN     "lastPrUrl" TEXT,
ADD COLUMN     "lastPrNumber" INTEGER,
ADD COLUMN     "lastPushedSequence" INTEGER,
ADD COLUMN     "githubPushMode" TEXT NOT NULL DEFAULT 'new_pr';
