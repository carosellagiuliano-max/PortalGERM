ALTER TYPE "AbuseEventKind" ADD VALUE 'RESTRICTION_EXPIRED';
ALTER TYPE "AuditTargetType" ADD VALUE 'TAXONOMY';
ALTER TYPE "NotificationKind" ADD VALUE 'MODERATION_CHANGED';

CREATE TYPE "ImportSetupApprovalEventKind" AS ENUM ('APPROVED', 'REVOKED', 'EXPIRED');

ALTER TABLE "Canton"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "City"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Skill"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AbuseReport"
  ADD COLUMN "slaPolicyVersion" VARCHAR(32) NOT NULL DEFAULT 'OPS_CASE_SLA_POLICY_V1',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AbuseReportEvent"
  ADD COLUMN "idempotencyKey" VARCHAR(128);

ALTER TABLE "ModerationRestriction"
  ADD COLUMN "liftedByUserId" UUID,
  ADD COLUMN "liftReason" VARCHAR(500),
  ADD COLUMN "expiredAt" TIMESTAMPTZ(3),
  ADD COLUMN "idempotencyKey" VARCHAR(128);

UPDATE "ModerationRestriction"
SET "idempotencyKey" = 'phase11-backfill-' || "id"::text
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "ModerationRestriction"
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

ALTER TABLE "ImportRun"
  ADD COLUMN "slaPolicyVersion" VARCHAR(32) NOT NULL DEFAULT 'OPS_CASE_SLA_POLICY_V1',
  ADD COLUMN "dueAt" TIMESTAMPTZ(3);

ALTER TABLE "SystemTask"
  ADD COLUMN "policyVersion" VARCHAR(32),
  ADD COLUMN "thresholdCode" VARCHAR(32);

ALTER TABLE "ContentRevision"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ContentEvent"
  ADD COLUMN "idempotencyKey" VARCHAR(128);

ALTER TABLE "SupportCase"
  ADD COLUMN "contactPreference" VARCHAR(32) NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "slaPolicyVersion" VARCHAR(32) NOT NULL DEFAULT 'OPS_CASE_SLA_POLICY_V1',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SupportCaseEvent"
  ADD COLUMN "idempotencyKey" VARCHAR(128);

CREATE TABLE "ImportSetupApprovalEvent" (
  "id" UUID NOT NULL,
  "importSetupApprovalId" UUID NOT NULL,
  "kind" "ImportSetupApprovalEventKind" NOT NULL,
  "actorUserId" UUID,
  "reasonCode" VARCHAR(64),
  "correlationId" VARCHAR(128) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportSetupApprovalEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportSetupApprovalEvent_importSetupApprovalId_fkey"
    FOREIGN KEY ("importSetupApprovalId") REFERENCES "ImportSetupApproval"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AbuseReportEvent_idempotencyKey_key"
  ON "AbuseReportEvent"("idempotencyKey");
CREATE UNIQUE INDEX "ModerationRestriction_idempotencyKey_key"
  ON "ModerationRestriction"("idempotencyKey");
CREATE UNIQUE INDEX "ModerationRestriction_one_active_target_type"
  ON "ModerationRestriction"("targetType", "targetId")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "ImportRun_status_dueAt_idx"
  ON "ImportRun"("status", "dueAt");
CREATE UNIQUE INDEX "ContentEvent_idempotencyKey_key"
  ON "ContentEvent"("idempotencyKey");
CREATE UNIQUE INDEX "SupportCaseEvent_idempotencyKey_key"
  ON "SupportCaseEvent"("idempotencyKey");
CREATE UNIQUE INDEX "ImportSetupApprovalEvent_idempotencyKey_key"
  ON "ImportSetupApprovalEvent"("idempotencyKey");
CREATE INDEX "ImportSetupApprovalEvent_importSetupApprovalId_createdAt_idx"
  ON "ImportSetupApprovalEvent"("importSetupApprovalId", "createdAt");
CREATE INDEX "Canton_isActive_sortOrder_idx"
  ON "Canton"("isActive", "sortOrder");
CREATE INDEX "City_cantonId_isActive_sortOrder_idx"
  ON "City"("cantonId", "isActive", "sortOrder");
CREATE INDEX "Skill_isActive_sortOrder_idx"
  ON "Skill"("isActive", "sortOrder");

ALTER TABLE "Canton"
  ADD CONSTRAINT "Canton_sortOrder_nonnegative" CHECK ("sortOrder" >= 0);
ALTER TABLE "City"
  ADD CONSTRAINT "City_sortOrder_nonnegative" CHECK ("sortOrder" >= 0);
ALTER TABLE "Skill"
  ADD CONSTRAINT "Skill_sortOrder_nonnegative" CHECK ("sortOrder" >= 0);
ALTER TABLE "AbuseReport"
  ADD CONSTRAINT "AbuseReport_version_positive" CHECK ("version" >= 1);
ALTER TABLE "ContentRevision"
  ADD CONSTRAINT "ContentRevision_version_positive" CHECK ("version" >= 1);
ALTER TABLE "SupportCase"
  ADD CONSTRAINT "SupportCase_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "SupportCase_contactPreference_allowed"
    CHECK ("contactPreference" IN ('EMAIL', 'PHONE'));

-- Phase-08 intake activities keep their stronger payload identity. Phase-11
-- operator activities use an idempotency/correlation pair without a payload.
ALTER TABLE "SalesActivity"
  DROP CONSTRAINT "SalesActivity_intake_identity_check",
  ADD CONSTRAINT "SalesActivity_intake_identity_check"
    CHECK (
      (
        "kind" = 'INTAKE_RECEIVED'
        AND "idempotencyKey" IS NOT NULL
        AND "payloadHash" IS NOT NULL
        AND "correlationId" IS NOT NULL
      ) OR (
        "kind" <> 'INTAKE_RECEIVED'
        AND "payloadHash" IS NULL
        AND (("idempotencyKey" IS NULL AND "correlationId" IS NULL)
          OR ("idempotencyKey" IS NOT NULL AND "correlationId" IS NOT NULL))
      )
    );

-- Optimistic-lock versions are lifecycle metadata, not authored content.
-- Keep every other released-revision immutability rule intact.
CREATE OR REPLACE FUNCTION enforce_job_revision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_published boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "Job"
    WHERE id = OLD."jobId"
      AND ("publishedRevisionId" = OLD.id
        OR ("currentRevisionId" = OLD.id AND status = 'PUBLISHED'))
  ) INTO is_published;

  IF TG_OP = 'DELETE' THEN
    IF OLD."submittedAt" IS NOT NULL OR is_published THEN
      RAISE EXCEPTION 'Released JobRevision cannot be deleted'
        USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."submittedAt" IS NULL
    AND NEW."submittedAt" IS NOT NULL
    AND (NEW."approvedAt" IS NOT NULL OR NEW."rejectedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Submission and moderation timestamps must be separate transitions'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;

  IF OLD."submittedAt" IS NOT NULL OR is_published THEN
    IF is_published
      OR (to_jsonb(OLD) - ARRAY['approvedAt', 'rejectedAt', 'updatedAt', 'version'])
        IS DISTINCT FROM
        (to_jsonb(NEW) - ARRAY['approvedAt', 'rejectedAt', 'updatedAt', 'version'])
      OR (OLD."approvedAt" IS NOT NULL
        AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt")
      OR (OLD."rejectedAt" IS NOT NULL
        AND NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt")
      OR NEW."version" NOT IN (OLD."version", OLD."version" + 1)
      OR (NEW."approvedAt" IS NOT NULL AND NEW."rejectedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'JobRevision is immutable after release outside monotone moderation timestamps'
        USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_content_revision_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE'
    AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE'
    AND OLD."status" = 'DRAFT'
    AND ((NEW."status" = 'DRAFT' AND NEW."version" IN (OLD."version", OLD."version" + 1))
      OR (NEW."status" = 'IN_REVIEW' AND NEW."version" = OLD."version" + 1)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'reviewedAt', 'publishedAt', 'version'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'reviewedAt', 'publishedAt', 'version'])
    OR (NEW."status" <> OLD."status" AND NEW."version" <> OLD."version" + 1)
    OR (NEW."status" = OLD."status" AND NEW."version" NOT IN (OLD."version", OLD."version" + 1))
    OR (OLD."reviewedAt" IS NOT NULL AND OLD."reviewedAt" IS DISTINCT FROM NEW."reviewedAt")
    OR (OLD."publishedAt" IS NOT NULL AND OLD."publishedAt" IS DISTINCT FROM NEW."publishedAt")
    OR NOT (NEW."status" = OLD."status"
      OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('APPROVED', 'REJECTED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" = 'PUBLISHED')
      OR (OLD."status" = 'PUBLISHED' AND NEW."status" = 'UNPUBLISHED'))
    OR (NEW."status" IN ('APPROVED', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED') AND NEW."reviewedAt" IS NULL)
    OR (NEW."status" IN ('PUBLISHED', 'UNPUBLISHED') AND NEW."publishedAt" IS NULL) THEN
    RAISE EXCEPTION 'ContentRevision authored content is immutable after review begins'
      USING ERRCODE = '23514', CONSTRAINT = 'content_revision_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;
