-- Remove only the unreleased v3 demo JobAlert commit artifacts before the v5
-- seed recreates them under JOB_ALERT_POLICY_V1. LIVE and mixed-provenance
-- evidence is deliberately outside this reconciliation.

BEGIN;

CREATE TEMP TABLE phase09_legacy_demo_job_alert_ids (
  "id" uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO phase09_legacy_demo_job_alert_ids ("id") VALUES
  ('8a3eabbe-c64e-56e9-a959-4b84adc2d032'),
  ('c9915f0d-b9a2-5871-af80-dc288a1c49a7'),
  ('4891603f-f30d-5ae6-8017-8a3478f124ea'),
  ('74ae7add-0b6a-58df-93d1-0c819bcede27'),
  ('47920fd1-e831-53af-ab71-f9852d8ca1f3'),
  ('b28798fd-8e29-5e22-b2c5-d676a362d04b'),
  ('147d6b19-a7e1-584e-adbe-607450fe4231'),
  ('195ed5c4-4a94-51f3-a851-165f6c5d34ca'),
  ('b9fcba52-ccbe-561b-8059-61895b1044a0'),
  ('f7f6b36b-42fb-5c74-9c98-5b1edc9a1db7'),
  ('e44a3baf-06cb-50b9-8836-428193ba4bda'),
  ('22e596a7-dfca-5cad-984c-0bf52269be32'),
  ('24901f3a-dcd1-585d-af5a-847b657240d0'),
  ('a56519a8-ab36-555b-90b9-c278320ad57e'),
  ('f0aba00f-9cd8-5a8e-9b70-bc072b3dca36');

ALTER TABLE "JobAlertEvent" DISABLE TRIGGER USER;
ALTER TABLE "JobAlertDigestItem" DISABLE TRIGGER USER;

DELETE FROM "JobAlertEvent" AS event
USING
  phase09_legacy_demo_job_alert_ids AS legacy_seed,
  "JobAlert" AS alert,
  "CandidateProfile" AS candidate_profile,
  "User" AS candidate_user,
  "JobAlertDigest" AS digest
WHERE legacy_seed."id" = alert."id"
  AND event."jobAlertId" = alert."id"
  AND digest."jobAlertId" = alert."id"
  AND candidate_profile."id" = alert."candidateProfileId"
  AND candidate_user."id" = candidate_profile."userId"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND digest."policyVersion" = 'job-alert-digest-v1'
  AND NOT EXISTS (
    SELECT 1
    FROM "JobAlertDigestItem" AS scoped_item
    JOIN "Job" AS scoped_job ON scoped_job."id" = scoped_item."jobId"
    WHERE scoped_item."jobAlertId" = alert."id"
      AND scoped_job."dataProvenance" <> 'DEMO'
  )
  AND (
    (event."kind" = 'CREATED' AND event."reasonCode" IS NULL)
    OR event."reasonCode" = 'demo-lifecycle'
  );

DELETE FROM "JobAlertDigestItem" AS item
USING
  phase09_legacy_demo_job_alert_ids AS legacy_seed,
  "JobAlertDigest" AS digest,
  "JobAlert" AS alert,
  "CandidateProfile" AS candidate_profile,
  "User" AS candidate_user
WHERE legacy_seed."id" = alert."id"
  AND item."digestId" = digest."id"
  AND alert."id" = digest."jobAlertId"
  AND candidate_profile."id" = alert."candidateProfileId"
  AND candidate_user."id" = candidate_profile."userId"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND digest."policyVersion" = 'job-alert-digest-v1'
  AND NOT EXISTS (
    SELECT 1
    FROM "JobAlertDigestItem" AS scoped_item
    JOIN "Job" AS scoped_job ON scoped_job."id" = scoped_item."jobId"
    WHERE scoped_item."jobAlertId" = alert."id"
      AND scoped_job."dataProvenance" <> 'DEMO'
  );

DELETE FROM "JobAlertUnsubscribeToken" AS token
USING
  phase09_legacy_demo_job_alert_ids AS legacy_seed,
  "JobAlertDigest" AS digest,
  "JobAlert" AS alert,
  "CandidateProfile" AS candidate_profile,
  "User" AS candidate_user
WHERE legacy_seed."id" = alert."id"
  AND token."digestId" = digest."id"
  AND alert."id" = digest."jobAlertId"
  AND candidate_profile."id" = alert."candidateProfileId"
  AND candidate_user."id" = candidate_profile."userId"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND digest."policyVersion" = 'job-alert-digest-v1'
  AND NOT EXISTS (
    SELECT 1
    FROM "JobAlertDigestItem" AS scoped_item
    JOIN "Job" AS scoped_job ON scoped_job."id" = scoped_item."jobId"
    WHERE scoped_item."jobAlertId" = alert."id"
      AND scoped_job."dataProvenance" <> 'DEMO'
  );

DELETE FROM "JobAlertDigest" AS digest
USING
  phase09_legacy_demo_job_alert_ids AS legacy_seed,
  "JobAlert" AS alert,
  "CandidateProfile" AS candidate_profile,
  "User" AS candidate_user
WHERE legacy_seed."id" = alert."id"
  AND alert."id" = digest."jobAlertId"
  AND candidate_profile."id" = alert."candidateProfileId"
  AND candidate_user."id" = candidate_profile."userId"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND digest."policyVersion" = 'job-alert-digest-v1'
  AND NOT EXISTS (
    SELECT 1
    FROM "JobAlertDigestItem" AS scoped_item
    JOIN "Job" AS scoped_job ON scoped_job."id" = scoped_item."jobId"
    WHERE scoped_item."jobAlertId" = alert."id"
      AND scoped_job."dataProvenance" <> 'DEMO'
  );

ALTER TABLE "JobAlertDigestItem" ENABLE TRIGGER USER;
ALTER TABLE "JobAlertEvent" ENABLE TRIGGER USER;

COMMIT;
