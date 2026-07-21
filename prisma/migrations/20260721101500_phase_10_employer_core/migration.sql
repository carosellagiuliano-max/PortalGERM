-- Phase 10 employer portal contracts: persisted enhanced company fields,
-- invitation token generations and optimistic Job/Revision concurrency.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COMPANY_CLAIM_EVIDENCE_ADDED' AFTER 'COMPANY_CLAIM_EVIDENCE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COMPANY_CLAIM_CANCELLED' AFTER 'COMPANY_CLAIM_EVIDENCE_ADDED';

ALTER TABLE "Company"
  ADD COLUMN "linkedinUrl" VARCHAR(512),
  ADD COLUMN "facebookUrl" VARCHAR(512),
  ADD COLUMN "instagramUrl" VARCHAR(512);

ALTER TABLE "CompanyInvitation"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Job"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "JobRevision"
  ADD COLUMN "companyIntro" VARCHAR(1200),
  ADD COLUMN "niceToHave" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "offer" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "JobReportingCheck"
  ADD COLUMN "datasetVersionSnapshot" VARCHAR(64),
  ADD COLUMN "dataYearSnapshot" INTEGER,
  ADD COLUMN "referenceUrlSnapshot" VARCHAR(1000);

ALTER TABLE "JobReportingCheck" DISABLE TRIGGER phase02_append_only_10;
UPDATE "JobReportingCheck" AS reporting
SET
  "datasetVersionSnapshot" = version."version",
  "dataYearSnapshot" = version."datasetYear",
  "referenceUrlSnapshot" = version."referenceUrl"
FROM "OccupationCodeVersion" AS version
WHERE reporting."occupationCodeVersionId" = version."id";
ALTER TABLE "JobReportingCheck" ENABLE TRIGGER phase02_append_only_10;

ALTER TABLE "JobReportingCheck"
  ALTER COLUMN "datasetVersionSnapshot" SET NOT NULL,
  ALTER COLUMN "dataYearSnapshot" SET NOT NULL;

ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "company_invitation_token_version_check"
  CHECK ("tokenVersion" >= 1);
ALTER TABLE "Job" ADD CONSTRAINT "job_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_version_check"
  CHECK ("version" >= 1);

-- A Recruiter has one effective capability per Job. Role changes replace the
-- active assignment under the same Company lock and retain the prior event log.
DROP INDEX "job_active_assignment_unique";
CREATE UNIQUE INDEX "job_active_assignment_unique"
  ON "JobAssignment" ("jobId", "userId") WHERE "status" = 'ACTIVE';

ALTER TABLE "CompanyInvitation"
  ADD CONSTRAINT "CompanyInvitation_inviterUserId_fkey"
  FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyInvitation"
  ADD CONSTRAINT "CompanyInvitation_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyInvitation" DROP CONSTRAINT "company_invitation_lifecycle_check";
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "company_invitation_lifecycle_check"
  CHECK ("createdAt" < "expiresAt"
    AND (("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL))
    AND (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)));

ALTER TABLE "JobAssignment" ADD CONSTRAINT "job_assignment_lifecycle_check"
  CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
    AND ("status" <> 'EXPIRED' OR "expiresAt" IS NOT NULL));

ALTER TABLE "JobReportingCheck" ADD CONSTRAINT "job_reporting_snapshot_check"
  CHECK ("dataYearSnapshot" BETWEEN 2000 AND 2200
    AND char_length(btrim("datasetVersionSnapshot")) > 0);

ALTER TABLE "CompanyVerificationRequest"
  ADD CONSTRAINT "company_verification_id_company_unique" UNIQUE ("id", "companyId");
ALTER TABLE "CompanyVerificationRequest"
  ADD CONSTRAINT "company_verification_supersedes_company_unique" UNIQUE ("supersedesRequestId", "companyId");
ALTER TABLE "CompanyVerificationRequest"
  DROP CONSTRAINT "CompanyVerificationRequest_supersedesRequestId_fkey";
ALTER TABLE "CompanyVerificationRequest"
  ADD CONSTRAINT "CompanyVerificationRequest_supersedesRequestId_companyId_fkey"
  FOREIGN KEY ("supersedesRequestId", "companyId")
  REFERENCES "CompanyVerificationRequest"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_verification_supersession_terminal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."supersedesRequestId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CompanyVerificationRequest" AS previous
    WHERE previous."id" = NEW."supersedesRequestId"
      AND previous."companyId" = NEW."companyId"
      AND previous."status" IN ('REJECTED', 'REVOKED')
  ) THEN
    RAISE EXCEPTION 'Verification cycles may supersede only a terminal cycle in the same Company'
      USING ERRCODE = '23514', CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_verification_supersession_terminal_trigger
BEFORE INSERT OR UPDATE OF "supersedesRequestId", "companyId" ON "CompanyVerificationRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_verification_supersession_terminal();

CREATE OR REPLACE FUNCTION enforce_job_revision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_job_status "JobStatus";
  is_current boolean;
  is_published boolean;
BEGIN
  SELECT "status", "currentRevisionId" = OLD."id", "publishedRevisionId" = OLD."id"
    INTO current_job_status, is_current, is_published
  FROM "Job" WHERE "id" = OLD."jobId";

  IF TG_OP = 'DELETE' AND (OLD."submittedAt" IS NOT NULL OR is_published) THEN
    RAISE EXCEPTION 'Released JobRevision cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  -- Moderation may project reviewed lifecycle timestamps without changing the
  -- authored snapshot. Published evidence remains entirely immutable.
  IF NOT is_published
    AND (to_jsonb(OLD) - ARRAY['submittedAt', 'approvedAt', 'rejectedAt', 'updatedAt'])
      IS NOT DISTINCT FROM
        (to_jsonb(NEW) - ARRAY['submittedAt', 'approvedAt', 'rejectedAt', 'updatedAt']) THEN
    RETURN NEW;
  END IF;

  IF OLD."submittedAt" IS NOT NULL
    AND NOT (is_current AND current_job_status = 'CHANGES_REQUESTED'
      AND OLD."approvedAt" IS NULL AND OLD."rejectedAt" IS NULL)
    OR is_published THEN
    RAISE EXCEPTION 'JobRevision is immutable after release outside changes requested'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_job_revision_child_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    revision_ids := ARRAY[NEW."jobRevisionId"];
  ELSIF TG_OP = 'DELETE' THEN
    revision_ids := ARRAY[OLD."jobRevisionId"];
  ELSE
    revision_ids := ARRAY[OLD."jobRevisionId", NEW."jobRevisionId"];
  END IF;
  SELECT ARRAY(SELECT DISTINCT value FROM unnest(revision_ids) AS value WHERE value IS NOT NULL ORDER BY value)
    INTO revision_ids;
  PERFORM 1 FROM "JobRevision" WHERE "id" = ANY(revision_ids) ORDER BY "id" FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "JobRevision" AS revision
    LEFT JOIN "Job" AS job ON job."id" = revision."jobId"
    WHERE revision."id" = ANY(revision_ids)
      AND (job."publishedRevisionId" = revision."id"
        OR (revision."submittedAt" IS NOT NULL
          AND NOT (job."currentRevisionId" = revision."id"
            AND job."status" = 'CHANGES_REQUESTED'
            AND revision."approvedAt" IS NULL
            AND revision."rejectedAt" IS NULL)))
  ) THEN
    RAISE EXCEPTION 'JobRevision children are immutable after release outside changes requested'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
