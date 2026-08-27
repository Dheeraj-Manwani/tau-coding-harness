-- CreateEnum
--
-- Replaces ADMIN_API_KEY as the guard on `/admin/*`. The key was a single
-- shared secret: it proved someone knew a string, not who they were, so the
-- audit log in admin.middleware.ts could only record `via: key|cookie` on reads
-- that touch other people's projects. A role names the operator and lets one
-- person be revoked without rotating a secret that kicks out everyone else.
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
--
-- Defaults to USER, so every existing row is a non-admin and the admin surface
-- is closed the moment this lands — there is deliberately no seed script and no
-- fallback credential. Promote the first operator by hand:
--
--   UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';
