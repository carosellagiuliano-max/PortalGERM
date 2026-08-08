-- Phase 34: PostgreSQL computes stored generated columns after BEFORE UPDATE
-- triggers. Exclude only the derived searchDocument value from the released
-- revision comparison; every authored source column remains immutable.
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
      OR (to_jsonb(OLD) - ARRAY[
          'approvedAt',
          'rejectedAt',
          'updatedAt',
          'version',
          'searchDocument'
        ]) IS DISTINCT FROM
        (to_jsonb(NEW) - ARRAY[
          'approvedAt',
          'rejectedAt',
          'updatedAt',
          'version',
          'searchDocument'
        ])
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
