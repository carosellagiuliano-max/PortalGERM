-- Reconcile Radar visibility against the latest currently-effective consent.
-- The hash is the SHA-256 digest of the NFC-normalized talent-radar-v1 notice.

BEGIN;

-- Phase-02 demo/test fixtures used a placeholder digest instead of the notice
-- digest. Correct only that known non-live fixture signature before enforcing
-- the canonical contract; live consent evidence is never rewritten.
ALTER TABLE "CandidateConsent" DISABLE TRIGGER USER;
UPDATE "CandidateConsent" AS consent
SET "noticeHash" = '1a67dc35ea6177523054b5631291883ffb5598dd4bb584a84a464405612fb2e3'
FROM "CandidateProfile" AS candidate_profile
JOIN "User" AS candidate_user
  ON candidate_user."id" = candidate_profile."userId"
WHERE consent."candidateProfileId" = candidate_profile."id"
  AND consent."actorUserId" = candidate_user."id"
  AND candidate_user."dataProvenance" IN ('DEMO', 'TEST')
  AND consent."kind" = 'TALENT_RADAR_VISIBILITY'
  AND consent."noticeVersion" = 'talent-radar-v1'
  AND consent."noticeHash" = '3a733bd802fac9d1e76251a0ba0ed906487493515d791ea0c4b5fdc7973374f7';
ALTER TABLE "CandidateConsent" ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION phase09_has_current_radar_visibility_consent(
  candidate_profile_id uuid,
  evaluated_at timestamptz
) RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT
      consent."granted"
      AND consent."noticeVersion" = 'talent-radar-v1'
      AND consent."noticeHash" = '1a67dc35ea6177523054b5631291883ffb5598dd4bb584a84a464405612fb2e3'
    FROM "CandidateConsent" AS consent
    WHERE consent."candidateProfileId" = candidate_profile_id
      AND consent."kind" = 'TALENT_RADAR_VISIBILITY'
      AND consent."effectiveAt" <= evaluated_at
    ORDER BY
      consent."effectiveAt" DESC,
      consent."createdAt" DESC
    LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION phase09_candidate_radar_is_publishable(
  candidate_profile_id uuid,
  evaluated_at timestamptz
) RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT
      candidate_user."status" = 'ACTIVE'
      AND candidate_profile."onboardingStatus" = 'COMPLETE'
      AND phase09_has_current_radar_visibility_consent(
        candidate_profile."id",
        evaluated_at
      )
    FROM "CandidateProfile" AS candidate_profile
    JOIN "User" AS candidate_user
      ON candidate_user."id" = candidate_profile."userId"
    WHERE candidate_profile."id" = candidate_profile_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION enforce_radar_profile_eligibility() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."publishedAt" IS NOT NULL
    AND NEW."withdrawnAt" IS NULL
    AND NOT phase09_candidate_radar_is_publishable(
      NEW."candidateProfileId",
      CURRENT_TIMESTAMP
    ) THEN
    RAISE EXCEPTION 'Radar profile is not eligible for publication'
      USING ERRCODE = '23514', CONSTRAINT = 'radar_profile_eligibility_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phase09_withdraw_candidate_radar(
  candidate_profile_id uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE "RadarProfile"
  SET
    "withdrawnAt" = GREATEST(CURRENT_TIMESTAMP, "publishedAt"),
    "updatedAt" = GREATEST("updatedAt", CURRENT_TIMESTAMP, "publishedAt")
  WHERE "candidateProfileId" = candidate_profile_id
    AND "publishedAt" IS NOT NULL
    AND "withdrawnAt" IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION phase09_withdraw_radar_after_consent() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."kind" = 'TALENT_RADAR_VISIBILITY'
    AND NEW."effectiveAt" <= CURRENT_TIMESTAMP
    AND NOT phase09_has_current_radar_visibility_consent(
      NEW."candidateProfileId",
      CURRENT_TIMESTAMP
    ) THEN
    PERFORM phase09_withdraw_candidate_radar(NEW."candidateProfileId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phase09_reconcile_invalid_active_radar(
  evaluated_at timestamptz DEFAULT CURRENT_TIMESTAMP
) RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  reconciled_count integer;
BEGIN
  IF evaluated_at IS NULL THEN
    RAISE EXCEPTION 'Radar reconciliation requires an evaluation timestamp'
      USING ERRCODE = '22004';
  END IF;

  UPDATE "RadarProfile" AS radar_profile
  SET
    "withdrawnAt" = GREATEST(evaluated_at, radar_profile."publishedAt"),
    "updatedAt" = GREATEST(
      radar_profile."updatedAt",
      evaluated_at,
      radar_profile."publishedAt"
    )
  WHERE radar_profile."publishedAt" IS NOT NULL
    AND radar_profile."withdrawnAt" IS NULL
    AND NOT phase09_candidate_radar_is_publishable(
      radar_profile."candidateProfileId",
      evaluated_at
    );

  GET DIAGNOSTICS reconciled_count = ROW_COUNT;
  RETURN reconciled_count;
END;
$$;

SELECT phase09_reconcile_invalid_active_radar(CURRENT_TIMESTAMP);

COMMIT;
