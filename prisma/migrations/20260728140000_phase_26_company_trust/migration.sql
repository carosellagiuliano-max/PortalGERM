-- CreateEnum
CREATE TYPE "CompanyVerificationEvidenceType" AS ENUM ('UID_REGISTER', 'DOMAIN_CHALLENGE', 'DOCUMENT', 'MANUAL_EXCEPTION', 'LEGACY_MANUAL');

-- CreateEnum
CREATE TYPE "CompanyVerificationEvidenceStatus" AS ENUM ('PENDING', 'VALID', 'MISMATCH', 'FAILED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CompanyVerificationScope" AS ENUM ('LEGACY_PROFILE', 'COMPANY_IDENTITY', 'DOMAIN_CONTROL', 'REPRESENTATION');

-- CreateEnum
CREATE TYPE "CompanyVerificationCheckResult" AS ENUM ('EXACT_MATCH', 'PARTIAL_MATCH', 'MISMATCH', 'NOT_FOUND', 'MALFORMED', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR');

-- CreateEnum
CREATE TYPE "CompanyDomainChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CompanyVerificationRiskLevel" AS ENUM ('NORMAL', 'HIGH', 'MANUAL_EXCEPTION');

-- CreateEnum
CREATE TYPE "CompanyVerificationDecisionKind" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'REVOKED', 'RESTORED');

-- CreateEnum
CREATE TYPE "CompanyVerificationAppealStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CompanyTrustLevel" AS ENUM ('NONE', 'LEGACY', 'STRONG');

-- CreateEnum
CREATE TYPE "CompanyTrustStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'ON_HOLD', 'REVOKED');

-- CreateEnum
CREATE TYPE "CompanyTrustRiskState" AS ENUM ('CLEAR', 'REVIEW', 'HOLD', 'REVOKED');

-- AlterEnum
ALTER TYPE "DocumentPurpose" ADD VALUE 'COMPANY_VERIFICATION';

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_currentVersionId_candidateProfileId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentVersion" DROP CONSTRAINT "DocumentVersion_documentId_candidateProfileId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentUploadIntent" DROP CONSTRAINT "DocumentUploadIntent_documentVersionId_candidateProfileId_fkey";

-- DropIndex
DROP INDEX "Document_currentVersionId_candidateProfileId_key";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "companyId" UUID,
ALTER COLUMN "candidateProfileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "companyId" UUID,
ALTER COLUMN "candidateProfileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DocumentUploadIntent" ADD COLUMN     "companyId" UUID,
ALTER COLUMN "candidateProfileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CompanyVerificationRequest" ADD COLUMN     "assignedAt" TIMESTAMPTZ(3),
ADD COLUMN     "assignedReviewerUserId" UUID,
ADD COLUMN     "decidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "policyVersion" VARCHAR(48) NOT NULL DEFAULT 'COMPANY_TRUST_POLICY_V1',
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "reviewDueAt" TIMESTAMPTZ(3),
ADD COLUMN     "reviewStartedAt" TIMESTAMPTZ(3),
ADD COLUMN     "riskLevel" "CompanyVerificationRiskLevel" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CompanyVerificationEvidence" (
    "id" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdByUserId" UUID,
    "documentVersionId" UUID,
    "domainChallengeId" UUID,
    "type" "CompanyVerificationEvidenceType" NOT NULL,
    "scope" "CompanyVerificationScope" NOT NULL,
    "status" "CompanyVerificationEvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "source" VARCHAR(64) NOT NULL,
    "providerKey" VARCHAR(64),
    "normalizedIdentifier" VARCHAR(255),
    "responseDigest" CHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64),
    "checkedAt" TIMESTAMPTZ(3),
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVerificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVerificationCheck" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "providerUseCase" VARCHAR(96) NOT NULL,
    "adapterKey" VARCHAR(64) NOT NULL,
    "adapterVersion" VARCHAR(32) NOT NULL,
    "inputSchemaVersion" VARCHAR(32) NOT NULL,
    "outputSchemaVersion" VARCHAR(32) NOT NULL,
    "result" "CompanyVerificationCheckResult" NOT NULL,
    "uidMatched" BOOLEAN,
    "nameMatched" BOOLEAN,
    "cantonMatched" BOOLEAN,
    "domainMatched" BOOLEAN,
    "requestDigest" CHAR(64) NOT NULL,
    "responseDigest" CHAR(64) NOT NULL,
    "failureClass" "WorkFailureClass",
    "failureCode" VARCHAR(64),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL,
    "providerRequestKey" VARCHAR(160) NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVerificationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyDomainChallenge" (
    "id" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "issuedByUserId" UUID NOT NULL,
    "supersedesChallengeId" UUID,
    "domain" VARCHAR(253) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "proofDigest" CHAR(64),
    "status" "CompanyDomainChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "supersededAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDomainChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVerificationDecision" (
    "id" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "kind" "CompanyVerificationDecisionKind" NOT NULL,
    "scope" "CompanyVerificationScope" NOT NULL,
    "riskLevel" "CompanyVerificationRiskLevel" NOT NULL,
    "policyVersion" VARCHAR(48) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVerificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTrustProjection" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "decisionId" UUID,
    "scope" "CompanyVerificationScope" NOT NULL,
    "level" "CompanyTrustLevel" NOT NULL,
    "status" "CompanyTrustStatus" NOT NULL,
    "riskState" "CompanyTrustRiskState" NOT NULL DEFAULT 'CLEAR',
    "policyVersion" VARCHAR(48) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "changedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyTrustProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVerificationAppeal" (
    "id" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "appellantUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "status" "CompanyVerificationAppealStatus" NOT NULL DEFAULT 'OPEN',
    "safeStatement" VARCHAR(2000) NOT NULL,
    "statementDigest" CHAR(64) NOT NULL,
    "decisionReasonCode" VARCHAR(64),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyVerificationAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationEvidence_documentVersionId_key" ON "CompanyVerificationEvidence"("documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationEvidence_domainChallengeId_key" ON "CompanyVerificationEvidence"("domainChallengeId");

-- CreateIndex
CREATE INDEX "CompanyVerificationEvidence_verificationRequestId_type_stat_idx" ON "CompanyVerificationEvidence"("verificationRequestId", "type", "status", "validTo");

-- CreateIndex
CREATE INDEX "CompanyVerificationEvidence_companyId_scope_status_validTo_idx" ON "CompanyVerificationEvidence"("companyId", "scope", "status", "validTo");

-- CreateIndex
CREATE INDEX "CompanyVerificationEvidence_status_validTo_id_idx" ON "CompanyVerificationEvidence"("status", "validTo", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationEvidence_id_companyId_key" ON "CompanyVerificationEvidence"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationCheck_providerRequestKey_key" ON "CompanyVerificationCheck"("providerRequestKey");

-- CreateIndex
CREATE INDEX "CompanyVerificationCheck_evidenceId_checkedAt_id_idx" ON "CompanyVerificationCheck"("evidenceId", "checkedAt", "id");

-- CreateIndex
CREATE INDEX "CompanyVerificationCheck_companyId_result_checkedAt_idx" ON "CompanyVerificationCheck"("companyId", "result", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomainChallenge_supersedesChallengeId_key" ON "CompanyDomainChallenge"("supersedesChallengeId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomainChallenge_tokenHash_key" ON "CompanyDomainChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanyDomainChallenge_companyId_status_expiresAt_idx" ON "CompanyDomainChallenge"("companyId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CompanyDomainChallenge_verificationRequestId_status_issuedA_idx" ON "CompanyDomainChallenge"("verificationRequestId", "status", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomainChallenge_id_companyId_key" ON "CompanyDomainChallenge"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationDecision_idempotencyKey_key" ON "CompanyVerificationDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CompanyVerificationDecision_verificationRequestId_decidedAt_idx" ON "CompanyVerificationDecision"("verificationRequestId", "decidedAt", "id");

-- CreateIndex
CREATE INDEX "CompanyVerificationDecision_companyId_kind_decidedAt_idx" ON "CompanyVerificationDecision"("companyId", "kind", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationDecision_id_companyId_key" ON "CompanyVerificationDecision"("id", "companyId");

-- CreateIndex
CREATE INDEX "CompanyTrustProjection_status_expiresAt_id_idx" ON "CompanyTrustProjection"("status", "expiresAt", "id");

-- CreateIndex
CREATE INDEX "CompanyTrustProjection_companyId_status_riskState_idx" ON "CompanyTrustProjection"("companyId", "status", "riskState");

-- CreateIndex
CREATE INDEX "CompanyTrustProjection_verificationRequestId_status_idx" ON "CompanyTrustProjection"("verificationRequestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTrustProjection_companyId_scope_key" ON "CompanyTrustProjection"("companyId", "scope");

-- CreateIndex
CREATE INDEX "CompanyVerificationAppeal_verificationRequestId_status_crea_idx" ON "CompanyVerificationAppeal"("verificationRequestId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyVerificationAppeal_companyId_status_createdAt_idx" ON "CompanyVerificationAppeal"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyVerificationAppeal_appellantUserId_status_createdAt_idx" ON "CompanyVerificationAppeal"("appellantUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Document_companyId_purpose_updatedAt_idx" ON "Document"("companyId", "purpose", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_companyId_purpose_key" ON "Document"("companyId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Document_id_companyId_key" ON "Document"("id", "companyId");

-- CreateIndex
CREATE INDEX "DocumentVersion_companyId_status_createdAt_idx" ON "DocumentVersion"("companyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_id_companyId_key" ON "DocumentVersion"("id", "companyId");

-- CreateIndex
CREATE INDEX "DocumentUploadIntent_companyId_purpose_status_expiresAt_idx" ON "DocumentUploadIntent"("companyId", "purpose", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentUploadIntent_documentVersionId_companyId_key" ON "DocumentUploadIntent"("documentVersionId", "companyId");

-- CreateIndex
CREATE INDEX "CompanyVerificationRequest_status_priority_reviewDueAt_id_idx" ON "CompanyVerificationRequest"("status", "priority", "reviewDueAt", "id");

-- CreateIndex
CREATE INDEX "CompanyVerificationRequest_assignedReviewerUserId_status_re_idx" ON "CompanyVerificationRequest"("assignedReviewerUserId", "status", "reviewDueAt", "id");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUploadIntent" ADD CONSTRAINT "DocumentUploadIntent_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUploadIntent" ADD CONSTRAINT "DocumentUploadIntent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_assignedReviewerUserId_fkey" FOREIGN KEY ("assignedReviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationEvidence" ADD CONSTRAINT "CompanyVerificationEvidence_verificationRequestId_companyI_fkey" FOREIGN KEY ("verificationRequestId", "companyId") REFERENCES "CompanyVerificationRequest"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationEvidence" ADD CONSTRAINT "CompanyVerificationEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationEvidence" ADD CONSTRAINT "CompanyVerificationEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationEvidence" ADD CONSTRAINT "CompanyVerificationEvidence_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationEvidence" ADD CONSTRAINT "CompanyVerificationEvidence_domainChallengeId_fkey" FOREIGN KEY ("domainChallengeId") REFERENCES "CompanyDomainChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationCheck" ADD CONSTRAINT "CompanyVerificationCheck_evidenceId_companyId_fkey" FOREIGN KEY ("evidenceId", "companyId") REFERENCES "CompanyVerificationEvidence"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationCheck" ADD CONSTRAINT "CompanyVerificationCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDomainChallenge" ADD CONSTRAINT "CompanyDomainChallenge_verificationRequestId_companyId_fkey" FOREIGN KEY ("verificationRequestId", "companyId") REFERENCES "CompanyVerificationRequest"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDomainChallenge" ADD CONSTRAINT "CompanyDomainChallenge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDomainChallenge" ADD CONSTRAINT "CompanyDomainChallenge_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDomainChallenge" ADD CONSTRAINT "CompanyDomainChallenge_supersedesChallengeId_fkey" FOREIGN KEY ("supersedesChallengeId") REFERENCES "CompanyDomainChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationDecision" ADD CONSTRAINT "CompanyVerificationDecision_verificationRequestId_companyI_fkey" FOREIGN KEY ("verificationRequestId", "companyId") REFERENCES "CompanyVerificationRequest"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationDecision" ADD CONSTRAINT "CompanyVerificationDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationDecision" ADD CONSTRAINT "CompanyVerificationDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationDecision" ADD CONSTRAINT "CompanyVerificationDecision_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTrustProjection" ADD CONSTRAINT "CompanyTrustProjection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTrustProjection" ADD CONSTRAINT "CompanyTrustProjection_verificationRequestId_companyId_fkey" FOREIGN KEY ("verificationRequestId", "companyId") REFERENCES "CompanyVerificationRequest"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTrustProjection" ADD CONSTRAINT "CompanyTrustProjection_decisionId_companyId_fkey" FOREIGN KEY ("decisionId", "companyId") REFERENCES "CompanyVerificationDecision"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationAppeal" ADD CONSTRAINT "CompanyVerificationAppeal_verificationRequestId_companyId_fkey" FOREIGN KEY ("verificationRequestId", "companyId") REFERENCES "CompanyVerificationRequest"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationAppeal" ADD CONSTRAINT "CompanyVerificationAppeal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationAppeal" ADD CONSTRAINT "CompanyVerificationAppeal_appellantUserId_fkey" FOREIGN KEY ("appellantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationAppeal" ADD CONSTRAINT "CompanyVerificationAppeal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 26 hardening: a vault record belongs to exactly one subject and its
-- purpose must match that subject. Existing candidate CV rows already satisfy
-- these constraints.
ALTER TABLE "Document"
  ADD CONSTRAINT "document_exactly_one_subject_check"
  CHECK (num_nonnulls("candidateProfileId", "companyId") = 1),
  ADD CONSTRAINT "document_subject_purpose_check"
  CHECK (
    ("candidateProfileId" IS NOT NULL AND "companyId" IS NULL AND "purpose" = 'CV')
    OR
    ("candidateProfileId" IS NULL AND "companyId" IS NOT NULL AND "purpose" = 'COMPANY_VERIFICATION')
  );

ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "document_version_exactly_one_subject_check"
  CHECK (num_nonnulls("candidateProfileId", "companyId") = 1);

ALTER TABLE "DocumentUploadIntent"
  ADD CONSTRAINT "document_upload_intent_exactly_one_subject_check"
  CHECK (num_nonnulls("candidateProfileId", "companyId") = 1),
  ADD CONSTRAINT "document_upload_intent_subject_purpose_check"
  CHECK (
    ("candidateProfileId" IS NOT NULL AND "companyId" IS NULL AND "purpose" = 'CV')
    OR
    ("candidateProfileId" IS NULL AND "companyId" IS NOT NULL AND "purpose" = 'COMPANY_VERIFICATION')
  );

CREATE OR REPLACE FUNCTION phase26_assert_document_subject_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_candidate UUID;
  parent_company UUID;
  version_candidate UUID;
  version_company UUID;
BEGIN
  IF TG_TABLE_NAME = 'DocumentVersion' THEN
    SELECT "candidateProfileId", "companyId"
      INTO parent_candidate, parent_company
      FROM "Document"
     WHERE "id" = NEW."documentId";
    IF NOT FOUND
      OR parent_candidate IS DISTINCT FROM NEW."candidateProfileId"
      OR parent_company IS DISTINCT FROM NEW."companyId" THEN
      RAISE EXCEPTION 'document version subject mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'document_version_subject_scope';
    END IF;
  ELSIF TG_TABLE_NAME = 'DocumentUploadIntent' THEN
    SELECT "candidateProfileId", "companyId"
      INTO version_candidate, version_company
      FROM "DocumentVersion"
     WHERE "id" = NEW."documentVersionId";
    IF NOT FOUND
      OR version_candidate IS DISTINCT FROM NEW."candidateProfileId"
      OR version_company IS DISTINCT FROM NEW."companyId" THEN
      RAISE EXCEPTION 'document upload intent subject mismatch'
        USING ERRCODE = '23514',
              CONSTRAINT = 'document_upload_intent_subject_scope';
    END IF;
  ELSE
    IF NEW."currentVersionId" IS NOT NULL THEN
      SELECT "candidateProfileId", "companyId"
        INTO version_candidate, version_company
        FROM "DocumentVersion"
       WHERE "id" = NEW."currentVersionId";
      IF NOT FOUND
        OR version_candidate IS DISTINCT FROM NEW."candidateProfileId"
        OR version_company IS DISTINCT FROM NEW."companyId" THEN
        RAISE EXCEPTION 'current document version subject mismatch'
          USING ERRCODE = '23514',
                CONSTRAINT = 'document_current_version_subject_scope';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase26_document_version_subject_scope
BEFORE INSERT OR UPDATE OF "documentId", "candidateProfileId", "companyId"
ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION phase26_assert_document_subject_scope();

CREATE TRIGGER phase26_document_upload_intent_subject_scope
BEFORE INSERT OR UPDATE OF "documentVersionId", "candidateProfileId", "companyId"
ON "DocumentUploadIntent"
FOR EACH ROW EXECUTE FUNCTION phase26_assert_document_subject_scope();

CREATE TRIGGER phase26_document_current_version_subject_scope
BEFORE INSERT OR UPDATE OF "currentVersionId", "candidateProfileId", "companyId"
ON "Document"
FOR EACH ROW EXECUTE FUNCTION phase26_assert_document_subject_scope();

-- Evidence is typed, scoped, digest-bound and has an explicit validity window.
ALTER TABLE "CompanyVerificationEvidence"
  ADD CONSTRAINT "company_verification_evidence_digest_check"
  CHECK ("responseDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "company_verification_evidence_validity_check"
  CHECK (
    ("validFrom" IS NULL AND "validTo" IS NULL)
    OR
    ("validFrom" IS NOT NULL AND "validTo" IS NOT NULL AND "validFrom" < "validTo")
  ),
  ADD CONSTRAINT "company_verification_evidence_reference_check"
  CHECK (
    ("type" = 'DOCUMENT' AND "documentVersionId" IS NOT NULL AND "domainChallengeId" IS NULL)
    OR
    ("type" = 'DOMAIN_CHALLENGE' AND "documentVersionId" IS NULL AND "domainChallengeId" IS NOT NULL)
    OR
    ("type" IN ('UID_REGISTER', 'MANUAL_EXCEPTION', 'LEGACY_MANUAL')
      AND "documentVersionId" IS NULL
      AND "domainChallengeId" IS NULL)
  ),
  ADD CONSTRAINT "company_verification_evidence_status_time_check"
  CHECK (
    ("status" = 'PENDING' AND "checkedAt" IS NULL AND "revokedAt" IS NULL)
    OR
    ("status" IN ('VALID', 'MISMATCH', 'FAILED', 'EXPIRED') AND "checkedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'REVOKED' AND "checkedAt" IS NOT NULL AND "revokedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "company_verification_current_valid_evidence_unique"
  ON "CompanyVerificationEvidence" ("verificationRequestId", "type")
  WHERE "status" = 'VALID' AND "revokedAt" IS NULL;

ALTER TABLE "CompanyVerificationCheck"
  ADD CONSTRAINT "company_verification_check_digest_check"
  CHECK (
    "requestDigest" ~ '^[a-f0-9]{64}$'
    AND "responseDigest" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "company_verification_check_latency_check"
  CHECK ("latencyMs" >= 0),
  ADD CONSTRAINT "company_verification_check_failure_check"
  CHECK (
    ("result" IN ('EXACT_MATCH', 'PARTIAL_MATCH', 'MISMATCH', 'NOT_FOUND')
      AND "failureClass" IS NULL)
    OR
    ("result" IN ('MALFORMED', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR')
      AND "failureCode" IS NOT NULL)
  );

ALTER TABLE "CompanyDomainChallenge"
  ADD CONSTRAINT "company_domain_challenge_digest_check"
  CHECK (
    "tokenHash" ~ '^[a-f0-9]{64}$'
    AND ("proofDigest" IS NULL OR "proofDigest" ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT "company_domain_challenge_window_check"
  CHECK ("issuedAt" < "expiresAt"),
  ADD CONSTRAINT "company_domain_challenge_status_time_check"
  CHECK (
    ("status" = 'PENDING' AND "verifiedAt" IS NULL AND "supersededAt" IS NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "proofDigest" IS NOT NULL AND "supersededAt" IS NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'EXPIRED' AND "verifiedAt" IS NULL AND "supersededAt" IS NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'SUPERSEDED' AND "supersededAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "company_domain_challenge_pending_unique"
  ON "CompanyDomainChallenge" ("companyId", "domain")
  WHERE "status" = 'PENDING';

-- A decision is an immutable approval fact. The requester cannot review their
-- own request; high-risk/manual exceptions require a distinct second approver.
ALTER TABLE "CompanyVerificationDecision"
  ADD CONSTRAINT "company_verification_decision_digest_check"
  CHECK ("evidenceDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "company_verification_decision_validity_check"
  CHECK (
    ("kind" IN ('APPROVED', 'RESTORED')
      AND "validFrom" IS NOT NULL
      AND "validTo" IS NOT NULL
      AND "validFrom" < "validTo")
    OR
    ("kind" IN ('CHANGES_REQUESTED', 'REJECTED', 'REVOKED')
      AND "validFrom" IS NULL
      AND "validTo" IS NULL)
  ),
  ADD CONSTRAINT "company_verification_decision_dual_approval_check"
  CHECK (
    ("riskLevel" = 'NORMAL'
      AND ("approvedByUserId" IS NULL OR "approvedByUserId" <> "decidedByUserId"))
    OR
    ("riskLevel" IN ('HIGH', 'MANUAL_EXCEPTION')
      AND "approvedByUserId" IS NOT NULL
      AND "approvedByUserId" <> "decidedByUserId")
  );

CREATE OR REPLACE FUNCTION phase26_assert_verification_decision_sod()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requester UUID;
BEGIN
  SELECT "requestedByUserId"
    INTO STRICT requester
    FROM "CompanyVerificationRequest"
   WHERE "id" = NEW."verificationRequestId"
     AND "companyId" = NEW."companyId"
   FOR KEY SHARE;
  IF requester = NEW."decidedByUserId"
    OR requester = NEW."approvedByUserId" THEN
    RAISE EXCEPTION 'verification requester cannot approve their own request'
      USING ERRCODE = '23514',
            CONSTRAINT = 'company_verification_decision_requester_sod';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase26_company_verification_decision_sod
BEFORE INSERT ON "CompanyVerificationDecision"
FOR EACH ROW EXECUTE FUNCTION phase26_assert_verification_decision_sod();

ALTER TABLE "CompanyTrustProjection"
  ADD CONSTRAINT "company_trust_projection_digest_check"
  CHECK ("evidenceDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "company_trust_projection_level_check"
  CHECK (
    ("level" = 'NONE' AND "decisionId" IS NULL)
    OR
    ("level" = 'LEGACY'
      AND "scope" = 'LEGACY_PROFILE'
      AND "decisionId" IS NULL
      AND "policyVersion" = 'COMPANY_TRUST_POLICY_V1')
    OR
    ("level" = 'STRONG'
      AND "scope" = 'COMPANY_IDENTITY'
      AND "decisionId" IS NOT NULL
      AND "policyVersion" = 'COMPANY_TRUST_POLICY_V2')
  ),
  ADD CONSTRAINT "company_trust_projection_validity_check"
  CHECK (
    ("status" IN ('ACTIVE', 'EXPIRING')
      AND (
        ("level" = 'LEGACY' AND "verifiedAt" IS NOT NULL)
        OR
        ("level" = 'STRONG'
          AND "verifiedAt" IS NOT NULL
          AND "expiresAt" IS NOT NULL
          AND "verifiedAt" < "expiresAt")
      ))
    OR
    ("status" IN ('PENDING', 'EXPIRED', 'ON_HOLD', 'REVOKED'))
  );

CREATE UNIQUE INDEX "company_verification_open_appeal_unique"
  ON "CompanyVerificationAppeal" ("verificationRequestId")
  WHERE "status" = 'OPEN';

ALTER TABLE "CompanyVerificationAppeal"
  ADD CONSTRAINT "company_verification_appeal_digest_check"
  CHECK ("statementDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "company_verification_appeal_decision_check"
  CHECK (
    ("status" = 'OPEN' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "decisionReasonCode" IS NULL)
    OR
    ("status" = 'WITHDRAWN' AND "decidedByUserId" IS NULL AND "decidedAt" IS NOT NULL)
    OR
    ("status" IN ('APPROVED', 'REJECTED')
      AND "decidedByUserId" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND "decisionReasonCode" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION phase26_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER phase26_company_verification_check_append_only
BEFORE UPDATE OR DELETE ON "CompanyVerificationCheck"
FOR EACH ROW EXECUTE FUNCTION phase26_reject_append_only_mutation();

CREATE TRIGGER phase26_company_verification_decision_append_only
BEFORE UPDATE OR DELETE ON "CompanyVerificationDecision"
FOR EACH ROW EXECUTE FUNCTION phase26_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION phase26_protect_evidence_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."verificationRequestId" IS DISTINCT FROM NEW."verificationRequestId"
    OR OLD."companyId" IS DISTINCT FROM NEW."companyId"
    OR OLD."createdByUserId" IS DISTINCT FROM NEW."createdByUserId"
    OR OLD."documentVersionId" IS DISTINCT FROM NEW."documentVersionId"
    OR OLD."domainChallengeId" IS DISTINCT FROM NEW."domainChallengeId"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."scope" IS DISTINCT FROM NEW."scope"
    OR OLD."source" IS DISTINCT FROM NEW."source"
    OR OLD."providerKey" IS DISTINCT FROM NEW."providerKey"
    OR OLD."normalizedIdentifier" IS DISTINCT FROM NEW."normalizedIdentifier"
    OR OLD."responseDigest" IS DISTINCT FROM NEW."responseDigest"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'company verification evidence provenance is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase26_company_verification_evidence_provenance
BEFORE UPDATE ON "CompanyVerificationEvidence"
FOR EACH ROW EXECUTE FUNCTION phase26_protect_evidence_provenance();

-- Explicitly classify all historical VERIFIED cycles as legacy. This preserves
-- local demo continuity but cannot satisfy the V2 strong-trust contract.
INSERT INTO "CompanyVerificationEvidence" (
  "id",
  "verificationRequestId",
  "companyId",
  "createdByUserId",
  "type",
  "scope",
  "status",
  "source",
  "providerKey",
  "responseDigest",
  "reasonCode",
  "checkedAt",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  request."id",
  request."companyId",
  request."requestedByUserId",
  'LEGACY_MANUAL',
  'LEGACY_PROFILE',
  'VALID',
  'legacy_backfill',
  NULL,
  encode(digest('phase26:legacy-evidence:' || request."id"::text, 'sha256'), 'hex'),
  'LEGACY_NOT_STRONG',
  request."updatedAt",
  CURRENT_TIMESTAMP
FROM "CompanyVerificationRequest" request
WHERE request."status" = 'VERIFIED'
  AND NOT EXISTS (
    SELECT 1
      FROM "CompanyVerificationEvidence" evidence
     WHERE evidence."verificationRequestId" = request."id"
       AND evidence."type" = 'LEGACY_MANUAL'
  );

INSERT INTO "CompanyTrustProjection" (
  "id",
  "companyId",
  "verificationRequestId",
  "decisionId",
  "scope",
  "level",
  "status",
  "riskState",
  "policyVersion",
  "evidenceDigest",
  "reasonCode",
  "verifiedAt",
  "expiresAt",
  "changedAt",
  "version",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT ON (request."companyId")
  gen_random_uuid(),
  request."companyId",
  request."id",
  NULL,
  'LEGACY_PROFILE',
  'LEGACY',
  'ACTIVE',
  'CLEAR',
  'COMPANY_TRUST_POLICY_V1',
  encode(digest('phase26:legacy-projection:' || request."id"::text, 'sha256'), 'hex'),
  'LEGACY_REVERIFY_REQUIRED',
  request."updatedAt",
  NULL,
  CURRENT_TIMESTAMP,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CompanyVerificationRequest" request
WHERE request."status" = 'VERIFIED'
ORDER BY request."companyId", request."updatedAt" DESC, request."id" DESC
ON CONFLICT ("companyId", "scope") DO NOTHING;
