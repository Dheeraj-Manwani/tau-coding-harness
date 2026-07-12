-- CreateTable
CREATE TABLE "ContextCheckpoint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "upToSequence" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "tokensBefore" INTEGER NOT NULL,
    "tokensAfter" INTEGER NOT NULL,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContextCheckpoint_projectId_upToSequence_idx" ON "ContextCheckpoint"("projectId", "upToSequence");

-- AddForeignKey
ALTER TABLE "ContextCheckpoint" ADD CONSTRAINT "ContextCheckpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
