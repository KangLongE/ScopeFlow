ALTER TABLE "projects" ADD COLUMN "aiDrafts" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "requirements" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_status_check" CHECK ("status" IN ('CONFIRMED', 'PENDING', 'EXCLUDED'));
