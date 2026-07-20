-- Replace Phase-09 upgrade sentinels with reproducible content hashes where a

BEGIN;
-- complete immutable snapshot exists. Any legacy Application without a
-- snapshot stays explicitly versioned as legacy instead of pretending that an
-- id-derived sentinel is content evidence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "Application"
  ADD COLUMN "submissionPayloadHashVersion" varchar(48) NOT NULL
    DEFAULT 'legacy-id-derived-v1';

ALTER TABLE "ApplicationSubmissionSnapshot"
  ADD COLUMN "confirmationSnapshotHashVersion" varchar(48) NOT NULL
    DEFAULT 'legacy-id-derived-v1';

ALTER TABLE "ApplicationSubmissionSnapshot" DISABLE TRIGGER USER;

UPDATE "ApplicationSubmissionSnapshot" AS snapshot
SET
  "confirmationSnapshotHash" = encode(
    digest(
      '{"version":' || to_json(snapshot."confirmationNoticeVersion"::text)::text ||
      ',"noticeHash":' || to_json(snapshot."confirmationNoticeHash"::text)::text ||
      ',"candidate":{"firstName":' || to_json(snapshot."candidateFirstName"::text)::text ||
      ',"lastName":' || to_json(snapshot."candidateLastName"::text)::text ||
      ',"email":' || to_json(snapshot."candidateEmail"::text)::text ||
      '},"recipient":{"companyName":' || to_json(snapshot."recipientCompanyName"::text)::text ||
      ',"contactKind":' || to_json(snapshot."applicationContactKind"::text)::text ||
      ',"contactValue":' || to_json(snapshot."applicationContactValue"::text)::text ||
      '},"job":{"revisionId":' || to_json(snapshot."jobRevisionId"::text)::text ||
      ',"slug":' || to_json(job."slug"::text)::text ||
      ',"title":' || to_json(revision."title"::text)::text ||
      ',"responseTargetDays":' || snapshot."responseTargetDays"::text ||
      ',"applicationEffort":' || to_json(snapshot."applicationEffort"::text)::text ||
      ',"requiredDocumentKinds":' || array_to_json(snapshot."requiredDocumentKinds")::text ||
      '}}',
      'sha256'
    ),
    'hex'
  ),
  "confirmationSnapshotHashVersion" = 'application-confirmation-snapshot-v1'
FROM "JobRevision" AS revision
JOIN "Job" AS job ON job."id" = revision."jobId"
WHERE revision."id" = snapshot."jobRevisionId";

ALTER TABLE "ApplicationSubmissionSnapshot" ENABLE TRIGGER USER;

ALTER TABLE "Application" DISABLE TRIGGER USER;

UPDATE "Application" AS application
SET
  "submissionPayloadHash" = encode(
    digest(
      '{"version":"application-submission-payload-v1"' ||
      ',"confirmationSnapshotHash":' || to_json(snapshot."confirmationSnapshotHash"::text)::text ||
      ',"coverLetter":' || COALESCE(to_json(application."coverLetter"::text)::text, 'null') ||
      ',"selectedDocumentIds":[' || COALESCE((
        SELECT string_agg(
          to_json(document."documentMetadataId"::text)::text,
          ',' ORDER BY document."documentMetadataId"
        )
        FROM "ApplicationSubmissionDocument" AS document
        WHERE document."applicationId" = application."id"
      ), '') || ']}',
      'sha256'
    ),
    'hex'
  ),
  "submissionPayloadHashVersion" = 'application-submission-payload-v1'
FROM "ApplicationSubmissionSnapshot" AS snapshot
WHERE snapshot."applicationId" = application."id";

ALTER TABLE "Application" ENABLE TRIGGER USER;

ALTER TABLE "Application"
  ALTER COLUMN "submissionPayloadHashVersion"
    SET DEFAULT 'application-submission-payload-v1';

ALTER TABLE "ApplicationSubmissionSnapshot"
  ALTER COLUMN "confirmationSnapshotHashVersion"
    SET DEFAULT 'application-confirmation-snapshot-v1';

CREATE OR REPLACE FUNCTION enforce_application_submission_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."jobId" IS DISTINCT FROM NEW."jobId"
    OR OLD."submittedJobRevisionId" IS DISTINCT FROM NEW."submittedJobRevisionId"
    OR OLD."candidateProfileId" IS DISTINCT FROM NEW."candidateProfileId"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."submissionPayloadHash" IS DISTINCT FROM NEW."submissionPayloadHash"
    OR OLD."submissionPayloadHashVersion" IS DISTINCT FROM NEW."submissionPayloadHashVersion"
    OR OLD."coverLetter" IS DISTINCT FROM NEW."coverLetter"
    OR OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt" THEN
    RAISE EXCEPTION 'Application submission identity and content are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'application_submission_immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "Application"
  ADD CONSTRAINT "application_submission_payload_hash_version_check"
    CHECK (
      "submissionPayloadHashVersion" IN (
        'legacy-id-derived-v1',
        'application-submission-payload-v1'
      )
    );

ALTER TABLE "ApplicationSubmissionSnapshot"
  ADD CONSTRAINT "application_confirmation_snapshot_hash_version_check"
    CHECK (
      "confirmationSnapshotHashVersion" IN (
        'legacy-id-derived-v1',
        'application-confirmation-snapshot-v1'
      )
    );

COMMIT;
