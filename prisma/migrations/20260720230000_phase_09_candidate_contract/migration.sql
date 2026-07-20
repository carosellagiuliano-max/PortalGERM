-- Phase 09 candidate workflow contract hardening.

BEGIN;

CREATE TYPE "WorkPermitType" AS ENUM (
  'SWISS_OR_EU_EFTA', 'B', 'C', 'G', 'L', 'F', 'N', 'S', 'OTHER'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CandidateProfile"
    WHERE char_length(COALESCE("summary", '')) > 500
  ) THEN
    RAISE EXCEPTION 'Candidate summaries must be shortened to 500 characters before Phase 09';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Application"
    WHERE char_length(COALESCE("coverLetter", '')) > 4000
  ) OR EXISTS (
    SELECT 1 FROM "ApplicationSubmissionSnapshot"
    WHERE char_length(COALESCE("coverLetterSnapshot", '')) > 4000
  ) THEN
    RAISE EXCEPTION 'Application cover letters must be shortened to 4000 characters before Phase 09';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ApplicationCandidateNote"
    WHERE char_length("body") > 1000
  ) THEN
    RAISE EXCEPTION 'Candidate notes must be shortened to 1000 characters before Phase 09';
  END IF;
END
$$;

ALTER TABLE "CandidateProfile"
  ALTER COLUMN "summary" TYPE varchar(500),
  ADD COLUMN "workPermitType" "WorkPermitType";

ALTER TABLE "Application"
  ALTER COLUMN "coverLetter" TYPE varchar(4000),
  ADD COLUMN "idempotencyKey" varchar(128) NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "submissionPayloadHash" char(64);

UPDATE "Application"
SET "submissionPayloadHash" = md5("id"::text) || md5('phase09-submission:' || "id"::text)
WHERE "submissionPayloadHash" IS NULL;

ALTER TABLE "Application"
  ALTER COLUMN "submissionPayloadHash" SET NOT NULL,
  ADD CONSTRAINT "application_submission_payload_hash_check"
    CHECK ("submissionPayloadHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "application_idempotency_key_check"
    CHECK (char_length(btrim("idempotencyKey")) BETWEEN 8 AND 128);

CREATE UNIQUE INDEX "Application_candidateProfileId_idempotencyKey_key"
  ON "Application" ("candidateProfileId", "idempotencyKey");

ALTER TABLE "ApplicationSubmissionSnapshot"
  ALTER COLUMN "coverLetterSnapshot" TYPE varchar(4000),
  ADD COLUMN "confirmationSnapshotHash" char(64);

ALTER TABLE "ApplicationSubmissionSnapshot" DISABLE TRIGGER USER;
UPDATE "ApplicationSubmissionSnapshot"
SET "confirmationSnapshotHash" =
  md5("applicationId"::text) || md5('phase09-confirmation:' || "applicationId"::text)
WHERE "confirmationSnapshotHash" IS NULL;
ALTER TABLE "ApplicationSubmissionSnapshot" ENABLE TRIGGER USER;

ALTER TABLE "ApplicationSubmissionSnapshot"
  ALTER COLUMN "confirmationSnapshotHash" SET NOT NULL,
  ADD CONSTRAINT "application_confirmation_snapshot_hash_check"
    CHECK ("confirmationSnapshotHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ApplicationSubmissionDocument"
  ADD COLUMN "safeFilenameSnapshot" varchar(255),
  ADD COLUMN "mimeTypeSnapshot" varchar(128),
  ADD COLUMN "sizeBytesSnapshot" integer,
  ADD COLUMN "storageKeyHash" char(64);

ALTER TABLE "ApplicationSubmissionDocument" DISABLE TRIGGER USER;
UPDATE "ApplicationSubmissionDocument" AS submission_document
SET
  "safeFilenameSnapshot" = document."safeFilename",
  "mimeTypeSnapshot" = document."mimeType",
  "sizeBytesSnapshot" = document."sizeBytes",
  "storageKeyHash" = md5(document."storageKey") || md5('phase09-storage:' || document."storageKey")
FROM "CandidateDocumentMetadata" AS document
WHERE document."id" = submission_document."documentMetadataId";
ALTER TABLE "ApplicationSubmissionDocument" ENABLE TRIGGER USER;

ALTER TABLE "ApplicationSubmissionDocument"
  ALTER COLUMN "safeFilenameSnapshot" SET NOT NULL,
  ALTER COLUMN "mimeTypeSnapshot" SET NOT NULL,
  ALTER COLUMN "sizeBytesSnapshot" SET NOT NULL,
  ALTER COLUMN "storageKeyHash" SET NOT NULL,
  ADD CONSTRAINT "application_submission_document_snapshot_check"
    CHECK (
      char_length(btrim("safeFilenameSnapshot")) BETWEEN 1 AND 255
      AND char_length(btrim("mimeTypeSnapshot")) BETWEEN 1 AND 128
      AND "sizeBytesSnapshot" BETWEEN 1 AND 5242880
      AND "storageKeyHash" ~ '^[0-9a-f]{64}$'
    );

CREATE FUNCTION phase09_enforce_application_document_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  document_row "CandidateDocumentMetadata"%ROWTYPE;
BEGIN
  SELECT * INTO document_row
  FROM "CandidateDocumentMetadata"
  WHERE "id" = NEW."documentMetadataId";

  IF document_row."id" IS NULL
    OR NEW."safeFilenameSnapshot" IS DISTINCT FROM document_row."safeFilename"
    OR NEW."mimeTypeSnapshot" IS DISTINCT FROM document_row."mimeType"
    OR NEW."sizeBytesSnapshot" IS DISTINCT FROM document_row."sizeBytes"
    OR NEW."storageKeyHash" IS DISTINCT FROM (
      md5(document_row."storageKey") || md5('phase09-storage:' || document_row."storageKey")
    ) THEN
    RAISE EXCEPTION 'Application document snapshot must match the selected metadata'
      USING ERRCODE = '23514', CONSTRAINT = 'application_submission_document_snapshot_match';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_application_document_snapshot_trigger
BEFORE INSERT ON "ApplicationSubmissionDocument"
FOR EACH ROW EXECUTE FUNCTION phase09_enforce_application_document_snapshot();

ALTER TABLE "ApplicationEvent"
  ADD COLUMN "idempotencyKey" varchar(128) NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "correlationId" varchar(128) NOT NULL DEFAULT gen_random_uuid()::text,
  ADD CONSTRAINT "application_event_idempotency_key_check"
    CHECK (char_length(btrim("idempotencyKey")) BETWEEN 8 AND 128),
  ADD CONSTRAINT "application_event_correlation_id_check"
    CHECK (char_length(btrim("correlationId")) BETWEEN 8 AND 128);

CREATE UNIQUE INDEX "ApplicationEvent_idempotencyKey_key"
  ON "ApplicationEvent" ("idempotencyKey");

ALTER TABLE "ApplicationCandidateNote"
  ALTER COLUMN "body" TYPE varchar(1000);

CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key"
  ON "ConversationParticipant" ("conversationId", "userId");

CREATE UNIQUE INDEX "ConversationParticipant_conversationId_companyId_key"
  ON "ConversationParticipant" ("conversationId", "companyId");

CREATE FUNCTION phase09_enforce_conversation_user_participant_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_user_id uuid;
BEGIN
  IF NEW."kind" <> 'USER' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(application_candidate."userId", radar_candidate."userId")
  INTO expected_user_id
  FROM "Conversation" AS conversation
  LEFT JOIN "Application" AS application
    ON application."id" = conversation."applicationId"
  LEFT JOIN "CandidateProfile" AS application_candidate
    ON application_candidate."id" = application."candidateProfileId"
  LEFT JOIN "EmployerContactRequest" AS contact_request
    ON contact_request."id" = conversation."contactRequestId"
  LEFT JOIN "CandidateProfile" AS radar_candidate
    ON radar_candidate."id" = contact_request."candidateProfileId"
  WHERE conversation."id" = NEW."conversationId";

  IF expected_user_id IS NULL OR NEW."userId" IS DISTINCT FROM expected_user_id THEN
    RAISE EXCEPTION 'Conversation USER participant must be the scoped Candidate owner'
      USING ERRCODE = '23514', CONSTRAINT = 'conversation_user_participant_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_conversation_user_participant_scope_trigger
BEFORE INSERT OR UPDATE ON "ConversationParticipant"
FOR EACH ROW EXECUTE FUNCTION phase09_enforce_conversation_user_participant_scope();

ALTER TABLE "Message"
  ADD COLUMN "idempotencyKey" varchar(128) NOT NULL DEFAULT gen_random_uuid()::text,
  ADD CONSTRAINT "message_idempotency_key_check"
    CHECK (char_length(btrim("idempotencyKey")) BETWEEN 8 AND 128);

CREATE UNIQUE INDEX "Message_idempotencyKey_key"
  ON "Message" ("idempotencyKey");

CREATE FUNCTION phase09_enforce_message_sender_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owning_company_id uuid;
  sender_active boolean;
  candidate_participant boolean;
  company_sender boolean;
BEGIN
  SELECT ("status" = 'ACTIVE') INTO sender_active
  FROM "User" WHERE "id" = NEW."senderUserId";

  SELECT conversation."companyId" INTO owning_company_id
  FROM "Conversation" AS conversation
  WHERE conversation."id" = NEW."conversationId";

  SELECT EXISTS (
    SELECT 1 FROM "ConversationParticipant"
    WHERE "conversationId" = NEW."conversationId"
      AND "kind" = 'USER'
      AND "userId" = NEW."senderUserId"
      AND "leftAt" IS NULL
  ) INTO candidate_participant;

  SELECT EXISTS (
    SELECT 1
    FROM "ConversationParticipant" AS participant
    JOIN "CompanyMembership" AS membership
      ON membership."companyId" = participant."companyId"
    WHERE participant."conversationId" = NEW."conversationId"
      AND participant."kind" = 'COMPANY_PRINCIPAL'
      AND participant."companyId" = owning_company_id
      AND participant."leftAt" IS NULL
      AND membership."userId" = NEW."senderUserId"
      AND membership."status" = 'ACTIVE'
  ) INTO company_sender;

  IF NOT COALESCE(sender_active, false)
    OR NOT (COALESCE(candidate_participant, false) OR COALESCE(company_sender, false)) THEN
    RAISE EXCEPTION 'Message sender must be an active scoped conversation participant'
      USING ERRCODE = '23514', CONSTRAINT = 'message_sender_participant_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_message_sender_scope_trigger
BEFORE INSERT OR UPDATE OF "conversationId", "senderUserId" ON "Message"
FOR EACH ROW EXECUTE FUNCTION phase09_enforce_message_sender_scope();

CREATE FUNCTION phase09_touch_conversation_after_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Conversation"
  SET "updatedAt" = GREATEST("updatedAt", NEW."createdAt", CURRENT_TIMESTAMP)
  WHERE "id" = NEW."conversationId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_touch_conversation_after_message_trigger
AFTER INSERT ON "Message"
FOR EACH ROW EXECUTE FUNCTION phase09_touch_conversation_after_message();

ALTER TABLE "RadarProfile"
  ADD COLUMN "availabilityBucket" varchar(32),
  ADD CONSTRAINT "radar_profile_availability_bucket_check"
    CHECK (
      "availabilityBucket" IS NULL OR "availabilityBucket" IN (
        'NOW', 'WITHIN_30_DAYS', 'WITHIN_90_DAYS', 'LATER', 'UNKNOWN'
      )
    );

CREATE FUNCTION phase09_withdraw_candidate_radar(candidate_profile_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "RadarProfile"
  SET "withdrawnAt" = COALESCE("withdrawnAt", CURRENT_TIMESTAMP)
  WHERE "candidateProfileId" = candidate_profile_id
    AND "publishedAt" IS NOT NULL
    AND "withdrawnAt" IS NULL;
END;
$$;

CREATE FUNCTION phase09_withdraw_radar_after_consent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" = 'TALENT_RADAR_VISIBILITY' AND NEW."granted" = false THEN
    PERFORM phase09_withdraw_candidate_radar(NEW."candidateProfileId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_withdraw_radar_after_consent_trigger
AFTER INSERT ON "CandidateConsent"
FOR EACH ROW EXECUTE FUNCTION phase09_withdraw_radar_after_consent();

CREATE FUNCTION phase09_withdraw_radar_after_onboarding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."onboardingStatus" = 'DRAFT' AND OLD."onboardingStatus" = 'COMPLETE' THEN
    PERFORM phase09_withdraw_candidate_radar(NEW."id");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_withdraw_radar_after_onboarding_trigger
AFTER UPDATE OF "onboardingStatus" ON "CandidateProfile"
FOR EACH ROW EXECUTE FUNCTION phase09_withdraw_radar_after_onboarding();

CREATE FUNCTION phase09_withdraw_radar_after_user_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  profile_id uuid;
BEGIN
  IF NEW."status" <> 'ACTIVE' AND OLD."status" = 'ACTIVE' THEN
    SELECT "id" INTO profile_id FROM "CandidateProfile" WHERE "userId" = NEW."id";
    IF profile_id IS NOT NULL THEN
      PERFORM phase09_withdraw_candidate_radar(profile_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_withdraw_radar_after_user_status_trigger
AFTER UPDATE OF "status" ON "User"
FOR EACH ROW EXECUTE FUNCTION phase09_withdraw_radar_after_user_status();

CREATE FUNCTION phase09_enforce_notification_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."recipientUserId" IS DISTINCT FROM NEW."recipientUserId"
    OR OLD."kind" IS DISTINCT FROM NEW."kind"
    OR OLD."schemaVersion" IS DISTINCT FROM NEW."schemaVersion"
    OR OLD."payload" IS DISTINCT FROM NEW."payload"
    OR OLD."dedupeKey" IS DISTINCT FROM NEW."dedupeKey"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Notification identity and payload are immutable; only readAt may change'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_payload_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase09_notification_immutable_trigger
BEFORE UPDATE ON "Notification"
FOR EACH ROW EXECUTE FUNCTION phase09_enforce_notification_immutable();

CREATE OR REPLACE FUNCTION enforce_application_submission_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."jobId" IS DISTINCT FROM NEW."jobId"
    OR OLD."submittedJobRevisionId" IS DISTINCT FROM NEW."submittedJobRevisionId"
    OR OLD."candidateProfileId" IS DISTINCT FROM NEW."candidateProfileId"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."submissionPayloadHash" IS DISTINCT FROM NEW."submissionPayloadHash"
    OR OLD."coverLetter" IS DISTINCT FROM NEW."coverLetter"
    OR OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt" THEN
    RAISE EXCEPTION 'Application submission identity and content are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'application_submission_immutable';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
