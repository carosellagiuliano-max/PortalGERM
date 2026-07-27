-- CreateEnum
CREATE TYPE "PaidScopeDecisionStatus" AS ENUM ('GO', 'NO_GO', 'REVOKED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'CHECKOUT_CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'HELD');

-- CreateEnum
CREATE TYPE "ProviderEventInboxStatus" AS ENUM ('RECEIVED', 'PROJECTED', 'HELD', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationItemStatus" AS ENUM ('MATCHED', 'OPEN', 'ESCALATED', 'REPAIRED');

-- CreateEnum
CREATE TYPE "ReconciliationMismatchKind" AS ENUM ('MISSING_ORDER', 'MISSING_ATTEMPT', 'AMOUNT', 'CURRENCY', 'TENANT', 'INVOICE', 'LEDGER', 'PROVIDER_STATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "DunningCaseStatus" AS ENUM ('OPEN', 'GRACE', 'SUSPENDED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceDeliveryClassification" AS ENUM ('PLATFORM_FAILURE', 'EXPECTED_MARKET_OUTCOME', 'USER_ACTION', 'PROVIDER_PAYMENT_FAILURE');

-- CreateEnum
CREATE TYPE "ServiceDeliveryStatus" AS ENUM ('OPEN', 'APPROVED', 'APPLIED', 'DENIED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ServiceRemedyKind" AS ENUM ('NONE', 'CREDIT_RESTORE', 'SERVICE_EXTENSION', 'REPLACEMENT', 'REFUND', 'PARTIAL_REFUND');

-- CreateEnum
CREATE TYPE "ServiceDeliveryEventKind" AS ENUM ('ASSESSED', 'APPROVED', 'DENIED', 'ESCALATED', 'REMEDY_APPLIED');

-- CreateEnum
CREATE TYPE "PaymentRiskDecisionKind" AS ENUM ('ALLOW', 'HOLD', 'DENY', 'REVIEW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentEventKind" ADD VALUE 'PENDING';
ALTER TYPE "PaymentEventKind" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentEventKind" ADD VALUE 'CHARGEBACK_OPENED';
ALTER TYPE "PaymentEventKind" ADD VALUE 'CHARGEBACK_RESOLVED';

-- Phase-24 dunning must suppress paid entitlements without pretending that the
-- contractual period was cancelled or expired.
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "SubscriptionEventKind" ADD VALUE 'DUNNING_STARTED';
ALTER TYPE "SubscriptionEventKind" ADD VALUE 'SUSPENDED';
ALTER TYPE "SubscriptionEventKind" ADD VALUE 'RESUMED';
ALTER TYPE "AuditTargetType" ADD VALUE 'PAYMENT_ATTEMPT';
ALTER TYPE "AuditTargetType" ADD VALUE 'PROVIDER_EVENT';
ALTER TYPE "AuditTargetType" ADD VALUE 'RECONCILIATION_RUN';
ALTER TYPE "AuditTargetType" ADD VALUE 'RECONCILIATION_ITEM';
ALTER TYPE "AuditTargetType" ADD VALUE 'REFUND';
ALTER TYPE "AuditTargetType" ADD VALUE 'CHARGEBACK';
ALTER TYPE "AuditTargetType" ADD VALUE 'CREDIT_NOTE';
ALTER TYPE "AuditTargetType" ADD VALUE 'DUNNING_CASE';
ALTER TYPE "AuditTargetType" ADD VALUE 'SERVICE_DELIVERY';
ALTER TYPE "AuditTargetType" ADD VALUE 'PAYMENT_RISK_DECISION';
ALTER TYPE "AuditTargetType" ADD VALUE 'PAID_SCOPE_DECISION';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_ATTEMPT_HELD';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_EVENT_INGESTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_EVENT_PROJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'RECONCILIATION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'RECONCILIATION_ITEM_REPAIRED';
ALTER TYPE "AuditAction" ADD VALUE 'REFUND_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'REFUND_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'CHARGEBACK_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_NOTE_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE 'DUNNING_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_DELIVERY_ASSESSED';
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_DELIVERY_RECOVERED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_RISK_DECIDED';

-- CreateTable
CREATE TABLE "PaidScopeDecision" (
    "id" UUID NOT NULL,
    "scopeCode" VARCHAR(64) NOT NULL,
    "packageCode" VARCHAR(64) NOT NULL,
    "status" "PaidScopeDecisionStatus" NOT NULL,
    "maximumMode" "OperationsActivationMode" NOT NULL DEFAULT 'SANDBOX',
    "decisionRef" VARCHAR(255) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "thresholdCode" VARCHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidScopeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "paidScopeDecisionId" UUID NOT NULL,
    "providerActivationId" UUID NOT NULL,
    "stepUpEvidenceId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "providerAccountReference" VARCHAR(128) NOT NULL,
    "attemptKey" VARCHAR(160) NOT NULL,
    "quoteDigest" CHAR(64) NOT NULL,
    "amountRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "providerSessionReference" VARCHAR(255),
    "providerPaymentReference" VARCHAR(255),
    "failureCode" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastProviderEventAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEventInbox" (
    "id" UUID NOT NULL,
    "paymentAttemptId" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "providerAccountReference" VARCHAR(128) NOT NULL,
    "providerEventId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(96) NOT NULL,
    "eventCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "apiVersion" VARCHAR(32),
    "liveMode" BOOLEAN NOT NULL,
    "rawBodyDigest" CHAR(64) NOT NULL,
    "signatureDigest" CHAR(64) NOT NULL,
    "payloadSchemaVersion" VARCHAR(32) NOT NULL,
    "normalizedPayload" JSONB NOT NULL,
    "status" "ProviderEventInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "nextRetryAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "failureClass" "WorkFailureClass",
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderEventInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "providerWindowStart" TIMESTAMPTZ(3) NOT NULL,
    "providerWindowEnd" TIMESTAMPTZ(3) NOT NULL,
    "cursorReference" VARCHAR(255),
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "manifestDigest" CHAR(64),
    "initiatedByUserId" UUID,
    "correlationId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationItem" (
    "id" UUID NOT NULL,
    "reconciliationRunId" UUID NOT NULL,
    "paymentAttemptId" UUID,
    "orderId" UUID,
    "companyId" UUID,
    "providerReference" VARCHAR(255) NOT NULL,
    "status" "ReconciliationItemStatus" NOT NULL,
    "mismatchKind" "ReconciliationMismatchKind",
    "expectedAmountRappen" INTEGER,
    "observedAmountRappen" INTEGER,
    "expectedCurrency" CHAR(3),
    "observedCurrency" CHAR(3),
    "evidenceDigest" CHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64),
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "amountRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reasonCode" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "providerRefundReference" VARCHAR(255),
    "stepUpEvidenceId" UUID NOT NULL,
    "approvalStepUpEvidenceId" UUID,
    "requestedByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "failureCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chargeback" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "providerDisputeReference" VARCHAR(255) NOT NULL,
    "amountRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCode" VARCHAR(64) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "evidenceDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Chargeback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "refundId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "amountRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "reasonCode" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningCase" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "paymentAttemptId" UUID,
    "companyId" UUID NOT NULL,
    "previousSubscriptionStatus" "SubscriptionStatus" NOT NULL,
    "status" "DunningCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCode" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "paymentDueAt" TIMESTAMPTZ(3) NOT NULL,
    "graceEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "suspendedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DunningCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDeliveryAssessment" (
    "id" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "serviceKind" VARCHAR(64) NOT NULL,
    "serviceInstanceId" VARCHAR(128) NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "classification" "ServiceDeliveryClassification" NOT NULL,
    "status" "ServiceDeliveryStatus" NOT NULL DEFAULT 'OPEN',
    "remedyKind" "ServiceRemedyKind" NOT NULL DEFAULT 'NONE',
    "remedyAmount" INTEGER,
    "currency" CHAR(3),
    "evidenceDigest" CHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "approvedByUserId" UUID,
    "refundId" UUID,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,
    "approvedAt" TIMESTAMPTZ(3),
    "appliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceDeliveryAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDeliveryEvent" (
    "id" UUID NOT NULL,
    "serviceDeliveryAssessmentId" UUID NOT NULL,
    "kind" "ServiceDeliveryEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRiskDecision" (
    "id" UUID NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" "PaymentRiskDecisionKind" NOT NULL,
    "riskBasisPoints" INTEGER NOT NULL,
    "signalCodes" TEXT[],
    "evidenceDigest" CHAR(64) NOT NULL,
    "caseReference" VARCHAR(255),
    "decidedByUserId" UUID,
    "decisionAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaidScopeDecision_decisionRef_key" ON "PaidScopeDecision"("decisionRef");

-- CreateIndex
CREATE INDEX "PaidScopeDecision_scopeCode_packageCode_status_effectiveAt__idx" ON "PaidScopeDecision"("scopeCode", "packageCode", "status", "effectiveAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_stepUpEvidenceId_key" ON "PaymentAttempt"("stepUpEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_attemptKey_key" ON "PaymentAttempt"("attemptKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerSessionReference_key" ON "PaymentAttempt"("providerSessionReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerPaymentReference_key" ON "PaymentAttempt"("providerPaymentReference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_companyId_status_createdAt_idx" ON "PaymentAttempt"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_provider_environment_status_createdAt_idx" ON "PaymentAttempt"("provider", "environment", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_providerPaymentReference_idx" ON "PaymentAttempt"("providerPaymentReference");

-- CreateIndex
CREATE INDEX "ProviderEventInbox_status_receivedAt_id_idx" ON "ProviderEventInbox"("status", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "ProviderEventInbox_paymentAttemptId_eventCreatedAt_id_idx" ON "ProviderEventInbox"("paymentAttemptId", "eventCreatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEventInbox_provider_environment_providerEventId_key" ON "ProviderEventInbox"("provider", "environment", "providerEventId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_provider_environment_status_startedAt_id_idx" ON "ReconciliationRun"("provider", "environment", "status", "startedAt", "id");

-- CreateIndex
CREATE INDEX "ReconciliationItem_status_mismatchKind_createdAt_id_idx" ON "ReconciliationItem"("status", "mismatchKind", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ReconciliationItem_companyId_status_createdAt_id_idx" ON "ReconciliationItem"("companyId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationItem_reconciliationRunId_providerReference_key" ON "ReconciliationItem"("reconciliationRunId", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundReference_key" ON "Refund"("providerRefundReference");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_stepUpEvidenceId_key" ON "Refund"("stepUpEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_approvalStepUpEvidenceId_key" ON "Refund"("approvalStepUpEvidenceId");

-- CreateIndex
CREATE INDEX "Refund_companyId_status_requestedAt_id_idx" ON "Refund"("companyId", "status", "requestedAt", "id");

-- CreateIndex
CREATE INDEX "Refund_status_requestedAt_id_idx" ON "Refund"("status", "requestedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Chargeback_providerDisputeReference_key" ON "Chargeback"("providerDisputeReference");

-- CreateIndex
CREATE INDEX "Chargeback_companyId_status_openedAt_id_idx" ON "Chargeback"("companyId", "status", "openedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_refundId_key" ON "CreditNote"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_idempotencyKey_key" ON "CreditNote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditNote_companyId_issuedAt_id_idx" ON "CreditNote"("companyId", "issuedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DunningCase_idempotencyKey_key" ON "DunningCase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DunningCase_status_graceEndsAt_id_idx" ON "DunningCase"("status", "graceEndsAt", "id");

-- CreateIndex
CREATE INDEX "DunningCase_companyId_status_graceEndsAt_id_idx" ON "DunningCase"("companyId", "status", "graceEndsAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDeliveryAssessment_idempotencyKey_key" ON "ServiceDeliveryAssessment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDeliveryAssessment_refundId_key" ON "ServiceDeliveryAssessment"("refundId");

-- CreateIndex
CREATE INDEX "ServiceDeliveryAssessment_companyId_status_assessedAt_id_idx" ON "ServiceDeliveryAssessment"("companyId", "status", "assessedAt", "id");

-- CreateIndex
CREATE INDEX "ServiceDeliveryAssessment_status_assessedAt_id_idx" ON "ServiceDeliveryAssessment"("status", "assessedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDeliveryAssessment_serviceKind_serviceInstanceId_pol_key" ON "ServiceDeliveryAssessment"("serviceKind", "serviceInstanceId", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDeliveryEvent_idempotencyKey_key" ON "ServiceDeliveryEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ServiceDeliveryEvent_serviceDeliveryAssessmentId_createdAt_idx" ON "ServiceDeliveryEvent"("serviceDeliveryAssessmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRiskDecision_idempotencyKey_key" ON "PaymentRiskDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentRiskDecision_companyId_kind_decisionAt_id_idx" ON "PaymentRiskDecision"("companyId", "kind", "decisionAt", "id");

-- CreateIndex
CREATE INDEX "PaymentRiskDecision_paymentAttemptId_decisionAt_idx" ON "PaymentRiskDecision"("paymentAttemptId", "decisionAt");

-- AddForeignKey
ALTER TABLE "PaidScopeDecision" ADD CONSTRAINT "PaidScopeDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "Order"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paidScopeDecisionId_fkey" FOREIGN KEY ("paidScopeDecisionId") REFERENCES "PaidScopeDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_providerActivationId_fkey" FOREIGN KEY ("providerActivationId") REFERENCES "ProviderActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_stepUpEvidenceId_fkey" FOREIGN KEY ("stepUpEvidenceId") REFERENCES "AuthAssuranceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEventInbox" ADD CONSTRAINT "ProviderEventInbox_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_stepUpEvidenceId_fkey" FOREIGN KEY ("stepUpEvidenceId") REFERENCES "AuthAssuranceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvalStepUpEvidenceId_fkey" FOREIGN KEY ("approvalStepUpEvidenceId") REFERENCES "AuthAssuranceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chargeback" ADD CONSTRAINT "Chargeback_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chargeback" ADD CONSTRAINT "Chargeback_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chargeback" ADD CONSTRAINT "Chargeback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCase" ADD CONSTRAINT "DunningCase_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "EmployerSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCase" ADD CONSTRAINT "DunningCase_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCase" ADD CONSTRAINT "DunningCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliveryAssessment" ADD CONSTRAINT "ServiceDeliveryAssessment_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliveryAssessment" ADD CONSTRAINT "ServiceDeliveryAssessment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliveryAssessment" ADD CONSTRAINT "ServiceDeliveryAssessment_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliveryAssessment" ADD CONSTRAINT "ServiceDeliveryAssessment_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliveryEvent" ADD CONSTRAINT "ServiceDeliveryEvent_serviceDeliveryAssessmentId_fkey" FOREIGN KEY ("serviceDeliveryAssessmentId") REFERENCES "ServiceDeliveryAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDeliveryEvent" ADD CONSTRAINT "ServiceDeliveryEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRiskDecision" ADD CONSTRAINT "PaymentRiskDecision_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRiskDecision" ADD CONSTRAINT "PaymentRiskDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRiskDecision" ADD CONSTRAINT "PaymentRiskDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase-24 database invariants. UUID defaults also keep controlled SQL repair
-- tooling compatible with Prisma-created rows.
ALTER TABLE "PaidScopeDecision" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "PaymentAttempt" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ProviderEventInbox" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ReconciliationRun" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ReconciliationItem" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Refund" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Chargeback" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "CreditNote" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "DunningCase" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ServiceDeliveryAssessment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ServiceDeliveryEvent" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "PaymentRiskDecision" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "PaidScopeDecision"
  ADD CONSTRAINT "paid_scope_decision_evidence_check" CHECK (
    "sampleSize" > 0
    AND "effectiveAt" < "expiresAt"
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
    AND "scopeCode" ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
    AND "packageCode" ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
    AND "thresholdCode" ~ '^[A-Z][A-Z0-9_]{1,63}$'
    AND "reasonCode" ~ '^[A-Z][A-Z0-9_]{1,63}$'
  );

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "payment_attempt_authority_check" CHECK (
    "provider" = 'STRIPE'
    AND "environment" IN ('local', 'ci', 'staging')
    AND "amountRappen" > 0
    AND "currency" = 'CHF'
    AND "quoteDigest" ~ '^[a-f0-9]{64}$'
    AND "createdAt" < "expiresAt"
  ),
  ADD CONSTRAINT "payment_attempt_state_check" CHECK (
    ("status" = 'CHECKOUT_CREATED' AND "providerSessionReference" IS NOT NULL)
    OR ("status" = 'SUCCEEDED' AND "providerPaymentReference" IS NOT NULL)
    OR ("status" IN ('FAILED', 'HELD') AND "failureCode" IS NOT NULL)
    OR ("status" IN ('CREATED', 'PENDING', 'CANCELLED', 'EXPIRED'))
  );

ALTER TABLE "ProviderEventInbox"
  ADD CONSTRAINT "provider_event_inbox_evidence_check" CHECK (
    "provider" = 'STRIPE'
    AND "environment" IN ('local', 'ci', 'staging')
    AND "liveMode" = false
    AND "rawBodyDigest" ~ '^[a-f0-9]{64}$'
    AND "signatureDigest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("normalizedPayload") = 'object'
    AND octet_length("normalizedPayload"::text) <= 32768
    AND "attemptCount" BETWEEN 0 AND 64
  ),
  ADD CONSTRAINT "provider_event_inbox_state_check" CHECK (
    ("status" = 'RECEIVED' AND "processedAt" IS NULL)
    OR ("status" IN ('PROJECTED', 'HELD', 'IGNORED', 'FAILED') AND "processedAt" IS NOT NULL)
  );

ALTER TABLE "ReconciliationRun"
  ADD CONSTRAINT "reconciliation_run_window_check" CHECK (
    "environment" IN ('local', 'ci', 'staging')
    AND "providerWindowStart" < "providerWindowEnd"
    AND "matchedCount" >= 0
    AND "mismatchCount" >= 0
    AND "processedCount" = "matchedCount" + "mismatchCount"
    AND (
      ("status" = 'RUNNING' AND "completedAt" IS NULL)
      OR ("status" IN ('COMPLETED', 'FAILED') AND "completedAt" IS NOT NULL)
    )
  );

ALTER TABLE "ReconciliationItem"
  ADD CONSTRAINT "reconciliation_item_state_check" CHECK (
    (
      "status" = 'MATCHED'
      AND "mismatchKind" IS NULL
      AND "reasonCode" IS NULL
    )
    OR (
      "status" IN ('OPEN', 'ESCALATED', 'REPAIRED')
      AND "mismatchKind" IS NOT NULL
      AND "reasonCode" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "reconciliation_item_amount_check" CHECK (
    ("expectedAmountRappen" IS NULL OR "expectedAmountRappen" >= 0)
    AND ("observedAmountRappen" IS NULL OR "observedAmountRappen" >= 0)
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
  );

ALTER TABLE "Refund"
  ADD CONSTRAINT "refund_money_check" CHECK (
    "amountRappen" > 0
    AND "currency" = 'CHF'
    AND "reasonCode" ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  ADD CONSTRAINT "refund_state_check" CHECK (
    (
      "status" = 'SUCCEEDED'
      AND "completedAt" IS NOT NULL
      AND "providerRefundReference" IS NOT NULL
      AND "approvedByUserId" IS NOT NULL
      AND "approvalStepUpEvidenceId" IS NOT NULL
    )
    OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "completedAt" IS NOT NULL)
    OR (
      "status" = 'REQUESTED'
      AND "completedAt" IS NULL
      AND "approvedByUserId" IS NULL
      AND "approvalStepUpEvidenceId" IS NULL
    )
    OR (
      "status" = 'PENDING'
      AND "completedAt" IS NULL
      AND "approvedByUserId" IS NOT NULL
      AND "approvalStepUpEvidenceId" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "refund_separation_of_duties_check" CHECK (
    "approvedByUserId" IS NULL
    OR "approvedByUserId" <> "requestedByUserId"
  );

ALTER TABLE "Chargeback"
  ADD CONSTRAINT "chargeback_money_state_check" CHECK (
    "amountRappen" > 0
    AND "currency" = 'CHF'
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
    AND (
      ("status" = 'OPEN' AND "resolvedAt" IS NULL)
      OR ("status" IN ('WON', 'LOST', 'ACCEPTED') AND "resolvedAt" IS NOT NULL)
    )
  );

ALTER TABLE "CreditNote"
  ADD CONSTRAINT "credit_note_money_state_check" CHECK (
    "amountRappen" > 0
    AND "currency" = 'CHF'
    AND (
      ("status" = 'ISSUED' AND "voidedAt" IS NULL)
      OR ("status" = 'VOID' AND "voidedAt" IS NOT NULL)
    )
  );

ALTER TABLE "DunningCase"
  ADD CONSTRAINT "dunning_case_state_check" CHECK (
    "paymentDueAt" < "graceEndsAt"
    AND "previousSubscriptionStatus" IN ('ACTIVE', 'CANCELLING')
    AND (
      ("status" IN ('OPEN', 'GRACE') AND "suspendedAt" IS NULL AND "resolvedAt" IS NULL)
      OR ("status" = 'SUSPENDED' AND "suspendedAt" IS NOT NULL AND "resolvedAt" IS NULL)
      OR ("status" IN ('RESOLVED', 'CANCELLED') AND "resolvedAt" IS NOT NULL)
    )
  );

ALTER TABLE "ServiceDeliveryAssessment"
  ADD CONSTRAINT "service_delivery_remedy_check" CHECK (
    "evidenceDigest" ~ '^[a-f0-9]{64}$'
    AND (
      (
        "classification" <> 'PLATFORM_FAILURE'
        AND "remedyKind" = 'NONE'
        AND "remedyAmount" IS NULL
        AND "currency" IS NULL
      )
      OR (
        "classification" = 'PLATFORM_FAILURE'
        AND (
          ("remedyKind" IN ('CREDIT_RESTORE', 'SERVICE_EXTENSION', 'REPLACEMENT') AND "remedyAmount" IS NULL AND "currency" IS NULL)
          OR ("remedyKind" IN ('REFUND', 'PARTIAL_REFUND') AND "remedyAmount" > 0 AND "currency" = 'CHF')
          OR ("remedyKind" = 'NONE' AND "status" IN ('OPEN', 'ESCALATED') AND "remedyAmount" IS NULL AND "currency" IS NULL)
        )
      )
    )
    AND (
      ("status" = 'OPEN' AND "approvedAt" IS NULL AND "appliedAt" IS NULL)
      OR ("status" IN ('APPROVED', 'DENIED', 'ESCALATED') AND "appliedAt" IS NULL)
      OR ("status" = 'APPLIED' AND "approvedAt" IS NOT NULL AND "appliedAt" IS NOT NULL)
    )
  );

ALTER TABLE "PaymentRiskDecision"
  ADD CONSTRAINT "payment_risk_decision_check" CHECK (
    "riskBasisPoints" BETWEEN 0 AND 10000
    AND cardinality("signalCodes") BETWEEN 1 AND 32
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
    AND ("expiresAt" IS NULL OR "decisionAt" < "expiresAt")
  );

CREATE INDEX "provider_event_inbox_retry_idx"
  ON "ProviderEventInbox"("nextRetryAt", "id")
  WHERE "status" IN ('RECEIVED', 'FAILED');
CREATE INDEX "reconciliation_item_open_keyset_idx"
  ON "ReconciliationItem"("createdAt", "id")
  WHERE "status" IN ('OPEN', 'ESCALATED');
CREATE INDEX "service_delivery_open_keyset_idx"
  ON "ServiceDeliveryAssessment"("assessedAt", "id")
  WHERE "status" IN ('OPEN', 'ESCALATED', 'APPROVED');

CREATE OR REPLACE FUNCTION phase24_reject_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'phase24 financial evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase24_paid_scope_decision_append_only
BEFORE UPDATE OR DELETE ON "PaidScopeDecision"
FOR EACH ROW EXECUTE FUNCTION phase24_reject_append_only_mutation();
CREATE TRIGGER phase24_service_delivery_event_append_only
BEFORE UPDATE OR DELETE ON "ServiceDeliveryEvent"
FOR EACH ROW EXECUTE FUNCTION phase24_reject_append_only_mutation();
CREATE TRIGGER phase24_payment_risk_decision_append_only
BEFORE UPDATE OR DELETE ON "PaymentRiskDecision"
FOR EACH ROW EXECUTE FUNCTION phase24_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION phase24_guard_payment_attempt_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."paidScopeDecisionId" IS DISTINCT FROM OLD."paidScopeDecisionId"
     OR NEW."providerActivationId" IS DISTINCT FROM OLD."providerActivationId"
     OR NEW."stepUpEvidenceId" IS DISTINCT FROM OLD."stepUpEvidenceId"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."providerAccountReference" IS DISTINCT FROM OLD."providerAccountReference"
     OR NEW."attemptKey" IS DISTINCT FROM OLD."attemptKey"
     OR NEW."quoteDigest" IS DISTINCT FROM OLD."quoteDigest"
     OR NEW."amountRappen" IS DISTINCT FROM OLD."amountRappen"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
  THEN
    RAISE EXCEPTION 'payment attempt authority snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase24_payment_attempt_identity_guard
BEFORE UPDATE ON "PaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION phase24_guard_payment_attempt_identity();

CREATE OR REPLACE FUNCTION phase24_guard_provider_event_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."providerAccountReference" IS DISTINCT FROM OLD."providerAccountReference"
     OR NEW."providerEventId" IS DISTINCT FROM OLD."providerEventId"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
     OR NEW."eventCreatedAt" IS DISTINCT FROM OLD."eventCreatedAt"
     OR NEW."apiVersion" IS DISTINCT FROM OLD."apiVersion"
     OR NEW."liveMode" IS DISTINCT FROM OLD."liveMode"
     OR NEW."rawBodyDigest" IS DISTINCT FROM OLD."rawBodyDigest"
     OR NEW."signatureDigest" IS DISTINCT FROM OLD."signatureDigest"
     OR NEW."payloadSchemaVersion" IS DISTINCT FROM OLD."payloadSchemaVersion"
     OR NEW."normalizedPayload" IS DISTINCT FROM OLD."normalizedPayload"
     OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
  THEN
    RAISE EXCEPTION 'provider event signature evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase24_provider_event_identity_guard
BEFORE UPDATE ON "ProviderEventInbox"
FOR EACH ROW EXECUTE FUNCTION phase24_guard_provider_event_identity();
CREATE TRIGGER phase24_provider_event_no_delete
BEFORE DELETE ON "ProviderEventInbox"
FOR EACH ROW EXECUTE FUNCTION phase24_reject_append_only_mutation();

-- The Phase-02 funding trigger keeps the purchased service window bound to
-- the paid catalog duration. Phase 24 permits one narrowly evidenced
-- exception: an approved platform-failure remedy can extend a purchased
-- Boost by exactly seven days. It cannot be repeated because OLD must still
-- equal the original paid duration.
CREATE OR REPLACE FUNCTION enforce_job_boost_funding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  funded_company uuid;
  funded_job uuid;
  funded_order_status "OrderStatus";
  funding_context "FulfillmentContextType";
  duration_days integer;
  ledger_company uuid;
  ledger_type "CreditType";
  ledger_kind "CreditLedgerKind";
  ledger_amount integer;
  service_extension_allowed boolean;
BEGIN
  IF num_nonnulls(NEW."orderLineId", NEW."consumedCreditLedgerEntryId") <> 1 THEN
    RAISE EXCEPTION 'Job Boost requires exactly one funding path'
      USING ERRCODE = '23514', CONSTRAINT = 'job_boost_funding_xor_check';
  END IF;
  IF NEW."orderLineId" IS NOT NULL THEN
    SELECT o."companyId", ol."targetJobId", o."status", ol."fulfillmentContext", pv."durationDays"
      INTO funded_company, funded_job, funded_order_status, funding_context, duration_days
      FROM "OrderLine" ol
      JOIN "Order" o ON o."id" = ol."orderId"
      JOIN "ProductVersion" pv ON pv."id" = ol."productVersionId"
      WHERE ol."id" = NEW."orderLineId";

    service_extension_allowed := false;
    IF TG_OP = 'UPDATE'
       AND duration_days IS NOT NULL
       AND OLD."endsAt" = OLD."startsAt" + make_interval(days => duration_days)
       AND NEW."startsAt" = OLD."startsAt"
       AND NEW."endsAt" = NEW."startsAt" + make_interval(days => duration_days + 7)
    THEN
      SELECT EXISTS (
        SELECT 1
        FROM "ServiceDeliveryAssessment" sda
        WHERE sda."serviceKind" = 'JOB_BOOST'
          AND sda."serviceInstanceId" = NEW."id"::text
          AND sda."orderLineId" = NEW."orderLineId"
          AND sda."companyId" = NEW."companyId"
          AND sda."classification" = 'PLATFORM_FAILURE'
          AND sda."remedyKind" = 'SERVICE_EXTENSION'
          AND sda."status" IN ('APPROVED', 'APPLIED')
      ) INTO service_extension_allowed;
    END IF;

    IF funded_company IS DISTINCT FROM NEW."companyId"
      OR funded_job IS DISTINCT FROM NEW."jobId"
      OR funded_order_status <> 'PAID'
      OR funding_context <> 'JOB_BOOST'
      OR duration_days IS NULL
      OR (
        NEW."endsAt" <> NEW."startsAt" + make_interval(days => duration_days)
        AND NOT service_extension_allowed
      )
    THEN
      RAISE EXCEPTION 'Purchased Job Boost must match its OrderLine target, duration or approved recovery'
        USING ERRCODE = '23514', CONSTRAINT = 'job_boost_order_funding_scope_check';
    END IF;
  ELSE
    SELECT ca."companyId", ca."creditType", cle."kind", cle."amount"
      INTO ledger_company, ledger_type, ledger_kind, ledger_amount
      FROM "CreditLedgerEntry" cle
      JOIN "CreditAccount" ca ON ca."id" = cle."accountId"
      WHERE cle."id" = NEW."consumedCreditLedgerEntryId";
    IF ledger_company IS DISTINCT FROM NEW."companyId"
      OR ledger_type <> 'JOB_BOOST'
      OR ledger_kind <> 'CONSUME'
      OR ledger_amount <> -1
      OR NEW."endsAt" <> NEW."startsAt" + interval '7 days'
    THEN
      RAISE EXCEPTION 'Ledger Job Boost requires one matching seven-day consumed credit'
        USING ERRCODE = '23514', CONSTRAINT = 'job_boost_ledger_funding_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Dunning adds an explicit reversible suspension state without weakening the
-- immutable commercial and period snapshot. The prior ACTIVE/CANCELLING state
-- is persisted on DunningCase and is the only state a recovery may restore.
CREATE OR REPLACE FUNCTION enforce_subscription_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'activatedAt', 'endedAt', 'updatedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'activatedAt', 'endedAt', 'updatedAt'])
    OR (OLD."activatedAt" IS NOT NULL AND OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt")
    OR (OLD."endedAt" IS NOT NULL AND OLD."endedAt" IS DISTINCT FROM NEW."endedAt")
    OR NOT (
      NEW."status" = OLD."status"
      OR (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
      OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('CANCELLING', 'EXPIRED', 'SUSPENDED'))
      OR (OLD."status" = 'CANCELLING' AND NEW."status" IN ('CANCELLED', 'SUSPENDED'))
      OR (OLD."status" = 'SUSPENDED' AND NEW."status" IN ('ACTIVE', 'CANCELLING', 'EXPIRED', 'CANCELLED'))
    )
  THEN
    RAISE EXCEPTION 'Subscription commercial and period snapshots are immutable outside lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'employer_subscription_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "EmployerSubscription"
  DROP CONSTRAINT "employer_subscription_lifecycle_projection_check";
ALTER TABLE "EmployerSubscription"
  ADD CONSTRAINT "employer_subscription_lifecycle_projection_check"
  CHECK (
    ("status" = 'SCHEDULED' AND "activatedAt" IS NULL AND "endedAt" IS NULL)
    OR ("status" IN ('ACTIVE', 'CANCELLING', 'SUSPENDED') AND "activatedAt" IS NOT NULL AND "endedAt" IS NULL)
    OR ("status" = 'EXPIRED' AND "activatedAt" IS NOT NULL AND "endedAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "endedAt" IS NOT NULL)
  );
