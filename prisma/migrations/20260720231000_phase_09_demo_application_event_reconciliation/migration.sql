-- Remove the unreleased demo-only shortcut events before the v5 seed writes
-- complete canonical status chains. LIVE and mixed-provenance evidence is
-- deliberately outside this reconciliation.

BEGIN;

CREATE TEMP TABLE phase09_legacy_demo_application_event_ids (
  "id" uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO phase09_legacy_demo_application_event_ids ("id") VALUES
  ('809ab38c-c991-5268-b697-383b6eadf2c4'),
  ('16b34484-b865-5c9f-9520-c61ec65c694b'),
  ('384792bf-dbe7-585e-ae90-f87163981c56'),
  ('6c69a956-132a-5679-9fbc-5b62cfbc5d64'),
  ('c90eafe5-4287-51e0-8973-644438766f87'),
  ('3460980d-4b80-59ab-9fd5-1cf4d1852d43'),
  ('c40ec542-5f95-565a-a73e-8beacb51c2ca'),
  ('04f98c45-af55-580c-a181-63bdfa6dd40e'),
  ('f78ca49b-e011-5aa9-8711-3eabd2e51838'),
  ('27ba4109-61d0-5f76-92cb-a42d5f603cad'),
  ('9490243d-97b4-5603-8598-2d13f3c3fca4'),
  ('900c2b32-c7ea-568a-a65a-a15a9709be67'),
  ('7b20d528-50cc-55e3-995a-5456f69be835'),
  ('7c748a5f-7478-51e2-99fd-7fc268210baf'),
  ('ac558276-39f6-5980-81a9-3530055eb61f'),
  ('3bd56394-8b08-545f-ae0c-90d5982a16fc'),
  ('ccafd07c-520a-5456-8c18-596afa80f5e5'),
  ('228d5ec9-0f2a-5df6-a966-ec2129205a41'),
  ('3a6505b3-dbb4-5f6b-908c-979e6cca5e96'),
  ('2f576387-f548-5e27-88e4-88f5d5180551');

ALTER TABLE "ApplicationEvent" DISABLE TRIGGER USER;

DELETE FROM "ApplicationEvent" AS event
USING
  phase09_legacy_demo_application_event_ids AS legacy_seed,
  "Application" AS application,
  "CandidateProfile" AS candidate_profile,
  "User" AS candidate_user,
  "Job" AS job
WHERE legacy_seed."id" = event."id"
  AND event."applicationId" = application."id"
  AND candidate_profile."id" = application."candidateProfileId"
  AND candidate_user."id" = candidate_profile."userId"
  AND job."id" = application."jobId"
  AND event."kind" = 'STATUS_CHANGE'
  AND event."metadata" ->> 'source' = 'demo-pipeline-history'
  AND candidate_user."dataProvenance" = 'DEMO'
  AND job."dataProvenance" = 'DEMO';

ALTER TABLE "ApplicationEvent" ENABLE TRIGGER USER;

COMMIT;
