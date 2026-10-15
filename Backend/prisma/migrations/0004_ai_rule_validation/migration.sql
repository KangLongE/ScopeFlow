ALTER TABLE ai_usage ADD COLUMN "rawResponse" TEXT, ADD COLUMN validation JSONB;
ALTER TABLE scopes ADD COLUMN "validationReview" JSONB;
ALTER TABLE ai_usage ADD COLUMN "reviewHistory" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE estimates ADD COLUMN "validationReview" JSONB;
ALTER TABLE estimate_items ADD COLUMN implementation JSONB;
