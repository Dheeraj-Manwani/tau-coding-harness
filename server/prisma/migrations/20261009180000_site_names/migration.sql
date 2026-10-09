-- CreateTable
CREATE TABLE "SiteName" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteName_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteName_name_key" ON "SiteName"("name");

-- CreateIndex
CREATE INDEX "SiteName_projectId_idx" ON "SiteName"("projectId");

-- Every address already in use is claimed for good.
INSERT INTO "SiteName" ("id", "name", "projectId")
SELECT gen_random_uuid()::text, "slug", "id" FROM "Project" WHERE "slug" IS NOT NULL;
