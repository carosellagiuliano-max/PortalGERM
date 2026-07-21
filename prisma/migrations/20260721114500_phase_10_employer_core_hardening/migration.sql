-- Phase 10 follow-up invariants found by the release migration audit.
-- Existing data is checked explicitly before constraints/triggers are tightened.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "JobRevision"
    WHERE ("approvedAt" IS NOT NULL AND "rejectedAt" IS NOT NULL)
      OR (("approvedAt" IS NOT NULL OR "rejectedAt" IS NOT NULL)
        AND "submittedAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Existing JobRevision review timestamps violate the Phase 10 lifecycle'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_review_timestamps_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CompanyInvitation"
    WHERE (("status" = 'ACCEPTED') <> ("acceptedAt" IS NOT NULL))
      OR (("status" = 'ACCEPTED') <> ("acceptedByUserId" IS NOT NULL))
      OR (("status" = 'REVOKED') <> ("revokedAt" IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Existing CompanyInvitation lifecycle projections are inconsistent'
      USING ERRCODE = '23514', CONSTRAINT = 'company_invitation_lifecycle_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CompanyVerificationRequest" AS child
    JOIN "CompanyVerificationRequest" AS previous
      ON previous.id = child."supersedesRequestId"
      AND previous."companyId" = child."companyId"
    WHERE previous.status NOT IN ('REJECTED', 'REVOKED')
  ) THEN
    RAISE EXCEPTION 'Existing verification supersession points to a non-terminal cycle'
      USING ERRCODE = '23514', CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "JobReportingCheck" AS reporting
    JOIN "OccupationCodeVersion" AS version
      ON version.id = reporting."occupationCodeVersionId"
    LEFT JOIN "OccupationCode" AS occupation
      ON occupation.id = reporting."occupationCodeId"
      AND occupation."occupationCodeVersionId" = reporting."occupationCodeVersionId"
    WHERE reporting."datasetVersionSnapshot" IS DISTINCT FROM version.version
      OR reporting."dataYearSnapshot" IS DISTINCT FROM version."datasetYear"
      OR reporting."referenceUrlSnapshot" IS DISTINCT FROM version."referenceUrl"
      OR (reporting."sourceSnapshot" IS DISTINCT FROM version.source
        AND reporting."sourceSnapshot" IS DISTINCT FROM
          (version.source || ' | ' || COALESCE(version."referenceUrl", 'no-reference-url')))
      OR reporting."disclaimerSnapshot" IS DISTINCT FROM version.disclaimer
      OR (reporting."occupationCodeId" IS NOT NULL AND (
        occupation.id IS NULL
        OR reporting."occupationCodeSnapshot" IS DISTINCT FROM occupation.code
        OR reporting."occupationLabelSnapshot" IS DISTINCT FROM occupation.label
        OR reporting.result IS DISTINCT FROM occupation.result
      ))
  ) THEN
    RAISE EXCEPTION 'Existing JobReportingCheck snapshots do not match their versioned source'
      USING ERRCODE = '23514', CONSTRAINT = 'job_reporting_snapshot_consistency';
  END IF;
END;
$$;

ALTER TABLE "JobRevision"
  ALTER COLUMN "niceToHave" DROP DEFAULT,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "CompanyVerificationRequest"
  RENAME CONSTRAINT "company_verification_id_company_unique"
  TO "CompanyVerificationRequest_id_companyId_key";
ALTER TABLE "CompanyVerificationRequest"
  RENAME CONSTRAINT "company_verification_supersedes_company_unique"
  TO "CompanyVerificationRequest_supersedesRequestId_companyId_key";

ALTER TABLE "CompanyInvitation"
  DROP CONSTRAINT "company_invitation_lifecycle_check";
ALTER TABLE "CompanyInvitation"
  ADD CONSTRAINT "company_invitation_lifecycle_check"
  CHECK (
    "createdAt" < "expiresAt"
    AND (("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL))
    AND (("status" = 'ACCEPTED') = ("acceptedByUserId" IS NOT NULL))
    AND (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL))
  );

ALTER TABLE "JobRevision"
  ADD CONSTRAINT "job_revision_review_timestamps_check"
  CHECK (
    NOT ("approvedAt" IS NOT NULL AND "rejectedAt" IS NOT NULL)
    AND ("approvedAt" IS NULL OR "submittedAt" IS NOT NULL)
    AND ("rejectedAt" IS NULL OR "submittedAt" IS NOT NULL)
  );

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
      OR (to_jsonb(OLD) - ARRAY['approvedAt', 'rejectedAt', 'updatedAt'])
        IS DISTINCT FROM
        (to_jsonb(NEW) - ARRAY['approvedAt', 'rejectedAt', 'updatedAt'])
      OR (OLD."approvedAt" IS NOT NULL
        AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt")
      OR (OLD."rejectedAt" IS NOT NULL
        AND NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt")
      OR (NEW."approvedAt" IS NOT NULL AND NEW."rejectedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'JobRevision is immutable after release outside monotone moderation timestamps'
        USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
    END IF;
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

  SELECT ARRAY(
    SELECT DISTINCT revision_id
    FROM unnest(revision_ids) AS revision_ids_to_lock(revision_id)
    WHERE revision_id IS NOT NULL
    ORDER BY revision_id
  ) INTO revision_ids;

  PERFORM 1
  FROM "JobRevision"
  WHERE id = ANY(revision_ids)
  ORDER BY id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM "JobRevision" AS revision
    WHERE revision.id = ANY(revision_ids)
      AND (revision."submittedAt" IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM "Job"
          WHERE "publishedRevisionId" = revision.id
            OR ("currentRevisionId" = revision.id AND status = 'PUBLISHED')
        ))
  ) THEN
    RAISE EXCEPTION 'JobRevision children are immutable after release'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_verification_predecessor_terminal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('REJECTED', 'REVOKED')
    AND EXISTS (
      SELECT 1
      FROM "CompanyVerificationRequest" AS child
      WHERE child."supersedesRequestId" = NEW.id
        AND child."companyId" = NEW."companyId"
    ) THEN
    RAISE EXCEPTION 'A superseded verification cycle must remain terminal'
      USING ERRCODE = '23514', CONSTRAINT = 'company_verification_supersession_terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_verification_predecessor_terminal_trigger
BEFORE UPDATE OF status ON "CompanyVerificationRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_verification_predecessor_terminal();

CREATE FUNCTION enforce_job_reporting_snapshot_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_row "OccupationCodeVersion"%ROWTYPE;
  occupation_row "OccupationCode"%ROWTYPE;
BEGIN
  SELECT * INTO version_row
  FROM "OccupationCodeVersion"
  WHERE id = NEW."occupationCodeVersionId";

  IF NOT FOUND
    OR NEW."datasetVersionSnapshot" IS DISTINCT FROM version_row.version
    OR NEW."dataYearSnapshot" IS DISTINCT FROM version_row."datasetYear"
    OR NEW."referenceUrlSnapshot" IS DISTINCT FROM version_row."referenceUrl"
    OR (NEW."sourceSnapshot" IS DISTINCT FROM version_row.source
      AND NEW."sourceSnapshot" IS DISTINCT FROM
        (version_row.source || ' | ' || COALESCE(version_row."referenceUrl", 'no-reference-url')))
    OR NEW."disclaimerSnapshot" IS DISTINCT FROM version_row.disclaimer THEN
    RAISE EXCEPTION 'JobReportingCheck version snapshots must match the referenced dataset'
      USING ERRCODE = '23514', CONSTRAINT = 'job_reporting_snapshot_consistency';
  END IF;

  IF NEW."occupationCodeId" IS NOT NULL THEN
    SELECT * INTO occupation_row
    FROM "OccupationCode"
    WHERE id = NEW."occupationCodeId"
      AND "occupationCodeVersionId" = NEW."occupationCodeVersionId";

    IF NOT FOUND
      OR NEW."occupationCodeSnapshot" IS DISTINCT FROM occupation_row.code
      OR NEW."occupationLabelSnapshot" IS DISTINCT FROM occupation_row.label
      OR NEW.result IS DISTINCT FROM occupation_row.result THEN
      RAISE EXCEPTION 'JobReportingCheck code snapshots must match the referenced occupation'
        USING ERRCODE = '23514', CONSTRAINT = 'job_reporting_snapshot_consistency';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_reporting_snapshot_consistency_trigger
BEFORE INSERT OR UPDATE ON "JobReportingCheck"
FOR EACH ROW EXECUTE FUNCTION enforce_job_reporting_snapshot_consistency();
