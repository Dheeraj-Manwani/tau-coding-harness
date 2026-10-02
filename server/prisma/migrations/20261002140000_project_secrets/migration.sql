-- Third-party credentials a generated app needs at runtime (Stripe, Resend, ...).
--
-- Collected by the `request_secret` agent tool through a form outside the chat,
-- so the value never lands in Message/ToolCall rows. Stored reversibly
-- (AES-256-GCM, same "v1:iv:tag:ct" format as ApiKey.ciphertext) because the
-- worker rewrites the sandbox's `.env` from these rows on every provision — the
-- `.env` itself is never persisted (isSecretPath).
CREATE TABLE "ProjectSecret" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectSecret_projectId_name_key" ON "ProjectSecret"("projectId", "name");

ALTER TABLE "ProjectSecret" ADD CONSTRAINT "ProjectSecret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
