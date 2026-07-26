-- Phase 21 adds a quarantined, immutable-version document vault. Existing
-- CandidateDocumentMetadata rows stay truthful metadata-only legacy records;
-- this migration never invents object bytes, hashes, or scanner receipts.

CREATE TYPE "DocumentStorageKind" AS ENUM (
  'METADATA_ONLY_LEGACY',
  'VAULT_ENCRYPTED'
);

CREATE TYPE "DocumentClassification" AS ENUM ('HIGHLY_SENSITIVE');

CREATE TYPE "VaultDocumentStatus" AS ENUM (
  'UPLOADING',
  'QUARANTINED',
  'SCANNING',
  'CLEAN',
  'REJECTED',
  'INFECTED',
  'SCAN_FAILED',
  'REPLACED',
  'DELETE_PENDING',
  'HELD',
  'DELETED'
);

CREATE TYPE "DocumentUploadIntentStatus" AS ENUM (
  'CREATED',
  'UPLOADING',
  'UPLOADED',
  'FINALIZED',
  'ABORTED',
  'EXPIRED',
  'FAILED'
);

CREATE TYPE "DocumentScanOutcome" AS ENUM (
  'CLEAN',
  'INFECTED',
  'POLICY_REJECTED',
  'TIMEOUT',
  'FAILED'
);

CREATE TYPE "DocumentReadGrantStatus" AS ENUM (
  'ACTIVE',
  'CONSUMED',
  'EXPIRED',
  'REVOKED'
);

CREATE TYPE "DocumentAccessKind" AS ENUM (
  'UPLOAD_INTENT_CREATED',
  'UPLOAD_STARTED',
  'UPLOAD_COMPLETED',
  'UPLOAD_ABORTED',
  'SCAN_REQUESTED',
  'SCAN_COMPLETED',
  'READ_GRANT_ISSUED',
  'READ_GRANTED',
  'READ_DENIED',
  'READ_THROTTLED',
  'RECONCILED',
  'DELETE_REQUESTED'
);

CREATE TYPE "ObjectLifecycleKind" AS ENUM (
  'DB_WITHOUT_OBJECT',
  'OBJECT_WITHOUT_DB',
  'INCOMPLETE_UPLOAD',
  'CHECKSUM_MISMATCH',
  'DELETE_PENDING',
  'LEGAL_HOLD',
  'PROVIDER_FAILURE',
  'CONSISTENT'
);

CREATE TYPE "ObjectLifecycleStatus" AS ENUM (
  'OBSERVED',
  'QUARANTINED',
  'REPAIRED',
  'RETRYABLE',
  'BLOCKED_BY_HOLD'
);

-- PostgreSQL enum labels are non-transactional across a failed migration.
-- IF NOT EXISTS makes a reviewed rollback/retry safe without weakening the
-- closed application-level action/target allowlists.
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT_VERSION';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT_UPLOAD_INTENT';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT_READ_GRANT';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_UPLOAD_INTENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_UPLOAD_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_SCAN_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_READ_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_READ';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_REPLACED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_DELETE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_RECONCILED';

ALTER TABLE "CandidateDocumentMetadata"
  ADD COLUMN "storageKind" "DocumentStorageKind" NOT NULL
    DEFAULT 'METADATA_ONLY_LEGACY',
  ADD COLUMN "documentVersionId" UUID;

CREATE UNIQUE INDEX "CandidateDocumentMetadata_documentVersionId_key"
  ON "CandidateDocumentMetadata"("documentVersionId");
CREATE UNIQUE INDEX "CandidateDocumentMetadata_documentVersionId_candidateProfileId_key"
  ON "CandidateDocumentMetadata"("documentVersionId", "candidateProfileId");

CREATE UNIQUE INDEX "Application_id_candidateProfileId_key"
  ON "Application"("id", "candidateProfileId");

ALTER TABLE "ApplicationSubmissionDocument"
  ADD COLUMN "candidateProfileId" UUID,
  ADD COLUMN "documentVersionId" UUID;

-- Phase 02 deliberately made submission evidence append-only. The only
-- mutation permitted here is this bounded owner-key backfill inside the
-- transactional migration; PostgreSQL restores all USER triggers on rollback.
ALTER TABLE "ApplicationSubmissionDocument" DISABLE TRIGGER USER;
UPDATE "ApplicationSubmissionDocument" snapshot
   SET "candidateProfileId" = application."candidateProfileId"
  FROM "Application" application
 WHERE application."id" = snapshot."applicationId";
ALTER TABLE "ApplicationSubmissionDocument" ENABLE TRIGGER USER;

ALTER TABLE "ApplicationSubmissionDocument"
  ALTER COLUMN "candidateProfileId" SET NOT NULL;

CREATE INDEX "ApplicationSubmissionDocument_documentVersionId_idx"
  ON "ApplicationSubmissionDocument"("documentVersionId");

CREATE TABLE "Document" (
  "id" UUID NOT NULL,
  "candidateProfileId" UUID NOT NULL,
  "purpose" "DocumentPurpose" NOT NULL,
  "currentVersionId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Document_candidateProfileId_purpose_key"
  ON "Document"("candidateProfileId", "purpose");
CREATE UNIQUE INDEX "Document_id_candidateProfileId_key"
  ON "Document"("id", "candidateProfileId");
CREATE UNIQUE INDEX "Document_currentVersionId_key"
  ON "Document"("currentVersionId");
CREATE UNIQUE INDEX "Document_currentVersionId_candidateProfileId_key"
  ON "Document"("currentVersionId", "candidateProfileId");
CREATE INDEX "Document_candidateProfileId_updatedAt_idx"
  ON "Document"("candidateProfileId", "updatedAt");

CREATE TABLE "DocumentVersion" (
  "id" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "candidateProfileId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "objectKey" VARCHAR(512) NOT NULL,
  "providerObjectVersion" VARCHAR(128) NOT NULL,
  "safeFilename" VARCHAR(255) NOT NULL,
  "declaredMimeType" VARCHAR(128) NOT NULL,
  "detectedMimeType" VARCHAR(128),
  "sizeBytes" INTEGER,
  "sha256" CHAR(64),
  "classification" "DocumentClassification" NOT NULL
    DEFAULT 'HIGHLY_SENSITIVE',
  "status" "VaultDocumentStatus" NOT NULL DEFAULT 'UPLOADING',
  "encryptionKeyVersion" VARCHAR(32) NOT NULL,
  "storageRegion" VARCHAR(32) NOT NULL,
  "uploadedAt" TIMESTAMPTZ(3),
  "scanCompletedAt" TIMESTAMPTZ(3),
  "replacedAt" TIMESTAMPTZ(3),
  "deleteRequestedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_version_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "document_version_size_bounds"
    CHECK ("sizeBytes" IS NULL OR ("sizeBytes" > 0 AND "sizeBytes" <= 5242880)),
  CONSTRAINT "document_version_sha256_shape"
    CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "document_version_uploaded_shape" CHECK (
    (
      "status" = 'UPLOADING'
      AND "uploadedAt" IS NULL
      AND "sizeBytes" IS NULL
      AND "sha256" IS NULL
      AND "detectedMimeType" IS NULL
    )
    OR (
      "status" <> 'UPLOADING'
      AND "uploadedAt" IS NOT NULL
      AND "sizeBytes" IS NOT NULL
      AND "sha256" IS NOT NULL
    )
  ),
  CONSTRAINT "document_version_scan_shape" CHECK (
    (
      "status" IN ('CLEAN', 'REJECTED', 'INFECTED', 'SCAN_FAILED')
      AND "scanCompletedAt" IS NOT NULL
    )
    OR "status" NOT IN ('CLEAN', 'REJECTED', 'INFECTED', 'SCAN_FAILED')
  ),
  CONSTRAINT "document_version_replaced_shape"
    CHECK ("status" <> 'REPLACED' OR "replacedAt" IS NOT NULL),
  CONSTRAINT "document_version_delete_shape"
    CHECK ("status" NOT IN ('DELETE_PENDING', 'DELETED') OR "deleteRequestedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "DocumentVersion_objectKey_key"
  ON "DocumentVersion"("objectKey");
CREATE UNIQUE INDEX "DocumentVersion_documentId_sequence_key"
  ON "DocumentVersion"("documentId", "sequence");
CREATE UNIQUE INDEX "DocumentVersion_id_candidateProfileId_key"
  ON "DocumentVersion"("id", "candidateProfileId");
CREATE INDEX "DocumentVersion_candidateProfileId_status_createdAt_idx"
  ON "DocumentVersion"("candidateProfileId", "status", "createdAt");
CREATE INDEX "DocumentVersion_status_uploadedAt_idx"
  ON "DocumentVersion"("status", "uploadedAt");
CREATE INDEX "DocumentVersion_sha256_idx"
  ON "DocumentVersion"("sha256");

CREATE TABLE "DocumentUploadIntent" (
  "id" UUID NOT NULL,
  "documentVersionId" UUID NOT NULL,
  "candidateProfileId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "purpose" "DocumentPurpose" NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "expectedSizeBytes" INTEGER NOT NULL,
  "expectedSha256" CHAR(64),
  "declaredMimeType" VARCHAR(128) NOT NULL,
  "safeFilename" VARCHAR(255) NOT NULL,
  "status" "DocumentUploadIntentStatus" NOT NULL DEFAULT 'CREATED',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "finalizedAt" TIMESTAMPTZ(3),
  "abortedAt" TIMESTAMPTZ(3),
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DocumentUploadIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_upload_intent_size_bounds"
    CHECK ("expectedSizeBytes" > 0 AND "expectedSizeBytes" <= 5242880),
  CONSTRAINT "document_upload_intent_hash_shape"
    CHECK ("expectedSha256" IS NULL OR "expectedSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "document_upload_intent_expiry_order"
    CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "document_upload_intent_terminal_shape" CHECK (
    ("status" = 'FINALIZED' AND "finalizedAt" IS NOT NULL AND "abortedAt" IS NULL)
    OR ("status" IN ('ABORTED', 'EXPIRED') AND "finalizedAt" IS NULL AND "abortedAt" IS NOT NULL)
    OR ("status" NOT IN ('FINALIZED', 'ABORTED', 'EXPIRED')
        AND "finalizedAt" IS NULL AND "abortedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "DocumentUploadIntent_documentVersionId_key"
  ON "DocumentUploadIntent"("documentVersionId");
CREATE UNIQUE INDEX "DocumentUploadIntent_actorUserId_idempotencyKey_key"
  ON "DocumentUploadIntent"("actorUserId", "idempotencyKey");
CREATE UNIQUE INDEX "DocumentUploadIntent_documentVersionId_candidateProfileId_key"
  ON "DocumentUploadIntent"("documentVersionId", "candidateProfileId");
CREATE UNIQUE INDEX "document_upload_intent_current_candidate_purpose_unique"
  ON "DocumentUploadIntent"("candidateProfileId", "purpose")
  WHERE "status" IN ('CREATED', 'UPLOADING', 'UPLOADED');
CREATE INDEX "DocumentUploadIntent_candidateProfileId_purpose_status_expiresAt_idx"
  ON "DocumentUploadIntent"("candidateProfileId", "purpose", "status", "expiresAt");
CREATE INDEX "DocumentUploadIntent_status_expiresAt_idx"
  ON "DocumentUploadIntent"("status", "expiresAt");

CREATE TABLE "DocumentScanAttempt" (
  "id" UUID NOT NULL,
  "documentVersionId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "engineVersion" VARCHAR(64) NOT NULL,
  "signatureVersion" VARCHAR(64) NOT NULL,
  "outcome" "DocumentScanOutcome" NOT NULL,
  "detectedMimeType" VARCHAR(128),
  "outcomeCode" VARCHAR(64) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentScanAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_scan_attempt_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "document_scan_attempt_completion_order"
    CHECK ("completedAt" >= "startedAt")
);

CREATE UNIQUE INDEX "DocumentScanAttempt_documentVersionId_attemptNumber_key"
  ON "DocumentScanAttempt"("documentVersionId", "attemptNumber");
CREATE INDEX "DocumentScanAttempt_outcome_completedAt_idx"
  ON "DocumentScanAttempt"("outcome", "completedAt");

CREATE TABLE "DocumentReadGrant" (
  "id" UUID NOT NULL,
  "documentVersionId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "companyId" UUID,
  "applicationId" UUID,
  "membershipId" UUID,
  "tokenHash" CHAR(64) NOT NULL,
  "status" "DocumentReadGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentReadGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_read_grant_token_shape"
    CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "document_read_grant_expiry_order"
    CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '60 seconds'),
  CONSTRAINT "document_read_grant_terminal_shape" CHECK (
    ("status" = 'ACTIVE' AND "consumedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" IN ('EXPIRED', 'REVOKED') AND "consumedAt" IS NULL AND "revokedAt" IS NOT NULL)
  ),
  CONSTRAINT "document_read_grant_audience_shape" CHECK (
    (
      "companyId" IS NULL
      AND "applicationId" IS NULL
      AND "membershipId" IS NULL
    )
    OR (
      "companyId" IS NOT NULL
      AND "applicationId" IS NOT NULL
      AND "membershipId" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "DocumentReadGrant_tokenHash_key"
  ON "DocumentReadGrant"("tokenHash");
CREATE INDEX "DocumentReadGrant_actorUserId_status_expiresAt_idx"
  ON "DocumentReadGrant"("actorUserId", "status", "expiresAt");
CREATE INDEX "DocumentReadGrant_applicationId_documentVersionId_idx"
  ON "DocumentReadGrant"("applicationId", "documentVersionId");
CREATE INDEX "DocumentReadGrant_companyId_createdAt_idx"
  ON "DocumentReadGrant"("companyId", "createdAt");

CREATE TABLE "DocumentAccessEvent" (
  "id" UUID NOT NULL,
  "documentVersionId" UUID NOT NULL,
  "documentReadGrantId" UUID,
  "actorUserId" UUID,
  "companyId" UUID,
  "applicationId" UUID,
  "kind" "DocumentAccessKind" NOT NULL,
  "outcomeCode" VARCHAR(64) NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentAccessEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentAccessEvent_documentVersionId_occurredAt_idx"
  ON "DocumentAccessEvent"("documentVersionId", "occurredAt");
CREATE INDEX "DocumentAccessEvent_actorUserId_kind_occurredAt_idx"
  ON "DocumentAccessEvent"("actorUserId", "kind", "occurredAt");
CREATE INDEX "DocumentAccessEvent_companyId_kind_occurredAt_idx"
  ON "DocumentAccessEvent"("companyId", "kind", "occurredAt");

CREATE TABLE "ObjectLifecycleOutcome" (
  "id" UUID NOT NULL,
  "documentVersionId" UUID,
  "objectKeyHash" CHAR(64) NOT NULL,
  "kind" "ObjectLifecycleKind" NOT NULL,
  "status" "ObjectLifecycleStatus" NOT NULL,
  "reasonCode" VARCHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectLifecycleOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "object_lifecycle_hash_shape"
    CHECK ("objectKeyHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "ObjectLifecycleOutcome_idempotencyKey_key"
  ON "ObjectLifecycleOutcome"("idempotencyKey");
CREATE INDEX "ObjectLifecycleOutcome_kind_status_observedAt_idx"
  ON "ObjectLifecycleOutcome"("kind", "status", "observedAt");
CREATE INDEX "ObjectLifecycleOutcome_documentVersionId_observedAt_idx"
  ON "ObjectLifecycleOutcome"("documentVersionId", "observedAt");

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_candidateProfileId_fkey"
  FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_documentId_candidateProfileId_fkey"
  FOREIGN KEY ("documentId", "candidateProfileId")
  REFERENCES "Document"("id", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_candidateProfileId_fkey"
  FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_currentVersionId_candidateProfileId_fkey"
  FOREIGN KEY ("currentVersionId", "candidateProfileId")
  REFERENCES "DocumentVersion"("id", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentUploadIntent"
  ADD CONSTRAINT "DocumentUploadIntent_documentVersionId_candidateProfileId_fkey"
  FOREIGN KEY ("documentVersionId", "candidateProfileId")
  REFERENCES "DocumentVersion"("id", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentUploadIntent"
  ADD CONSTRAINT "DocumentUploadIntent_candidateProfileId_fkey"
  FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentUploadIntent"
  ADD CONSTRAINT "DocumentUploadIntent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentScanAttempt"
  ADD CONSTRAINT "DocumentScanAttempt_documentVersionId_fkey"
  FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentReadGrant"
  ADD CONSTRAINT "DocumentReadGrant_documentVersionId_fkey"
  FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentReadGrant"
  ADD CONSTRAINT "DocumentReadGrant_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentReadGrant"
  ADD CONSTRAINT "DocumentReadGrant_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentReadGrant"
  ADD CONSTRAINT "DocumentReadGrant_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentReadGrant"
  ADD CONSTRAINT "DocumentReadGrant_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentAccessEvent"
  ADD CONSTRAINT "DocumentAccessEvent_documentVersionId_fkey"
  FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentAccessEvent"
  ADD CONSTRAINT "DocumentAccessEvent_documentReadGrantId_fkey"
  FOREIGN KEY ("documentReadGrantId") REFERENCES "DocumentReadGrant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentAccessEvent"
  ADD CONSTRAINT "DocumentAccessEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentAccessEvent"
  ADD CONSTRAINT "DocumentAccessEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentAccessEvent"
  ADD CONSTRAINT "DocumentAccessEvent_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ObjectLifecycleOutcome"
  ADD CONSTRAINT "ObjectLifecycleOutcome_documentVersionId_fkey"
  FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CandidateDocumentMetadata"
  ADD CONSTRAINT "CandidateDocumentMetadata_documentVersionId_candidateProfileId_fkey"
  FOREIGN KEY ("documentVersionId", "candidateProfileId")
  REFERENCES "DocumentVersion"("id", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApplicationSubmissionDocument"
  DROP CONSTRAINT "ApplicationSubmissionDocument_applicationId_fkey";
ALTER TABLE "ApplicationSubmissionDocument"
  ADD CONSTRAINT "ApplicationSubmissionDocument_applicationId_candidateProfileId_fkey"
  FOREIGN KEY ("applicationId", "candidateProfileId")
  REFERENCES "Application"("id", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationSubmissionDocument"
  ADD CONSTRAINT "ApplicationSubmissionDocument_documentVersionId_candidateProfileId_fkey"
  FOREIGN KEY ("documentVersionId", "candidateProfileId")
  REFERENCES "DocumentVersion"("id", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION phase21_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'phase21 evidence rows are append-only';
END;
$$;

CREATE TRIGGER "document_scan_attempt_append_only"
BEFORE UPDATE OR DELETE ON "DocumentScanAttempt"
FOR EACH ROW EXECUTE FUNCTION phase21_reject_append_only_mutation();

CREATE TRIGGER "document_access_event_append_only"
BEFORE UPDATE OR DELETE ON "DocumentAccessEvent"
FOR EACH ROW EXECUTE FUNCTION phase21_reject_append_only_mutation();

CREATE TRIGGER "object_lifecycle_outcome_append_only"
BEFORE UPDATE OR DELETE ON "ObjectLifecycleOutcome"
FOR EACH ROW EXECUTE FUNCTION phase21_reject_append_only_mutation();

CREATE FUNCTION phase21_protect_document_version_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."documentId" IS DISTINCT FROM OLD."documentId"
     OR NEW."candidateProfileId" IS DISTINCT FROM OLD."candidateProfileId"
     OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
     OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey"
     OR NEW."providerObjectVersion" IS DISTINCT FROM OLD."providerObjectVersion"
     OR NEW."safeFilename" IS DISTINCT FROM OLD."safeFilename"
     OR NEW."declaredMimeType" IS DISTINCT FROM OLD."declaredMimeType"
     OR NEW."classification" IS DISTINCT FROM OLD."classification"
     OR NEW."encryptionKeyVersion" IS DISTINCT FROM OLD."encryptionKeyVersion"
     OR NEW."storageRegion" IS DISTINCT FROM OLD."storageRegion"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'document version identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_version_identity_immutable"
BEFORE UPDATE ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION phase21_protect_document_version_identity();

CREATE FUNCTION phase21_validate_document_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'UPLOADING' AND NEW."status" IN ('QUARANTINED', 'REJECTED', 'DELETE_PENDING'))
    OR (OLD."status" = 'QUARANTINED' AND NEW."status" IN ('SCANNING', 'REJECTED', 'INFECTED', 'SCAN_FAILED', 'DELETE_PENDING', 'HELD'))
    OR (OLD."status" = 'SCANNING' AND NEW."status" IN ('CLEAN', 'REJECTED', 'INFECTED', 'SCAN_FAILED', 'HELD'))
    OR (OLD."status" = 'CLEAN' AND NEW."status" IN ('REPLACED', 'DELETE_PENDING', 'HELD'))
    OR (OLD."status" = 'SCAN_FAILED' AND NEW."status" IN ('SCANNING', 'REJECTED', 'DELETE_PENDING', 'HELD'))
    OR (OLD."status" = 'REPLACED' AND NEW."status" IN ('DELETE_PENDING', 'HELD'))
    OR (OLD."status" = 'DELETE_PENDING' AND NEW."status" IN ('HELD', 'DELETED'))
  ) THEN
    RAISE EXCEPTION 'invalid document lifecycle transition from % to %',
      OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_version_status_transition_guard"
BEFORE UPDATE OF "status" ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION phase21_validate_document_status_transition();

CREATE FUNCTION phase21_validate_upload_intent_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'CREATED' AND NEW."status" IN ('UPLOADING', 'ABORTED', 'EXPIRED', 'FAILED'))
    OR (OLD."status" = 'UPLOADING' AND NEW."status" IN ('UPLOADED', 'ABORTED', 'EXPIRED', 'FAILED'))
    OR (OLD."status" = 'UPLOADED' AND NEW."status" IN ('FINALIZED', 'ABORTED', 'EXPIRED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'invalid upload intent transition from % to %',
      OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_upload_intent_status_transition_guard"
BEFORE UPDATE OF "status" ON "DocumentUploadIntent"
FOR EACH ROW EXECUTE FUNCTION phase21_validate_upload_intent_transition();
