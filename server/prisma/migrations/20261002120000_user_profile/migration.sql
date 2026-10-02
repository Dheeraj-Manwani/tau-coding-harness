-- Profile: an optional display name and picture. Deliberately nothing else;
-- see api/services/profile.service.ts.
ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(40);
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "profileSeededAt" TIMESTAMP(3);
