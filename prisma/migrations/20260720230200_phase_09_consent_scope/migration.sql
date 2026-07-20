-- Consent actors are real users and only the current Radar notice may publish.

BEGIN;

ALTER TABLE "CandidateConsent"
  ADD CONSTRAINT "CandidateConsent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserConsentEvent"
  ADD CONSTRAINT "UserConsentEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_radar_profile_eligibility() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  eligible boolean;
BEGIN
  IF NEW."publishedAt" IS NOT NULL AND NEW."withdrawnAt" IS NULL THEN
    SELECT u."status" = 'ACTIVE' AND cp."onboardingStatus" = 'COMPLETE'
      AND COALESCE((
        SELECT cc."granted" AND cc."noticeVersion" = 'talent-radar-v1'
        FROM "CandidateConsent" cc
        WHERE cc."candidateProfileId" = cp."id"
          AND cc."kind" = 'TALENT_RADAR_VISIBILITY'
          AND cc."effectiveAt" <= CURRENT_TIMESTAMP
        ORDER BY cc."effectiveAt" DESC, cc."createdAt" DESC
        LIMIT 1
      ), false)
      INTO eligible
      FROM "CandidateProfile" cp
      JOIN "User" u ON u."id" = cp."userId"
      WHERE cp."id" = NEW."candidateProfileId";
    IF NOT COALESCE(eligible, false) THEN
      RAISE EXCEPTION 'Radar profile is not eligible for publication'
        USING ERRCODE = '23514', CONSTRAINT = 'radar_profile_eligibility_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
