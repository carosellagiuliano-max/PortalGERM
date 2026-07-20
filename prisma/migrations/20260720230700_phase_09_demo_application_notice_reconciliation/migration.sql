-- Reconcile only the deterministic demo Application snapshots that used the

BEGIN;
-- historical seed placeholder instead of the actual confirmation notice text.
-- LIVE evidence is deliberately never rewritten.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "ApplicationSubmissionSnapshot" DISABLE TRIGGER USER;

UPDATE "ApplicationSubmissionSnapshot" AS snapshot
SET "confirmationNoticeHash" = encode(
  digest(
    convert_to(
      'Ich bestätige, dass SwissTalentHub meine oben angezeigten Identitäts- und Bewerbungsdaten für diese konkrete Stelle an das genannte Unternehmen übermitteln und als unveränderbaren Einreichungsnachweis speichern darf.',
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)
FROM "Application" AS application
JOIN "CandidateProfile" AS profile
  ON profile."id" = application."candidateProfileId"
JOIN "User" AS candidate_user
  ON candidate_user."id" = profile."userId"
WHERE snapshot."applicationId" = application."id"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND application."idempotencyKey" LIKE 'seed:application:%'
  AND snapshot."confirmationNoticeVersion" = 'application-confirmation-v1'
  AND snapshot."confirmationNoticeHash" = encode(
    digest(convert_to('application-confirmation-notice-v1', 'UTF8'), 'sha256'),
    'hex'
  );

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
JOIN "Application" AS application
  ON application."submittedJobRevisionId" = revision."id"
JOIN "CandidateProfile" AS profile ON profile."id" = application."candidateProfileId"
JOIN "User" AS candidate_user ON candidate_user."id" = profile."userId"
WHERE revision."id" = snapshot."jobRevisionId"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND application."idempotencyKey" LIKE 'seed:application:%';

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
FROM
  "ApplicationSubmissionSnapshot" AS snapshot,
  "CandidateProfile" AS profile,
  "User" AS candidate_user
WHERE snapshot."applicationId" = application."id"
  AND profile."id" = application."candidateProfileId"
  AND candidate_user."id" = profile."userId"
  AND candidate_user."dataProvenance" = 'DEMO'
  AND application."idempotencyKey" LIKE 'seed:application:%';

ALTER TABLE "Application" ENABLE TRIGGER USER;

COMMIT;
