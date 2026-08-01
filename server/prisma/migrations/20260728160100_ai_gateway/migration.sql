-- The OpenAI-compatible /v1 gateway: per-user API keys for generated apps, and
-- the runtime inference those apps bill to the owner's credits.
-- See doc/AI_FOR_GENERATED_APPS.md.

CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'ROTATING', 'REVOKED');

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailyCapMicro" BIGINT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokeAfter" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- Every gateway request authenticates by sha256 of the presented key, so this
-- index is the hot path: one equality lookup, no scan, no timing side channel.
CREATE UNIQUE INDEX "ApiKey_lookupHash_key" ON "ApiKey"("lookupHash");

-- NOTE: deliberately NOT unique on userId. The rotation grace window means a
-- user briefly holds both an ACTIVE and a ROTATING key; "exactly one usable
-- key" is a service-layer invariant. Without the overlap, rotating would break
-- every deployed app instantly with no window to redeploy.
CREATE INDEX "ApiKey_userId_status_idx" ON "ApiKey"("userId", "status");

CREATE TABLE "GatewayUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "projectId" TEXT,
    "alias" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicro" BIGINT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayUsage_pkey" PRIMARY KEY ("id")
);

-- Idempotency for the paired GATEWAY_DEBIT ledger row.
CREATE UNIQUE INDEX "GatewayUsage_requestId_key" ON "GatewayUsage"("requestId");
CREATE INDEX "GatewayUsage_userId_recordedAt_idx" ON "GatewayUsage"("userId", "recordedAt");

-- The daily-cap pre-flight sums costMicro over this index on every request.
CREATE INDEX "GatewayUsage_apiKeyId_recordedAt_idx" ON "GatewayUsage"("apiKeyId", "recordedAt");
CREATE INDEX "GatewayUsage_projectId_idx" ON "GatewayUsage"("projectId");

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GatewayUsage" ADD CONSTRAINT "GatewayUsage_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
