ALTER TABLE ai_usage
  ADD COLUMN "executionKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "policyRevision" TEXT,
  ADD COLUMN "creditState" TEXT,
  ADD COLUMN "costStatus" TEXT,
  ADD COLUMN "priceSnapshot" JSONB,
  ADD COLUMN "delivery" JSONB,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorMessage" TEXT;

CREATE UNIQUE INDEX "ai_usage_workspaceId_userId_executionKey_key"
  ON ai_usage ("workspaceId", "userId", "executionKey");
