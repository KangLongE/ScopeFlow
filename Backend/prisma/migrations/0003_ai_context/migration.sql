ALTER TABLE projects ADD COLUMN "contextReview" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE initial_requests ADD COLUMN history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE clarification_questions ADD COLUMN important BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE requirements ADD COLUMN provenance JSONB NOT NULL DEFAULT '{}';
ALTER TABLE change_requests ADD COLUMN "analysisContext" JSONB;
ALTER TABLE ai_usage ADD COLUMN "inputSnapshot" JSONB,
  ADD COLUMN "inputFingerprint" TEXT,
  ADD COLUMN "baselineScopeId" UUID,
  ADD COLUMN "baselineVersion" TEXT,
  ADD COLUMN result JSONB,
  ADD COLUMN "contextStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN cached BOOLEAN NOT NULL DEFAULT false;
