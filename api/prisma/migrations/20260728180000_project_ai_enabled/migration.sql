-- Marks a project whose app calls the tau AI gateway.
--
-- Drives re-injection of TAU_API_KEY into the sandbox on every provision. The
-- key is written to a `.env` that is deliberately kept OUT of the ProjectFile
-- manifest (isSecretPath), so unlike every other file it does not come back
-- from R2 on rehydrate — this flag is how the worker knows to write it again.
ALTER TABLE "Project" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
