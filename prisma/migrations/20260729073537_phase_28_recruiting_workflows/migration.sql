-- Phase 28 adds two independent, default-off recruiting tracks. Existing
-- Application rows and legacy INTERVIEW status semantics are not rewritten.

CREATE TYPE "ExternalApplicationStatus" AS ENUM (
  'BEGUN', 'SUBMITTED', 'INTERVIEW', 'OFFER', 'REJECTED', 'HIRED',
  'WITHDRAWN', 'ARCHIVED'
);
CREATE TYPE "ExternalApplicationSource" AS ENUM ('CANDIDATE_CONFIRMED');
CREATE TYPE "ExternalApplicationEventKind" AS ENUM (
  'CREATED', 'STATUS_CHANGED', 'REMINDER_CHANGED', 'ARCHIVED'
);
CREATE TYPE "InterviewStatus" AS ENUM (
  'PROPOSED', 'SCHEDULED', 'RESCHEDULE_PENDING', 'DECLINED', 'CANCELLED',
  'COMPLETED'
);
CREATE TYPE "InterviewProposalStatus" AS ENUM (
  'OPEN', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'CANCELLED', 'EXPIRED'
);
CREATE TYPE "InterviewParticipantKind" AS ENUM (
  'CANDIDATE', 'COMPANY_MEMBER'
);
CREATE TYPE "InterviewParticipantStatus" AS ENUM (
  'PENDING', 'ACCEPTED', 'DECLINED'
);
CREATE TYPE "InterviewResponseKind" AS ENUM (
  'ACCEPT', 'DECLINE', 'RESCHEDULE'
);
CREATE TYPE "InterviewEventKind" AS ENUM (
  'PROPOSED', 'ACCEPTED', 'DECLINED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED',
  'CANCELLED', 'REMINDER_QUEUED', 'REMINDER_SENT', 'REMINDER_FAILED'
);
CREATE TYPE "CalendarArtifactMethod" AS ENUM ('REQUEST', 'CANCEL');
CREATE TYPE "CalendarArtifactStatus" AS ENUM (
  'ACTIVE', 'SUPERSEDED', 'CANCELLED'
);
CREATE TYPE "InterviewReminderStatus" AS ENUM (
  'PENDING', 'QUEUED', 'CANCELLED'
);

ALTER TYPE "AuditAction" ADD VALUE 'EXTERNAL_APPLICATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'EXTERNAL_APPLICATION_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'EXTERNAL_APPLICATION_REMINDER_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'INTERVIEW_PROPOSED';
ALTER TYPE "AuditAction" ADD VALUE 'INTERVIEW_RESPONDED';
ALTER TYPE "AuditAction" ADD VALUE 'INTERVIEW_RESCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE 'INTERVIEW_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'INTERVIEW_REMINDER_PROCESSED';

ALTER TYPE "AuditTargetType" ADD VALUE 'EXTERNAL_APPLICATION_TRACKER';
ALTER TYPE "AuditTargetType" ADD VALUE 'INTERVIEW';
ALTER TYPE "AuditTargetType" ADD VALUE 'INTERVIEW_PROPOSAL';
ALTER TYPE "AuditTargetType" ADD VALUE 'CALENDAR_ARTIFACT';

ALTER TYPE "NotificationKind" ADD VALUE 'EXTERNAL_APPLICATION_CHANGED';
ALTER TYPE "NotificationKind" ADD VALUE 'INTERVIEW_CHANGED';
ALTER TYPE "NotificationKind" ADD VALUE 'INTERVIEW_REMINDER';
ALTER TYPE "NotificationPurpose" ADD VALUE 'EXTERNAL_APPLICATION_REMINDER';
ALTER TYPE "NotificationPurpose" ADD VALUE 'INTERVIEW_SCHEDULING';

CREATE TABLE "ExternalApplicationTracker" (
  "id" UUID NOT NULL,
  "candidateProfileId" UUID NOT NULL,
  "source" "ExternalApplicationSource" NOT NULL DEFAULT 'CANDIDATE_CONFIRMED',
  "status" "ExternalApplicationStatus" NOT NULL DEFAULT 'BEGUN',
  "snapshotFingerprint" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reminderAt" TIMESTAMPTZ(3),
  "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ExternalApplicationTracker_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_tracker_version_check" CHECK ("version" > 0),
  CONSTRAINT "external_tracker_fingerprint_check"
    CHECK ("snapshotFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "external_tracker_archive_check" CHECK (
    ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL AND "reminderAt" IS NULL)
    OR
    ("status" <> 'ARCHIVED' AND "archivedAt" IS NULL)
  )
);

CREATE TABLE "ExternalJobSnapshot" (
  "id" UUID NOT NULL,
  "trackerId" UUID NOT NULL,
  "sourceJobId" UUID NOT NULL,
  "sourceJobRevisionId" UUID NOT NULL,
  "jobSlug" VARCHAR(220) NOT NULL,
  "jobTitle" VARCHAR(200) NOT NULL,
  "companyId" UUID NOT NULL,
  "companyName" VARCHAR(200) NOT NULL,
  "companySlug" VARCHAR(200) NOT NULL,
  "applicationUrl" VARCHAR(512) NOT NULL,
  "applicationUrlHash" CHAR(64) NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "source" "ExternalApplicationSource" NOT NULL DEFAULT 'CANDIDATE_CONFIRMED',
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ExternalJobSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_snapshot_hash_check" CHECK (
    "applicationUrlHash" ~ '^[a-f0-9]{64}$'
    AND "payloadHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "external_snapshot_url_check" CHECK (
    "applicationUrl" ~ '^https?://'
  )
);

CREATE TABLE "ExternalApplicationEvent" (
  "id" UUID NOT NULL,
  "trackerId" UUID NOT NULL,
  "kind" "ExternalApplicationEventKind" NOT NULL,
  "fromStatus" "ExternalApplicationStatus",
  "toStatus" "ExternalApplicationStatus",
  "source" "ExternalApplicationSource" NOT NULL DEFAULT 'CANDIDATE_CONFIRMED',
  "actorUserId" UUID NOT NULL,
  "reasonCode" VARCHAR(64),
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExternalApplicationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_event_shape_check" CHECK (
    ("kind" = 'CREATED' AND "fromStatus" IS NULL AND "toStatus" = 'BEGUN')
    OR
    ("kind" IN ('STATUS_CHANGED', 'ARCHIVED')
      AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR
    ("kind" = 'REMINDER_CHANGED'
      AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  )
);

CREATE TABLE "Interview" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "candidateProfileId" UUID NOT NULL,
  "status" "InterviewStatus" NOT NULL DEFAULT 'PROPOSED',
  "timeZone" VARCHAR(64) NOT NULL,
  "scheduledStartAt" TIMESTAMPTZ(3),
  "scheduledEndAt" TIMESTAMPTZ(3),
  "activeProposalVersion" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "subject" VARCHAR(200) NOT NULL,
  "location" VARCHAR(300),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "cancelledAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "Interview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_version_check"
    CHECK ("version" > 0 AND "activeProposalVersion" > 0),
  CONSTRAINT "interview_timezone_check"
    CHECK ("timeZone" ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)+$'),
  CONSTRAINT "interview_schedule_check" CHECK (
    ("scheduledStartAt" IS NULL AND "scheduledEndAt" IS NULL)
    OR
    ("scheduledStartAt" IS NOT NULL AND "scheduledEndAt" > "scheduledStartAt")
  ),
  CONSTRAINT "interview_scheduled_state_check" CHECK (
    "status" NOT IN ('SCHEDULED', 'COMPLETED')
    OR ("scheduledStartAt" IS NOT NULL AND "scheduledEndAt" IS NOT NULL)
  ),
  CONSTRAINT "interview_terminal_time_check" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
    OR ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL)
  )
);

CREATE TABLE "InterviewProposal" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "slotIndex" INTEGER NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" VARCHAR(64) NOT NULL,
  "status" "InterviewProposalStatus" NOT NULL DEFAULT 'OPEN',
  "createdByUserId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InterviewProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_proposal_version_slot_check"
    CHECK ("version" > 0 AND "slotIndex" BETWEEN 1 AND 20),
  CONSTRAINT "interview_proposal_time_check"
    CHECK ("endsAt" > "startsAt" AND "expiresAt" < "startsAt"),
  CONSTRAINT "interview_proposal_timezone_check"
    CHECK ("timeZone" ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)+$')
);

CREATE TABLE "InterviewParticipant" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" "InterviewParticipantKind" NOT NULL,
  "status" "InterviewParticipantStatus" NOT NULL DEFAULT 'PENDING',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "respondedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "InterviewParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_participant_response_check" CHECK (
    ("status" = 'PENDING' AND "respondedAt" IS NULL)
    OR ("status" <> 'PENDING' AND "respondedAt" IS NOT NULL)
  )
);

CREATE TABLE "InterviewResponse" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "proposalId" UUID,
  "participantId" UUID NOT NULL,
  "kind" "InterviewResponseKind" NOT NULL,
  "requestedStartAt" TIMESTAMPTZ(3),
  "requestedEndAt" TIMESTAMPTZ(3),
  "requestedTimeZone" VARCHAR(64),
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InterviewResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_response_shape_check" CHECK (
    ("kind" IN ('ACCEPT', 'DECLINE')
      AND "proposalId" IS NOT NULL
      AND "requestedStartAt" IS NULL
      AND "requestedEndAt" IS NULL
      AND "requestedTimeZone" IS NULL)
    OR
    ("kind" = 'RESCHEDULE'
      AND "requestedStartAt" IS NOT NULL
      AND "requestedEndAt" > "requestedStartAt"
      AND "requestedTimeZone" IS NOT NULL)
  )
);

CREATE TABLE "InterviewEvent" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "kind" "InterviewEventKind" NOT NULL,
  "actorUserId" UUID,
  "proposalVersion" INTEGER,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  "reasonCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InterviewEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_event_version_check"
    CHECK ("proposalVersion" IS NULL OR "proposalVersion" > 0)
);

CREATE TABLE "CalendarArtifact" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "interviewVersion" INTEGER NOT NULL,
  "uid" VARCHAR(255) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "method" "CalendarArtifactMethod" NOT NULL,
  "status" "CalendarArtifactStatus" NOT NULL DEFAULT 'ACTIVE',
  "payloadHash" CHAR(64) NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CalendarArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_artifact_version_check"
    CHECK ("interviewVersion" > 0 AND "sequence" > 0),
  CONSTRAINT "calendar_artifact_hash_check"
    CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "calendar_artifact_method_status_check" CHECK (
    ("method" = 'CANCEL' AND "status" = 'CANCELLED')
    OR ("method" = 'REQUEST' AND "status" IN ('ACTIVE', 'SUPERSEDED'))
  )
);

CREATE TABLE "InterviewReminder" (
  "id" UUID NOT NULL,
  "interviewId" UUID NOT NULL,
  "recipientUserId" UUID NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "InterviewReminderStatus" NOT NULL DEFAULT 'PENDING',
  "dedupeKey" VARCHAR(160) NOT NULL,
  "outboxId" UUID,
  "queuedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "InterviewReminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_reminder_state_check" CHECK (
    ("status" = 'PENDING' AND "queuedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'QUEUED' AND "queuedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
  )
);

CREATE INDEX "ExternalApplicationTracker_candidateProfileId_status_update_idx"
  ON "ExternalApplicationTracker" ("candidateProfileId", "status", "updatedAt", "id");
CREATE INDEX "ExternalApplicationTracker_status_reminderAt_id_idx"
  ON "ExternalApplicationTracker" ("status", "reminderAt", "id");
CREATE UNIQUE INDEX "ExternalApplicationTracker_candidateProfileId_snapshotFinge_key"
  ON "ExternalApplicationTracker" ("candidateProfileId", "snapshotFingerprint");
CREATE UNIQUE INDEX "ExternalApplicationTracker_id_candidateProfileId_key"
  ON "ExternalApplicationTracker" ("id", "candidateProfileId");
CREATE UNIQUE INDEX "ExternalJobSnapshot_trackerId_key"
  ON "ExternalJobSnapshot" ("trackerId");
CREATE INDEX "ExternalJobSnapshot_sourceJobId_sourceJobRevisionId_idx"
  ON "ExternalJobSnapshot" ("sourceJobId", "sourceJobRevisionId");
CREATE UNIQUE INDEX "ExternalJobSnapshot_trackerId_payloadHash_key"
  ON "ExternalJobSnapshot" ("trackerId", "payloadHash");
CREATE UNIQUE INDEX "ExternalApplicationEvent_idempotencyKey_key"
  ON "ExternalApplicationEvent" ("idempotencyKey");
CREATE INDEX "ExternalApplicationEvent_trackerId_createdAt_id_idx"
  ON "ExternalApplicationEvent" ("trackerId", "createdAt", "id");

CREATE INDEX "Interview_applicationId_createdAt_id_idx"
  ON "Interview" ("applicationId", "createdAt", "id");
CREATE INDEX "Interview_companyId_status_scheduledStartAt_id_idx"
  ON "Interview" ("companyId", "status", "scheduledStartAt", "id");
CREATE INDEX "Interview_candidateProfileId_status_scheduledStartAt_id_idx"
  ON "Interview" ("candidateProfileId", "status", "scheduledStartAt", "id");
CREATE UNIQUE INDEX "Interview_id_companyId_key"
  ON "Interview" ("id", "companyId");
CREATE UNIQUE INDEX "Interview_id_candidateProfileId_key"
  ON "Interview" ("id", "candidateProfileId");
CREATE INDEX "InterviewProposal_interviewId_version_status_startsAt_idx"
  ON "InterviewProposal" ("interviewId", "version", "status", "startsAt");
CREATE INDEX "InterviewProposal_status_expiresAt_id_idx"
  ON "InterviewProposal" ("status", "expiresAt", "id");
CREATE UNIQUE INDEX "InterviewProposal_interviewId_version_slotIndex_key"
  ON "InterviewProposal" ("interviewId", "version", "slotIndex");
CREATE INDEX "InterviewParticipant_userId_status_interviewId_idx"
  ON "InterviewParticipant" ("userId", "status", "interviewId");
CREATE UNIQUE INDEX "InterviewParticipant_interviewId_userId_key"
  ON "InterviewParticipant" ("interviewId", "userId");
CREATE UNIQUE INDEX "InterviewParticipant_id_interviewId_key"
  ON "InterviewParticipant" ("id", "interviewId");
CREATE UNIQUE INDEX "InterviewResponse_idempotencyKey_key"
  ON "InterviewResponse" ("idempotencyKey");
CREATE INDEX "InterviewResponse_interviewId_createdAt_id_idx"
  ON "InterviewResponse" ("interviewId", "createdAt", "id");
CREATE INDEX "InterviewResponse_participantId_createdAt_idx"
  ON "InterviewResponse" ("participantId", "createdAt");
CREATE UNIQUE INDEX "InterviewEvent_idempotencyKey_key"
  ON "InterviewEvent" ("idempotencyKey");
CREATE INDEX "InterviewEvent_interviewId_createdAt_id_idx"
  ON "InterviewEvent" ("interviewId", "createdAt", "id");
CREATE INDEX "CalendarArtifact_interviewId_status_sequence_idx"
  ON "CalendarArtifact" ("interviewId", "status", "sequence");
CREATE UNIQUE INDEX "CalendarArtifact_interviewId_interviewVersion_sequence_meth_key"
  ON "CalendarArtifact" ("interviewId", "interviewVersion", "sequence", "method");
CREATE UNIQUE INDEX "CalendarArtifact_uid_sequence_method_key"
  ON "CalendarArtifact" ("uid", "sequence", "method");
CREATE UNIQUE INDEX "calendar_artifact_one_active_per_interview"
  ON "CalendarArtifact" ("interviewId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "InterviewReminder_dedupeKey_key"
  ON "InterviewReminder" ("dedupeKey");
CREATE INDEX "InterviewReminder_status_dueAt_id_idx"
  ON "InterviewReminder" ("status", "dueAt", "id");
CREATE INDEX "InterviewReminder_recipientUserId_status_dueAt_idx"
  ON "InterviewReminder" ("recipientUserId", "status", "dueAt");

ALTER TABLE "ExternalApplicationTracker"
  ADD CONSTRAINT "ExternalApplicationTracker_candidateProfileId_fkey"
  FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalJobSnapshot"
  ADD CONSTRAINT "ExternalJobSnapshot_trackerId_fkey"
  FOREIGN KEY ("trackerId") REFERENCES "ExternalApplicationTracker"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalApplicationEvent"
  ADD CONSTRAINT "ExternalApplicationEvent_trackerId_fkey"
  FOREIGN KEY ("trackerId") REFERENCES "ExternalApplicationTracker"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_candidateProfileId_fkey"
  FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewProposal"
  ADD CONSTRAINT "InterviewProposal_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewParticipant"
  ADD CONSTRAINT "InterviewParticipant_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewParticipant"
  ADD CONSTRAINT "InterviewParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewResponse"
  ADD CONSTRAINT "InterviewResponse_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewResponse"
  ADD CONSTRAINT "InterviewResponse_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "InterviewProposal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewResponse"
  ADD CONSTRAINT "InterviewResponse_participantId_interviewId_fkey"
  FOREIGN KEY ("participantId", "interviewId")
  REFERENCES "InterviewParticipant"("id", "interviewId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewEvent"
  ADD CONSTRAINT "InterviewEvent_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarArtifact"
  ADD CONSTRAINT "CalendarArtifact_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewReminder"
  ADD CONSTRAINT "InterviewReminder_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION phase28_reject_update_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'phase28 evidence rows are append-only';
END;
$$;

CREATE TRIGGER external_job_snapshot_append_only
BEFORE UPDATE OR DELETE ON "ExternalJobSnapshot"
FOR EACH ROW EXECUTE FUNCTION phase28_reject_update_delete();
CREATE TRIGGER external_application_event_append_only
BEFORE UPDATE OR DELETE ON "ExternalApplicationEvent"
FOR EACH ROW EXECUTE FUNCTION phase28_reject_update_delete();
CREATE TRIGGER interview_response_append_only
BEFORE UPDATE OR DELETE ON "InterviewResponse"
FOR EACH ROW EXECUTE FUNCTION phase28_reject_update_delete();
CREATE TRIGGER interview_event_append_only
BEFORE UPDATE OR DELETE ON "InterviewEvent"
FOR EACH ROW EXECUTE FUNCTION phase28_reject_update_delete();

CREATE FUNCTION phase28_validate_interview_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "Application" application
      JOIN "Job" job ON job."id" = application."jobId"
     WHERE application."id" = NEW."applicationId"
       AND application."candidateProfileId" = NEW."candidateProfileId"
       AND job."companyId" = NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'interview application, candidate and company scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER interview_scope_guard
BEFORE INSERT OR UPDATE OF "applicationId", "companyId", "candidateProfileId"
ON "Interview"
FOR EACH ROW EXECUTE FUNCTION phase28_validate_interview_scope();

CREATE FUNCTION phase28_validate_participant_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_interview "Interview"%ROWTYPE;
BEGIN
  SELECT * INTO target_interview
    FROM "Interview"
   WHERE "id" = NEW."interviewId";
  IF target_interview."id" IS NULL THEN
    RAISE EXCEPTION 'interview participant has no interview';
  END IF;
  IF NEW."kind" = 'CANDIDATE' AND NOT EXISTS (
    SELECT 1 FROM "CandidateProfile"
     WHERE "id" = target_interview."candidateProfileId"
       AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'candidate participant does not own interview candidate';
  END IF;
  IF NEW."kind" = 'COMPANY_MEMBER' AND NOT EXISTS (
    SELECT 1 FROM "CompanyMembership"
     WHERE "companyId" = target_interview."companyId"
       AND "userId" = NEW."userId"
       AND "status" = 'ACTIVE'
       AND "role" <> 'VIEWER'
  ) THEN
    RAISE EXCEPTION 'company participant lacks active mutable membership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER interview_participant_scope_guard
BEFORE INSERT OR UPDATE OF "interviewId", "userId", "kind"
ON "InterviewParticipant"
FOR EACH ROW EXECUTE FUNCTION phase28_validate_participant_scope();

CREATE FUNCTION phase28_validate_external_event_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "ExternalApplicationTracker" tracker
      JOIN "CandidateProfile" profile
        ON profile."id" = tracker."candidateProfileId"
     WHERE tracker."id" = NEW."trackerId"
       AND profile."userId" = NEW."actorUserId"
  ) THEN
    RAISE EXCEPTION 'external application event actor is not the owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_application_event_actor_guard
BEFORE INSERT ON "ExternalApplicationEvent"
FOR EACH ROW EXECUTE FUNCTION phase28_validate_external_event_actor();
