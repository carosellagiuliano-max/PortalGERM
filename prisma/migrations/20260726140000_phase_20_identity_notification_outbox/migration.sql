-- Phase 20 is additive. Existing LIVE identities are classified as legacy
-- assurance and are never silently promoted to verified e-mail assurance.

CREATE TYPE "IdentityAssuranceLevel" AS ENUM (
  'LOW_ASSURANCE',
  'VERIFIED_EMAIL',
  'LEGACY_ASSURANCE'
);

CREATE TYPE "EmailVerificationPurpose" AS ENUM (
  'REGISTRATION',
  'INVITATION',
  'LOGIN_EMAIL_CHANGE'
);

CREATE TYPE "PendingEmailChangeStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "NotificationPurpose" AS ENUM (
  'IDENTITY_VERIFICATION',
  'LOGIN_EMAIL_CHANGE_VERIFICATION',
  'LOGIN_EMAIL_CHANGED_NOTICE',
  'PASSWORD_RESET',
  'COMPANY_INVITATION',
  'COMPANY_VERIFICATION',
  'APPLICATION_SUBMITTED',
  'APPLICATION_STATUS_CHANGED',
  'EMPLOYER_MESSAGE',
  'TALENT_CONTACT_REQUEST',
  'IDENTITY_REVEAL',
  'JOB_ALERT',
  'SUBSCRIPTION_TRANSACTIONAL',
  'BILLING_TRANSACTIONAL',
  'USAGE_OPERATIONAL',
  'JOB_MODERATION',
  'ABUSE_REPORT',
  'PRIVACY_REQUEST',
  'COMMERCIAL_OPTIONAL'
);

CREATE TYPE "NotificationPurposeClass" AS ENUM ('MANDATORY', 'OPTIONAL');
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
  'PENDING',
  'LEASED',
  'RETRY',
  'DELIVERED',
  'SUPPRESSED',
  'DEAD_LETTER',
  'PAUSED'
);

CREATE TYPE "NotificationDeliveryOutcome" AS ENUM (
  'ACCEPTED',
  'TRANSIENT_FAILURE',
  'PERMANENT_FAILURE',
  'BOUNCED',
  'SUPPRESSED',
  'TIMED_OUT',
  'CONFIGURATION_ERROR'
);

CREATE TYPE "NotificationSuppressionReason" AS ENUM (
  'HARD_BOUNCE',
  'MANUAL_SECURITY',
  'USER_OPT_OUT'
);

CREATE TYPE "AuthSecurityEventKind" AS ENUM (
  'LOGIN_FAILED',
  'LOGIN_RATE_LIMITED',
  'VERIFICATION_REQUESTED',
  'VERIFICATION_RATE_LIMITED',
  'VERIFICATION_SUCCEEDED',
  'VERIFICATION_REJECTED',
  'EMAIL_CHANGE_REQUESTED',
  'EMAIL_CHANGE_REJECTED',
  'EMAIL_CHANGE_COMPLETED',
  'PASSWORD_RECOVERY_REQUESTED',
  'PASSWORD_RECOVERY_RATE_LIMITED',
  'SESSIONS_REVOKED'
);

ALTER TYPE "AuditAction" ADD VALUE 'EMAIL_VERIFICATION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'EMAIL_VERIFICATION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_EMAIL_CHANGE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_EMAIL_CHANGE_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_EMAIL_CHANGE_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_PREFERENCE_CHANGED';

ALTER TABLE "User"
  ADD COLUMN "emailAddressEpoch" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "identityAssurance" "IdentityAssuranceLevel" NOT NULL DEFAULT 'LOW_ASSURANCE';

UPDATE "User"
   SET "identityAssurance" =
     CASE
       WHEN "dataProvenance" IN ('DEMO', 'TEST') AND "emailVerifiedAt" IS NOT NULL
         THEN 'VERIFIED_EMAIL'::"IdentityAssuranceLevel"
       WHEN "dataProvenance" = 'LIVE'
         THEN 'LEGACY_ASSURANCE'::"IdentityAssuranceLevel"
       ELSE 'LOW_ASSURANCE'::"IdentityAssuranceLevel"
     END;

ALTER TABLE "User"
  ADD CONSTRAINT "user_email_address_epoch_positive"
  CHECK ("emailAddressEpoch" > 0);

CREATE TABLE "EmailVerificationChallenge" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "EmailVerificationPurpose" NOT NULL,
  "addressEpoch" INTEGER NOT NULL,
  "targetNormalizedHash" VARCHAR(64) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  "supersededAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_verification_epoch_positive" CHECK ("addressEpoch" > 0),
  CONSTRAINT "email_verification_expiry_after_creation" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "email_verification_terminal_exclusive"
    CHECK (NOT ("usedAt" IS NOT NULL AND "supersededAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "EmailVerificationChallenge_tokenHash_key"
  ON "EmailVerificationChallenge"("tokenHash");
CREATE UNIQUE INDEX "email_verification_current_unique"
  ON "EmailVerificationChallenge"("userId", "purpose", "addressEpoch")
  WHERE "usedAt" IS NULL AND "supersededAt" IS NULL;
CREATE INDEX "EmailVerificationChallenge_userId_purpose_addressEpoch_crea_idx"
  ON "EmailVerificationChallenge"("userId", "purpose", "addressEpoch", "createdAt");
CREATE INDEX "EmailVerificationChallenge_expiresAt_usedAt_supersededAt_idx"
  ON "EmailVerificationChallenge"("expiresAt", "usedAt", "supersededAt");

CREATE TABLE "PendingEmailChange" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "challengeId" UUID NOT NULL,
  "initiatedBySessionId" UUID NOT NULL,
  "targetEmail" VARCHAR(320) NOT NULL,
  "targetEmailNormalized" VARCHAR(320) NOT NULL,
  "addressEpoch" INTEGER NOT NULL,
  "status" "PendingEmailChangeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PendingEmailChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_email_change_epoch_positive" CHECK ("addressEpoch" > 1),
  CONSTRAINT "pending_email_change_expiry_after_creation" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "pending_email_change_terminal_shape" CHECK (
    ("status" = 'PENDING' AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" IN ('CANCELLED', 'EXPIRED') AND "completedAt" IS NULL AND "cancelledAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "PendingEmailChange_challengeId_key"
  ON "PendingEmailChange"("challengeId");
CREATE UNIQUE INDEX "pending_email_change_current_user_unique"
  ON "PendingEmailChange"("userId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "pending_email_change_current_target_unique"
  ON "PendingEmailChange"("targetEmailNormalized") WHERE "status" = 'PENDING';
CREATE INDEX "PendingEmailChange_userId_status_createdAt_idx"
  ON "PendingEmailChange"("userId", "status", "createdAt");
CREATE INDEX "PendingEmailChange_targetEmailNormalized_status_idx"
  ON "PendingEmailChange"("targetEmailNormalized", "status");

CREATE TABLE "AuthAssuranceEvidence" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "sessionId" UUID,
  "purpose" VARCHAR(64) NOT NULL,
  "action" VARCHAR(96) NOT NULL,
  "tenantId" UUID,
  "method" VARCHAR(32) NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthAssuranceEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_assurance_expiry_after_issue" CHECK ("expiresAt" > "issuedAt")
);
CREATE INDEX "AuthAssuranceEvidence_userId_purpose_action_expiresAt_idx"
  ON "AuthAssuranceEvidence"("userId", "purpose", "action", "expiresAt");
CREATE INDEX "AuthAssuranceEvidence_sessionId_expiresAt_idx"
  ON "AuthAssuranceEvidence"("sessionId", "expiresAt");

CREATE TABLE "NotificationOutbox" (
  "id" UUID NOT NULL,
  "recipientUserId" UUID,
  "recipientAddressCiphertext" BYTEA,
  "recipientAddressNonce" BYTEA,
  "recipientAddressTag" BYTEA,
  "recipientAddressKeyVersion" VARCHAR(32),
  "purpose" "NotificationPurpose" NOT NULL,
  "purposeClass" "NotificationPurposeClass" NOT NULL,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
  "templateKey" VARCHAR(64) NOT NULL,
  "payloadSchemaVersion" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "dedupeKey" VARCHAR(160) NOT NULL,
  "providerDedupeKey" VARCHAR(160) NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "availableAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseOwner" VARCHAR(96),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "lastErrorCode" VARCHAR(64),
  "deliveredAt" TIMESTAMPTZ(3),
  "suppressedAt" TIMESTAMPTZ(3),
  "deadLetteredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_outbox_recipient_shape" CHECK (
    (
      "recipientUserId" IS NOT NULL
      AND "recipientAddressCiphertext" IS NULL
      AND "recipientAddressNonce" IS NULL
      AND "recipientAddressTag" IS NULL
      AND "recipientAddressKeyVersion" IS NULL
    )
    OR (
      "recipientUserId" IS NULL
      AND "recipientAddressCiphertext" IS NOT NULL
      AND "recipientAddressNonce" IS NOT NULL
      AND "recipientAddressTag" IS NOT NULL
      AND "recipientAddressKeyVersion" IS NOT NULL
    )
  ),
  CONSTRAINT "notification_outbox_payload_limit"
    CHECK (octet_length("payload"::text) <= 32768),
  CONSTRAINT "notification_outbox_attempt_bounds"
    CHECK ("attemptCount" >= 0 AND "maxAttempts" BETWEEN 1 AND 20 AND "attemptCount" <= "maxAttempts"),
  CONSTRAINT "notification_outbox_lease_shape" CHECK (
    (
      "status" = 'LEASED'
      AND "leaseOwner" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
    )
    OR (
      "status" <> 'LEASED'
      AND "leaseOwner" IS NULL
      AND "leaseExpiresAt" IS NULL
    )
  ),
  CONSTRAINT "notification_outbox_terminal_shape" CHECK (
    ("status" = 'DELIVERED' AND "deliveredAt" IS NOT NULL AND "suppressedAt" IS NULL AND "deadLetteredAt" IS NULL)
    OR ("status" = 'SUPPRESSED' AND "deliveredAt" IS NULL AND "suppressedAt" IS NOT NULL AND "deadLetteredAt" IS NULL)
    OR ("status" = 'DEAD_LETTER' AND "deliveredAt" IS NULL AND "suppressedAt" IS NULL AND "deadLetteredAt" IS NOT NULL)
    OR ("status" NOT IN ('DELIVERED', 'SUPPRESSED', 'DEAD_LETTER')
        AND "deliveredAt" IS NULL AND "suppressedAt" IS NULL AND "deadLetteredAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key"
  ON "NotificationOutbox"("dedupeKey");
CREATE UNIQUE INDEX "NotificationOutbox_providerDedupeKey_key"
  ON "NotificationOutbox"("providerDedupeKey");
CREATE INDEX "NotificationOutbox_status_availableAt_createdAt_idx"
  ON "NotificationOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "NotificationOutbox_leaseExpiresAt_idx"
  ON "NotificationOutbox"("leaseExpiresAt");
CREATE INDEX "NotificationOutbox_recipientUserId_purpose_createdAt_idx"
  ON "NotificationOutbox"("recipientUserId", "purpose", "createdAt");

CREATE TABLE "NotificationDeliveryAttempt" (
  "id" UUID NOT NULL,
  "outboxId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "leaseOwner" VARCHAR(96) NOT NULL,
  "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "providerClass" VARCHAR(64) NOT NULL,
  "outcome" "NotificationDeliveryOutcome" NOT NULL,
  "providerReceipt" VARCHAR(255),
  "errorCode" VARCHAR(64),
  "nextAvailableAt" TIMESTAMPTZ(3),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_attempt_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "notification_attempt_completion_order" CHECK ("completedAt" >= "startedAt")
);
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_outboxId_attemptNumber_key"
  ON "NotificationDeliveryAttempt"("outboxId", "attemptNumber");
CREATE INDEX "NotificationDeliveryAttempt_outboxId_startedAt_idx"
  ON "NotificationDeliveryAttempt"("outboxId", "startedAt");
CREATE INDEX "NotificationDeliveryAttempt_leaseExpiresAt_completedAt_idx"
  ON "NotificationDeliveryAttempt"("leaseExpiresAt", "completedAt");

CREATE TABLE "NotificationSuppression" (
  "id" UUID NOT NULL,
  "recipientHash" VARCHAR(64) NOT NULL,
  "reason" "NotificationSuppressionReason" NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMPTZ(3),
  CONSTRAINT "NotificationSuppression_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_suppression_release_order"
    CHECK ("releasedAt" IS NULL OR "releasedAt" >= "createdAt")
);
CREATE UNIQUE INDEX "notification_suppression_active_recipient_unique"
  ON "NotificationSuppression"("recipientHash") WHERE "releasedAt" IS NULL;
CREATE INDEX "NotificationSuppression_recipientHash_releasedAt_idx"
  ON "NotificationSuppression"("recipientHash", "releasedAt");

CREATE TABLE "NotificationPreference" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "NotificationPurpose" NOT NULL,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
  "enabled" BOOLEAN NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preference_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "NotificationPreference_userId_purpose_channel_key"
  ON "NotificationPreference"("userId", "purpose", "channel");
CREATE INDEX "NotificationPreference_userId_updatedAt_idx"
  ON "NotificationPreference"("userId", "updatedAt");

CREATE TABLE "NotificationPreferenceEvent" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "NotificationPurpose" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "version" INTEGER NOT NULL,
  "actorUserId" UUID,
  "reasonCode" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPreferenceEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preference_event_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "NotificationPreferenceEvent_userId_purpose_channel_version_key"
  ON "NotificationPreferenceEvent"("userId", "purpose", "channel", "version");
CREATE INDEX "NotificationPreferenceEvent_userId_createdAt_idx"
  ON "NotificationPreferenceEvent"("userId", "createdAt");

CREATE TABLE "AuthSecurityEvent" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "kind" "AuthSecurityEventKind" NOT NULL,
  "actorHash" VARCHAR(128),
  "targetHash" VARCHAR(128),
  "correlationId" VARCHAR(128) NOT NULL,
  "outcomeCode" VARCHAR(64) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "retainUntil" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSecurityEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_security_event_retention_order" CHECK ("retainUntil" > "occurredAt")
);
CREATE INDEX "AuthSecurityEvent_kind_occurredAt_idx"
  ON "AuthSecurityEvent"("kind", "occurredAt");
CREATE INDEX "AuthSecurityEvent_userId_occurredAt_idx"
  ON "AuthSecurityEvent"("userId", "occurredAt");
CREATE INDEX "AuthSecurityEvent_retainUntil_idx"
  ON "AuthSecurityEvent"("retainUntil");

ALTER TABLE "EmailVerificationChallenge"
  ADD CONSTRAINT "EmailVerificationChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingEmailChange"
  ADD CONSTRAINT "PendingEmailChange_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingEmailChange"
  ADD CONSTRAINT "PendingEmailChange_challengeId_fkey"
  FOREIGN KEY ("challengeId") REFERENCES "EmailVerificationChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingEmailChange"
  ADD CONSTRAINT "PendingEmailChange_initiatedBySessionId_fkey"
  FOREIGN KEY ("initiatedBySessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthAssuranceEvidence"
  ADD CONSTRAINT "AuthAssuranceEvidence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthAssuranceEvidence"
  ADD CONSTRAINT "AuthAssuranceEvidence_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDeliveryAttempt"
  ADD CONSTRAINT "NotificationDeliveryAttempt_outboxId_fkey"
  FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreferenceEvent"
  ADD CONSTRAINT "NotificationPreferenceEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreferenceEvent"
  ADD CONSTRAINT "NotificationPreferenceEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthSecurityEvent"
  ADD CONSTRAINT "AuthSecurityEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION phase20_reject_immutable_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'phase20 event rows are append-only';
END;
$$;

CREATE TRIGGER "notification_delivery_attempt_append_only"
BEFORE UPDATE OR DELETE ON "NotificationDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION phase20_reject_immutable_event_mutation();

CREATE TRIGGER "notification_preference_event_append_only"
BEFORE UPDATE OR DELETE ON "NotificationPreferenceEvent"
FOR EACH ROW EXECUTE FUNCTION phase20_reject_immutable_event_mutation();

CREATE TRIGGER "auth_security_event_append_only"
BEFORE UPDATE OR DELETE ON "AuthSecurityEvent"
FOR EACH ROW EXECUTE FUNCTION phase20_reject_immutable_event_mutation();
