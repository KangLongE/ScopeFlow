-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'REQUIREMENT_GATHERING', 'WAITING_SCOPE_APPROVAL', 'ACTIVE', 'WAITING_CHANGE_APPROVAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('FEATURE', 'NON_FUNCTIONAL', 'DESIGN', 'INFRA', 'EXTERNAL_INTEGRATION');

-- CreateEnum
CREATE TYPE "RequirementPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RequirementSource" AS ENUM ('CLIENT_INITIAL', 'CLIENT_ANSWER', 'OWNER_MANUAL', 'CHANGE_REQUEST');

-- CreateEnum
CREATE TYPE "ScopeStatus" AS ENUM ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('DRAFT', 'WAITING_INTERNAL_REVIEW', 'WAITING_CLIENT_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClientAccessPurpose" AS ENUM ('QUESTIONS', 'SCOPE', 'CHANGE');

-- CreateEnum
CREATE TYPE "AIAction" AS ENUM ('INITIAL_ANALYSIS', 'QUESTIONS', 'REQUIREMENTS', 'ESTIMATE', 'SCOPE_SUMMARY', 'SCOPE_COMPARISON');

-- CreateEnum
CREATE TYPE "AIUsageStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(6),
    "refreshTokenExpiresAt" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "creditLimit" INTEGER NOT NULL DEFAULT 100,
    "userCreditLimit" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'REQUIREMENT_GATHERING',
    "budget" DOUBLE PRECISION,
    "deadline" DATE,
    "referenceUrl" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initial_requests" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "analysis" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "initial_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clarification_questions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clarification_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clarification_answers" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clarification_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "RequirementType" NOT NULL,
    "priority" "RequirementPriority" NOT NULL,
    "source" "RequirementSource" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "rates" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "rates" JSONB NOT NULL,
    "overrideTotal" DOUBLE PRECISION,
    "adjustmentReason" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_items" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "hours" JSONB NOT NULL,
    "complexity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT NOT NULL DEFAULT '',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "estimate_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scopes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "majorVersion" INTEGER NOT NULL DEFAULT 1,
    "minorVersion" INTEGER NOT NULL DEFAULT 0,
    "status" "ScopeStatus" NOT NULL DEFAULT 'DRAFT',
    "document" JSONB NOT NULL,
    "basedOnRevision" INTEGER NOT NULL,
    "approvedAt" TIMESTAMPTZ(6),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_requirements" (
    "id" UUID NOT NULL,
    "scopeId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "scope_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "baseScopeId" UUID NOT NULL,
    "resultScopeId" UUID,
    "request" TEXT NOT NULL,
    "analysis" JSONB,
    "review" JSONB,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "rates" JSONB NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT NOT NULL DEFAULT '',
    "reviewedBy" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "approvedBy" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_request_requirements" (
    "id" UUID NOT NULL,
    "changeRequestId" UUID NOT NULL,
    "requirementId" UUID,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "change_request_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_access_tokens" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "scopeId" UUID,
    "changeRequestId" UUID,
    "purpose" "ClientAccessPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_access_tokens_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_access_tokens" ADD CONSTRAINT "client_access_target_check" CHECK (
  ("purpose" = 'QUESTIONS' AND "scopeId" IS NULL AND "changeRequestId" IS NULL) OR
  ("purpose" = 'SCOPE' AND "scopeId" IS NOT NULL AND "changeRequestId" IS NULL) OR
  ("purpose" = 'CHANGE' AND "scopeId" IS NULL AND "changeRequestId" IS NOT NULL)
);

CREATE FUNCTION prevent_approved_scope_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'APPROVED' THEN
    RAISE EXCEPTION 'approved scopes are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "approved_scope_immutable" BEFORE UPDATE OR DELETE ON "scopes"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_scope_mutation();

-- CreateTable
CREATE TABLE "client_feedback" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "tokenId" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "action" "AIAction" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "AIUsageStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_result_cache" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "action" "AIAction" NOT NULL,
    "result" JSONB,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "leaseUntil" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_result_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_limits_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "userId" TEXT,
    "event" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

-- CreateIndex
CREATE INDEX "workspace_members_userId_idx" ON "workspace_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "clients_workspaceId_createdAt_idx" ON "clients"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "clients_workspaceId_id_key" ON "clients"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "projects_workspaceId_deletedAt_createdAt_idx" ON "projects"("workspaceId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspaceId_id_key" ON "projects"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "initial_requests_projectId_key" ON "initial_requests"("projectId");

-- CreateIndex
CREATE INDEX "clarification_questions_projectId_position_idx" ON "clarification_questions"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "clarification_answers_questionId_key" ON "clarification_answers"("questionId");

-- CreateIndex
CREATE INDEX "requirements_projectId_createdAt_idx" ON "requirements"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rate_cards_workspaceId_key" ON "rate_cards"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_projectId_key" ON "estimates"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_items_estimateId_requirementId_key" ON "estimate_items"("estimateId", "requirementId");

-- CreateIndex
CREATE INDEX "scopes_projectId_status_createdAt_idx" ON "scopes"("projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "scopes_projectId_majorVersion_minorVersion_key" ON "scopes"("projectId", "majorVersion", "minorVersion");

-- CreateIndex
CREATE INDEX "scope_requirements_scopeId_position_idx" ON "scope_requirements"("scopeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "scope_requirements_scopeId_requirementId_key" ON "scope_requirements"("scopeId", "requirementId");

-- CreateIndex
CREATE INDEX "change_requests_projectId_status_idx" ON "change_requests"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_projectId_number_key" ON "change_requests"("projectId", "number");

-- CreateIndex
CREATE INDEX "change_request_requirements_changeRequestId_idx" ON "change_request_requirements"("changeRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "client_access_tokens_tokenHash_key" ON "client_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "client_access_tokens_projectId_purpose_createdAt_idx" ON "client_access_tokens"("projectId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "client_feedback_projectId_createdAt_idx" ON "client_feedback"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_workspaceId_createdAt_idx" ON "ai_usage"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_userId_createdAt_idx" ON "ai_usage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_result_cache_expiresAt_idx" ON "ai_result_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_result_cache_workspaceId_hash_key" ON "ai_result_cache"("workspaceId", "hash");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_createdAt_idx" ON "audit_logs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_projectId_createdAt_idx" ON "audit_logs"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "clients"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_requests" ADD CONSTRAINT "initial_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clarification_questions" ADD CONSTRAINT "clarification_questions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clarification_answers" ADD CONSTRAINT "clarification_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "clarification_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scopes" ADD CONSTRAINT "scopes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_requirements" ADD CONSTRAINT "scope_requirements_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_requirements" ADD CONSTRAINT "scope_requirements_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_baseScopeId_fkey" FOREIGN KEY ("baseScopeId") REFERENCES "scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_resultScopeId_fkey" FOREIGN KEY ("resultScopeId") REFERENCES "scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_requirements" ADD CONSTRAINT "change_request_requirements_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_requirements" ADD CONSTRAINT "change_request_requirements_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_tokens" ADD CONSTRAINT "client_access_tokens_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_tokens" ADD CONSTRAINT "client_access_tokens_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_tokens" ADD CONSTRAINT "client_access_tokens_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "client_access_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_result_cache" ADD CONSTRAINT "ai_result_cache_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
