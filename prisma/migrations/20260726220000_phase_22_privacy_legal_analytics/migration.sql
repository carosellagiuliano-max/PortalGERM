-- Phase 22: additive privacy execution, legal publication and consent evidence.
-- No row below grants a legal approval. All activation remains fail closed until
-- a named owner records an APPROVED ProcessingApproval with external evidence.

CREATE TYPE "PrivacySubjectClass" AS ENUM (
  'USER',
  'CANDIDATE',
  'EMPLOYER_MEMBER',
  'INVITEE',
  'LEAD',
  'REPORTER',
  'NON_ACCOUNT_HOLDER'
);
CREATE TYPE "PrivacyInventoryStatus" AS ENUM (
  'DRAFT',
  'REVIEWED',
  'ACTIVE',
  'REVOKED'
);
CREATE TYPE "PrivacyInventoryOutcome" AS ENUM (
  'INCLUDE',
  'EXCLUDE',
  'CORRECT',
  'DELETE',
  'ANONYMIZE',
  'RETAIN'
);
CREATE TYPE "LegalDocumentType" AS ENUM (
  'PRIVACY',
  'TERMS',
  'IMPRINT',
  'COOKIE',
  'ANALYTICS',
  'AVG_NOTICE',
  'DPA',
  'DSFA'
);
CREATE TYPE "LegalRevisionStatus" AS ENUM (
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED'
);
CREATE TYPE "LegalPublicationStatus" AS ENUM (
  'CURRENT',
  'REVOKED',
  'EXPIRED'
);
CREATE TYPE "ProcessingApprovalStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'REVOKED',
  'EXPIRED'
);
CREATE TYPE "PrivacyExecutionKind" AS ENUM (
  'EXPORT',
  'CORRECTION',
  'ERASURE'
);
CREATE TYPE "PrivacyExecutionStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PARTIAL',
  'RETRY_REQUIRED',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED'
);
CREATE TYPE "PrivacyProcessorOutcomeStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'RETAINED',
  'RETRY_REQUIRED',
  'FAILED_TERMINAL'
);
CREATE TYPE "PrivacyExportArtifactStatus" AS ENUM (
  'BUILDING',
  'READY',
  'CONSUMED',
  'EXPIRED',
  'REVOKED',
  'FAILED'
);
CREATE TYPE "LegalHoldStatus" AS ENUM (
  'ACTIVE',
  'RELEASED',
  'EXPIRED'
);
CREATE TYPE "PrivacyErasureAction" AS ENUM (
  'ERASED',
  'ANONYMIZED',
  'RETAINED'
);

ALTER TYPE "AuditTargetType" ADD VALUE 'PRIVACY_INVENTORY';
ALTER TYPE "AuditTargetType" ADD VALUE 'PRIVACY_EXECUTION';
ALTER TYPE "AuditTargetType" ADD VALUE 'PRIVACY_EXPORT_ARTIFACT';
ALTER TYPE "AuditTargetType" ADD VALUE 'LEGAL_DOCUMENT';
ALTER TYPE "AuditTargetType" ADD VALUE 'LEGAL_PUBLICATION';
ALTER TYPE "AuditTargetType" ADD VALUE 'PROCESSING_APPROVAL';
ALTER TYPE "AuditTargetType" ADD VALUE 'LEGAL_HOLD';
ALTER TYPE "AuditTargetType" ADD VALUE 'ANALYTICS_CONSENT';

ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_INVENTORY_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_REVISION_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_PUBLICATION_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_PUBLICATION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_APPROVAL_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_EXECUTION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_PROCESSOR_OUTCOME_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_EXECUTION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_EXPORT_ARTIFACT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_EXPORT_ARTIFACT_DOWNLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_HOLD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_CONSENT_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PRIVACY_RESTORE_RECONCILED';

ALTER TYPE "PrivacyRequestEventKind" ADD VALUE 'EXECUTION_STARTED';
ALTER TYPE "PrivacyRequestEventKind" ADD VALUE 'PROCESSOR_UPDATED';
ALTER TYPE "PrivacyRequestEventKind" ADD VALUE 'PARTIAL';
ALTER TYPE "PrivacyRequestEventKind" ADD VALUE 'ARTIFACT_READY';
ALTER TYPE "PrivacyDeletionOutcomeCode"
  ADD VALUE 'ERASURE_OR_ANONYMIZATION_COMPLETED';
ALTER TYPE "PrivacyDeletionOutcomeCode"
  ADD VALUE 'PARTIALLY_RETAINED_WITH_BASIS';

CREATE TABLE "PrivacyDataInventoryVersion" (
  "id" UUID NOT NULL,
  "version" VARCHAR(32) NOT NULL,
  "status" "PrivacyInventoryStatus" NOT NULL DEFAULT 'DRAFT',
  "contentHash" CHAR(64) NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "reviewRef" VARCHAR(255),
  "effectiveAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivacyDataInventoryVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_inventory_state_check" CHECK (
    ("status" IN ('DRAFT', 'REVIEWED') AND "effectiveAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'ACTIVE' AND "effectiveAt" IS NOT NULL AND "revokedAt" IS NULL AND "reviewRef" IS NOT NULL)
    OR ("status" = 'REVOKED' AND "effectiveAt" IS NOT NULL AND "revokedAt" IS NOT NULL AND "reviewRef" IS NOT NULL)
  )
);

CREATE TABLE "PrivacyDataInventoryEntry" (
  "id" UUID NOT NULL,
  "inventoryVersionId" UUID NOT NULL,
  "entityKey" VARCHAR(96) NOT NULL,
  "fieldScope" VARCHAR(255) NOT NULL,
  "subjectClass" "PrivacySubjectClass" NOT NULL,
  "purposeCode" VARCHAR(96) NOT NULL,
  "legalBasisCode" VARCHAR(96) NOT NULL,
  "processorKey" VARCHAR(96) NOT NULL,
  "storageRegion" VARCHAR(64) NOT NULL,
  "retentionDays" INTEGER,
  "exportOutcome" "PrivacyInventoryOutcome" NOT NULL,
  "correctionOutcome" "PrivacyInventoryOutcome" NOT NULL,
  "erasureOutcome" "PrivacyInventoryOutcome" NOT NULL,
  "holdRuleCode" VARCHAR(96) NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivacyDataInventoryEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_inventory_retention_check" CHECK (
    "retentionDays" IS NULL OR ("retentionDays" BETWEEN 1 AND 36500)
  )
);

CREATE TABLE "LegalDocument" (
  "id" UUID NOT NULL,
  "type" "LegalDocumentType" NOT NULL,
  "locale" VARCHAR(16) NOT NULL DEFAULT 'de-CH',
  "slug" VARCHAR(96) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalRevision" (
  "id" UUID NOT NULL,
  "legalDocumentId" UUID NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "status" "LegalRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "versionLabel" VARCHAR(32) NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "changeSummary" VARCHAR(1000) NOT NULL,
  "requiresReconsent" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_revision_positive_number_check" CHECK ("revisionNumber" > 0),
  CONSTRAINT "legal_revision_review_check" CHECK (
    ("status" IN ('DRAFT', 'IN_REVIEW') AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
    OR (
      "status" IN ('APPROVED', 'REJECTED')
      AND "reviewedByUserId" IS NOT NULL
      AND "reviewedAt" IS NOT NULL
      AND "reviewedByUserId" <> "createdByUserId"
    )
  )
);

CREATE TABLE "LegalPublication" (
  "id" UUID NOT NULL,
  "legalDocumentId" UUID NOT NULL,
  "legalRevisionId" UUID NOT NULL,
  "status" "LegalPublicationStatus" NOT NULL DEFAULT 'CURRENT',
  "publicationHash" CHAR(64) NOT NULL,
  "publishedByUserId" UUID NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReasonCode" VARCHAR(96),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalPublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_publication_time_check" CHECK (
    ("expiresAt" IS NULL OR "expiresAt" > "effectiveAt")
    AND (
      ("status" = 'CURRENT' AND "revokedAt" IS NULL AND "revokeReasonCode" IS NULL)
      OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokeReasonCode" IS NOT NULL)
      OR ("status" = 'EXPIRED' AND "expiresAt" IS NOT NULL AND "revokedAt" IS NULL)
    )
  )
);

CREATE TABLE "ProcessingApproval" (
  "id" UUID NOT NULL,
  "scope" VARCHAR(128) NOT NULL,
  "region" VARCHAR(64) NOT NULL,
  "processorKey" VARCHAR(96) NOT NULL,
  "version" VARCHAR(32) NOT NULL,
  "status" "ProcessingApprovalStatus" NOT NULL DEFAULT 'DRAFT',
  "legalPublicationId" UUID,
  "legalBasisRef" VARCHAR(255) NOT NULL,
  "avgDecisionRef" VARCHAR(255),
  "dpaRef" VARCHAR(255),
  "dsfaDecision" VARCHAR(32) NOT NULL,
  "dsfaDecisionRef" VARCHAR(255),
  "owner" VARCHAR(160) NOT NULL,
  "approvedBy" VARCHAR(160),
  "effectiveAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "reviewAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReasonCode" VARCHAR(96),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "processing_approval_dsfa_check" CHECK (
    "dsfaDecision" IN ('REQUIRED', 'NOT_REQUIRED', 'APPROVED')
    AND (
      "dsfaDecision" = 'REQUIRED'
      OR "dsfaDecisionRef" IS NOT NULL
    )
  ),
  CONSTRAINT "processing_approval_state_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "approvedBy" IS NULL
      AND "effectiveAt" IS NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'APPROVED'
      AND "approvedBy" IS NOT NULL
      AND "effectiveAt" IS NOT NULL
      AND "legalPublicationId" IS NOT NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'REVOKED'
      AND "approvedBy" IS NOT NULL
      AND "effectiveAt" IS NOT NULL
      AND "revokedAt" IS NOT NULL
      AND "revokeReasonCode" IS NOT NULL
    )
    OR (
      "status" = 'EXPIRED'
      AND "approvedBy" IS NOT NULL
      AND "effectiveAt" IS NOT NULL
      AND "expiresAt" IS NOT NULL
      AND "revokedAt" IS NULL
    )
  ),
  CONSTRAINT "processing_approval_time_check" CHECK (
    "reviewAt" > "createdAt"
    AND ("expiresAt" IS NULL OR ("effectiveAt" IS NOT NULL AND "expiresAt" > "effectiveAt"))
  )
);

CREATE TABLE "PrivacyExecution" (
  "id" UUID NOT NULL,
  "privacyRequestId" UUID NOT NULL,
  "inventoryVersionId" UUID NOT NULL,
  "processingApprovalId" UUID,
  "kind" "PrivacyExecutionKind" NOT NULL,
  "status" "PrivacyExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "subjectClass" "PrivacySubjectClass" NOT NULL,
  "subjectReferenceHash" CHAR(64) NOT NULL,
  "policyVersion" VARCHAR(32) NOT NULL,
  "requiredProcessors" TEXT[] NOT NULL,
  "checkpoint" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "approvedByUserId" UUID,
  "approvalEvidenceRef" VARCHAR(255),
  "stepUpEvidenceRef" VARCHAR(255),
  "lastErrorClass" VARCHAR(64),
  "nextRetryAt" TIMESTAMPTZ(3),
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PrivacyExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_execution_bounds_check" CHECK (
    cardinality("requiredProcessors") BETWEEN 1 AND 100
    AND "checkpoint" BETWEEN 0 AND 100
    AND "attemptCount" BETWEEN 0 AND 100
  ),
  CONSTRAINT "privacy_execution_evidence_check" CHECK (
    "status" <> 'COMPLETED'
    OR (
      "completedAt" IS NOT NULL
      AND "approvedByUserId" IS NOT NULL
      AND "approvalEvidenceRef" IS NOT NULL
      AND "stepUpEvidenceRef" IS NOT NULL
      AND "processingApprovalId" IS NOT NULL
    )
  )
);

CREATE TABLE "PrivacyProcessorOutcome" (
  "id" UUID NOT NULL,
  "privacyExecutionId" UUID NOT NULL,
  "processorKey" VARCHAR(96) NOT NULL,
  "dedupeKey" VARCHAR(160) NOT NULL,
  "status" "PrivacyProcessorOutcomeStatus" NOT NULL DEFAULT 'PENDING',
  "checkpoint" VARCHAR(255),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "outcomeCode" VARCHAR(96),
  "retainedBasisRef" VARCHAR(255),
  "providerReceiptHash" CHAR(64),
  "lastErrorClass" VARCHAR(64),
  "nextRetryAt" TIMESTAMPTZ(3),
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PrivacyProcessorOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_processor_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 100),
  CONSTRAINT "privacy_processor_terminal_check" CHECK (
    (
      "status" IN ('PENDING', 'RUNNING', 'RETRY_REQUIRED')
      AND "completedAt" IS NULL
    )
    OR (
      "status" IN ('SUCCEEDED', 'RETAINED', 'FAILED_TERMINAL')
      AND "completedAt" IS NOT NULL
      AND "outcomeCode" IS NOT NULL
    )
  ),
  CONSTRAINT "privacy_processor_retained_check" CHECK (
    "status" <> 'RETAINED' OR "retainedBasisRef" IS NOT NULL
  )
);

CREATE TABLE "PrivacyExportArtifact" (
  "id" UUID NOT NULL,
  "privacyRequestId" UUID NOT NULL,
  "privacyExecutionId" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "status" "PrivacyExportArtifactStatus" NOT NULL DEFAULT 'BUILDING',
  "objectKey" VARCHAR(512) NOT NULL,
  "objectVersion" VARCHAR(128) NOT NULL,
  "encryptionKeyVersion" VARCHAR(32) NOT NULL,
  "storageRegion" VARCHAR(64) NOT NULL,
  "manifest" JSONB NOT NULL,
  "manifestHash" CHAR(64) NOT NULL,
  "packageSha256" CHAR(64),
  "sizeBytes" INTEGER,
  "downloadTokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PrivacyExportArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_export_artifact_ttl_check" CHECK (
    "expiresAt" > "createdAt"
    AND "expiresAt" <= "createdAt" + INTERVAL '15 minutes'
  ),
  CONSTRAINT "privacy_export_artifact_state_check" CHECK (
    (
      "status" = 'BUILDING'
      AND "packageSha256" IS NULL
      AND "sizeBytes" IS NULL
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'READY'
      AND "packageSha256" IS NOT NULL
      AND "sizeBytes" > 0
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'CONSUMED'
      AND "packageSha256" IS NOT NULL
      AND "sizeBytes" > 0
      AND "consumedAt" IS NOT NULL
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'REVOKED'
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NOT NULL
    )
    OR ("status" IN ('EXPIRED', 'FAILED') AND "consumedAt" IS NULL)
  )
);

CREATE TABLE "LegalHold" (
  "id" UUID NOT NULL,
  "subjectUserId" UUID,
  "subjectReferenceHash" CHAR(64) NOT NULL,
  "entityType" VARCHAR(96) NOT NULL,
  "entityReferenceHash" CHAR(64) NOT NULL,
  "scope" VARCHAR(128) NOT NULL,
  "status" "LegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "basisRef" VARCHAR(255) NOT NULL,
  "safeReasonCode" VARCHAR(96) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "reviewAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3),
  "releasedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_hold_time_check" CHECK (
    "reviewAt" > "startsAt"
    AND ("endsAt" IS NULL OR "endsAt" > "startsAt")
  ),
  CONSTRAINT "legal_hold_state_check" CHECK (
    ("status" = 'ACTIVE' AND "releasedAt" IS NULL)
    OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "endsAt" IS NOT NULL AND "releasedAt" IS NULL)
  )
);

CREATE TABLE "ErasureProof" (
  "id" UUID NOT NULL,
  "privacyExecutionId" UUID NOT NULL,
  "processorKey" VARCHAR(96) NOT NULL,
  "entityKey" VARCHAR(96) NOT NULL,
  "subjectReferenceHash" CHAR(64) NOT NULL,
  "action" "PrivacyErasureAction" NOT NULL,
  "proofDigest" CHAR(64) NOT NULL,
  "retainedBasisRef" VARCHAR(255),
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErasureProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "erasure_proof_retained_check" CHECK (
    ("action" = 'RETAINED' AND "retainedBasisRef" IS NOT NULL)
    OR ("action" <> 'RETAINED' AND "retainedBasisRef" IS NULL)
  )
);

CREATE TABLE "PrivacyTombstone" (
  "id" UUID NOT NULL,
  "subjectReferenceHash" CHAR(64) NOT NULL,
  "processorKey" VARCHAR(96) NOT NULL,
  "entityKey" VARCHAR(96) NOT NULL,
  "erasureProofDigest" CHAR(64) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "reconciledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivacyTombstone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsConsentEvent" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "pseudonymousSubjectId" VARCHAR(128),
  "eventFamily" VARCHAR(96) NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "policyVersion" VARCHAR(32) NOT NULL,
  "noticeHash" CHAR(64) NOT NULL,
  "legalPublicationId" UUID NOT NULL,
  "processingApprovalId" UUID NOT NULL,
  "pseudonymEpoch" INTEGER NOT NULL,
  "actorUserId" UUID,
  "reasonCode" VARCHAR(96) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsConsentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_consent_subject_check" CHECK (
    ("userId" IS NOT NULL AND "pseudonymousSubjectId" IS NULL)
    OR ("userId" IS NULL AND "pseudonymousSubjectId" IS NOT NULL)
  ),
  CONSTRAINT "analytics_consent_epoch_check" CHECK ("pseudonymEpoch" > 0)
);

CREATE UNIQUE INDEX "PrivacyDataInventoryVersion_version_key"
  ON "PrivacyDataInventoryVersion"("version");
CREATE UNIQUE INDEX "PrivacyDataInventoryVersion_contentHash_key"
  ON "PrivacyDataInventoryVersion"("contentHash");
CREATE UNIQUE INDEX "privacy_inventory_one_active"
  ON "PrivacyDataInventoryVersion" ((1))
  WHERE "status" = 'ACTIVE';
CREATE INDEX "PrivacyDataInventoryVersion_status_effectiveAt_idx"
  ON "PrivacyDataInventoryVersion"("status", "effectiveAt");
CREATE UNIQUE INDEX "PrivacyDataInventoryEntry_inventoryVersionId_entityKey_fiel_key"
  ON "PrivacyDataInventoryEntry"(
    "inventoryVersionId",
    "entityKey",
    "fieldScope",
    "subjectClass",
    "processorKey"
  );
CREATE INDEX "PrivacyDataInventoryEntry_inventoryVersionId_subjectClass_p_idx"
  ON "PrivacyDataInventoryEntry"("inventoryVersionId", "subjectClass", "processorKey");

CREATE UNIQUE INDEX "LegalDocument_slug_key" ON "LegalDocument"("slug");
CREATE UNIQUE INDEX "LegalDocument_type_locale_key" ON "LegalDocument"("type", "locale");
CREATE UNIQUE INDEX "LegalRevision_legalDocumentId_revisionNumber_key"
  ON "LegalRevision"("legalDocumentId", "revisionNumber");
CREATE UNIQUE INDEX "LegalRevision_legalDocumentId_versionLabel_key"
  ON "LegalRevision"("legalDocumentId", "versionLabel");
CREATE INDEX "LegalRevision_legalDocumentId_status_createdAt_idx"
  ON "LegalRevision"("legalDocumentId", "status", "createdAt");
CREATE UNIQUE INDEX "LegalPublication_legalRevisionId_key"
  ON "LegalPublication"("legalRevisionId");
CREATE UNIQUE INDEX "legal_publication_one_current"
  ON "LegalPublication"("legalDocumentId")
  WHERE "status" = 'CURRENT';
CREATE INDEX "LegalPublication_legalDocumentId_status_effectiveAt_idx"
  ON "LegalPublication"("legalDocumentId", "status", "effectiveAt");

CREATE UNIQUE INDEX "ProcessingApproval_scope_region_processorKey_version_key"
  ON "ProcessingApproval"("scope", "region", "processorKey", "version");
CREATE INDEX "ProcessingApproval_scope_processorKey_status_effectiveAt_ex_idx"
  ON "ProcessingApproval"("scope", "processorKey", "status", "effectiveAt", "expiresAt");

CREATE UNIQUE INDEX "PrivacyExecution_privacyRequestId_kind_key"
  ON "PrivacyExecution"("privacyRequestId", "kind");
CREATE INDEX "PrivacyExecution_status_nextRetryAt_createdAt_idx"
  ON "PrivacyExecution"("status", "nextRetryAt", "createdAt");
CREATE INDEX "PrivacyExecution_inventoryVersionId_kind_status_idx"
  ON "PrivacyExecution"("inventoryVersionId", "kind", "status");
CREATE UNIQUE INDEX "PrivacyProcessorOutcome_dedupeKey_key"
  ON "PrivacyProcessorOutcome"("dedupeKey");
CREATE UNIQUE INDEX "PrivacyProcessorOutcome_privacyExecutionId_processorKey_key"
  ON "PrivacyProcessorOutcome"("privacyExecutionId", "processorKey");
CREATE INDEX "PrivacyProcessorOutcome_status_nextRetryAt_createdAt_idx"
  ON "PrivacyProcessorOutcome"("status", "nextRetryAt", "createdAt");

CREATE UNIQUE INDEX "PrivacyExportArtifact_privacyExecutionId_key"
  ON "PrivacyExportArtifact"("privacyExecutionId");
CREATE UNIQUE INDEX "PrivacyExportArtifact_objectKey_key"
  ON "PrivacyExportArtifact"("objectKey");
CREATE UNIQUE INDEX "PrivacyExportArtifact_downloadTokenHash_key"
  ON "PrivacyExportArtifact"("downloadTokenHash");
CREATE UNIQUE INDEX "PrivacyExportArtifact_id_ownerUserId_key"
  ON "PrivacyExportArtifact"("id", "ownerUserId");
CREATE INDEX "PrivacyExportArtifact_ownerUserId_status_expiresAt_idx"
  ON "PrivacyExportArtifact"("ownerUserId", "status", "expiresAt");
CREATE INDEX "PrivacyExportArtifact_privacyRequestId_createdAt_idx"
  ON "PrivacyExportArtifact"("privacyRequestId", "createdAt");

CREATE INDEX "LegalHold_subjectReferenceHash_status_reviewAt_idx"
  ON "LegalHold"("subjectReferenceHash", "status", "reviewAt");
CREATE INDEX "LegalHold_entityType_entityReferenceHash_status_idx"
  ON "LegalHold"("entityType", "entityReferenceHash", "status");
CREATE UNIQUE INDEX "ErasureProof_privacyExecutionId_processorKey_entityKey_key"
  ON "ErasureProof"("privacyExecutionId", "processorKey", "entityKey");
CREATE INDEX "ErasureProof_subjectReferenceHash_occurredAt_idx"
  ON "ErasureProof"("subjectReferenceHash", "occurredAt");
CREATE UNIQUE INDEX "PrivacyTombstone_subjectReferenceHash_processorKey_entityKe_key"
  ON "PrivacyTombstone"("subjectReferenceHash", "processorKey", "entityKey");
CREATE INDEX "PrivacyTombstone_reconciledAt_effectiveAt_idx"
  ON "PrivacyTombstone"("reconciledAt", "effectiveAt");
CREATE INDEX "AnalyticsConsentEvent_userId_eventFamily_effectiveAt_idx"
  ON "AnalyticsConsentEvent"("userId", "eventFamily", "effectiveAt");
CREATE INDEX "AnalyticsConsentEvent_pseudonymousSubjectId_eventFamily_eff_idx"
  ON "AnalyticsConsentEvent"("pseudonymousSubjectId", "eventFamily", "effectiveAt");

ALTER TABLE "PrivacyDataInventoryEntry"
  ADD CONSTRAINT "PrivacyDataInventoryEntry_inventoryVersionId_fkey"
  FOREIGN KEY ("inventoryVersionId")
  REFERENCES "PrivacyDataInventoryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalRevision"
  ADD CONSTRAINT "LegalRevision_legalDocumentId_fkey"
  FOREIGN KEY ("legalDocumentId")
  REFERENCES "LegalDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalPublication"
  ADD CONSTRAINT "LegalPublication_legalDocumentId_fkey"
  FOREIGN KEY ("legalDocumentId")
  REFERENCES "LegalDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalPublication"
  ADD CONSTRAINT "LegalPublication_legalRevisionId_fkey"
  FOREIGN KEY ("legalRevisionId")
  REFERENCES "LegalRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessingApproval"
  ADD CONSTRAINT "ProcessingApproval_legalPublicationId_fkey"
  FOREIGN KEY ("legalPublicationId")
  REFERENCES "LegalPublication"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExecution"
  ADD CONSTRAINT "PrivacyExecution_privacyRequestId_fkey"
  FOREIGN KEY ("privacyRequestId")
  REFERENCES "PrivacyRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExecution"
  ADD CONSTRAINT "PrivacyExecution_inventoryVersionId_fkey"
  FOREIGN KEY ("inventoryVersionId")
  REFERENCES "PrivacyDataInventoryVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExecution"
  ADD CONSTRAINT "PrivacyExecution_processingApprovalId_fkey"
  FOREIGN KEY ("processingApprovalId")
  REFERENCES "ProcessingApproval"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExecution"
  ADD CONSTRAINT "PrivacyExecution_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyProcessorOutcome"
  ADD CONSTRAINT "PrivacyProcessorOutcome_privacyExecutionId_fkey"
  FOREIGN KEY ("privacyExecutionId")
  REFERENCES "PrivacyExecution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExportArtifact"
  ADD CONSTRAINT "PrivacyExportArtifact_privacyRequestId_fkey"
  FOREIGN KEY ("privacyRequestId")
  REFERENCES "PrivacyRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExportArtifact"
  ADD CONSTRAINT "PrivacyExportArtifact_privacyExecutionId_fkey"
  FOREIGN KEY ("privacyExecutionId")
  REFERENCES "PrivacyExecution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyExportArtifact"
  ADD CONSTRAINT "PrivacyExportArtifact_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold"
  ADD CONSTRAINT "LegalHold_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold"
  ADD CONSTRAINT "LegalHold_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold"
  ADD CONSTRAINT "LegalHold_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErasureProof"
  ADD CONSTRAINT "ErasureProof_privacyExecutionId_fkey"
  FOREIGN KEY ("privacyExecutionId")
  REFERENCES "PrivacyExecution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalyticsConsentEvent"
  ADD CONSTRAINT "AnalyticsConsentEvent_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalyticsConsentEvent"
  ADD CONSTRAINT "AnalyticsConsentEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalyticsConsentEvent"
  ADD CONSTRAINT "AnalyticsConsentEvent_legalPublicationId_fkey"
  FOREIGN KEY ("legalPublicationId")
  REFERENCES "LegalPublication"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalyticsConsentEvent"
  ADD CONSTRAINT "AnalyticsConsentEvent_processingApprovalId_fkey"
  FOREIGN KEY ("processingApprovalId")
  REFERENCES "ProcessingApproval"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION phase22_legal_publication_scope_guard()
RETURNS trigger AS $$
DECLARE
  revision_document UUID;
  revision_status "LegalRevisionStatus";
  revision_hash CHAR(64);
  revision_creator UUID;
  revision_reviewer UUID;
BEGIN
  SELECT "legalDocumentId", "status", "contentHash", "createdByUserId", "reviewedByUserId"
    INTO revision_document, revision_status, revision_hash, revision_creator, revision_reviewer
    FROM "LegalRevision"
   WHERE "id" = NEW."legalRevisionId"
   FOR SHARE;
  IF revision_document IS NULL
     OR revision_document <> NEW."legalDocumentId"
     OR revision_status <> 'APPROVED'
     OR revision_hash <> NEW."publicationHash"
     OR NEW."publishedByUserId" IN (revision_creator, revision_reviewer)
  THEN
    RAISE EXCEPTION 'invalid legal publication approval chain';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase22_legal_publication_scope_guard_trigger
BEFORE INSERT ON "LegalPublication"
FOR EACH ROW EXECUTE FUNCTION phase22_legal_publication_scope_guard();

CREATE FUNCTION phase22_execution_completion_guard()
RETURNS trigger AS $$
DECLARE
  open_count INTEGER;
  terminal_count INTEGER;
BEGIN
  IF NEW."status" = 'COMPLETED' AND OLD."status" <> 'COMPLETED' THEN
    SELECT
      count(*) FILTER (
        WHERE "status" NOT IN ('SUCCEEDED', 'RETAINED')
      ),
      count(*)
      INTO open_count, terminal_count
      FROM "PrivacyProcessorOutcome"
     WHERE "privacyExecutionId" = NEW."id";
    IF open_count <> 0
       OR terminal_count <> cardinality(NEW."requiredProcessors")
       OR NEW."checkpoint" <> cardinality(NEW."requiredProcessors")
    THEN
      RAISE EXCEPTION 'privacy execution cannot complete with open processor outcomes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase22_execution_completion_guard_trigger
BEFORE UPDATE ON "PrivacyExecution"
FOR EACH ROW EXECUTE FUNCTION phase22_execution_completion_guard();

CREATE FUNCTION phase22_export_single_use_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD."consumedAt" IS NOT NULL
     AND (
       NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt"
       OR NEW."status" IS DISTINCT FROM OLD."status"
     )
  THEN
    RAISE EXCEPTION 'privacy export consumption is immutable';
  END IF;
  IF OLD."status" <> 'CONSUMED'
     AND NEW."status" = 'CONSUMED'
     AND (
       OLD."status" <> 'READY'
       OR OLD."consumedAt" IS NOT NULL
       OR NEW."consumedAt" IS NULL
     )
  THEN
    RAISE EXCEPTION 'invalid privacy export consumption';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase22_export_single_use_guard_trigger
BEFORE UPDATE ON "PrivacyExportArtifact"
FOR EACH ROW EXECUTE FUNCTION phase22_export_single_use_guard();

CREATE FUNCTION phase22_forbid_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'phase 22 evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase22_erasure_proof_append_only_update
BEFORE UPDATE OR DELETE ON "ErasureProof"
FOR EACH ROW EXECUTE FUNCTION phase22_forbid_evidence_mutation();
CREATE TRIGGER phase22_tombstone_append_only_delete
BEFORE DELETE ON "PrivacyTombstone"
FOR EACH ROW EXECUTE FUNCTION phase22_forbid_evidence_mutation();
CREATE TRIGGER phase22_analytics_consent_append_only
BEFORE UPDATE OR DELETE ON "AnalyticsConsentEvent"
FOR EACH ROW EXECUTE FUNCTION phase22_forbid_evidence_mutation();
CREATE TRIGGER phase22_inventory_entry_append_only
BEFORE UPDATE OR DELETE ON "PrivacyDataInventoryEntry"
FOR EACH ROW EXECUTE FUNCTION phase22_forbid_evidence_mutation();
