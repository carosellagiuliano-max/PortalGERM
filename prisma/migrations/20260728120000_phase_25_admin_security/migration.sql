-- CreateEnum
CREATE TYPE "AdminDuty" AS ENUM ('PLATFORM', 'SECURITY', 'SUPPORT', 'MODERATION', 'FINANCE', 'PRIVACY_VERIFY', 'PRIVACY_PROCESS', 'CONTENT_SUPPLY', 'TRUST_SAFETY');

-- CreateEnum
CREATE TYPE "AuthenticatorKind" AS ENUM ('WEBAUTHN', 'TOTP');

-- CreateEnum
CREATE TYPE "AuthenticatorStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'COMPROMISED');

-- CreateEnum
CREATE TYPE "AuthenticatorChallengeKind" AS ENUM ('WEBAUTHN_REGISTRATION', 'WEBAUTHN_AUTHENTICATION', 'TOTP_ENROLLMENT', 'TOTP_AUTHENTICATION', 'RECOVERY');

-- CreateEnum
CREATE TYPE "SecurityChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'CANCELLED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AssuranceLevel" AS ENUM ('AAL1', 'AAL2', 'RECOVERY');

-- CreateEnum
CREATE TYPE "PrivilegedApprovalKind" AS ENUM ('ROLE_ASSIGNMENT', 'DIRECT_CAPABILITY_GRANT', 'BREAK_GLASS', 'TRUST_RESTORE', 'FINANCE', 'PRIVACY');

-- CreateEnum
CREATE TYPE "PrivilegedApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "BreakGlassStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RiskSubjectType" AS ENUM ('USER', 'SESSION', 'COMPANY', 'JOB', 'MESSAGE', 'CONTACT_REQUEST', 'REVEAL', 'EXPORT', 'PAYMENT');

-- CreateEnum
CREATE TYPE "RiskSignalKind" AS ENUM ('CREDENTIAL_STUFFING', 'PASSWORD_SPRAY', 'SESSION_ANOMALY', 'RECOVERY_ABUSE', 'COMPROMISED_COMPANY', 'JOB_SCAM', 'JOB_DUPLICATE', 'MASS_MESSAGING', 'MASS_CONTACT', 'REPEATED_COMPLAINT', 'REVEAL_ANOMALY', 'EXPORT_ANOMALY', 'PAYMENT_FRAUD');

-- CreateEnum
CREATE TYPE "TrustRiskDecisionKind" AS ENUM ('ALLOW', 'STEP_UP', 'HOLD', 'REVIEW', 'REVOKE');

-- CreateEnum
CREATE TYPE "TrustSafetySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TrustSafetyCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'HELD', 'REVOKED', 'APPEALED', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TrustSafetyEventKind" AS ENUM ('OPENED', 'ASSIGNED', 'REVIEW_STARTED', 'HELD', 'REVOKED', 'APPEAL_SUBMITTED', 'APPEAL_APPROVED', 'APPEAL_REJECTED', 'RESTORED', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TrustSafetyAppealStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- DropIndex
DROP INDEX "AuthAssuranceEvidence_userId_purpose_action_expiresAt_idx";

-- AlterTable
ALTER TABLE "AuthAssuranceEvidence" ADD COLUMN     "challengeId" UUID,
ADD COLUMN     "grantDigest" CHAR(64),
ADD COLUMN     "policyVersion" VARCHAR(48) NOT NULL DEFAULT 'STEP_UP_POLICY_V1',
ADD COLUMN     "resourceId" VARCHAR(160);

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "duty" "AdminDuty" NOT NULL,
    "policyVersion" VARCHAR(48) NOT NULL DEFAULT 'ADMIN_GRANTS_POLICY_V2',
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRoleCapability" (
    "id" UUID NOT NULL,
    "adminRoleId" UUID NOT NULL,
    "capability" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRoleCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRoleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adminRoleId" UUID NOT NULL,
    "grantedByUserId" UUID,
    "revokedByUserId" UUID,
    "approvalId" UUID,
    "reasonCode" VARCHAR(64) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminCapabilityGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "capability" VARCHAR(64) NOT NULL,
    "duty" "AdminDuty" NOT NULL,
    "grantedByUserId" UUID,
    "revokedByUserId" UUID,
    "approvalId" UUID,
    "reasonCode" VARCHAR(64) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminCapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Authenticator" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "AuthenticatorKind" NOT NULL,
    "status" "AuthenticatorStatus" NOT NULL DEFAULT 'PENDING',
    "label" VARCHAR(100) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Authenticator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" UUID NOT NULL,
    "authenticatorId" UUID NOT NULL,
    "credentialId" VARCHAR(1024) NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "deviceType" VARCHAR(32) NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotpCredential" (
    "id" UUID NOT NULL,
    "authenticatorId" UUID NOT NULL,
    "secretCiphertext" BYTEA NOT NULL,
    "secretNonce" BYTEA NOT NULL,
    "secretTag" BYTEA NOT NULL,
    "keyVersion" VARCHAR(32) NOT NULL,
    "algorithm" VARCHAR(16) NOT NULL DEFAULT 'SHA1',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "periodSeconds" INTEGER NOT NULL DEFAULT 30,
    "lastAcceptedStep" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TotpCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticatorChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "authenticatorId" UUID,
    "kind" "AuthenticatorChallengeKind" NOT NULL,
    "status" "SecurityChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "challengeDigest" CHAR(64) NOT NULL,
    "context" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticatorChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticatorEvent" (
    "id" UUID NOT NULL,
    "authenticatorId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticatorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAssurance" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "authenticatorId" UUID,
    "level" "AssuranceLevel" NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "policyVersion" VARCHAR(48) NOT NULL DEFAULT 'ADMIN_MFA_POLICY_V1',
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionAssurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepUpChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "action" VARCHAR(96) NOT NULL,
    "tenantId" UUID,
    "resourceId" VARCHAR(160),
    "policyVersion" VARCHAR(48) NOT NULL,
    "requiredLevel" "AssuranceLevel" NOT NULL,
    "status" "SecurityChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "challengeDigest" CHAR(64) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepUpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivilegedApproval" (
    "id" UUID NOT NULL,
    "kind" "PrivilegedApprovalKind" NOT NULL,
    "status" "PrivilegedApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "rejectedByUserId" UUID,
    "targetType" VARCHAR(48) NOT NULL,
    "targetId" VARCHAR(160) NOT NULL,
    "duty" "AdminDuty" NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivilegedApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakGlassGrant" (
    "id" UUID NOT NULL,
    "approvalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "revokedByUserId" UUID,
    "status" "BreakGlassStatus" NOT NULL DEFAULT 'PENDING',
    "incidentReference" VARCHAR(160) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "capabilities" TEXT[],
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "alertDedupeKey" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakGlassGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskSignal" (
    "id" UUID NOT NULL,
    "kind" "RiskSignalKind" NOT NULL,
    "subjectType" "RiskSubjectType" NOT NULL,
    "subjectId" VARCHAR(160) NOT NULL,
    "companyId" UUID,
    "source" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "policyVersion" VARCHAR(48) NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(3),
    "windowEndedAt" TIMESTAMPTZ(3),
    "observedCount" INTEGER,
    "evidenceDigest" CHAR(64) NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "recordedByUserId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustRiskDecision" (
    "id" UUID NOT NULL,
    "riskSignalId" UUID NOT NULL,
    "kind" "TrustRiskDecisionKind" NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "policyVersion" VARCHAR(48) NOT NULL,
    "effectScope" TEXT[],
    "evidenceDigest" CHAR(64) NOT NULL,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustRiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustSafetyCase" (
    "id" UUID NOT NULL,
    "riskDecisionId" UUID NOT NULL,
    "subjectType" "RiskSubjectType" NOT NULL,
    "subjectId" VARCHAR(160) NOT NULL,
    "companyId" UUID,
    "category" "RiskSignalKind" NOT NULL,
    "severity" "TrustSafetySeverity" NOT NULL,
    "status" "TrustSafetyCaseStatus" NOT NULL DEFAULT 'OPEN',
    "policyVersion" VARCHAR(48) NOT NULL,
    "safeReasonCode" VARCHAR(64) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "assigneeUserId" UUID,
    "reviewDueAt" TIMESTAMPTZ(3) NOT NULL,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustSafetyCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustSafetyCaseEvent" (
    "id" UUID NOT NULL,
    "trustSafetyCaseId" UUID NOT NULL,
    "kind" "TrustSafetyEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64) NOT NULL,
    "safeNote" VARCHAR(1000),
    "evidenceDigest" CHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustSafetyCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustSafetyAppeal" (
    "id" UUID NOT NULL,
    "trustSafetyCaseId" UUID NOT NULL,
    "appellantUserId" UUID NOT NULL,
    "status" "TrustSafetyAppealStatus" NOT NULL DEFAULT 'OPEN',
    "safeStatement" VARCHAR(2000) NOT NULL,
    "statementDigest" CHAR(64) NOT NULL,
    "decisionReasonCode" VARCHAR(64),
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustSafetyAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_code_key" ON "AdminRole"("code");

-- CreateIndex
CREATE INDEX "AdminRole_active_duty_code_idx" ON "AdminRole"("active", "duty", "code");

-- CreateIndex
CREATE INDEX "AdminRoleCapability_capability_adminRoleId_idx" ON "AdminRoleCapability"("capability", "adminRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRoleCapability_adminRoleId_capability_key" ON "AdminRoleCapability"("adminRoleId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRoleAssignment_approvalId_key" ON "AdminRoleAssignment"("approvalId");

-- CreateIndex
CREATE INDEX "AdminRoleAssignment_userId_revokedAt_validFrom_validTo_idx" ON "AdminRoleAssignment"("userId", "revokedAt", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "AdminRoleAssignment_adminRoleId_revokedAt_validTo_idx" ON "AdminRoleAssignment"("adminRoleId", "revokedAt", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "AdminCapabilityGrant_approvalId_key" ON "AdminCapabilityGrant"("approvalId");

-- CreateIndex
CREATE INDEX "AdminCapabilityGrant_userId_capability_revokedAt_validFrom__idx" ON "AdminCapabilityGrant"("userId", "capability", "revokedAt", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "Authenticator_userId_status_kind_idx" ON "Authenticator"("userId", "status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_authenticatorId_key" ON "WebAuthnCredential"("authenticatorId");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "TotpCredential_authenticatorId_key" ON "TotpCredential"("authenticatorId");

-- CreateIndex
CREATE INDEX "AuthenticatorChallenge_userId_status_expiresAt_idx" ON "AuthenticatorChallenge"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthenticatorChallenge_sessionId_status_expiresAt_idx" ON "AuthenticatorChallenge"("sessionId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_batchId_usedAt_revokedAt_idx" ON "RecoveryCode"("userId", "batchId", "usedAt", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthenticatorEvent_authenticatorId_createdAt_idx" ON "AuthenticatorEvent"("authenticatorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAssurance_sessionId_key" ON "SessionAssurance"("sessionId");

-- CreateIndex
CREATE INDEX "SessionAssurance_userId_level_expiresAt_revokedAt_idx" ON "SessionAssurance"("userId", "level", "expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "StepUpChallenge_userId_purpose_action_status_expiresAt_idx" ON "StepUpChallenge"("userId", "purpose", "action", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "StepUpChallenge_sessionId_status_expiresAt_idx" ON "StepUpChallenge"("sessionId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "PrivilegedApproval_status_kind_duty_expiresAt_idx" ON "PrivilegedApproval"("status", "kind", "duty", "expiresAt");

-- CreateIndex
CREATE INDEX "PrivilegedApproval_targetType_targetId_status_idx" ON "PrivilegedApproval"("targetType", "targetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BreakGlassGrant_approvalId_key" ON "BreakGlassGrant"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "BreakGlassGrant_alertDedupeKey_key" ON "BreakGlassGrant"("alertDedupeKey");

-- CreateIndex
CREATE INDEX "BreakGlassGrant_userId_status_validFrom_validTo_idx" ON "BreakGlassGrant"("userId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "RiskSignal_dedupeKey_key" ON "RiskSignal"("dedupeKey");

-- CreateIndex
CREATE INDEX "RiskSignal_subjectType_subjectId_kind_occurredAt_idx" ON "RiskSignal"("subjectType", "subjectId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "RiskSignal_companyId_kind_occurredAt_idx" ON "RiskSignal"("companyId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "RiskSignal_retainUntil_idx" ON "RiskSignal"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "TrustRiskDecision_idempotencyKey_key" ON "TrustRiskDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TrustRiskDecision_kind_decidedAt_id_idx" ON "TrustRiskDecision"("kind", "decidedAt", "id");

-- CreateIndex
CREATE INDEX "TrustRiskDecision_riskSignalId_decidedAt_idx" ON "TrustRiskDecision"("riskSignalId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustSafetyCase_riskDecisionId_key" ON "TrustSafetyCase"("riskDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustSafetyCase_dedupeKey_key" ON "TrustSafetyCase"("dedupeKey");

-- CreateIndex
CREATE INDEX "TrustSafetyCase_status_severity_reviewDueAt_id_idx" ON "TrustSafetyCase"("status", "severity", "reviewDueAt", "id");

-- CreateIndex
CREATE INDEX "TrustSafetyCase_assigneeUserId_status_reviewDueAt_id_idx" ON "TrustSafetyCase"("assigneeUserId", "status", "reviewDueAt", "id");

-- CreateIndex
CREATE INDEX "TrustSafetyCase_subjectType_subjectId_status_idx" ON "TrustSafetyCase"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE INDEX "TrustSafetyCase_companyId_status_reviewDueAt_idx" ON "TrustSafetyCase"("companyId", "status", "reviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustSafetyCaseEvent_idempotencyKey_key" ON "TrustSafetyCaseEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TrustSafetyCaseEvent_trustSafetyCaseId_createdAt_id_idx" ON "TrustSafetyCaseEvent"("trustSafetyCaseId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TrustSafetyAppeal_trustSafetyCaseId_status_createdAt_idx" ON "TrustSafetyAppeal"("trustSafetyCaseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TrustSafetyAppeal_appellantUserId_status_createdAt_idx" ON "TrustSafetyAppeal"("appellantUserId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAssuranceEvidence_challengeId_key" ON "AuthAssuranceEvidence"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAssuranceEvidence_grantDigest_key" ON "AuthAssuranceEvidence"("grantDigest");

-- CreateIndex
CREATE INDEX "AuthAssuranceEvidence_userId_purpose_action_tenantId_resour_idx" ON "AuthAssuranceEvidence"("userId", "purpose", "action", "tenantId", "resourceId", "expiresAt");

-- AddForeignKey
ALTER TABLE "AuthAssuranceEvidence" ADD CONSTRAINT "AuthAssuranceEvidence_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "StepUpChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRoleCapability" ADD CONSTRAINT "AdminRoleCapability_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "PrivilegedApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminCapabilityGrant" ADD CONSTRAINT "AdminCapabilityGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminCapabilityGrant" ADD CONSTRAINT "AdminCapabilityGrant_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "PrivilegedApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Authenticator" ADD CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_authenticatorId_fkey" FOREIGN KEY ("authenticatorId") REFERENCES "Authenticator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpCredential" ADD CONSTRAINT "TotpCredential_authenticatorId_fkey" FOREIGN KEY ("authenticatorId") REFERENCES "Authenticator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthenticatorChallenge" ADD CONSTRAINT "AuthenticatorChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthenticatorChallenge" ADD CONSTRAINT "AuthenticatorChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthenticatorEvent" ADD CONSTRAINT "AuthenticatorEvent_authenticatorId_fkey" FOREIGN KEY ("authenticatorId") REFERENCES "Authenticator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAssurance" ADD CONSTRAINT "SessionAssurance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAssurance" ADD CONSTRAINT "SessionAssurance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAssurance" ADD CONSTRAINT "SessionAssurance_authenticatorId_fkey" FOREIGN KEY ("authenticatorId") REFERENCES "Authenticator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpChallenge" ADD CONSTRAINT "StepUpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpChallenge" ADD CONSTRAINT "StepUpChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "PrivilegedApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustRiskDecision" ADD CONSTRAINT "TrustRiskDecision_riskSignalId_fkey" FOREIGN KEY ("riskSignalId") REFERENCES "RiskSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSafetyCase" ADD CONSTRAINT "TrustSafetyCase_riskDecisionId_fkey" FOREIGN KEY ("riskDecisionId") REFERENCES "TrustRiskDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSafetyCaseEvent" ADD CONSTRAINT "TrustSafetyCaseEvent_trustSafetyCaseId_fkey" FOREIGN KEY ("trustSafetyCaseId") REFERENCES "TrustSafetyCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSafetyAppeal" ADD CONSTRAINT "TrustSafetyAppeal_trustSafetyCaseId_fkey" FOREIGN KEY ("trustSafetyCaseId") REFERENCES "TrustSafetyCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 25 hard invariants: no wildcard/unknown capability, bounded grants,
-- different actors for four-eyes approval and replay-safe active rows.
CREATE FUNCTION phase25_admin_capability_known(value TEXT) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value = ANY (ARRAY[
    'ADMIN_OVERVIEW_READ','ADMIN_GLOBAL_SEARCH','ADMIN_JOB_REVIEW',
    'ADMIN_JOB_PUBLISH','ADMIN_JOB_BOOST_MANAGE','ADMIN_COMPANY_REVIEW',
    'ADMIN_COMPANY_MODERATE','ADMIN_CLAIM_REVIEW','ADMIN_USER_MODERATE',
    'ADMIN_TAXONOMY_MANAGE','ADMIN_REPORT_REVIEW',
    'ADMIN_RESTRICTION_MANAGE','ADMIN_LICENSED_IMPORT',
    'ADMIN_IMPORT_SETUP_APPROVE','ADMIN_SUPPORT_MANAGE',
    'ADMIN_CONTENT_MANAGE','ADMIN_CLUSTER_PRODUCT_APPROVE',
    'ADMIN_CLUSTER_OPS_APPROVE','ADMIN_CLUSTER_ACTIVATE',
    'ADMIN_LEAD_MANAGE','ADMIN_COCKPIT_READ','ADMIN_OPS_READ',
    'ADMIN_AUDIT_READ','ADMIN_SYSTEM_TASK_MANAGE','ADMIN_BILLING_READ',
    'ADMIN_BILLING_MUTATE','ADMIN_CATALOG_READ','ADMIN_CATALOG_MUTATE',
    'ADMIN_INVOICE_MUTATE','ADMIN_ANALYTICS_READ','ADMIN_LEGAL_READ',
    'ADMIN_LEGAL_DRAFT','ADMIN_LEGAL_REVIEW','ADMIN_LEGAL_PUBLISH',
    'PRIVACY_EXECUTION_APPROVE','PRIVACY_HOLD_MANAGE',
    'ADMIN_CREDITS_GRANT','ADMIN_CREDIT_REVERSE','ADMIN_SLA_PROJECT',
    'PRIVACY_CASE_READ','PRIVACY_CASE_VERIFY','PRIVACY_CASE_PROCESS',
    'ADMIN_SECURITY_READ','ADMIN_SECURITY_GRANT','ADMIN_SECURITY_APPROVE',
    'ADMIN_AUTHENTICATOR_RESET','ADMIN_BREAK_GLASS_MANAGE',
    'TRUST_SAFETY_READ','TRUST_SAFETY_REVIEW','TRUST_SAFETY_RESTORE'
  ]::TEXT[]);
$$;

CREATE FUNCTION phase25_admin_capabilities_known(values_to_check TEXT[]) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(bool_and(phase25_admin_capability_known(value)), false)
  FROM unnest(values_to_check) AS value;
$$;

ALTER TABLE "AdminRoleCapability"
  ADD CONSTRAINT "admin_role_capability_known"
  CHECK (phase25_admin_capability_known("capability"));
ALTER TABLE "AdminRoleAssignment"
  ADD CONSTRAINT "admin_role_assignment_bounded"
  CHECK ("validTo" > "validFrom");
ALTER TABLE "AdminCapabilityGrant"
  ADD CONSTRAINT "admin_capability_grant_known"
  CHECK (phase25_admin_capability_known("capability")),
  ADD CONSTRAINT "admin_capability_grant_bounded"
  CHECK ("validTo" > "validFrom");
ALTER TABLE "PrivilegedApproval"
  ADD CONSTRAINT "privileged_approval_different_actor"
  CHECK (
    ("approvedByUserId" IS NULL OR "approvedByUserId" <> "requestedByUserId")
    AND
    ("rejectedByUserId" IS NULL OR "rejectedByUserId" <> "requestedByUserId")
  ),
  ADD CONSTRAINT "privileged_approval_decision_shape"
  CHECK (
    ("status" = 'PENDING' AND "decidedAt" IS NULL AND
      "approvedByUserId" IS NULL AND "rejectedByUserId" IS NULL)
    OR
    ("status" IN ('APPROVED','CONSUMED') AND "decidedAt" IS NOT NULL AND
      "approvedByUserId" IS NOT NULL AND "rejectedByUserId" IS NULL)
    OR
    ("status" = 'REJECTED' AND "decidedAt" IS NOT NULL AND
      "rejectedByUserId" IS NOT NULL AND "approvedByUserId" IS NULL)
    OR
    ("status" IN ('EXPIRED','CANCELLED') AND "approvedByUserId" IS NULL)
  );
ALTER TABLE "BreakGlassGrant"
  ADD CONSTRAINT "break_glass_different_actor"
  CHECK ("approvedByUserId" <> "requestedByUserId"),
  ADD CONSTRAINT "break_glass_bounded"
  CHECK ("validTo" > "validFrom" AND "validTo" <= "validFrom" + INTERVAL '60 minutes'),
  ADD CONSTRAINT "break_glass_capabilities_known"
  CHECK (
    cardinality("capabilities") BETWEEN 1 AND 8
    AND phase25_admin_capabilities_known("capabilities")
  );
ALTER TABLE "AuthenticatorChallenge"
  ADD CONSTRAINT "authenticator_challenge_attempts"
  CHECK ("maxAttempts" BETWEEN 1 AND 10 AND "attemptCount" BETWEEN 0 AND "maxAttempts");
ALTER TABLE "TotpCredential"
  ADD CONSTRAINT "totp_policy_v1_shape"
  CHECK ("algorithm" = 'SHA1' AND "digits" = 6 AND "periodSeconds" = 30);
ALTER TABLE "SessionAssurance"
  ADD CONSTRAINT "session_assurance_bounded"
  CHECK ("expiresAt" > "verifiedAt");
ALTER TABLE "StepUpChallenge"
  ADD CONSTRAINT "step_up_challenge_attempts"
  CHECK ("maxAttempts" BETWEEN 1 AND 10 AND "attemptCount" BETWEEN 0 AND "maxAttempts"),
  ADD CONSTRAINT "step_up_challenge_bounded"
  CHECK ("expiresAt" > "createdAt");
ALTER TABLE "RiskSignal"
  ADD CONSTRAINT "risk_signal_bounded_count"
  CHECK ("observedCount" IS NULL OR "observedCount" >= 0),
  ADD CONSTRAINT "risk_signal_retention"
  CHECK ("retainUntil" > "occurredAt"),
  ADD CONSTRAINT "risk_signal_window"
  CHECK (
    ("windowStartedAt" IS NULL AND "windowEndedAt" IS NULL)
    OR
    ("windowStartedAt" IS NOT NULL AND "windowEndedAt" IS NOT NULL
      AND "windowEndedAt" >= "windowStartedAt")
  );
ALTER TABLE "TrustSafetyCase"
  ADD CONSTRAINT "trust_case_hold_shape"
  CHECK (
    ("status" = 'HELD' AND "holdExpiresAt" IS NOT NULL)
    OR
    ("status" <> 'HELD')
  );

CREATE UNIQUE INDEX "AdminRoleAssignment_one_unrevoked_role_key"
  ON "AdminRoleAssignment" ("userId", "adminRoleId")
  WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "AdminCapabilityGrant_one_unrevoked_capability_key"
  ON "AdminCapabilityGrant" ("userId", "capability", "duty")
  WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "Authenticator_one_active_kind_label_key"
  ON "Authenticator" ("userId", "kind", "label")
  WHERE "status" IN ('PENDING','ACTIVE');
CREATE UNIQUE INDEX "TrustSafetyAppeal_one_open_version_key"
  ON "TrustSafetyAppeal" ("trustSafetyCaseId", "decisionVersion")
  WHERE "status" = 'OPEN';

-- Actor and tenant references are constrained even where the Prisma model keeps
-- generic event DTOs intentionally relation-light.
ALTER TABLE "AdminRoleAssignment"
  ADD CONSTRAINT "AdminRoleAssignment_grantedByUserId_fkey"
    FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "AdminRoleAssignment_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "AdminCapabilityGrant"
  ADD CONSTRAINT "AdminCapabilityGrant_grantedByUserId_fkey"
    FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "AdminCapabilityGrant_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "Authenticator"
  ADD CONSTRAINT "Authenticator_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "AuthenticatorEvent"
  ADD CONSTRAINT "AuthenticatorEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "PrivilegedApproval"
  ADD CONSTRAINT "PrivilegedApproval_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "PrivilegedApproval_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "PrivilegedApproval_rejectedByUserId_fkey"
    FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "BreakGlassGrant"
  ADD CONSTRAINT "BreakGlassGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "BreakGlassGrant_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "BreakGlassGrant_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "BreakGlassGrant_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "RiskSignal"
  ADD CONSTRAINT "RiskSignal_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "RiskSignal_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "TrustRiskDecision"
  ADD CONSTRAINT "TrustRiskDecision_decidedByUserId_fkey"
    FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "TrustSafetyCase"
  ADD CONSTRAINT "TrustSafetyCase_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "TrustSafetyCase_assigneeUserId_fkey"
    FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "TrustSafetyCaseEvent"
  ADD CONSTRAINT "TrustSafetyCaseEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "TrustSafetyAppeal"
  ADD CONSTRAINT "TrustSafetyAppeal_appellantUserId_fkey"
    FOREIGN KEY ("appellantUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "TrustSafetyAppeal_decidedByUserId_fkey"
    FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;

-- Evidence streams are append-only. Mutable projections (Case, Appeal, Grant,
-- Challenge) are evented separately and therefore intentionally excluded.
CREATE TRIGGER phase25_append_only_authenticator_event
  BEFORE UPDATE OR DELETE ON "AuthenticatorEvent"
  FOR EACH ROW EXECUTE FUNCTION phase02_raise_append_only();
CREATE TRIGGER phase25_append_only_risk_signal
  BEFORE UPDATE OR DELETE ON "RiskSignal"
  FOR EACH ROW EXECUTE FUNCTION phase02_raise_append_only();
CREATE TRIGGER phase25_append_only_risk_decision
  BEFORE UPDATE OR DELETE ON "TrustRiskDecision"
  FOR EACH ROW EXECUTE FUNCTION phase02_raise_append_only();
CREATE TRIGGER phase25_append_only_trust_case_event
  BEFORE UPDATE OR DELETE ON "TrustSafetyCaseEvent"
  FOR EACH ROW EXECUTE FUNCTION phase02_raise_append_only();

-- Seed the closed role catalog. Role membership remains explicit and bounded;
-- no role or migration row contains a wildcard.
INSERT INTO "AdminRole"
  ("id","code","name","description","duty","policyVersion","isSystem","active","createdAt","updatedAt")
VALUES
  ('25000000-0000-4000-8000-000000000001','PLATFORM_OPERATOR','Platform Operations','Übersicht, Betrieb und allgemeine Plattformverwaltung.','PLATFORM','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000002','JOB_MODERATOR','Job Moderation','Job-, Firmen- und Missbrauchsmoderation.','MODERATION','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000003','SUPPORT_AGENT','Support','Supportfälle ohne Finance-, Privacy- oder Securityrechte.','SUPPORT','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000004','CONTENT_SUPPLY_OPERATOR','Content & Supply','Taxonomie, lizenzierter Import und Content.','CONTENT_SUPPLY','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000005','FINANCE_OPERATOR','Finance','Billing-, Katalog- und Rechnungsoperationen.','FINANCE','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000006','PRIVACY_VERIFIER','Privacy Verification','Unabhängige Privacy- und Legalprüfung.','PRIVACY_VERIFY','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000007','PRIVACY_PROCESSOR','Privacy Processing','Privacy-Ausführung getrennt von der Prüfung.','PRIVACY_PROCESS','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000008','SECURITY_ADMIN','Security Administration','MFA, Grants, Approval und Break-glass.','SECURITY','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000009','TRUST_SAFETY_REVIEWER','Trust & Safety Review','Risk- und Trust-Fallprüfung ohne Restore.','TRUST_SAFETY','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('25000000-0000-4000-8000-000000000010','TRUST_SAFETY_APPROVER','Trust & Safety Approval','Unabhängige Restore- und Securityfreigabe.','SECURITY','ADMIN_GRANTS_POLICY_V2',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO "AdminRoleCapability" ("id","adminRoleId","capability","createdAt")
SELECT gen_random_uuid(), role."id", mapping.capability, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('PLATFORM_OPERATOR','ADMIN_OVERVIEW_READ'),
    ('PLATFORM_OPERATOR','ADMIN_GLOBAL_SEARCH'),
    ('PLATFORM_OPERATOR','ADMIN_USER_MODERATE'),
    ('PLATFORM_OPERATOR','ADMIN_COMPANY_REVIEW'),
    ('PLATFORM_OPERATOR','ADMIN_LEAD_MANAGE'),
    ('PLATFORM_OPERATOR','ADMIN_COCKPIT_READ'),
    ('PLATFORM_OPERATOR','ADMIN_OPS_READ'),
    ('PLATFORM_OPERATOR','ADMIN_AUDIT_READ'),
    ('PLATFORM_OPERATOR','ADMIN_SYSTEM_TASK_MANAGE'),
    ('PLATFORM_OPERATOR','ADMIN_ANALYTICS_READ'),
    ('JOB_MODERATOR','ADMIN_JOB_REVIEW'),
    ('JOB_MODERATOR','ADMIN_JOB_PUBLISH'),
    ('JOB_MODERATOR','ADMIN_JOB_BOOST_MANAGE'),
    ('JOB_MODERATOR','ADMIN_COMPANY_MODERATE'),
    ('JOB_MODERATOR','ADMIN_CLAIM_REVIEW'),
    ('JOB_MODERATOR','ADMIN_REPORT_REVIEW'),
    ('JOB_MODERATOR','ADMIN_RESTRICTION_MANAGE'),
    ('JOB_MODERATOR','ADMIN_SLA_PROJECT'),
    ('SUPPORT_AGENT','ADMIN_SUPPORT_MANAGE'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_TAXONOMY_MANAGE'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_LICENSED_IMPORT'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_IMPORT_SETUP_APPROVE'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_CONTENT_MANAGE'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_CLUSTER_PRODUCT_APPROVE'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_CLUSTER_OPS_APPROVE'),
    ('CONTENT_SUPPLY_OPERATOR','ADMIN_CLUSTER_ACTIVATE'),
    ('FINANCE_OPERATOR','ADMIN_BILLING_READ'),
    ('FINANCE_OPERATOR','ADMIN_BILLING_MUTATE'),
    ('FINANCE_OPERATOR','ADMIN_CATALOG_READ'),
    ('FINANCE_OPERATOR','ADMIN_CATALOG_MUTATE'),
    ('FINANCE_OPERATOR','ADMIN_INVOICE_MUTATE'),
    ('FINANCE_OPERATOR','ADMIN_CREDITS_GRANT'),
    ('FINANCE_OPERATOR','ADMIN_CREDIT_REVERSE'),
    ('PRIVACY_VERIFIER','ADMIN_LEGAL_READ'),
    ('PRIVACY_VERIFIER','ADMIN_LEGAL_REVIEW'),
    ('PRIVACY_VERIFIER','PRIVACY_CASE_READ'),
    ('PRIVACY_VERIFIER','PRIVACY_CASE_VERIFY'),
    ('PRIVACY_VERIFIER','PRIVACY_HOLD_MANAGE'),
    ('PRIVACY_PROCESSOR','ADMIN_LEGAL_READ'),
    ('PRIVACY_PROCESSOR','ADMIN_LEGAL_DRAFT'),
    ('PRIVACY_PROCESSOR','ADMIN_LEGAL_PUBLISH'),
    ('PRIVACY_PROCESSOR','PRIVACY_CASE_READ'),
    ('PRIVACY_PROCESSOR','PRIVACY_CASE_PROCESS'),
    ('PRIVACY_PROCESSOR','PRIVACY_EXECUTION_APPROVE'),
    ('SECURITY_ADMIN','ADMIN_SECURITY_READ'),
    ('SECURITY_ADMIN','ADMIN_SECURITY_GRANT'),
    ('SECURITY_ADMIN','ADMIN_SECURITY_APPROVE'),
    ('SECURITY_ADMIN','ADMIN_AUTHENTICATOR_RESET'),
    ('SECURITY_ADMIN','ADMIN_BREAK_GLASS_MANAGE'),
    ('SECURITY_ADMIN','ADMIN_AUDIT_READ'),
    ('TRUST_SAFETY_REVIEWER','TRUST_SAFETY_READ'),
    ('TRUST_SAFETY_REVIEWER','TRUST_SAFETY_REVIEW'),
    ('TRUST_SAFETY_REVIEWER','ADMIN_REPORT_REVIEW'),
    ('TRUST_SAFETY_REVIEWER','ADMIN_RESTRICTION_MANAGE'),
    ('TRUST_SAFETY_APPROVER','TRUST_SAFETY_READ'),
    ('TRUST_SAFETY_APPROVER','TRUST_SAFETY_RESTORE'),
    ('TRUST_SAFETY_APPROVER','ADMIN_SECURITY_APPROVE'),
    ('TRUST_SAFETY_APPROVER','ADMIN_AUDIT_READ')
) AS mapping(role_code, capability)
JOIN "AdminRole" role ON role."code" = mapping.role_code;

-- Safe compatibility bridge: every existing active global ADMIN receives only
-- the explicit Platform Operations role, for fourteen days. Domain owners
-- must deliberately grant all other duties; expiry fails closed.
INSERT INTO "AdminRoleAssignment"
  ("id","userId","adminRoleId","grantedByUserId","reasonCode","validFrom","validTo","createdAt")
SELECT
  gen_random_uuid(),
  admin_user."id",
  platform_role."id",
  NULL,
  'PHASE25_EXPLICIT_BOOTSTRAP',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '14 days',
  CURRENT_TIMESTAMP
FROM "User" admin_user
CROSS JOIN "AdminRole" platform_role
WHERE admin_user."role" = 'ADMIN'
  AND admin_user."status" = 'ACTIVE'
  AND platform_role."code" = 'PLATFORM_OPERATOR'
  AND NOT EXISTS (
    SELECT 1 FROM "AdminRoleAssignment" existing
    WHERE existing."userId" = admin_user."id"
      AND existing."adminRoleId" = platform_role."id"
      AND existing."revokedAt" IS NULL
  );
