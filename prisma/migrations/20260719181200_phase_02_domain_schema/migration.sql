-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- PostgreSQL range/exclusion support required by the Phase-02 contract.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CANDIDATE', 'EMPLOYER', 'RECRUITER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "DataProvenance" AS ENUM ('LIVE', 'DEMO', 'TEST');

-- CreateEnum
CREATE TYPE "CompanyMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'RECRUITER', 'VIEWER');

-- CreateEnum
CREATE TYPE "CompanyMembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CompanyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CompanyInvitationEventKind" AS ENUM ('CREATED', 'RESENT', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CompanyMembershipEventKind" AS ENUM ('CREATED', 'ROLE_CHANGED', 'SUSPENDED', 'REACTIVATED', 'PLAN_LIMIT_SUSPENDED', 'PLAN_LIMIT_REACTIVATED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CompanyStatusEventKind" AS ENUM ('DRAFT_CREATED', 'ONBOARDING_COMPLETED', 'SUSPENDED', 'REACTIVATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CompanyClaimStatus" AS ENUM ('PENDING', 'NEEDS_EVIDENCE', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompanyClaimEventKind" AS ENUM ('CREATED', 'EVIDENCE_REQUESTED', 'EVIDENCE_ADDED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompanyVerificationStatus" AS ENUM ('DRAFT', 'PENDING', 'CHANGES_REQUESTED', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CompanyVerificationEventKind" AS ENUM ('DRAFT_CREATED', 'SUBMITTED', 'EVIDENCE_REQUESTED', 'RESUBMITTED', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('DRAFT', 'COMPLETE');

-- CreateEnum
CREATE TYPE "CandidateOnboardingEventKind" AS ENUM ('DRAFT_CREATED', 'COMPLETED', 'REOPENED');

-- CreateEnum
CREATE TYPE "DocumentPurpose" AS ENUM ('CV');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'REMOVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobAssignmentRole" AS ENUM ('EDITOR', 'REVIEWER', 'PIPELINE');

-- CreateEnum
CREATE TYPE "JobAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobAssignmentEventKind" AS ENUM ('ASSIGNED', 'ROLE_CHANGED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'PAUSED', 'EXPIRED', 'CLOSED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "JobStatusEventKind" AS ENUM ('DRAFT_CREATED', 'DRAFT_UPDATED', 'SUBMITTED', 'REVIEW_STARTED', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'PAUSED', 'REACTIVATED', 'EXPIRED', 'CLOSED', 'REJECTED', 'REVISION_REOPENED', 'IMPORT_ROLLED_BACK');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PERMANENT', 'TEMPORARY', 'FREELANCE', 'INTERNSHIP', 'APPRENTICESHIP', 'HOLIDAY_JOB');

-- CreateEnum
CREATE TYPE "JobOrigin" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "RemoteType" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('DE', 'FR', 'IT', 'EN');

-- CreateEnum
CREATE TYPE "LanguageLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('YEARLY', 'MONTHLY', 'HOURLY');

-- CreateEnum
CREATE TYPE "ApplicationEffort" AS ENUM ('SIMPLE', 'MEDIUM', 'LONG');

-- CreateEnum
CREATE TYPE "RemotePreference" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE', 'ANY');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('JUNIOR', 'MID', 'SENIOR', 'LEAD');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationRejectionReason" AS ENUM ('NOT_A_MATCH', 'POSITION_FILLED', 'REQUIREMENTS_NOT_MET', 'OTHER_REVIEWED');

-- CreateEnum
CREATE TYPE "ApplicationEventKind" AS ENUM ('STATUS_CHANGE', 'CANDIDATE_NOTE_UPDATED', 'EMPLOYER_NOTE_ADDED', 'MESSAGE_SENT', 'SCHEDULED_INTERVIEW');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('APPLICATION', 'TALENT_RADAR');

-- CreateEnum
CREATE TYPE "ConversationParticipantKind" AS ENUM ('USER', 'COMPANY_PRINCIPAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'CANCELLING', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanPriceMode" AS ENUM ('FIXED', 'CONTRACT');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionChangeKind" AS ENUM ('DOWNGRADE', 'CANCEL');

-- CreateEnum
CREATE TYPE "SubscriptionChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubscriptionEventKind" AS ENUM ('ACTIVATED', 'CHANGE_SCHEDULED', 'CHANGED', 'CANCELLATION_SCHEDULED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentEventKind" AS ENUM ('CHECKOUT_CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "BoostStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('JOB_BOOST', 'ADDITIONAL_JOB', 'FEATURED_JOB', 'FEATURED_EMPLOYER', 'NEWSLETTER', 'SOCIAL_PUSH', 'IMPORT_SETUP', 'CONTACT_PACK', 'SUCCESS_FEE');

-- CreateEnum
CREATE TYPE "FulfillmentContextType" AS ENUM ('NONE', 'SUBSCRIPTION', 'JOB_BOOST', 'ADDITIONAL_JOB', 'IMPORT_SETUP', 'CONTACT_PACK');

-- CreateEnum
CREATE TYPE "CreditType" AS ENUM ('JOB_BOOST', 'TALENT_CONTACT', 'NEWSLETTER', 'SOCIAL_PUSH');

-- CreateEnum
CREATE TYPE "CreditFundingSource" AS ENUM ('PLAN_ALLOWANCE', 'PURCHASED_PACK', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "CreditLedgerKind" AS ENUM ('GRANT', 'CONSUME', 'EXPIRE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AnalyticsLevel" AS ENUM ('NONE', 'BASIC', 'ADVANCED', 'PRO');

-- CreateEnum
CREATE TYPE "EntitlementKey" AS ENUM ('ACTIVE_JOB_LIMIT', 'SEAT_LIMIT', 'TALENT_RADAR_ACCESS', 'TALENT_CONTACT_ALLOWANCE', 'JOB_BOOST_ALLOWANCE', 'ANALYTICS_LEVEL', 'ENHANCED_COMPANY_PROFILE', 'EMPLOYER_IMPORT_ACCESS');

-- CreateEnum
CREATE TYPE "EntitlementValueType" AS ENUM ('BOOLEAN', 'INTEGER', 'ANALYTICS_LEVEL');

-- CreateEnum
CREATE TYPE "EntitlementIntegerMode" AS ENUM ('ADD', 'REPLACE');

-- CreateEnum
CREATE TYPE "CatalogVersionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TaxRateReviewStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "SalaryDatasetReviewStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "SalesActivityKind" AS ENUM ('NOTE', 'CONTACT_ATTEMPT', 'STATUS_CHANGE', 'TASK_ASSIGNED', 'OUTCOME');

-- CreateEnum
CREATE TYPE "AbuseTargetType" AS ENUM ('JOB', 'COMPANY', 'USER', 'MESSAGE');

-- CreateEnum
CREATE TYPE "AbuseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AbuseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AbuseEventKind" AS ENUM ('CREATED', 'TRIAGED', 'ASSIGNED', 'RESTRICTION_APPLIED', 'RESTRICTION_LIFTED', 'RESOLVED', 'DISMISSED', 'NOTE_ADDED');

-- CreateEnum
CREATE TYPE "ModerationRestrictionType" AS ENUM ('HIDE_JOB', 'PAUSE_COMPANY', 'SUSPEND_USER', 'BLOCK_MESSAGE_THREAD');

-- CreateEnum
CREATE TYPE "ModerationRestrictionStatus" AS ENUM ('ACTIVE', 'LIFTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ImportInputSource" AS ENUM ('UPLOAD', 'PASTE');

-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('XML', 'JSON');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('PENDING', 'PARSING', 'PREVIEW_READY', 'PARTIALLY_COMMITTED', 'COMMITTED', 'PARTIALLY_ROLLED_BACK', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportItemStatus" AS ENUM ('PENDING', 'OK', 'ERROR', 'COMMITTED', 'ROLLED_BACK', 'CONFLICT_MANUAL_REMEDIATION');

-- CreateEnum
CREATE TYPE "ImportDecisionKind" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "ImportSetupApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ImportAccessGrantStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AdditionalJobPermitStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EmailLogStatus" AS ENUM ('QUEUED', 'MOCK_RECORDED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ContactRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContactRequestEventKind" AS ENUM ('CREATED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REVEAL_GRANTED');

-- CreateEnum
CREATE TYPE "RevealField" AS ENUM ('DISPLAY_NAME', 'EMAIL', 'PHONE', 'CV_METADATA');

-- CreateEnum
CREATE TYPE "PrivacyRequestType" AS ENUM ('EXPORT', 'DELETE', 'CORRECT');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('PENDING', 'IDENTITY_CHECK', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrivacyRequestEventKind" AS ENUM ('CREATED', 'IDENTITY_REQUESTED', 'VERIFIED', 'PROCESSING_STARTED', 'MANIFEST_CREATED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'NOTE_ADDED');

-- CreateEnum
CREATE TYPE "PrivacyCorrectionFieldCode" AS ENUM ('DISPLAY_NAME', 'LEGAL_NAME', 'EMAIL', 'PHONE', 'LOCATION', 'PROFILE_PREFERENCES', 'CONSENT_HISTORY', 'APPLICATION_DATA', 'OTHER_ACCOUNT_DATA');

-- CreateEnum
CREATE TYPE "PrivacyCorrectionOutcomeCode" AS ENUM ('CORRECTED_VIA_CANONICAL_COMMAND', 'NO_CHANGE_REQUIRED', 'REFERRED_FOR_POLICY');

-- CreateEnum
CREATE TYPE "PrivacyDeletionDependencyCode" AS ENUM ('ACCOUNTING_RETENTION', 'ACTIVE_APPLICATIONS', 'MESSAGES', 'ABUSE_SECURITY_AUDIT', 'LEGAL_HOLD', 'ACTIVE_COMPANY_DUTY', 'NONE');

-- CreateEnum
CREATE TYPE "PrivacyDeletionOutcomeCode" AS ENUM ('ASSESSMENT_COMPLETED_NO_ERASURE');

-- CreateEnum
CREATE TYPE "PrivacyRequestRejectionCode" AS ENUM ('IDENTITY_NOT_VERIFIED', 'DUPLICATE', 'OUT_OF_SCOPE', 'INSUFFICIENT_INFORMATION', 'ABUSIVE_REQUEST');

-- CreateEnum
CREATE TYPE "IdentityRevealRevokeReason" AS ENUM ('PRIVACY_CHOICE', 'TRUST_CONCERN', 'OTHER');

-- CreateEnum
CREATE TYPE "RadarConsentKind" AS ENUM ('TALENT_RADAR_VISIBILITY');

-- CreateEnum
CREATE TYPE "UserConsentKind" AS ENUM ('TERMS', 'MARKETING', 'DATA_USE', 'JOB_ALERT_DELIVERY');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "JobAlertStatus" AS ENUM ('ACTIVE', 'PAUSED', 'UNSUBSCRIBED', 'DELETED');

-- CreateEnum
CREATE TYPE "JobAlertEventKind" AS ENUM ('CREATED', 'UPDATED', 'PAUSED', 'RESUMED', 'DIGEST_MOCK_RECORDED', 'UNSUBSCRIBED', 'DELETED');

-- CreateEnum
CREATE TYPE "ContentPageType" AS ENUM ('GUIDE', 'CLUSTER');

-- CreateEnum
CREATE TYPE "ContentRevisionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "ContentEventKind" AS ENUM ('DRAFTED', 'SUBMITTED_FOR_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('ACCOUNT', 'APPLICATION', 'EMPLOYER', 'BILLING', 'PRIVACY', 'ABUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'TRIAGED', 'WAITING_FOR_REQUESTER', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportCaseEventKind" AS ENUM ('CREATED', 'TRIAGED', 'ASSIGNED', 'INFORMATION_REQUESTED', 'REPLIED', 'RESOLVED', 'REOPENED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SystemTaskKind" AS ENUM ('MODERATION', 'VERIFICATION', 'SUPPORT', 'SALES_FOLLOW_UP', 'CONTENT_REVIEW', 'SUPPLY_GAP', 'USAGE_DIAGNOSTIC', 'RENEWAL_REVIEW', 'RETENTION_RISK', 'CREDIT_EXPIRY');

-- CreateEnum
CREATE TYPE "SystemTaskStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('APPLICATION_SUBMITTED', 'APPLICATION_STATUS_CHANGED', 'MESSAGE_RECEIVED', 'CONTACT_REQUEST_RECEIVED', 'CONTACT_REQUEST_ACCEPTED', 'CONTACT_REQUEST_DECLINED', 'CONTACT_REQUEST_CANCELLED', 'IDENTITY_REVEAL_GRANTED', 'IDENTITY_REVEAL_REVOKED', 'JOB_REVIEW_CHANGED', 'COMPANY_VERIFICATION_CHANGED', 'TEAM_INVITATION_CREATED', 'TEAM_MEMBERSHIP_CHANGED', 'ORDER_PAID', 'INVOICE_ISSUED', 'SUBSCRIPTION_CHANGED', 'USAGE_WARNING', 'SYSTEM_TASK_ASSIGNED', 'SUPPORT_CASE_CHANGED', 'PRIVACY_REQUEST_CHANGED');

-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('USER', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCEEDED', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('USER', 'SESSION', 'COMPANY', 'MEMBERSHIP', 'INVITATION', 'CLAIM_REQUEST', 'VERIFICATION_REQUEST', 'JOB', 'JOB_REVISION', 'JOB_ASSIGNMENT', 'APPLICATION', 'CONVERSATION', 'MESSAGE', 'RADAR_PROFILE', 'CONTACT_REQUEST', 'IDENTITY_REVEAL_GRANT', 'PRIVACY_REQUEST', 'ABUSE_REPORT', 'MODERATION_RESTRICTION', 'PLAN_VERSION', 'PRODUCT_VERSION', 'SUBSCRIPTION', 'ORDER', 'INVOICE', 'CREDIT_LEDGER_ENTRY', 'JOB_BOOST', 'IMPORT_SOURCE', 'IMPORT_RUN', 'SUPPORT_CASE', 'CONTENT_REVISION', 'SALES_LEAD', 'SYSTEM_TASK', 'CLUSTER_LAUNCH_ASSESSMENT', 'TAX_RATE_VERSION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_REGISTERED', 'USER_LOGIN', 'USER_LOGIN_FAILED', 'USER_LOGOUT', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'SESSION_REVOKED', 'USER_SUSPENDED', 'USER_REACTIVATED', 'COMPANY_CREATED_WITH_OWNER', 'COMPANY_CLAIM_REQUESTED', 'COMPANY_CLAIM_EVIDENCE_REQUESTED', 'COMPANY_CLAIM_APPROVED', 'COMPANY_CLAIM_REJECTED', 'COMPANY_PROFILE_UPDATED', 'COMPANY_ONBOARDING_COMPLETED', 'COMPANY_VERIFICATION_SUBMITTED', 'COMPANY_VERIFICATION_CHANGES_REQUESTED', 'COMPANY_VERIFIED', 'COMPANY_VERIFICATION_REJECTED', 'COMPANY_VERIFICATION_REVOKED', 'COMPANY_SUSPENDED', 'COMPANY_REACTIVATED', 'INVITATION_SENT', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED', 'MEMBERSHIP_ROLE_CHANGED', 'MEMBERSHIP_REMOVED', 'JOB_ASSIGNMENT_CREATED', 'JOB_ASSIGNMENT_REVOKED', 'JOB_DRAFT_UPDATED', 'JOB_SUBMITTED', 'JOB_REVIEW_STARTED', 'JOB_CHANGES_REQUESTED', 'JOB_APPROVED', 'JOB_PUBLISHED', 'JOB_REJECTED', 'JOB_FLAGGED', 'JOB_PAUSED', 'JOB_REACTIVATED', 'JOB_EXPIRED', 'JOB_CLOSED', 'JOB_REPORTING_CHECKED', 'APPLICATION_SUBMITTED', 'APPLICATION_STATUS_CHANGED', 'APPLICATION_WITHDRAWN', 'APPLICATION_EMPLOYER_NOTE_ADDED', 'MESSAGE_SENT', 'CANDIDATE_ONBOARDING_COMPLETED', 'CANDIDATE_ONBOARDING_REOPENED', 'USER_CONSENT_CHANGED', 'RADAR_CONSENT_CHANGED', 'CONTACT_REQUEST_SENT', 'CONTACT_REQUEST_ACCEPTED', 'CONTACT_REQUEST_DECLINED', 'CONTACT_REQUEST_EXPIRED', 'CONTACT_REQUEST_CANCELLED', 'IDENTITY_REVEALED', 'IDENTITY_REVEAL_REVOKED', 'PRIVACY_CASE_ACCESSED', 'PRIVACY_REQUEST_CREATED', 'PRIVACY_REQUEST_STATUS_CHANGED', 'PRIVACY_EXPORT_MANIFEST_CREATED', 'CHECKOUT_CREATED', 'ORDER_PAID', 'ORDER_FAILED', 'ORDER_CANCELLED', 'INVOICE_ISSUED', 'INVOICE_PAID', 'INVOICE_VOIDED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_CHANGED', 'SUBSCRIPTION_CANCELLING', 'SUBSCRIPTION_EXPIRED', 'CREDITS_GRANTED', 'CREDITS_CONSUMED', 'CREDITS_EXPIRED', 'CREDIT_CONSUME_REVERSED', 'JOB_BOOST_ACTIVATED', 'JOB_BOOST_CANCELLED', 'JOB_BOOST_EXPIRED', 'ABUSE_REPORT_SUBMITTED', 'ABUSE_REPORT_TRIAGED', 'MODERATION_RESTRICTION_APPLIED', 'MODERATION_RESTRICTION_LIFTED', 'MODERATION_RESTRICTION_EXPIRED', 'ABUSE_REPORT_RESOLVED', 'IMPORT_PARSED', 'IMPORT_DECISION_RECORDED', 'IMPORT_COMMITTED', 'IMPORT_ROLLED_BACK', 'IMPORT_SETUP_APPROVED', 'IMPORT_SETUP_REVOKED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_TRIAGED', 'SUPPORT_CASE_ASSIGNED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_RESOLVED', 'SUPPORT_CASE_REOPENED', 'CONTENT_DRAFTED', 'CONTENT_REVIEWED', 'CONTENT_PUBLISHED', 'CONTENT_UNPUBLISHED', 'TAXONOMY_CHANGED', 'LEAD_STATUS_CHANGED', 'SYSTEM_TASK_ASSIGNED', 'SYSTEM_TASK_OUTCOME_RECORDED', 'CLUSTER_ASSESSMENT_APPROVED', 'CLUSTER_ACTIVATED', 'CLUSTER_REVOKED', 'CATALOG_VERSION_SCHEDULED', 'CATALOG_VERSION_DEACTIVATED', 'TAX_RATE_APPROVED', 'RATE_LIMITED', 'AUTHORIZATION_DENIED_SENSITIVE', 'MAINTENANCE_PROJECTION_SYNCED');

-- CreateEnum
CREATE TYPE "AnalyticsPurpose" AS ENUM ('ESSENTIAL_OPERATIONAL', 'PRODUCT_ANALYTICS');

-- CreateEnum
CREATE TYPE "AnalyticsEventKind" AS ENUM ('PUBLIC_VALUE_VIEWED', 'SEARCH_SUBMITTED', 'SEARCH_RESULTS_VIEWED', 'JOB_DETAIL_VIEWED', 'JOB_SAVED', 'APPLY_INTENT_STARTED', 'APPLICATION_SUBMITTED', 'APPLICATION_STATUS_CHANGED', 'CANDIDATE_REGISTERED', 'CANDIDATE_PROFILE_COMPLETED', 'RADAR_OPTED_IN', 'JOB_ALERT_ACTIVATED', 'EMPLOYER_REGISTERED', 'COMPANY_ONBOARDING_COMPLETED', 'COMPANY_VERIFICATION_SUBMITTED', 'COMPANY_VERIFIED', 'JOB_DRAFT_CREATED', 'JOB_SUBMITTED', 'JOB_PUBLISHED', 'EMPLOYER_RESPONSE_RECORDED', 'CONTACT_REQUEST_SENT', 'CONTACT_REQUEST_ACCEPTED', 'CONTACT_REQUEST_DECLINED', 'IDENTITY_REVEAL_GRANTED', 'PRICING_VIEWED', 'LIMIT_REACHED', 'CHECKOUT_STARTED', 'CHECKOUT_COMPLETED', 'SUBSCRIPTION_CHANGED', 'LEAD_SUBMITTED', 'LEAD_QUALIFIED', 'LEAD_WON', 'BOOST_ACTIVATED', 'MODERATION_ACTIONED');

-- CreateEnum
CREATE TYPE "JobReportingResult" AS ENUM ('REQUIRES_REPORTING', 'NOT_REQUIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RequiredDocumentKind" AS ENUM ('NONE', 'CV', 'COVER_LETTER', 'CERTIFICATES', 'REFERENCES', 'PORTFOLIO', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationContactKind" AS ENUM ('EMAIL', 'PHONE', 'APPLY_URL');

-- CreateEnum
CREATE TYPE "JobBenefitCode" AS ENUM ('FLEXIBLE_WORK', 'HOME_OFFICE', 'PAID_TRAINING', 'PENSION_TOP_UP', 'PARENTAL_LEAVE', 'CHILDCARE_SUPPORT', 'PUBLIC_TRANSPORT_SUPPORT', 'MEAL_SUPPORT', 'HEALTH_WELLBEING', 'EXTRA_LEAVE', 'PERFORMANCE_BONUS');

-- CreateEnum
CREATE TYPE "ClusterLaunchAssessmentStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ClusterLaunchEventKind" AS ENUM ('EVALUATED', 'PRODUCT_APPROVED', 'OPS_APPROVED', 'ACTIVATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RecruiterMandateStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RecruiterMandateEventKind" AS ENUM ('GRANTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralAttributionKind" AS ENUM ('VISIT', 'CONVERSION');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailNormalized" VARCHAR(320) NOT NULL,
    "role" "Role" NOT NULL,
    "name" VARCHAR(160),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "dataProvenance" "DataProvenance" NOT NULL DEFAULT 'LIVE',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "algorithm" VARCHAR(32) NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "userAgent" VARCHAR(512),
    "ipHash" VARCHAR(128),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "requestedIpHash" VARCHAR(128),
    "requestedUserAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" UUID NOT NULL,
    "namespace" VARCHAR(64) NOT NULL,
    "keyHash" VARCHAR(128) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Canton" (
    "id" UUID NOT NULL,
    "code" CHAR(2) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "language" "Language" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Canton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" UUID NOT NULL,
    "cantonId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cantonId" UUID,
    "firstName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "publicDisplayName" VARCHAR(160),
    "phone" VARCHAR(40),
    "postalCode" VARCHAR(16),
    "cityLabel" VARCHAR(160),
    "summary" VARCHAR(3000),
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateOnboardingEvent" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "kind" "CandidateOnboardingEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateOnboardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSkill" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "level" INTEGER,
    "years" INTEGER,

    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateLanguage" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "code" CHAR(2) NOT NULL,
    "level" "LanguageLevel" NOT NULL,

    CONSTRAINT "CandidateLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePreference" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "desiredTitles" TEXT[],
    "desiredJobTypes" "JobType"[],
    "salaryPeriod" "SalaryPeriod",
    "salaryMinChf" INTEGER,
    "salaryMaxChf" INTEGER,
    "workloadMin" INTEGER,
    "workloadMax" INTEGER,
    "remotePreference" "RemotePreference",
    "mobilityRadiusKm" INTEGER,
    "availableFrom" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CandidatePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePreferenceCategory" (
    "candidatePreferenceId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "CandidatePreferenceCategory_pkey" PRIMARY KEY ("candidatePreferenceId","categoryId")
);

-- CreateTable
CREATE TABLE "CandidateDocumentMetadata" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "safeFilename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "purpose" "DocumentPurpose" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CandidateDocumentMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(160),
    "phone" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "uid" VARCHAR(32),
    "industry" VARCHAR(160),
    "size" VARCHAR(64),
    "website" VARCHAR(512),
    "logoStorageKey" VARCHAR(512),
    "coverStorageKey" VARCHAR(512),
    "about" VARCHAR(5000),
    "values" TEXT[],
    "benefits" TEXT[],
    "responseTargetDays" INTEGER,
    "responseSampleSize" INTEGER NOT NULL DEFAULT 0,
    "responseWithinTargetBps" INTEGER,
    "status" "CompanyStatus" NOT NULL DEFAULT 'DRAFT',
    "dataProvenance" "DataProvenance" NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyStatusEvent" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" "CompanyStatusEventKind" NOT NULL,
    "fromStatus" "CompanyStatus",
    "toStatus" "CompanyStatus" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CompanyMembershipRole" NOT NULL,
    "status" "CompanyMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembershipEvent" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "kind" "CompanyMembershipEventKind" NOT NULL,
    "fromRole" "CompanyMembershipRole",
    "toRole" "CompanyMembershipRole",
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMembershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyLocation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "cantonId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "address" VARCHAR(255),
    "postalCode" VARCHAR(16),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInvitation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "inviterUserId" UUID NOT NULL,
    "acceptedByUserId" UUID,
    "inviteeEmailNormalized" VARCHAR(320) NOT NULL,
    "intendedRole" "CompanyMembershipRole" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "CompanyInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInvitationEvent" (
    "id" UUID NOT NULL,
    "invitationId" UUID NOT NULL,
    "kind" "CompanyInvitationEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyInvitationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyClaimRequest" (
    "id" UUID NOT NULL,
    "requesterEmployerUserId" UUID NOT NULL,
    "candidateCompanyId" UUID NOT NULL,
    "requestedRole" "CompanyMembershipRole" NOT NULL DEFAULT 'OWNER',
    "approvedRole" "CompanyMembershipRole",
    "matchSignals" JSONB NOT NULL,
    "evidenceSummary" VARCHAR(1000),
    "status" "CompanyClaimStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyClaimEvent" (
    "id" UUID NOT NULL,
    "claimRequestId" UUID NOT NULL,
    "kind" "CompanyClaimEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "evidenceRef" VARCHAR(255),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVerificationRequest" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "supersedesRequestId" UUID,
    "status" "CompanyVerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "evidenceMetadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVerificationEvent" (
    "id" UUID NOT NULL,
    "verificationRequestId" UUID NOT NULL,
    "kind" "CompanyVerificationEventKind" NOT NULL,
    "fromStatus" "CompanyVerificationStatus",
    "toStatus" "CompanyVerificationStatus" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "evidenceRef" VARCHAR(255),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "JobOrigin" NOT NULL DEFAULT 'MANUAL',
    "sourceReference" VARCHAR(255) NOT NULL DEFAULT 'platform-manual',
    "importSourceId" UUID,
    "currentRevisionId" UUID,
    "publishedRevisionId" UUID,
    "publishedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "publishedCategoryId" UUID,
    "publishedCantonId" UUID,
    "publishedCityId" UUID,
    "publishedSalaryPeriod" "SalaryPeriod",
    "publishedSalaryMin" INTEGER,
    "publishedSalaryMax" INTEGER,
    "dataProvenance" "DataProvenance" NOT NULL DEFAULT 'LIVE',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRevision" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "tasks" TEXT[],
    "requirements" TEXT[],
    "applicationProcessSteps" TEXT[],
    "requiredDocumentKinds" "RequiredDocumentKind"[],
    "jobType" "JobType" NOT NULL,
    "remoteType" "RemoteType" NOT NULL,
    "categoryId" UUID NOT NULL,
    "cantonId" UUID NOT NULL,
    "cityId" UUID,
    "locationLabel" VARCHAR(200),
    "workloadMin" INTEGER NOT NULL,
    "workloadMax" INTEGER NOT NULL,
    "salaryPeriod" "SalaryPeriod",
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "startDate" DATE,
    "startByArrangement" BOOLEAN NOT NULL DEFAULT false,
    "validThrough" TIMESTAMPTZ(3),
    "responseTargetDays" INTEGER NOT NULL,
    "applicationEffort" "ApplicationEffort" NOT NULL,
    "inclusionStatement" VARCHAR(1000),
    "applicationContactKind" "ApplicationContactKind" NOT NULL,
    "applicationContactValue" VARCHAR(512) NOT NULL,
    "authoredByUserId" UUID NOT NULL,
    "contentChecksum" VARCHAR(64) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRevisionBenefit" (
    "id" UUID NOT NULL,
    "jobRevisionId" UUID NOT NULL,
    "benefitCode" "JobBenefitCode" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "JobRevisionBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRevisionSkill" (
    "id" UUID NOT NULL,
    "jobRevisionId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JobRevisionSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRevisionLanguage" (
    "id" UUID NOT NULL,
    "jobRevisionId" UUID NOT NULL,
    "code" CHAR(2) NOT NULL,
    "minLevel" "LanguageLevel" NOT NULL,

    CONSTRAINT "JobRevisionLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobScoreSnapshot" (
    "id" UUID NOT NULL,
    "jobRevisionId" UUID NOT NULL,
    "scoreVersion" VARCHAR(32) NOT NULL,
    "scorePoints" INTEGER NOT NULL,
    "maxPoints" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "factorBreakdown" JSONB NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStatusEvent" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "jobRevisionId" UUID,
    "kind" "JobStatusEventKind" NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAssignment" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "JobAssignmentRole" NOT NULL,
    "status" "JobAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedByUserId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAssignmentEvent" (
    "id" UUID NOT NULL,
    "jobAssignmentId" UUID NOT NULL,
    "kind" "JobAssignmentEventKind" NOT NULL,
    "fromRole" "JobAssignmentRole",
    "toRole" "JobAssignmentRole",
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobReportingCheck" (
    "id" UUID NOT NULL,
    "jobRevisionId" UUID NOT NULL,
    "occupationCodeVersionId" UUID NOT NULL,
    "occupationCodeId" UUID,
    "occupationCodeSnapshot" VARCHAR(32),
    "occupationLabelSnapshot" VARCHAR(255),
    "result" "JobReportingResult" NOT NULL,
    "reasonSnapshot" VARCHAR(1000) NOT NULL,
    "disclaimerSnapshot" VARCHAR(1000) NOT NULL,
    "sourceSnapshot" VARCHAR(500) NOT NULL,
    "checkedByUserId" UUID,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobReportingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobViewAggregate" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "viewCount" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "definitionVersion" VARCHAR(32) NOT NULL,
    "refreshedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobViewAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "submittedJobRevisionId" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "coverLetter" VARCHAR(10000),
    "rejectionReason" "ApplicationRejectionReason",
    "rejectionNote" VARCHAR(1000),
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSubmissionSnapshot" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "jobRevisionId" UUID NOT NULL,
    "candidateFirstName" VARCHAR(100) NOT NULL,
    "candidateLastName" VARCHAR(100) NOT NULL,
    "candidateEmail" VARCHAR(320) NOT NULL,
    "coverLetterSnapshot" VARCHAR(10000),
    "recipientCompanyName" VARCHAR(200) NOT NULL,
    "applicationContactKind" "ApplicationContactKind" NOT NULL,
    "applicationContactValue" VARCHAR(512) NOT NULL,
    "responseTargetDays" INTEGER NOT NULL,
    "applicationEffort" "ApplicationEffort" NOT NULL,
    "requiredDocumentKinds" "RequiredDocumentKind"[],
    "confirmationNoticeVersion" VARCHAR(32) NOT NULL,
    "confirmationNoticeHash" VARCHAR(64) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationSubmissionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSubmissionDocument" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "documentMetadataId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSubmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "actorUserId" UUID,
    "kind" "ApplicationEventKind" NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus",
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationCandidateNote" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "body" VARCHAR(3000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationCandidateNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEmployerNote" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" VARCHAR(3000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationEmployerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedJob" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlert" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "query" JSONB NOT NULL,
    "frequency" "AlertFrequency" NOT NULL,
    "status" "JobAlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextDueAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSuccessfulCutoffAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlertEvent" (
    "id" UUID NOT NULL,
    "jobAlertId" UUID NOT NULL,
    "kind" "JobAlertEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlertDigest" (
    "id" UUID NOT NULL,
    "jobAlertId" UUID NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    "runAt" TIMESTAMPTZ(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAlertDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlertDigestItem" (
    "id" UUID NOT NULL,
    "digestId" UUID NOT NULL,
    "jobAlertId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAlertDigestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlertUnsubscribeToken" (
    "id" UUID NOT NULL,
    "jobAlertId" UUID NOT NULL,
    "digestId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "JobAlertUnsubscribeToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "applicationId" UUID,
    "contactRequestId" UUID,
    "subject" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "kind" "ConversationParticipantKind" NOT NULL,
    "userId" UUID,
    "companyId" UUID,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "lastReadAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "schemaVersion" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" UUID NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "templateKey" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EmailLogStatus" NOT NULL DEFAULT 'MOCK_RECORDED',
    "providerReference" VARCHAR(255),
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateConsent" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "kind" "RadarConsentKind" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "noticeVersion" VARCHAR(32) NOT NULL,
    "noticeHash" VARCHAR(64) NOT NULL,
    "actorUserId" UUID NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsentEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "UserConsentKind" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "purpose" VARCHAR(160) NOT NULL,
    "noticeVersion" VARCHAR(32) NOT NULL,
    "noticeHash" VARCHAR(64) NOT NULL,
    "actorUserId" UUID,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarProfile" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "displayLabel" VARCHAR(160) NOT NULL,
    "cantonBucket" VARCHAR(64) NOT NULL,
    "categoryBucket" VARCHAR(120) NOT NULL,
    "seniority" "Seniority",
    "remotePreference" "RemotePreference",
    "workloadMin" INTEGER,
    "workloadMax" INTEGER,
    "salaryYearlyMinChf" INTEGER,
    "salaryYearlyMaxChf" INTEGER,
    "languageCodes" TEXT[],
    "skillSlugs" TEXT[],
    "publishedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "projectionVersion" VARCHAR(32) NOT NULL,
    "projectionHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RadarProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarOpaqueMapping" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "epoch" DATE NOT NULL,
    "lookupHmac" VARCHAR(128) NOT NULL,
    "encryptedToken" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "lookupKeyVersion" VARCHAR(32) NOT NULL,
    "encryptionKeyVersion" VARCHAR(32) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revocationReason" VARCHAR(64),

    CONSTRAINT "RadarOpaqueMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarSearchBudget" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "calendarDate" DATE NOT NULL,
    "filterHash" VARCHAR(64) NOT NULL,
    "firstUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarSearchBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarSearchSession" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "requestingUserId" UUID NOT NULL,
    "filterHash" VARCHAR(64) NOT NULL,
    "calendarDate" DATE NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "normalizedFilters" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarSearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarSearchSessionCandidate" (
    "id" UUID NOT NULL,
    "radarSearchSessionId" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RadarSearchSessionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerContactRequest" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "requestingUserId" UUID NOT NULL,
    "creditLedgerEntryId" UUID NOT NULL,
    "messagePreview" VARCHAR(1000) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "ContactRequestStatus" NOT NULL DEFAULT 'PENDING',
    "fundingSource" "CreditFundingSource" NOT NULL,
    "clusterPolicyVersion" VARCHAR(32) NOT NULL,
    "cantonBucketSnapshot" VARCHAR(64) NOT NULL,
    "categoryBucketSnapshot" VARCHAR(120) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "terminalAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployerContactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactRequestEvent" (
    "id" UUID NOT NULL,
    "contactRequestId" UUID NOT NULL,
    "kind" "ContactRequestEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityRevealGrant" (
    "id" UUID NOT NULL,
    "candidateProfileId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contactRequestId" UUID NOT NULL,
    "conversationId" UUID,
    "noticeVersion" VARCHAR(32) NOT NULL,
    "confirmationSnapshotHash" VARCHAR(128) NOT NULL,
    "revealedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" UUID,
    "revokeReason" "IdentityRevealRevokeReason",

    CONSTRAINT "IdentityRevealGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityRevealGrantField" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "field" "RevealField" NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "encryptionKeyVersion" VARCHAR(32) NOT NULL,
    "schemaVersion" VARCHAR(32) NOT NULL,
    "integrityHmac" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityRevealGrantField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityRevealConfirmation" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "contactRequestId" UUID NOT NULL,
    "conversationId" UUID,
    "completeFieldSet" "RevealField"[],
    "newlyAddedFields" "RevealField"[],
    "noticeVersion" VARCHAR(32) NOT NULL,
    "previewHmac" VARCHAR(128) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityRevealConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" UUID NOT NULL,
    "requesterUserId" UUID NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "assignedAdminUserId" UUID,
    "assignmentReasonCode" VARCHAR(64),
    "verifiedAt" TIMESTAMPTZ(3),
    "processingStartedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correctionOutcome" "PrivacyCorrectionOutcomeCode",
    "deletionDependencies" "PrivacyDeletionDependencyCode"[],
    "deletionOutcome" "PrivacyDeletionOutcomeCode",
    "rejectionCode" "PrivacyRequestRejectionCode",
    "safeOutcomeNote" VARCHAR(500),
    "exportManifest" JSONB,
    "exportManifestChecksum" VARCHAR(64),
    "exportExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequestCorrectionField" (
    "privacyRequestId" UUID NOT NULL,
    "fieldCode" "PrivacyCorrectionFieldCode" NOT NULL,
    "correctionText" VARCHAR(1000) NOT NULL,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PrivacyRequestCorrectionField_pkey" PRIMARY KEY ("privacyRequestId","fieldCode")
);

-- CreateTable
CREATE TABLE "PrivacyRequestEvent" (
    "id" UUID NOT NULL,
    "privacyRequestId" UUID NOT NULL,
    "kind" "PrivacyRequestEventKind" NOT NULL,
    "fromStatus" "PrivacyRequestStatus",
    "toStatus" "PrivacyRequestStatus" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "safeNote" VARCHAR(500),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyIdentityChallenge" (
    "id" UUID NOT NULL,
    "privacyRequestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyIdentityChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbuseReport" (
    "id" UUID NOT NULL,
    "targetType" "AbuseTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "reporterUserId" UUID,
    "reasonCode" VARCHAR(64) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "severity" "AbuseSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "AbuseStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" UUID,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "resolutionCode" VARCHAR(64),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AbuseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbuseReportEvent" (
    "id" UUID NOT NULL,
    "abuseReportId" UUID NOT NULL,
    "kind" "AbuseEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "safeNote" VARCHAR(500),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbuseReportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationRestriction" (
    "id" UUID NOT NULL,
    "abuseReportId" UUID NOT NULL,
    "targetType" "ModerationRestrictionType" NOT NULL,
    "targetId" UUID NOT NULL,
    "status" "ModerationRestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" VARCHAR(1000) NOT NULL,
    "appliedByUserId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "liftedAt" TIMESTAMPTZ(3),
    "correlationId" VARCHAR(128) NOT NULL,

    CONSTRAINT "ModerationRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorKind" "AuditActorKind" NOT NULL,
    "capability" VARCHAR(128) NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetType" "AuditTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "companyId" UUID,
    "result" "AuditResult" NOT NULL,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "metadata" JSONB,
    "ipHash" VARCHAR(128),
    "ipHashVersion" VARCHAR(32),
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryDatasetVersion" (
    "id" UUID NOT NULL,
    "datasetKey" VARCHAR(64) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "source" VARCHAR(500) NOT NULL,
    "referenceUrl" VARCHAR(1000),
    "methodology" VARCHAR(3000) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "dataAsOf" DATE NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "reviewStatus" "SalaryDatasetReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryDatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryBand" (
    "id" UUID NOT NULL,
    "salaryDatasetVersionId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "cantonId" UUID,
    "seniority" "Seniority",
    "workloadMin" INTEGER NOT NULL,
    "workloadMax" INTEGER NOT NULL,
    "period" "SalaryPeriod" NOT NULL,
    "p25Chf" INTEGER NOT NULL,
    "medianChf" INTEGER NOT NULL,
    "p75Chf" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "notes" VARCHAR(1000),

    CONSTRAINT "SalaryBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccupationCodeVersion" (
    "id" UUID NOT NULL,
    "datasetKey" VARCHAR(64) NOT NULL,
    "datasetYear" INTEGER NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "source" VARCHAR(500) NOT NULL,
    "referenceUrl" VARCHAR(1000),
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccupationCodeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccupationCode" (
    "id" UUID NOT NULL,
    "occupationCodeVersionId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "result" "JobReportingResult" NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,

    CONSTRAINT "OccupationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportSource" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sourceReference" VARCHAR(500) NOT NULL,
    "licenseReference" VARCHAR(500) NOT NULL,
    "provenance" "DataProvenance" NOT NULL DEFAULT 'LIVE',
    "format" "ImportFormat" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportSourceCompanyRight" (
    "id" UUID NOT NULL,
    "importSourceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "rightsEvidence" VARCHAR(1000) NOT NULL,
    "grantedByUserId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportSourceCompanyRight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" UUID NOT NULL,
    "importSourceId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "inputSource" "ImportInputSource" NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'PENDING',
    "redactedErrorSummary" VARCHAR(1000),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportItem" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "sourceItemKey" VARCHAR(160) NOT NULL,
    "normalizedPreview" JSONB NOT NULL,
    "normalizedChecksum" VARCHAR(64) NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "status" "ImportItemStatus" NOT NULL DEFAULT 'PENDING',
    "validationSummary" JSONB,
    "redactedErrorSummary" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportDecision" (
    "id" UUID NOT NULL,
    "importItemId" UUID NOT NULL,
    "kind" "ImportDecisionKind" NOT NULL,
    "selectedCompanyId" UUID,
    "actorUserId" UUID NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "committedJobId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "producer" VARCHAR(64) NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "kind" "AnalyticsEventKind" NOT NULL,
    "schemaVersion" VARCHAR(32) NOT NULL,
    "purpose" "AnalyticsPurpose" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pseudonymousActorId" VARCHAR(128),
    "pseudonymousSessionId" VARCHAR(128),
    "companyId" UUID,
    "jobId" UUID,
    "actorProvenanceSnapshot" "DataProvenance",
    "companyProvenanceSnapshot" "DataProvenance",
    "jobProvenanceSnapshot" "DataProvenance",
    "properties" JSONB NOT NULL,
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricDaily" (
    "id" UUID NOT NULL,
    "metricKey" VARCHAR(64) NOT NULL,
    "definitionVersion" VARCHAR(32) NOT NULL,
    "thresholdVersion" VARCHAR(32) NOT NULL,
    "calendarDate" DATE NOT NULL,
    "companyId" UUID,
    "cantonId" UUID,
    "categoryId" UUID,
    "valueInteger" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "refreshedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterLaunchAssessment" (
    "id" UUID NOT NULL,
    "cantonId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL,
    "evidenceWindowStart" TIMESTAMPTZ(3) NOT NULL,
    "evidenceWindowEnd" TIMESTAMPTZ(3) NOT NULL,
    "liveJobCount" INTEGER NOT NULL,
    "activeCandidateCount" INTEGER NOT NULL,
    "activeEmployerCount" INTEGER NOT NULL,
    "responseRateBasisPoints" INTEGER NOT NULL,
    "contentCoverageBasisPoints" INTEGER NOT NULL,
    "medianApplicationsTimes2" INTEGER NOT NULL,
    "dataProvenance" "DataProvenance" NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "status" "ClusterLaunchAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "productApprovedByUserId" UUID,
    "productApprovedAt" TIMESTAMPTZ(3),
    "opsApprovedByUserId" UUID,
    "opsApprovedAt" TIMESTAMPTZ(3),
    "activatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "activationReason" VARCHAR(500),
    "revokeReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterLaunchAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterLaunchEvent" (
    "id" UUID NOT NULL,
    "clusterLaunchAssessmentId" UUID NOT NULL,
    "kind" "ClusterLaunchEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterLaunchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "isDefaultFree" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CatalogVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "priceMode" "PlanPriceMode" NOT NULL,
    "billingInterval" "BillingInterval" NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "netPriceRappen" INTEGER,
    "monthlyEquivalentRappen" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'CHF',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isSelfService" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "id" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "key" "EntitlementKey" NOT NULL,
    "valueType" "EntitlementValueType" NOT NULL,
    "booleanValue" BOOLEAN,
    "integerValue" INTEGER,
    "analyticsLevelValue" "AnalyticsLevel",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerSubscription" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "sourceOrderId" UUID,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "billingIntervalSnapshot" "BillingInterval" NOT NULL,
    "termMonthsSnapshot" INTEGER NOT NULL,
    "recurringNetRappenSnapshot" INTEGER NOT NULL,
    "monthlyEquivalentRappenSnapshot" INTEGER NOT NULL,
    "currencySnapshot" CHAR(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployerSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "kind" "SubscriptionEventKind" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(64),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionChangeSchedule" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "currentSubscriptionId" UUID NOT NULL,
    "successorSubscriptionId" UUID,
    "kind" "SubscriptionChangeKind" NOT NULL,
    "status" "SubscriptionChangeStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "retainedMembershipIds" TEXT[],
    "retainedDefaultOwnerId" UUID NOT NULL,
    "invitationRevocationScope" JSONB NOT NULL,
    "actorUserId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "appliedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionChangeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "ProductType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVersion" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CatalogVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "netPriceRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CHF',
    "durationDays" INTEGER,
    "creditType" "CreditType",
    "creditAmount" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isSelfService" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "requiresLegalReview" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBillingProfile" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "legalName" VARCHAR(200) NOT NULL,
    "billingContactEmail" VARCHAR(320) NOT NULL,
    "street" VARCHAR(200) NOT NULL,
    "postalCode" VARCHAR(16) NOT NULL,
    "city" VARCHAR(160) NOT NULL,
    "countryCode" CHAR(2) NOT NULL DEFAULT 'CH',
    "uid" VARCHAR(32),
    "vatNumber" VARCHAR(32),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MOCK',
    "clientIdempotencyKey" VARCHAR(128) NOT NULL,
    "providerIdempotencyKey" VARCHAR(128),
    "providerReference" VARCHAR(255),
    "billingLegalNameSnapshot" VARCHAR(200) NOT NULL,
    "billingContactEmailSnapshot" VARCHAR(320) NOT NULL,
    "billingStreetSnapshot" VARCHAR(200) NOT NULL,
    "billingPostalCodeSnapshot" VARCHAR(16) NOT NULL,
    "billingCitySnapshot" VARCHAR(160) NOT NULL,
    "billingCountryCodeSnapshot" CHAR(2) NOT NULL,
    "billingUidSnapshot" VARCHAR(32),
    "billingVatNumberSnapshot" VARCHAR(32),
    "currency" CHAR(3) NOT NULL DEFAULT 'CHF',
    "netTotalRappen" INTEGER NOT NULL,
    "vatTotalRappen" INTEGER NOT NULL,
    "totalRappen" INTEGER NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "planVersionId" UUID,
    "productVersionId" UUID,
    "taxRateVersionId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitNetRappen" INTEGER NOT NULL,
    "netRappen" INTEGER NOT NULL,
    "taxRateBasisPoints" INTEGER NOT NULL,
    "vatRappen" INTEGER NOT NULL,
    "totalRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "descriptionSnapshot" VARCHAR(255) NOT NULL,
    "fulfillmentContext" "FulfillmentContextType" NOT NULL,
    "targetJobId" UUID,
    "targetImportSourceId" UUID,
    "targetCreditType" "CreditType",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "billingLegalNameSnapshot" VARCHAR(200) NOT NULL,
    "billingContactEmailSnapshot" VARCHAR(320) NOT NULL,
    "billingStreetSnapshot" VARCHAR(200) NOT NULL,
    "billingPostalCodeSnapshot" VARCHAR(16) NOT NULL,
    "billingCitySnapshot" VARCHAR(160) NOT NULL,
    "billingCountryCodeSnapshot" CHAR(2) NOT NULL,
    "billingUidSnapshot" VARCHAR(32),
    "billingVatNumberSnapshot" VARCHAR(32),
    "currency" CHAR(3) NOT NULL,
    "netTotalRappen" INTEGER NOT NULL,
    "vatTotalRappen" INTEGER NOT NULL,
    "totalRappen" INTEGER NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "descriptionSnapshot" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitNetRappen" INTEGER NOT NULL,
    "netRappen" INTEGER NOT NULL,
    "taxRateBasisPoints" INTEGER NOT NULL,
    "vatRappen" INTEGER NOT NULL,
    "totalRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRateVersion" (
    "id" UUID NOT NULL,
    "jurisdiction" VARCHAR(32) NOT NULL,
    "taxType" VARCHAR(64) NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "source" VARCHAR(500) NOT NULL,
    "referenceUrl" VARCHAR(1000),
    "reviewStatus" "TaxRateReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementGrant" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "key" "EntitlementKey" NOT NULL,
    "valueType" "EntitlementValueType" NOT NULL,
    "booleanValue" BOOLEAN,
    "integerValue" INTEGER,
    "analyticsLevelValue" "AnalyticsLevel",
    "integerMode" "EntitlementIntegerMode",
    "reasonCode" VARCHAR(64) NOT NULL,
    "grantedByUserId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "fundingSource" "CreditFundingSource" NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "fundingSource" "CreditFundingSource" NOT NULL,
    "kind" "CreditLedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourcePlanVersionId" UUID,
    "sourceOrderLineId" UUID,
    "reversalOfEntryId" UUID,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "reasonCode" VARCHAR(64),
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "kind" "PaymentEventKind" NOT NULL,
    "providerReference" VARCHAR(255),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobBoost" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderLineId" UUID,
    "consumedCreditLedgerEntryId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "BoostStatus" NOT NULL,
    "cancellationReason" VARCHAR(500),
    "cancelledByUserId" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobBoost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalJobPermit" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "targetJobId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "status" "AdditionalJobPermitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdditionalJobPermit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportSetupApproval" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "importSourceId" UUID NOT NULL,
    "orderLineId" UUID,
    "sourceRightsEvidence" VARCHAR(1000) NOT NULL,
    "mappingEvidence" VARCHAR(1000) NOT NULL,
    "approvedByUserId" UUID,
    "approvalReason" VARCHAR(500),
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "status" "ImportSetupApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportSetupApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportAccessGrant" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "importSourceId" UUID NOT NULL,
    "importSetupApprovalId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "status" "ImportAccessGrantStatus" NOT NULL DEFAULT 'SCHEDULED',
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "auditCorrelationId" VARCHAR(128) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLead" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "emailNormalized" VARCHAR(320) NOT NULL,
    "organizationNormalized" VARCHAR(200),
    "purpose" VARCHAR(128) NOT NULL,
    "consentSource" VARCHAR(128) NOT NULL,
    "needSummary" VARCHAR(2000),
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "ownerUserId" UUID,
    "nextAt" TIMESTAMPTZ(3),
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" UUID NOT NULL,
    "salesLeadId" UUID NOT NULL,
    "kind" "SalesActivityKind" NOT NULL,
    "actorUserId" UUID,
    "safeNote" VARCHAR(1000),
    "outcomeCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemTask" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "kind" "SystemTaskKind" NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "evidenceWindowStart" TIMESTAMPTZ(3),
    "evidenceWindowEnd" TIMESTAMPTZ(3),
    "evidenceReference" VARCHAR(255),
    "ownerUserId" UUID,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SystemTaskStatus" NOT NULL DEFAULT 'OPEN',
    "outcomeCode" VARCHAR(64),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "id" UUID NOT NULL,
    "publicCodeHash" VARCHAR(128) NOT NULL,
    "encryptedCode" BYTEA NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "campaign" VARCHAR(128) NOT NULL,
    "targetPath" VARCHAR(500) NOT NULL,
    "keyVersion" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralAttribution" (
    "id" UUID NOT NULL,
    "referralLinkId" UUID NOT NULL,
    "kind" "ReferralAttributionKind" NOT NULL,
    "pseudonymousVisitorId" VARCHAR(128) NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "selfReferralFlag" BOOLEAN NOT NULL DEFAULT false,
    "botFlag" BOOLEAN NOT NULL DEFAULT false,
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruiterMandate" (
    "id" UUID NOT NULL,
    "recruiterUserId" UUID NOT NULL,
    "clientCompanyId" UUID NOT NULL,
    "grantedByOwnerUserId" UUID NOT NULL,
    "status" "RecruiterMandateStatus" NOT NULL DEFAULT 'SCHEDULED',
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "reasonCode" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruiterMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruiterMandateJob" (
    "recruiterMandateId" UUID NOT NULL,
    "jobId" UUID NOT NULL,

    CONSTRAINT "RecruiterMandateJob_pkey" PRIMARY KEY ("recruiterMandateId","jobId")
);

-- CreateTable
CREATE TABLE "RecruiterMandateEvent" (
    "id" UUID NOT NULL,
    "recruiterMandateId" UUID NOT NULL,
    "kind" "RecruiterMandateEventKind" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruiterMandateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPage" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "type" "ContentPageType" NOT NULL,
    "canonicalPath" VARCHAR(500) NOT NULL,
    "dataProvenance" "DataProvenance" NOT NULL DEFAULT 'LIVE',
    "currentPublishedRevisionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" UUID NOT NULL,
    "contentPageId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "ContentRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(220) NOT NULL,
    "excerpt" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "heroMetadata" JSONB,
    "authoredByUserId" UUID NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "reviewedAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentEvent" (
    "id" UUID NOT NULL,
    "contentPageId" UUID NOT NULL,
    "contentRevisionId" UUID NOT NULL,
    "kind" "ContentEventKind" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" UUID NOT NULL,
    "requesterUserId" UUID NOT NULL,
    "companyId" UUID,
    "category" "SupportCategory" NOT NULL,
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(3000) NOT NULL,
    "assigneeUserId" UUID,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCaseEvent" (
    "id" UUID NOT NULL,
    "supportCaseId" UUID NOT NULL,
    "kind" "SupportCaseEventKind" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "safeBody" VARCHAR(3000),
    "reasonCode" VARCHAR(64),
    "correlationId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- CreateIndex
CREATE INDEX "User_status_role_idx" ON "User"("status", "role");

-- CreateIndex
CREATE INDEX "User_dataProvenance_status_idx" ON "User"("dataProvenance", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_userId_key" ON "Credential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_usedAt_idx" ON "PasswordResetToken"("expiresAt", "usedAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_namespace_keyHash_windowStart_key" ON "RateLimitBucket"("namespace", "keyHash", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Canton_code_key" ON "Canton"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Canton_slug_key" ON "Canton"("slug");

-- CreateIndex
CREATE INDEX "Canton_slug_idx" ON "Canton"("slug");

-- CreateIndex
CREATE INDEX "City_cantonId_idx" ON "City"("cantonId");

-- CreateIndex
CREATE UNIQUE INDEX "City_cantonId_slug_key" ON "City"("cantonId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_isActive_sortOrder_idx" ON "Category"("parentId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile"("userId");

-- CreateIndex
CREATE INDEX "CandidateProfile_onboardingStatus_cantonId_idx" ON "CandidateProfile"("onboardingStatus", "cantonId");

-- CreateIndex
CREATE INDEX "CandidateOnboardingEvent_candidateProfileId_createdAt_idx" ON "CandidateOnboardingEvent"("candidateProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateSkill_candidateProfileId_idx" ON "CandidateSkill"("candidateProfileId");

-- CreateIndex
CREATE INDEX "CandidateSkill_skillId_idx" ON "CandidateSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSkill_candidateProfileId_skillId_key" ON "CandidateSkill"("candidateProfileId", "skillId");

-- CreateIndex
CREATE INDEX "CandidateLanguage_candidateProfileId_idx" ON "CandidateLanguage"("candidateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateLanguage_candidateProfileId_code_key" ON "CandidateLanguage"("candidateProfileId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CandidatePreference_candidateProfileId_key" ON "CandidatePreference"("candidateProfileId");

-- CreateIndex
CREATE INDEX "CandidatePreferenceCategory_categoryId_idx" ON "CandidatePreferenceCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateDocumentMetadata_storageKey_key" ON "CandidateDocumentMetadata"("storageKey");

-- CreateIndex
CREATE INDEX "CandidateDocumentMetadata_candidateProfileId_status_purpose_idx" ON "CandidateDocumentMetadata"("candidateProfileId", "status", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerProfile_userId_key" ON "EmployerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_uid_key" ON "Company"("uid");

-- CreateIndex
CREATE INDEX "Company_status_dataProvenance_idx" ON "Company"("status", "dataProvenance");

-- CreateIndex
CREATE INDEX "CompanyStatusEvent_companyId_createdAt_idx" ON "CompanyStatusEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyMembership_companyId_status_role_idx" ON "CompanyMembership"("companyId", "status", "role");

-- CreateIndex
CREATE INDEX "CompanyMembership_userId_status_idx" ON "CompanyMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

-- CreateIndex
CREATE INDEX "CompanyMembershipEvent_membershipId_createdAt_idx" ON "CompanyMembershipEvent"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyLocation_companyId_idx" ON "CompanyLocation"("companyId");

-- CreateIndex
CREATE INDEX "CompanyLocation_cantonId_cityId_idx" ON "CompanyLocation"("cantonId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvitation_tokenHash_key" ON "CompanyInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanyInvitation_companyId_status_expiresAt_idx" ON "CompanyInvitation"("companyId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CompanyInvitation_inviteeEmailNormalized_status_idx" ON "CompanyInvitation"("inviteeEmailNormalized", "status");

-- CreateIndex
CREATE INDEX "CompanyInvitationEvent_invitationId_createdAt_idx" ON "CompanyInvitationEvent"("invitationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaimRequest_idempotencyKey_key" ON "CompanyClaimRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CompanyClaimRequest_candidateCompanyId_status_idx" ON "CompanyClaimRequest"("candidateCompanyId", "status");

-- CreateIndex
CREATE INDEX "CompanyClaimRequest_requesterEmployerUserId_status_idx" ON "CompanyClaimRequest"("requesterEmployerUserId", "status");

-- CreateIndex
CREATE INDEX "CompanyClaimEvent_claimRequestId_createdAt_idx" ON "CompanyClaimEvent"("claimRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationRequest_supersedesRequestId_key" ON "CompanyVerificationRequest"("supersedesRequestId");

-- CreateIndex
CREATE INDEX "CompanyVerificationRequest_companyId_status_createdAt_idx" ON "CompanyVerificationRequest"("companyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVerificationEvent_idempotencyKey_key" ON "CompanyVerificationEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CompanyVerificationEvent_verificationRequestId_createdAt_idx" ON "CompanyVerificationEvent"("verificationRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_slug_key" ON "Job"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Job_currentRevisionId_key" ON "Job"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_publishedRevisionId_key" ON "Job"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "Job_status_publishedAt_idx" ON "Job"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Job_companyId_status_idx" ON "Job"("companyId", "status");

-- CreateIndex
CREATE INDEX "Job_publishedCategoryId_publishedCantonId_status_idx" ON "Job"("publishedCategoryId", "publishedCantonId", "status");

-- CreateIndex
CREATE INDEX "Job_publishedSalaryPeriod_publishedSalaryMin_publishedSalar_idx" ON "Job"("publishedSalaryPeriod", "publishedSalaryMin", "publishedSalaryMax", "status");

-- CreateIndex
CREATE INDEX "Job_expiresAt_status_idx" ON "Job"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "Job_dataProvenance_status_publishedAt_idx" ON "Job"("dataProvenance", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "JobRevision_categoryId_cantonId_cityId_idx" ON "JobRevision"("categoryId", "cantonId", "cityId");

-- CreateIndex
CREATE INDEX "JobRevision_jobId_createdAt_idx" ON "JobRevision"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRevision_jobId_revisionNumber_key" ON "JobRevision"("jobId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JobRevision_jobId_contentChecksum_key" ON "JobRevision"("jobId", "contentChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "JobRevisionBenefit_jobRevisionId_benefitCode_key" ON "JobRevisionBenefit"("jobRevisionId", "benefitCode");

-- CreateIndex
CREATE UNIQUE INDEX "JobRevisionBenefit_jobRevisionId_sortOrder_key" ON "JobRevisionBenefit"("jobRevisionId", "sortOrder");

-- CreateIndex
CREATE INDEX "JobRevisionSkill_jobRevisionId_idx" ON "JobRevisionSkill"("jobRevisionId");

-- CreateIndex
CREATE INDEX "JobRevisionSkill_skillId_idx" ON "JobRevisionSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRevisionSkill_jobRevisionId_skillId_key" ON "JobRevisionSkill"("jobRevisionId", "skillId");

-- CreateIndex
CREATE INDEX "JobRevisionLanguage_jobRevisionId_idx" ON "JobRevisionLanguage"("jobRevisionId");

-- CreateIndex
CREATE INDEX "JobRevisionLanguage_code_idx" ON "JobRevisionLanguage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JobRevisionLanguage_jobRevisionId_code_key" ON "JobRevisionLanguage"("jobRevisionId", "code");

-- CreateIndex
CREATE INDEX "JobScoreSnapshot_scoreVersion_calculatedAt_idx" ON "JobScoreSnapshot"("scoreVersion", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobScoreSnapshot_jobRevisionId_scoreVersion_key" ON "JobScoreSnapshot"("jobRevisionId", "scoreVersion");

-- CreateIndex
CREATE UNIQUE INDEX "JobStatusEvent_idempotencyKey_key" ON "JobStatusEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JobStatusEvent_jobId_createdAt_idx" ON "JobStatusEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobAssignment_companyId_status_idx" ON "JobAssignment"("companyId", "status");

-- CreateIndex
CREATE INDEX "JobAssignment_membershipId_status_idx" ON "JobAssignment"("membershipId", "status");

-- CreateIndex
CREATE INDEX "JobAssignment_userId_jobId_idx" ON "JobAssignment"("userId", "jobId");

-- CreateIndex
CREATE INDEX "JobAssignment_jobId_status_idx" ON "JobAssignment"("jobId", "status");

-- CreateIndex
CREATE INDEX "JobAssignmentEvent_jobAssignmentId_createdAt_idx" ON "JobAssignmentEvent"("jobAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "JobReportingCheck_jobRevisionId_checkedAt_idx" ON "JobReportingCheck"("jobRevisionId", "checkedAt");

-- CreateIndex
CREATE INDEX "JobReportingCheck_occupationCodeId_idx" ON "JobReportingCheck"("occupationCodeId");

-- CreateIndex
CREATE INDEX "JobViewAggregate_jobId_windowEnd_idx" ON "JobViewAggregate"("jobId", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "JobViewAggregate_jobId_windowStart_windowEnd_definitionVers_key" ON "JobViewAggregate"("jobId", "windowStart", "windowEnd", "definitionVersion");

-- CreateIndex
CREATE INDEX "Application_jobId_status_updatedAt_idx" ON "Application"("jobId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Application_candidateProfileId_updatedAt_idx" ON "Application"("candidateProfileId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_candidateProfileId_key" ON "Application"("jobId", "candidateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSubmissionSnapshot_applicationId_key" ON "ApplicationSubmissionSnapshot"("applicationId");

-- CreateIndex
CREATE INDEX "ApplicationSubmissionDocument_documentMetadataId_idx" ON "ApplicationSubmissionDocument"("documentMetadataId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSubmissionDocument_applicationId_documentMetadat_key" ON "ApplicationSubmissionDocument"("applicationId", "documentMetadataId");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationCandidateNote_applicationId_key" ON "ApplicationCandidateNote"("applicationId");

-- CreateIndex
CREATE INDEX "ApplicationEmployerNote_applicationId_createdAt_idx" ON "ApplicationEmployerNote"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationEmployerNote_companyId_createdAt_idx" ON "ApplicationEmployerNote"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedJob_jobId_idx" ON "SavedJob"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedJob_candidateProfileId_jobId_key" ON "SavedJob"("candidateProfileId", "jobId");

-- CreateIndex
CREATE INDEX "JobAlert_status_nextDueAt_idx" ON "JobAlert"("status", "nextDueAt");

-- CreateIndex
CREATE INDEX "JobAlert_candidateProfileId_status_idx" ON "JobAlert"("candidateProfileId", "status");

-- CreateIndex
CREATE INDEX "JobAlertEvent_jobAlertId_createdAt_idx" ON "JobAlertEvent"("jobAlertId", "createdAt");

-- CreateIndex
CREATE INDEX "JobAlertDigest_scheduledFor_runAt_idx" ON "JobAlertDigest"("scheduledFor", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobAlertDigest_jobAlertId_scheduledFor_key" ON "JobAlertDigest"("jobAlertId", "scheduledFor");

-- CreateIndex
CREATE INDEX "JobAlertDigestItem_jobId_idx" ON "JobAlertDigestItem"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobAlertDigestItem_jobAlertId_jobId_key" ON "JobAlertDigestItem"("jobAlertId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobAlertDigestItem_digestId_sortOrder_key" ON "JobAlertDigestItem"("digestId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "JobAlertUnsubscribeToken_tokenHash_key" ON "JobAlertUnsubscribeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "JobAlertUnsubscribeToken_jobAlertId_expiresAt_idx" ON "JobAlertUnsubscribeToken"("jobAlertId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_applicationId_key" ON "Conversation"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_contactRequestId_key" ON "Conversation"("contactRequestId");

-- CreateIndex
CREATE INDEX "Conversation_companyId_updatedAt_idx" ON "Conversation"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_conversationId_idx" ON "ConversationParticipant"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_companyId_conversationId_idx" ON "ConversationParticipant"("companyId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_kind_userId_companyI_key" ON "ConversationParticipant"("conversationId", "kind", "userId", "companyId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_recipient_createdAt_idx" ON "EmailLog"("recipient", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateConsent_candidateProfileId_kind_effectiveAt_create_idx" ON "CandidateConsent"("candidateProfileId", "kind", "effectiveAt", "createdAt");

-- CreateIndex
CREATE INDEX "UserConsentEvent_userId_kind_effectiveAt_createdAt_idx" ON "UserConsentEvent"("userId", "kind", "effectiveAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RadarProfile_candidateProfileId_key" ON "RadarProfile"("candidateProfileId");

-- CreateIndex
CREATE INDEX "RadarProfile_publishedAt_withdrawnAt_cantonBucket_categoryB_idx" ON "RadarProfile"("publishedAt", "withdrawnAt", "cantonBucket", "categoryBucket");

-- CreateIndex
CREATE UNIQUE INDEX "RadarOpaqueMapping_lookupHmac_key" ON "RadarOpaqueMapping"("lookupHmac");

-- CreateIndex
CREATE INDEX "RadarOpaqueMapping_companyId_lookupHmac_epoch_idx" ON "RadarOpaqueMapping"("companyId", "lookupHmac", "epoch");

-- CreateIndex
CREATE INDEX "RadarOpaqueMapping_validTo_revokedAt_idx" ON "RadarOpaqueMapping"("validTo", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RadarOpaqueMapping_candidateProfileId_companyId_epoch_key" ON "RadarOpaqueMapping"("candidateProfileId", "companyId", "epoch");

-- CreateIndex
CREATE INDEX "RadarSearchBudget_companyId_calendarDate_filterHash_idx" ON "RadarSearchBudget"("companyId", "calendarDate", "filterHash");

-- CreateIndex
CREATE UNIQUE INDEX "RadarSearchBudget_companyId_calendarDate_filterHash_key" ON "RadarSearchBudget"("companyId", "calendarDate", "filterHash");

-- CreateIndex
CREATE INDEX "RadarSearchSession_membershipId_createdAt_idx" ON "RadarSearchSession"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "RadarSearchSession_expiresAt_idx" ON "RadarSearchSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RadarSearchSession_companyId_filterHash_calendarDate_policy_key" ON "RadarSearchSession"("companyId", "filterHash", "calendarDate", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "RadarSearchSessionCandidate_radarSearchSessionId_candidateP_key" ON "RadarSearchSessionCandidate"("radarSearchSessionId", "candidateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "RadarSearchSessionCandidate_radarSearchSessionId_position_key" ON "RadarSearchSessionCandidate"("radarSearchSessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerContactRequest_creditLedgerEntryId_key" ON "EmployerContactRequest"("creditLedgerEntryId");

-- CreateIndex
CREATE INDEX "EmployerContactRequest_companyId_status_createdAt_idx" ON "EmployerContactRequest"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EmployerContactRequest_candidateProfileId_status_createdAt_idx" ON "EmployerContactRequest"("candidateProfileId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerContactRequest_companyId_idempotencyKey_key" ON "EmployerContactRequest"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ContactRequestEvent_contactRequestId_createdAt_idx" ON "ContactRequestEvent"("contactRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityRevealGrant_contactRequestId_key" ON "IdentityRevealGrant"("contactRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityRevealGrant_conversationId_key" ON "IdentityRevealGrant"("conversationId");

-- CreateIndex
CREATE INDEX "IdentityRevealGrant_companyId_candidateProfileId_idx" ON "IdentityRevealGrant"("companyId", "candidateProfileId");

-- CreateIndex
CREATE INDEX "IdentityRevealGrant_candidateProfileId_revokedAt_idx" ON "IdentityRevealGrant"("candidateProfileId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityRevealGrantField_grantId_field_key" ON "IdentityRevealGrantField"("grantId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityRevealConfirmation_idempotencyKey_key" ON "IdentityRevealConfirmation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IdentityRevealConfirmation_grantId_createdAt_idx" ON "IdentityRevealConfirmation"("grantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRequest_idempotencyKey_key" ON "PrivacyRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrivacyRequest_requesterUserId_createdAt_idx" ON "PrivacyRequest"("requesterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_status_dueAt_idx" ON "PrivacyRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_assignedAdminUserId_status_dueAt_idx" ON "PrivacyRequest"("assignedAdminUserId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRequestEvent_idempotencyKey_key" ON "PrivacyRequestEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrivacyRequestEvent_privacyRequestId_createdAt_idx" ON "PrivacyRequestEvent"("privacyRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyIdentityChallenge_idempotencyKey_key" ON "PrivacyIdentityChallenge"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrivacyIdentityChallenge_privacyRequestId_expiresAt_idx" ON "PrivacyIdentityChallenge"("privacyRequestId", "expiresAt");

-- CreateIndex
CREATE INDEX "AbuseReport_status_severity_dueAt_idx" ON "AbuseReport"("status", "severity", "dueAt");

-- CreateIndex
CREATE INDEX "AbuseReport_assigneeUserId_status_dueAt_idx" ON "AbuseReport"("assigneeUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "AbuseReport_targetType_targetId_createdAt_idx" ON "AbuseReport"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseReportEvent_abuseReportId_createdAt_idx" ON "AbuseReportEvent"("abuseReportId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationRestriction_targetType_targetId_status_idx" ON "ModerationRestriction"("targetType", "targetId", "status");

-- CreateIndex
CREATE INDEX "ModerationRestriction_status_endsAt_idx" ON "ModerationRestriction"("status", "endsAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_retainUntil_idx" ON "AuditLog"("retainUntil");

-- CreateIndex
CREATE INDEX "SalaryDatasetVersion_datasetKey_reviewStatus_validFrom_vali_idx" ON "SalaryDatasetVersion"("datasetKey", "reviewStatus", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryDatasetVersion_datasetKey_version_key" ON "SalaryDatasetVersion"("datasetKey", "version");

-- CreateIndex
CREATE INDEX "SalaryBand_salaryDatasetVersionId_categoryId_cantonId_senio_idx" ON "SalaryBand"("salaryDatasetVersionId", "categoryId", "cantonId", "seniority", "period");

-- CreateIndex
CREATE INDEX "OccupationCodeVersion_datasetKey_validFrom_validTo_idx" ON "OccupationCodeVersion"("datasetKey", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "OccupationCodeVersion_datasetKey_version_key" ON "OccupationCodeVersion"("datasetKey", "version");

-- CreateIndex
CREATE INDEX "OccupationCode_code_result_idx" ON "OccupationCode"("code", "result");

-- CreateIndex
CREATE UNIQUE INDEX "OccupationCode_occupationCodeVersionId_code_key" ON "OccupationCode"("occupationCodeVersionId", "code");

-- CreateIndex
CREATE INDEX "ImportSource_isActive_provenance_idx" ON "ImportSource"("isActive", "provenance");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSource_name_sourceReference_key" ON "ImportSource"("name", "sourceReference");

-- CreateIndex
CREATE INDEX "ImportSourceCompanyRight_companyId_validFrom_validTo_idx" ON "ImportSourceCompanyRight"("companyId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSourceCompanyRight_importSourceId_companyId_validFrom_key" ON "ImportSourceCompanyRight"("importSourceId", "companyId", "validFrom");

-- CreateIndex
CREATE INDEX "ImportRun_importSourceId_status_createdAt_idx" ON "ImportRun"("importSourceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRun_importSourceId_checksum_key" ON "ImportRun"("importSourceId", "checksum");

-- CreateIndex
CREATE INDEX "ImportItem_runId_status_idx" ON "ImportItem"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportItem_runId_sourceItemKey_key" ON "ImportItem"("runId", "sourceItemKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportItem_runId_dedupeKey_key" ON "ImportItem"("runId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportDecision_importItemId_key" ON "ImportDecision"("importItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportDecision_committedJobId_key" ON "ImportDecision"("committedJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportDecision_idempotencyKey_key" ON "ImportDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ImportDecision_selectedCompanyId_kind_idx" ON "ImportDecision"("selectedCompanyId", "kind");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_kind_occurredAt_idx" ON "AnalyticsEvent"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_companyId_occurredAt_idx" ON "AnalyticsEvent"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_jobId_occurredAt_idx" ON "AnalyticsEvent"("jobId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_retainUntil_idx" ON "AnalyticsEvent"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_producer_dedupeKey_key" ON "AnalyticsEvent"("producer", "dedupeKey");

-- CreateIndex
CREATE INDEX "MetricDaily_calendarDate_metricKey_idx" ON "MetricDaily"("calendarDate", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "MetricDaily_metricKey_definitionVersion_calendarDate_compan_key" ON "MetricDaily"("metricKey", "definitionVersion", "calendarDate", "companyId", "cantonId", "categoryId");

-- CreateIndex
CREATE INDEX "ClusterLaunchAssessment_cantonId_categoryId_policyVersion_s_idx" ON "ClusterLaunchAssessment"("cantonId", "categoryId", "policyVersion", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterLaunchAssessment_cantonId_categoryId_policyVersion_e_key" ON "ClusterLaunchAssessment"("cantonId", "categoryId", "policyVersion", "evaluatedAt");

-- CreateIndex
CREATE INDEX "ClusterLaunchEvent_clusterLaunchAssessmentId_createdAt_idx" ON "ClusterLaunchEvent"("clusterLaunchAssessmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "PlanVersion_planId_status_validFrom_validTo_idx" ON "PlanVersion"("planId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "PlanVersion"("planId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlement_planVersionId_key_key" ON "PlanEntitlement"("planVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerSubscription_sourceOrderId_key" ON "EmployerSubscription"("sourceOrderId");

-- CreateIndex
CREATE INDEX "EmployerSubscription_companyId_status_currentPeriodEnd_idx" ON "EmployerSubscription"("companyId", "status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "EmployerSubscription_planVersionId_currentPeriodStart_idx" ON "EmployerSubscription"("planVersionId", "currentPeriodStart");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEvent_idempotencyKey_key" ON "SubscriptionEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionChangeSchedule_successorSubscriptionId_key" ON "SubscriptionChangeSchedule"("successorSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionChangeSchedule_idempotencyKey_key" ON "SubscriptionChangeSchedule"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SubscriptionChangeSchedule_companyId_status_effectiveAt_idx" ON "SubscriptionChangeSchedule"("companyId", "status", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE INDEX "ProductVersion_productId_status_validFrom_validTo_idx" ON "ProductVersion"("productId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_productId_version_key" ON "ProductVersion"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBillingProfile_companyId_key" ON "CompanyBillingProfile"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientIdempotencyKey_key" ON "Order"("clientIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerIdempotencyKey_key" ON "Order"("providerIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerReference_key" ON "Order"("providerReference");

-- CreateIndex
CREATE INDEX "Order_companyId_status_createdAt_idx" ON "Order"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_planVersionId_idx" ON "OrderLine"("planVersionId");

-- CreateIndex
CREATE INDEX "OrderLine_productVersionId_idx" ON "OrderLine"("productVersionId");

-- CreateIndex
CREATE INDEX "OrderLine_targetJobId_idx" ON "OrderLine"("targetJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_issuedAt_idx" ON "Invoice"("companyId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_status_dueAt_idx" ON "Invoice"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_orderLineId_key" ON "InvoiceLine"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_sortOrder_key" ON "InvoiceLine"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "TaxRateVersion_jurisdiction_taxType_reviewStatus_validFrom__idx" ON "TaxRateVersion"("jurisdiction", "taxType", "reviewStatus", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementGrant_idempotencyKey_key" ON "EntitlementGrant"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EntitlementGrant_companyId_key_validFrom_validTo_idx" ON "EntitlementGrant"("companyId", "key", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementGrant_companyId_key_validFrom_key" ON "EntitlementGrant"("companyId", "key", "validFrom");

-- CreateIndex
CREATE INDEX "CreditAccount_companyId_creditType_periodEnd_idx" ON "CreditAccount"("companyId", "creditType", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_companyId_creditType_fundingSource_periodStar_key" ON "CreditAccount"("companyId", "creditType", "fundingSource", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_reversalOfEntryId_key" ON "CreditLedgerEntry"("reversalOfEntryId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_accountId_createdAt_idx" ON "CreditLedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_validTo_kind_idx" ON "CreditLedgerEntry"("validTo", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_accountId_idempotencyKey_key" ON "CreditLedgerEntry"("accountId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_providerReference_key" ON "PaymentEvent"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_idempotencyKey_key" ON "PaymentEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobBoost_orderLineId_key" ON "JobBoost"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "JobBoost_consumedCreditLedgerEntryId_key" ON "JobBoost"("consumedCreditLedgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "JobBoost_idempotencyKey_key" ON "JobBoost"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JobBoost_jobId_startsAt_endsAt_status_idx" ON "JobBoost"("jobId", "startsAt", "endsAt", "status");

-- CreateIndex
CREATE INDEX "JobBoost_companyId_status_endsAt_idx" ON "JobBoost"("companyId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalJobPermit_orderLineId_key" ON "AdditionalJobPermit"("orderLineId");

-- CreateIndex
CREATE INDEX "AdditionalJobPermit_companyId_status_validFrom_validTo_idx" ON "AdditionalJobPermit"("companyId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "AdditionalJobPermit_targetJobId_status_validFrom_validTo_idx" ON "AdditionalJobPermit"("targetJobId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSetupApproval_orderLineId_key" ON "ImportSetupApproval"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSetupApproval_idempotencyKey_key" ON "ImportSetupApproval"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ImportSetupApproval_companyId_status_validUntil_idx" ON "ImportSetupApproval"("companyId", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ImportAccessGrant_importSetupApprovalId_key" ON "ImportAccessGrant"("importSetupApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportAccessGrant_orderLineId_key" ON "ImportAccessGrant"("orderLineId");

-- CreateIndex
CREATE INDEX "ImportAccessGrant_companyId_importSourceId_status_validFrom_idx" ON "ImportAccessGrant"("companyId", "importSourceId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "SalesLead_status_nextAt_idx" ON "SalesLead"("status", "nextAt");

-- CreateIndex
CREATE INDEX "SalesLead_ownerUserId_status_nextAt_idx" ON "SalesLead"("ownerUserId", "status", "nextAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesLead_emailNormalized_purpose_key" ON "SalesLead"("emailNormalized", "purpose");

-- CreateIndex
CREATE INDEX "SalesActivity_salesLeadId_createdAt_idx" ON "SalesActivity"("salesLeadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTask_idempotencyKey_key" ON "SystemTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SystemTask_status_dueAt_idx" ON "SystemTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SystemTask_ownerUserId_status_dueAt_idx" ON "SystemTask"("ownerUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "SystemTask_companyId_status_dueAt_idx" ON "SystemTask"("companyId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_publicCodeHash_key" ON "ReferralLink"("publicCodeHash");

-- CreateIndex
CREATE INDEX "ReferralLink_expiresAt_revokedAt_idx" ON "ReferralLink"("expiresAt", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralAttribution_dedupeKey_key" ON "ReferralAttribution"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReferralAttribution_referralLinkId_occurredAt_idx" ON "ReferralAttribution"("referralLinkId", "occurredAt");

-- CreateIndex
CREATE INDEX "ReferralAttribution_retainUntil_idx" ON "ReferralAttribution"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RecruiterMandate_idempotencyKey_key" ON "RecruiterMandate"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RecruiterMandate_recruiterUserId_clientCompanyId_status_val_idx" ON "RecruiterMandate"("recruiterUserId", "clientCompanyId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "RecruiterMandateJob_jobId_idx" ON "RecruiterMandateJob"("jobId");

-- CreateIndex
CREATE INDEX "RecruiterMandateEvent_recruiterMandateId_createdAt_idx" ON "RecruiterMandateEvent"("recruiterMandateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_slug_key" ON "ContentPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_currentPublishedRevisionId_key" ON "ContentPage"("currentPublishedRevisionId");

-- CreateIndex
CREATE INDEX "ContentPage_type_locale_dataProvenance_idx" ON "ContentPage"("type", "locale", "dataProvenance");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_canonicalPath_locale_key" ON "ContentPage"("canonicalPath", "locale");

-- CreateIndex
CREATE INDEX "ContentRevision_status_publishedAt_idx" ON "ContentRevision"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRevision_contentPageId_revisionNumber_key" ON "ContentRevision"("contentPageId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRevision_contentPageId_contentHash_key" ON "ContentRevision"("contentPageId", "contentHash");

-- CreateIndex
CREATE INDEX "ContentEvent_contentPageId_createdAt_idx" ON "ContentEvent"("contentPageId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentEvent_contentRevisionId_createdAt_idx" ON "ContentEvent"("contentRevisionId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_status_priority_dueAt_idx" ON "SupportCase"("status", "priority", "dueAt");

-- CreateIndex
CREATE INDEX "SupportCase_assigneeUserId_status_dueAt_idx" ON "SupportCase"("assigneeUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "SupportCase_requesterUserId_createdAt_idx" ON "SupportCase"("requesterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCaseEvent_supportCaseId_createdAt_idx" ON "SupportCaseEvent"("supportCaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateOnboardingEvent" ADD CONSTRAINT "CandidateOnboardingEvent_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateLanguage" ADD CONSTRAINT "CandidateLanguage_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePreference" ADD CONSTRAINT "CandidatePreference_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePreferenceCategory" ADD CONSTRAINT "CandidatePreferenceCategory_candidatePreferenceId_fkey" FOREIGN KEY ("candidatePreferenceId") REFERENCES "CandidatePreference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePreferenceCategory" ADD CONSTRAINT "CandidatePreferenceCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDocumentMetadata" ADD CONSTRAINT "CandidateDocumentMetadata_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerProfile" ADD CONSTRAINT "EmployerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatusEvent" ADD CONSTRAINT "CompanyStatusEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembershipEvent" ADD CONSTRAINT "CompanyMembershipEvent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitationEvent" ADD CONSTRAINT "CompanyInvitationEvent_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "CompanyInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimRequest" ADD CONSTRAINT "CompanyClaimRequest_requesterEmployerUserId_fkey" FOREIGN KEY ("requesterEmployerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimRequest" ADD CONSTRAINT "CompanyClaimRequest_candidateCompanyId_fkey" FOREIGN KEY ("candidateCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimEvent" ADD CONSTRAINT "CompanyClaimEvent_claimRequestId_fkey" FOREIGN KEY ("claimRequestId") REFERENCES "CompanyClaimRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_supersedesRequestId_fkey" FOREIGN KEY ("supersedesRequestId") REFERENCES "CompanyVerificationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVerificationEvent" ADD CONSTRAINT "CompanyVerificationEvent_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "CompanyVerificationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_importSourceId_fkey" FOREIGN KEY ("importSourceId") REFERENCES "ImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_publishedCategoryId_fkey" FOREIGN KEY ("publishedCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_publishedCantonId_fkey" FOREIGN KEY ("publishedCantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_publishedCityId_fkey" FOREIGN KEY ("publishedCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevision" ADD CONSTRAINT "JobRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevision" ADD CONSTRAINT "JobRevision_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevision" ADD CONSTRAINT "JobRevision_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevision" ADD CONSTRAINT "JobRevision_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevisionBenefit" ADD CONSTRAINT "JobRevisionBenefit_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevisionSkill" ADD CONSTRAINT "JobRevisionSkill_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevisionSkill" ADD CONSTRAINT "JobRevisionSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRevisionLanguage" ADD CONSTRAINT "JobRevisionLanguage_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScoreSnapshot" ADD CONSTRAINT "JobScoreSnapshot_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStatusEvent" ADD CONSTRAINT "JobStatusEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStatusEvent" ADD CONSTRAINT "JobStatusEvent_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignmentEvent" ADD CONSTRAINT "JobAssignmentEvent_jobAssignmentId_fkey" FOREIGN KEY ("jobAssignmentId") REFERENCES "JobAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReportingCheck" ADD CONSTRAINT "JobReportingCheck_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReportingCheck" ADD CONSTRAINT "JobReportingCheck_occupationCodeVersionId_fkey" FOREIGN KEY ("occupationCodeVersionId") REFERENCES "OccupationCodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobViewAggregate" ADD CONSTRAINT "JobViewAggregate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_submittedJobRevisionId_fkey" FOREIGN KEY ("submittedJobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubmissionSnapshot" ADD CONSTRAINT "ApplicationSubmissionSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubmissionSnapshot" ADD CONSTRAINT "ApplicationSubmissionSnapshot_jobRevisionId_fkey" FOREIGN KEY ("jobRevisionId") REFERENCES "JobRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubmissionDocument" ADD CONSTRAINT "ApplicationSubmissionDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubmissionDocument" ADD CONSTRAINT "ApplicationSubmissionDocument_documentMetadataId_fkey" FOREIGN KEY ("documentMetadataId") REFERENCES "CandidateDocumentMetadata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCandidateNote" ADD CONSTRAINT "ApplicationCandidateNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEmployerNote" ADD CONSTRAINT "ApplicationEmployerNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEmployerNote" ADD CONSTRAINT "ApplicationEmployerNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlert" ADD CONSTRAINT "JobAlert_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertEvent" ADD CONSTRAINT "JobAlertEvent_jobAlertId_fkey" FOREIGN KEY ("jobAlertId") REFERENCES "JobAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertDigest" ADD CONSTRAINT "JobAlertDigest_jobAlertId_fkey" FOREIGN KEY ("jobAlertId") REFERENCES "JobAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertDigestItem" ADD CONSTRAINT "JobAlertDigestItem_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "JobAlertDigest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertDigestItem" ADD CONSTRAINT "JobAlertDigestItem_jobAlertId_fkey" FOREIGN KEY ("jobAlertId") REFERENCES "JobAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertDigestItem" ADD CONSTRAINT "JobAlertDigestItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertUnsubscribeToken" ADD CONSTRAINT "JobAlertUnsubscribeToken_jobAlertId_fkey" FOREIGN KEY ("jobAlertId") REFERENCES "JobAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlertUnsubscribeToken" ADD CONSTRAINT "JobAlertUnsubscribeToken_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "JobAlertDigest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactRequestId_fkey" FOREIGN KEY ("contactRequestId") REFERENCES "EmployerContactRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateConsent" ADD CONSTRAINT "CandidateConsent_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsentEvent" ADD CONSTRAINT "UserConsentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarProfile" ADD CONSTRAINT "RadarProfile_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarOpaqueMapping" ADD CONSTRAINT "RadarOpaqueMapping_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarOpaqueMapping" ADD CONSTRAINT "RadarOpaqueMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarSearchBudget" ADD CONSTRAINT "RadarSearchBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarSearchSession" ADD CONSTRAINT "RadarSearchSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarSearchSession" ADD CONSTRAINT "RadarSearchSession_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarSearchSessionCandidate" ADD CONSTRAINT "RadarSearchSessionCandidate_radarSearchSessionId_fkey" FOREIGN KEY ("radarSearchSessionId") REFERENCES "RadarSearchSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarSearchSessionCandidate" ADD CONSTRAINT "RadarSearchSessionCandidate_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerContactRequest" ADD CONSTRAINT "EmployerContactRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerContactRequest" ADD CONSTRAINT "EmployerContactRequest_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerContactRequest" ADD CONSTRAINT "EmployerContactRequest_requestingUserId_fkey" FOREIGN KEY ("requestingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerContactRequest" ADD CONSTRAINT "EmployerContactRequest_creditLedgerEntryId_fkey" FOREIGN KEY ("creditLedgerEntryId") REFERENCES "CreditLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequestEvent" ADD CONSTRAINT "ContactRequestEvent_contactRequestId_fkey" FOREIGN KEY ("contactRequestId") REFERENCES "EmployerContactRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "IdentityRevealGrant_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "IdentityRevealGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "IdentityRevealGrant_contactRequestId_fkey" FOREIGN KEY ("contactRequestId") REFERENCES "EmployerContactRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "IdentityRevealGrant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "IdentityRevealGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealGrantField" ADD CONSTRAINT "IdentityRevealGrantField_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "IdentityRevealGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealConfirmation" ADD CONSTRAINT "IdentityRevealConfirmation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "IdentityRevealGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealConfirmation" ADD CONSTRAINT "IdentityRevealConfirmation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealConfirmation" ADD CONSTRAINT "IdentityRevealConfirmation_contactRequestId_fkey" FOREIGN KEY ("contactRequestId") REFERENCES "EmployerContactRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRevealConfirmation" ADD CONSTRAINT "IdentityRevealConfirmation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequestCorrectionField" ADD CONSTRAINT "PrivacyRequestCorrectionField_privacyRequestId_fkey" FOREIGN KEY ("privacyRequestId") REFERENCES "PrivacyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequestEvent" ADD CONSTRAINT "PrivacyRequestEvent_privacyRequestId_fkey" FOREIGN KEY ("privacyRequestId") REFERENCES "PrivacyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyIdentityChallenge" ADD CONSTRAINT "PrivacyIdentityChallenge_privacyRequestId_fkey" FOREIGN KEY ("privacyRequestId") REFERENCES "PrivacyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyIdentityChallenge" ADD CONSTRAINT "PrivacyIdentityChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbuseReportEvent" ADD CONSTRAINT "AbuseReportEvent_abuseReportId_fkey" FOREIGN KEY ("abuseReportId") REFERENCES "AbuseReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationRestriction" ADD CONSTRAINT "ModerationRestriction_abuseReportId_fkey" FOREIGN KEY ("abuseReportId") REFERENCES "AbuseReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryBand" ADD CONSTRAINT "SalaryBand_salaryDatasetVersionId_fkey" FOREIGN KEY ("salaryDatasetVersionId") REFERENCES "SalaryDatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryBand" ADD CONSTRAINT "SalaryBand_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryBand" ADD CONSTRAINT "SalaryBand_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupationCode" ADD CONSTRAINT "OccupationCode_occupationCodeVersionId_fkey" FOREIGN KEY ("occupationCodeVersionId") REFERENCES "OccupationCodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSourceCompanyRight" ADD CONSTRAINT "ImportSourceCompanyRight_importSourceId_fkey" FOREIGN KEY ("importSourceId") REFERENCES "ImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSourceCompanyRight" ADD CONSTRAINT "ImportSourceCompanyRight_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_importSourceId_fkey" FOREIGN KEY ("importSourceId") REFERENCES "ImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportDecision" ADD CONSTRAINT "ImportDecision_importItemId_fkey" FOREIGN KEY ("importItemId") REFERENCES "ImportItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportDecision" ADD CONSTRAINT "ImportDecision_selectedCompanyId_fkey" FOREIGN KEY ("selectedCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportDecision" ADD CONSTRAINT "ImportDecision_committedJobId_fkey" FOREIGN KEY ("committedJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricDaily" ADD CONSTRAINT "MetricDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricDaily" ADD CONSTRAINT "MetricDaily_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricDaily" ADD CONSTRAINT "MetricDaily_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterLaunchAssessment" ADD CONSTRAINT "ClusterLaunchAssessment_cantonId_fkey" FOREIGN KEY ("cantonId") REFERENCES "Canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterLaunchAssessment" ADD CONSTRAINT "ClusterLaunchAssessment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterLaunchEvent" ADD CONSTRAINT "ClusterLaunchEvent_clusterLaunchAssessmentId_fkey" FOREIGN KEY ("clusterLaunchAssessmentId") REFERENCES "ClusterLaunchAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "EmployerSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "EmployerSubscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "EmployerSubscription_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "EmployerSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "SubscriptionChangeSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "SubscriptionChangeSchedule_currentSubscriptionId_fkey" FOREIGN KEY ("currentSubscriptionId") REFERENCES "EmployerSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "SubscriptionChangeSchedule_successorSubscriptionId_fkey" FOREIGN KEY ("successorSubscriptionId") REFERENCES "EmployerSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBillingProfile" ADD CONSTRAINT "CompanyBillingProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_taxRateVersionId_fkey" FOREIGN KEY ("taxRateVersionId") REFERENCES "TaxRateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_targetJobId_fkey" FOREIGN KEY ("targetJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_targetImportSourceId_fkey" FOREIGN KEY ("targetImportSourceId") REFERENCES "ImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRateVersion" ADD CONSTRAINT "TaxRateVersion_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_sourcePlanVersionId_fkey" FOREIGN KEY ("sourcePlanVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_sourceOrderLineId_fkey" FOREIGN KEY ("sourceOrderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_reversalOfEntryId_fkey" FOREIGN KEY ("reversalOfEntryId") REFERENCES "CreditLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBoost" ADD CONSTRAINT "JobBoost_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBoost" ADD CONSTRAINT "JobBoost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBoost" ADD CONSTRAINT "JobBoost_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBoost" ADD CONSTRAINT "JobBoost_consumedCreditLedgerEntryId_fkey" FOREIGN KEY ("consumedCreditLedgerEntryId") REFERENCES "CreditLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalJobPermit" ADD CONSTRAINT "AdditionalJobPermit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalJobPermit" ADD CONSTRAINT "AdditionalJobPermit_targetJobId_fkey" FOREIGN KEY ("targetJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalJobPermit" ADD CONSTRAINT "AdditionalJobPermit_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSetupApproval" ADD CONSTRAINT "ImportSetupApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSetupApproval" ADD CONSTRAINT "ImportSetupApproval_importSourceId_fkey" FOREIGN KEY ("importSourceId") REFERENCES "ImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSetupApproval" ADD CONSTRAINT "ImportSetupApproval_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportAccessGrant" ADD CONSTRAINT "ImportAccessGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportAccessGrant" ADD CONSTRAINT "ImportAccessGrant_importSourceId_fkey" FOREIGN KEY ("importSourceId") REFERENCES "ImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportAccessGrant" ADD CONSTRAINT "ImportAccessGrant_importSetupApprovalId_fkey" FOREIGN KEY ("importSetupApprovalId") REFERENCES "ImportSetupApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportAccessGrant" ADD CONSTRAINT "ImportAccessGrant_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_salesLeadId_fkey" FOREIGN KEY ("salesLeadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTask" ADD CONSTRAINT "SystemTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTask" ADD CONSTRAINT "SystemTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_referralLinkId_fkey" FOREIGN KEY ("referralLinkId") REFERENCES "ReferralLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterMandate" ADD CONSTRAINT "RecruiterMandate_recruiterUserId_fkey" FOREIGN KEY ("recruiterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterMandate" ADD CONSTRAINT "RecruiterMandate_grantedByOwnerUserId_fkey" FOREIGN KEY ("grantedByOwnerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterMandate" ADD CONSTRAINT "RecruiterMandate_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterMandateJob" ADD CONSTRAINT "RecruiterMandateJob_recruiterMandateId_fkey" FOREIGN KEY ("recruiterMandateId") REFERENCES "RecruiterMandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterMandateJob" ADD CONSTRAINT "RecruiterMandateJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterMandateEvent" ADD CONSTRAINT "RecruiterMandateEvent_recruiterMandateId_fkey" FOREIGN KEY ("recruiterMandateId") REFERENCES "RecruiterMandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPage" ADD CONSTRAINT "ContentPage_currentPublishedRevisionId_fkey" FOREIGN KEY ("currentPublishedRevisionId") REFERENCES "ContentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_contentPageId_fkey" FOREIGN KEY ("contentPageId") REFERENCES "ContentPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEvent" ADD CONSTRAINT "ContentEvent_contentPageId_fkey" FOREIGN KEY ("contentPageId") REFERENCES "ContentPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEvent" ADD CONSTRAINT "ContentEvent_contentRevisionId_fkey" FOREIGN KEY ("contentRevisionId") REFERENCES "ContentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase-02 scalar, money, scope and lifecycle checks.
ALTER TABLE "User" ADD CONSTRAINT "user_email_normalized_check"
  CHECK ("emailNormalized" = lower(btrim("emailNormalized")) AND char_length("emailNormalized") BETWEEN 3 AND 320);
ALTER TABLE "Session" ADD CONSTRAINT "session_token_hash_check"
  CHECK (char_length("tokenHash") = 64);
ALTER TABLE "Session" ADD CONSTRAINT "session_expiry_range_check"
  CHECK ("createdAt" < "expiresAt" AND "expiresAt" <= "absoluteExpiresAt");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "password_reset_token_hash_check"
  CHECK (char_length("tokenHash") = 64 AND "createdAt" < "expiresAt");
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "rate_limit_bucket_window_check"
  CHECK ("count" >= 0 AND "version" > 0 AND "windowStart" < "windowEnd" AND "windowEnd" <= "expiresAt");
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "candidate_skill_rating_check"
  CHECK (("level" IS NULL OR "level" BETWEEN 1 AND 5) AND ("years" IS NULL OR "years" >= 0));
ALTER TABLE "CandidateLanguage" ADD CONSTRAINT "candidate_language_code_check"
  CHECK ("code" = lower("code") AND char_length("code") = 2);
ALTER TABLE "CandidatePreference" ADD CONSTRAINT "candidate_preference_ranges_check"
  CHECK ((("salaryPeriod" IS NULL AND "salaryMinChf" IS NULL AND "salaryMaxChf" IS NULL)
      OR ("salaryPeriod" IS NOT NULL AND "salaryMinChf" IS NOT NULL AND "salaryMaxChf" IS NOT NULL
        AND "salaryMinChf" >= 0 AND "salaryMinChf" <= "salaryMaxChf"))
    AND (("workloadMin" IS NULL AND "workloadMax" IS NULL)
      OR ("workloadMin" IS NOT NULL AND "workloadMax" IS NOT NULL
        AND "workloadMin" BETWEEN 1 AND 100 AND "workloadMin" <= "workloadMax" AND "workloadMax" <= 100))
    AND ("mobilityRadiusKm" IS NULL OR "mobilityRadiusKm" BETWEEN 0 AND 500));
ALTER TABLE "CandidateDocumentMetadata" ADD CONSTRAINT "candidate_document_metadata_size_check"
  CHECK ("sizeBytes" BETWEEN 1 AND 5242880);
ALTER TABLE "Company" ADD CONSTRAINT "company_response_metrics_check"
  CHECK ("responseSampleSize" >= 0 AND ("responseWithinTargetBps" IS NULL OR "responseWithinTargetBps" BETWEEN 0 AND 10000)
    AND ("responseTargetDays" IS NULL OR "responseTargetDays" BETWEEN 1 AND 365));
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "company_membership_removed_projection_check"
  CHECK (("status" = 'REMOVED') = ("removedAt" IS NOT NULL));
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "company_location_coordinates_check"
  CHECK (("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "company_invitation_lifecycle_check"
  CHECK ("createdAt" < "expiresAt"
    AND ("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL)
    AND ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL));
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "company_invitation_identity_check"
  CHECK ("inviteeEmailNormalized" = lower(btrim("inviteeEmailNormalized"))
    AND char_length("inviteeEmailNormalized") BETWEEN 3 AND 320
    AND char_length("tokenHash") = 64);
ALTER TABLE "CompanyClaimRequest" ADD CONSTRAINT "company_claim_role_check"
  CHECK ("requestedRole" = 'OWNER' AND ("approvedRole" IS NULL OR "approvedRole" IN ('OWNER', 'ADMIN')));
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "company_verification_supersession_check"
  CHECK ("supersedesRequestId" IS NULL OR "supersedesRequestId" <> "id");
ALTER TABLE "Job" ADD CONSTRAINT "job_source_reference_check"
  CHECK (char_length(btrim("sourceReference")) > 0);
ALTER TABLE "Job" ADD CONSTRAINT "job_origin_import_source_check"
  CHECK (("origin" = 'MANUAL' AND "importSourceId" IS NULL)
    OR ("origin" = 'IMPORT' AND "importSourceId" IS NOT NULL));
ALTER TABLE "Job" ADD CONSTRAINT "job_published_projection_presence_check"
  CHECK ("status" <> 'PUBLISHED' OR
    ("publishedRevisionId" IS NOT NULL AND "publishedAt" IS NOT NULL AND "expiresAt" IS NOT NULL
      AND "publishedCategoryId" IS NOT NULL AND "publishedCantonId" IS NOT NULL AND "publishedAt" < "expiresAt"));
ALTER TABLE "Job" ADD CONSTRAINT "job_published_salary_range_check"
  CHECK (("publishedSalaryPeriod" IS NULL AND "publishedSalaryMin" IS NULL AND "publishedSalaryMax" IS NULL)
    OR ("publishedSalaryPeriod" IS NOT NULL AND "publishedSalaryMin" IS NOT NULL AND "publishedSalaryMax" IS NOT NULL
      AND "publishedSalaryMin" >= 0 AND "publishedSalaryMin" <= "publishedSalaryMax"));
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_workload_check"
  CHECK ("workloadMin" BETWEEN 1 AND 100 AND "workloadMin" <= "workloadMax" AND "workloadMax" <= 100);
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_salary_check"
  CHECK (("salaryPeriod" IS NULL AND "salaryMin" IS NULL AND "salaryMax" IS NULL)
    OR ("salaryPeriod" IS NOT NULL AND "salaryMin" IS NOT NULL AND "salaryMax" IS NOT NULL
      AND "salaryMin" >= 0 AND "salaryMin" <= "salaryMax"));
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_dates_check"
  CHECK (("startDate" IS NULL OR NOT "startByArrangement") AND ("validThrough" IS NULL OR "createdAt" < "validThrough"));
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_response_check"
  CHECK ("responseTargetDays" BETWEEN 1 AND 365);
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_required_documents_check"
  CHECK (NOT ('NONE'::"RequiredDocumentKind" = ANY ("requiredDocumentKinds") AND cardinality("requiredDocumentKinds") > 1));
ALTER TABLE "JobRevisionBenefit" ADD CONSTRAINT "job_revision_benefit_content_check"
  CHECK (char_length("description") BETWEEN 20 AND 500 AND "sortOrder" BETWEEN 0 AND 9);
ALTER TABLE "JobRevisionLanguage" ADD CONSTRAINT "job_revision_language_code_check"
  CHECK ("code" = lower("code") AND char_length("code") = 2);
ALTER TABLE "JobScoreSnapshot" ADD CONSTRAINT "job_score_snapshot_points_check"
  CHECK ("maxPoints" > 0 AND "scorePoints" BETWEEN 0 AND "maxPoints" AND char_length("evidenceHash") = 64);
ALTER TABLE "JobAssignment" ADD CONSTRAINT "job_assignment_range_check"
  CHECK ("expiresAt" IS NULL OR "validFrom" < "expiresAt");
ALTER TABLE "JobViewAggregate" ADD CONSTRAINT "job_view_aggregate_check"
  CHECK ("windowStart" < "windowEnd" AND "viewCount" >= 0 AND "threshold" >= 0);
ALTER TABLE "Application" ADD CONSTRAINT "application_rejection_projection_check"
  CHECK (("status" = 'REJECTED' AND "rejectionReason" IS NOT NULL) OR ("status" <> 'REJECTED' AND "rejectionReason" IS NULL AND "rejectionNote" IS NULL));
ALTER TABLE "ApplicationSubmissionSnapshot" ADD CONSTRAINT "application_snapshot_documents_check"
  CHECK (NOT ('NONE'::"RequiredDocumentKind" = ANY ("requiredDocumentKinds") AND cardinality("requiredDocumentKinds") > 1));
ALTER TABLE "JobAlertDigest" ADD CONSTRAINT "job_alert_digest_window_check"
  CHECK ("windowStart" < "windowEnd" AND "itemCount" >= 0);
ALTER TABLE "JobAlertDigestItem" ADD CONSTRAINT "job_alert_digest_item_position_check"
  CHECK ("sortOrder" >= 0);
ALTER TABLE "JobAlertUnsubscribeToken" ADD CONSTRAINT "job_alert_unsubscribe_token_check"
  CHECK (char_length("tokenHash") = 64 AND "issuedAt" < "expiresAt" AND "expiresAt" <= "issuedAt" + interval '180 days');
ALTER TABLE "Conversation" ADD CONSTRAINT "conversation_origin_xor_check"
  CHECK (num_nonnulls("applicationId", "contactRequestId") = 1);
ALTER TABLE "Conversation" ADD CONSTRAINT "conversation_kind_origin_check"
  CHECK (("kind" = 'APPLICATION' AND "applicationId" IS NOT NULL AND "contactRequestId" IS NULL)
    OR ("kind" = 'TALENT_RADAR' AND "applicationId" IS NULL AND "contactRequestId" IS NOT NULL));
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "conversation_participant_principal_check"
  CHECK (("kind" = 'USER' AND "userId" IS NOT NULL AND "companyId" IS NULL)
    OR ("kind" = 'COMPANY_PRINCIPAL' AND "userId" IS NULL AND "companyId" IS NOT NULL));
ALTER TABLE "RadarProfile" ADD CONSTRAINT "radar_profile_ranges_check"
  CHECK ((("workloadMin" IS NULL AND "workloadMax" IS NULL)
      OR ("workloadMin" IS NOT NULL AND "workloadMax" IS NOT NULL
        AND "workloadMin" BETWEEN 1 AND 100 AND "workloadMin" <= "workloadMax" AND "workloadMax" <= 100))
    AND (("salaryYearlyMinChf" IS NULL AND "salaryYearlyMaxChf" IS NULL)
      OR ("salaryYearlyMinChf" IS NOT NULL AND "salaryYearlyMaxChf" IS NOT NULL
        AND "salaryYearlyMinChf" >= 0 AND "salaryYearlyMinChf" <= "salaryYearlyMaxChf"))
    AND NOT ("publishedAt" IS NOT NULL AND "withdrawnAt" IS NOT NULL));
ALTER TABLE "RadarOpaqueMapping" ADD CONSTRAINT "radar_opaque_mapping_crypto_check"
  CHECK (octet_length("encryptedToken") >= 16 AND octet_length("nonce") = 12 AND octet_length("authTag") = 16 AND "validFrom" < "validTo");
ALTER TABLE "RadarSearchSession" ADD CONSTRAINT "radar_search_session_result_check"
  CHECK ("resultCount" BETWEEN 0 AND 20 AND "createdAt" < "expiresAt");
ALTER TABLE "RadarSearchSessionCandidate" ADD CONSTRAINT "radar_search_session_position_check"
  CHECK ("position" BETWEEN 0 AND 19);
ALTER TABLE "EmployerContactRequest" ADD CONSTRAINT "contact_request_expiry_check"
  CHECK ("expiresAt" = "createdAt" + interval '14 days');
ALTER TABLE "IdentityRevealGrantField" ADD CONSTRAINT "identity_reveal_field_crypto_check"
  CHECK (octet_length("ciphertext") > 0 AND octet_length("nonce") = 12 AND octet_length("authTag") = 16);
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "identity_reveal_revocation_projection_check"
  CHECK (("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokeReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "revokeReason" IS NOT NULL));
ALTER TABLE "IdentityRevealConfirmation" ADD CONSTRAINT "identity_reveal_confirmation_fields_check"
  CHECK ("completeFieldSet" IS NOT NULL AND "newlyAddedFields" IS NOT NULL
    AND cardinality("completeFieldSet") BETWEEN 1 AND 4
    AND cardinality("newlyAddedFields") BETWEEN 1 AND 4);
ALTER TABLE "JobReportingCheck" ADD CONSTRAINT "job_reporting_code_snapshot_check"
  CHECK (("occupationCodeId" IS NULL AND "occupationCodeSnapshot" IS NULL AND "occupationLabelSnapshot" IS NULL)
    OR ("occupationCodeId" IS NOT NULL AND nullif(btrim("occupationCodeSnapshot"), '') IS NOT NULL
      AND nullif(btrim("occupationLabelSnapshot"), '') IS NOT NULL));
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "privacy_request_deletion_dependencies_check"
  CHECK (NOT ('NONE'::"PrivacyDeletionDependencyCode" = ANY ("deletionDependencies") AND cardinality("deletionDependencies") > 1));
ALTER TABLE "PrivacyRequestCorrectionField" ADD CONSTRAINT "privacy_correction_text_length_check"
  CHECK (char_length(btrim("correctionText")) BETWEEN 20 AND 1000);
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "privacy_request_type_outcome_check"
  CHECK ("version" > 0
    AND (("type" = 'EXPORT' AND "correctionOutcome" IS NULL
          AND COALESCE(cardinality("deletionDependencies"), 0) = 0 AND "deletionOutcome" IS NULL)
      OR ("type" = 'DELETE' AND "correctionOutcome" IS NULL
          AND "exportManifest" IS NULL AND "exportManifestChecksum" IS NULL AND "exportExpiresAt" IS NULL)
      OR ("type" = 'CORRECT' AND COALESCE(cardinality("deletionDependencies"), 0) = 0 AND "deletionOutcome" IS NULL
          AND "exportManifest" IS NULL AND "exportManifestChecksum" IS NULL AND "exportExpiresAt" IS NULL))
    AND (("status" = 'REJECTED' AND "rejectionCode" IS NOT NULL)
      OR ("status" <> 'REJECTED' AND "rejectionCode" IS NULL))
    AND ("status" <> 'COMPLETED'
      OR ("completedAt" IS NOT NULL
        AND (("type" = 'EXPORT' AND "exportManifest" IS NOT NULL
              AND "exportManifestChecksum" IS NOT NULL AND "exportExpiresAt" IS NOT NULL)
          OR ("type" = 'DELETE' AND "deletionOutcome" IS NOT NULL
              AND COALESCE(cardinality("deletionDependencies"), 0) >= 1)
          OR ("type" = 'CORRECT' AND "correctionOutcome" IS NOT NULL)))));
ALTER TABLE "PrivacyIdentityChallenge" ADD CONSTRAINT "privacy_identity_challenge_check"
  CHECK ("attempts" BETWEEN 0 AND 5 AND "createdAt" < "expiresAt" AND "expiresAt" <= "createdAt" + interval '15 minutes');
ALTER TABLE "ModerationRestriction" ADD CONSTRAINT "moderation_restriction_range_check"
  CHECK ("endsAt" IS NULL OR "startsAt" < "endsAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "audit_actor_check"
  CHECK (("actorKind" = 'USER' AND "actorUserId" IS NOT NULL) OR ("actorKind" <> 'USER' AND "actorUserId" IS NULL));
ALTER TABLE "AuditLog" ADD CONSTRAINT "audit_ip_hash_pair_check"
  CHECK (("ipHash" IS NULL) = ("ipHashVersion" IS NULL));
ALTER TABLE "SalaryDatasetVersion" ADD CONSTRAINT "salary_dataset_version_range_check"
  CHECK ("validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "SalaryDatasetVersion" ADD CONSTRAINT "salary_dataset_review_projection_check"
  CHECK (("reviewStatus" = 'DRAFT' AND "publishedAt" IS NULL)
    OR ("reviewStatus" IN ('APPROVED', 'RETIRED') AND "publishedAt" IS NOT NULL));
ALTER TABLE "SalaryBand" ADD CONSTRAINT "salary_band_values_check"
  CHECK ("workloadMin" BETWEEN 1 AND 100 AND "workloadMin" <= "workloadMax" AND "workloadMax" <= 100
    AND 0 <= "p25Chf" AND "p25Chf" <= "medianChf" AND "medianChf" <= "p75Chf" AND "sampleSize" >= 0);
ALTER TABLE "OccupationCodeVersion" ADD CONSTRAINT "occupation_code_version_range_check"
  CHECK ("validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "OccupationCode" ADD CONSTRAINT "occupation_code_range_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveFrom" < "effectiveTo");
ALTER TABLE "ImportSourceCompanyRight" ADD CONSTRAINT "import_source_company_right_range_check"
  CHECK ("validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "ImportDecision" ADD CONSTRAINT "import_decision_company_check"
  CHECK (("kind" = 'APPROVE' AND "selectedCompanyId" IS NOT NULL) OR ("kind" = 'REJECT' AND "selectedCompanyId" IS NULL AND "committedJobId" IS NULL));
ALTER TABLE "MetricDaily" ADD CONSTRAINT "metric_daily_sample_check" CHECK ("sampleSize" >= 0);
ALTER TABLE "ClusterLaunchAssessment" ADD CONSTRAINT "cluster_launch_assessment_values_check"
  CHECK ("evidenceWindowStart" < "evidenceWindowEnd" AND "evaluatedAt" <= "validUntil"
    AND "liveJobCount" >= 0 AND "activeCandidateCount" >= 0 AND "activeEmployerCount" >= 0
    AND "responseRateBasisPoints" BETWEEN 0 AND 10000 AND "contentCoverageBasisPoints" BETWEEN 0 AND 10000
    AND "medianApplicationsTimes2" >= 0
    AND ("status" <> 'ACTIVATED' OR ("dataProvenance" = 'LIVE'
      AND "productApprovedByUserId" IS NOT NULL AND "productApprovedAt" IS NOT NULL
      AND "opsApprovedByUserId" IS NOT NULL AND "opsApprovedAt" IS NOT NULL
      AND "activatedAt" IS NOT NULL)));

-- Typed catalog and billing checks. Billing values are integer Rappen.
ALTER TABLE "PlanVersion" ADD CONSTRAINT "plan_version_range_check"
  CHECK ("termMonths" > 0 AND ("validTo" IS NULL OR "validFrom" < "validTo"));
ALTER TABLE "PlanVersion" ADD CONSTRAINT "plan_version_price_mode_check"
  CHECK (("priceMode" = 'FIXED' AND "netPriceRappen" IS NOT NULL AND "monthlyEquivalentRappen" IS NOT NULL
      AND "netPriceRappen" >= 0 AND "monthlyEquivalentRappen" >= 0)
    OR ("priceMode" = 'CONTRACT' AND "netPriceRappen" IS NULL AND "monthlyEquivalentRappen" IS NULL AND NOT "isSelfService"));
ALTER TABLE "PlanVersion" ADD CONSTRAINT "plan_version_monthly_equivalent_check"
  CHECK ("priceMode" = 'CONTRACT'
    OR ("billingInterval" = 'MONTHLY' AND "termMonths" = 1 AND "monthlyEquivalentRappen" = "netPriceRappen")
    OR ("billingInterval" = 'ANNUAL' AND "monthlyEquivalentRappen" = floor("netPriceRappen"::numeric / "termMonths" + 0.5)::integer));
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "plan_entitlement_value_check"
  CHECK (num_nonnulls("booleanValue", "integerValue", "analyticsLevelValue") = 1
    AND (("key" IN ('ACTIVE_JOB_LIMIT', 'SEAT_LIMIT', 'TALENT_CONTACT_ALLOWANCE', 'JOB_BOOST_ALLOWANCE')
          AND "valueType" = 'INTEGER' AND "integerValue" >= 0 AND "booleanValue" IS NULL AND "analyticsLevelValue" IS NULL)
      OR ("key" IN ('TALENT_RADAR_ACCESS', 'ENHANCED_COMPANY_PROFILE', 'EMPLOYER_IMPORT_ACCESS')
          AND "valueType" = 'BOOLEAN' AND "booleanValue" IS NOT NULL AND "integerValue" IS NULL AND "analyticsLevelValue" IS NULL)
      OR ("key" = 'ANALYTICS_LEVEL' AND "valueType" = 'ANALYTICS_LEVEL' AND "analyticsLevelValue" IS NOT NULL
          AND "booleanValue" IS NULL AND "integerValue" IS NULL)));
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "employer_subscription_period_check"
  CHECK ("currentPeriodStart" < "currentPeriodEnd" AND "termMonthsSnapshot" > 0
    AND "recurringNetRappenSnapshot" >= 0 AND "monthlyEquivalentRappenSnapshot" >= 0);
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "employer_subscription_lifecycle_projection_check"
  CHECK (("status" = 'SCHEDULED' AND "activatedAt" IS NULL AND "endedAt" IS NULL)
    OR ("status" IN ('ACTIVE', 'CANCELLING') AND "activatedAt" IS NOT NULL AND "endedAt" IS NULL)
    OR ("status" = 'EXPIRED' AND "activatedAt" IS NOT NULL AND "endedAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "endedAt" IS NOT NULL));
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "subscription_change_successor_check"
  CHECK (("kind" = 'DOWNGRADE' AND "successorSubscriptionId" IS NOT NULL)
    OR ("kind" = 'CANCEL' AND "successorSubscriptionId" IS NULL));
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "subscription_change_lifecycle_projection_check"
  CHECK (("status" = 'PENDING' AND "appliedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'APPLIED' AND "appliedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "appliedAt" IS NULL AND "revokedAt" IS NOT NULL));
ALTER TABLE "ProductVersion" ADD CONSTRAINT "product_version_range_price_check"
  CHECK ("netPriceRappen" >= 0 AND ("validTo" IS NULL OR "validFrom" < "validTo")
    AND ("durationDays" IS NULL OR "durationDays" > 0)
    AND (("creditType" IS NULL AND "creditAmount" IS NULL)
      OR ("creditType" IS NOT NULL AND "creditAmount" IS NOT NULL AND "creditAmount" > 0)));
ALTER TABLE "CompanyBillingProfile" ADD CONSTRAINT "company_billing_country_check" CHECK ("countryCode" = 'CH');
ALTER TABLE "Order" ADD CONSTRAINT "order_totals_check"
  CHECK ("netTotalRappen" >= 0 AND "vatTotalRappen" >= 0 AND "totalRappen" = "netTotalRappen" + "vatTotalRappen");
ALTER TABLE "Order" ADD CONSTRAINT "order_lifecycle_projection_check"
  CHECK ((("status" = 'PAID') = ("paidAt" IS NOT NULL))
    AND (("status" = 'FAILED') = ("failedAt" IS NOT NULL))
    AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)));
ALTER TABLE "OrderLine" ADD CONSTRAINT "order_line_catalog_reference_xor_check"
  CHECK (num_nonnulls("planVersionId", "productVersionId") = 1);
ALTER TABLE "OrderLine" ADD CONSTRAINT "order_line_money_check"
  CHECK ("quantity" > 0 AND "unitNetRappen" >= 0 AND "netRappen" = "unitNetRappen" * "quantity"
    AND "taxRateBasisPoints" BETWEEN 0 AND 10000
    AND "vatRappen" = floor("netRappen"::numeric * "taxRateBasisPoints" / 10000 + 0.5)::integer
    AND "totalRappen" = "netRappen" + "vatRappen");
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_totals_check"
  CHECK ("netTotalRappen" >= 0 AND "vatTotalRappen" >= 0 AND "totalRappen" = "netTotalRappen" + "vatTotalRappen");
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_lifecycle_projection_check"
  CHECK (("status" = 'DRAFT' AND "issuedAt" IS NULL AND "paidAt" IS NULL AND "voidedAt" IS NULL)
    OR ("status" = 'ISSUED' AND "issuedAt" IS NOT NULL AND "paidAt" IS NULL AND "voidedAt" IS NULL)
    OR ("status" = 'PAID' AND "issuedAt" IS NOT NULL AND "paidAt" IS NOT NULL AND "voidedAt" IS NULL)
    OR ("status" = 'VOID' AND "issuedAt" IS NOT NULL AND "paidAt" IS NULL AND "voidedAt" IS NOT NULL));
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "invoice_line_money_check"
  CHECK ("quantity" > 0 AND "unitNetRappen" >= 0 AND "netRappen" = "unitNetRappen" * "quantity"
    AND "taxRateBasisPoints" BETWEEN 0 AND 10000
    AND "vatRappen" = floor("netRappen"::numeric * "taxRateBasisPoints" / 10000 + 0.5)::integer
    AND "totalRappen" = "netRappen" + "vatRappen");
ALTER TABLE "TaxRateVersion" ADD CONSTRAINT "tax_rate_version_check"
  CHECK ("rateBasisPoints" BETWEEN 0 AND 10000 AND ("validTo" IS NULL OR "validFrom" < "validTo"));
ALTER TABLE "TaxRateVersion" ADD CONSTRAINT "tax_rate_review_projection_check"
  CHECK (("reviewStatus" = 'DRAFT' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
    OR ("reviewStatus" IN ('APPROVED', 'RETIRED') AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL));
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "entitlement_grant_range_check"
  CHECK ("validFrom" < "validTo");
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "entitlement_grant_value_check"
  CHECK (num_nonnulls("booleanValue", "integerValue", "analyticsLevelValue") = 1
    AND (("key" IN ('ACTIVE_JOB_LIMIT', 'SEAT_LIMIT', 'TALENT_CONTACT_ALLOWANCE', 'JOB_BOOST_ALLOWANCE')
          AND "valueType" = 'INTEGER' AND "integerValue" >= 0 AND "integerMode" IS NOT NULL
          AND "booleanValue" IS NULL AND "analyticsLevelValue" IS NULL)
      OR ("key" IN ('TALENT_RADAR_ACCESS', 'ENHANCED_COMPANY_PROFILE', 'EMPLOYER_IMPORT_ACCESS')
          AND "valueType" = 'BOOLEAN' AND "booleanValue" = true AND "integerMode" IS NULL
          AND "integerValue" IS NULL AND "analyticsLevelValue" IS NULL)
      OR ("key" = 'ANALYTICS_LEVEL' AND "valueType" = 'ANALYTICS_LEVEL' AND "analyticsLevelValue" IS NOT NULL
          AND "integerMode" IS NULL AND "booleanValue" IS NULL AND "integerValue" IS NULL)));
ALTER TABLE "CreditAccount" ADD CONSTRAINT "credit_account_period_check" CHECK ("periodStart" < "periodEnd");
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "credit_ledger_sign_check"
  CHECK (("kind" = 'GRANT' AND "amount" > 0 AND "reversalOfEntryId" IS NULL)
    OR ("kind" IN ('CONSUME', 'EXPIRE') AND "amount" < 0 AND "reversalOfEntryId" IS NULL)
    OR ("kind" = 'REVERSAL' AND "amount" > 0 AND "reversalOfEntryId" IS NOT NULL));
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "credit_ledger_range_check" CHECK ("validFrom" < "validTo");
ALTER TABLE "JobBoost" ADD CONSTRAINT "job_boost_funding_xor_check"
  CHECK (num_nonnulls("orderLineId", "consumedCreditLedgerEntryId") = 1);
ALTER TABLE "JobBoost" ADD CONSTRAINT "job_boost_range_check" CHECK ("startsAt" < "endsAt");
ALTER TABLE "AdditionalJobPermit" ADD CONSTRAINT "additional_job_permit_range_check" CHECK ("validFrom" < "validTo");
ALTER TABLE "ImportSetupApproval" ADD CONSTRAINT "import_setup_approval_lifecycle_check"
  CHECK (("status" IN ('APPROVED', 'USED') AND "approvedByUserId" IS NOT NULL AND "approvalReason" IS NOT NULL)
    OR "status" IN ('DRAFT', 'EXPIRED', 'REVOKED'));
ALTER TABLE "ImportAccessGrant" ADD CONSTRAINT "import_access_grant_range_check" CHECK ("validFrom" < "validTo");
ALTER TABLE "SalesLead" ADD CONSTRAINT "sales_lead_email_normalized_check" CHECK ("emailNormalized" = lower(btrim("emailNormalized")));
ALTER TABLE "SystemTask" ADD CONSTRAINT "system_task_evidence_window_check"
  CHECK ("evidenceWindowEnd" IS NULL OR "evidenceWindowStart" IS NULL OR "evidenceWindowStart" < "evidenceWindowEnd");
ALTER TABLE "ReferralLink" ADD CONSTRAINT "referral_link_expiry_check" CHECK ("createdAt" < "expiresAt");
ALTER TABLE "RecruiterMandate" ADD CONSTRAINT "recruiter_mandate_range_check" CHECK ("validFrom" < "validTo");
ALTER TABLE "ContentRevision" ADD CONSTRAINT "content_revision_body_check"
  CHECK (char_length("title") > 0 AND char_length("excerpt") > 0 AND char_length("body") > 0);
ALTER TABLE "ContentRevision" ADD CONSTRAINT "content_revision_lifecycle_projection_check"
  CHECK (("status" IN ('DRAFT', 'IN_REVIEW') AND "reviewedAt" IS NULL AND "publishedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "reviewedAt" IS NOT NULL AND "publishedAt" IS NULL)
    OR ("status" IN ('PUBLISHED', 'UNPUBLISHED') AND "reviewedAt" IS NOT NULL AND "publishedAt" IS NOT NULL));

-- Cross-scope composite foreign keys prevent accidental cross-tenant joins.
ALTER TABLE "City" ADD CONSTRAINT "city_id_canton_unique" UNIQUE ("id", "cantonId");
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "company_location_city_canton_fkey"
  FOREIGN KEY ("cityId", "cantonId") REFERENCES "City"("id", "cantonId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "job_id_company_unique" UNIQUE ("id", "companyId");
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_id_job_unique" UNIQUE ("id", "jobId");
ALTER TABLE "Job" ADD CONSTRAINT "job_current_revision_id_unique" UNIQUE ("currentRevisionId", "id");
ALTER TABLE "Job" ADD CONSTRAINT "job_published_revision_id_unique" UNIQUE ("publishedRevisionId", "id");
ALTER TABLE "Job" ADD CONSTRAINT "job_current_revision_scope_fkey"
  FOREIGN KEY ("currentRevisionId", "id") REFERENCES "JobRevision"("id", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "job_published_revision_scope_fkey"
  FOREIGN KEY ("publishedRevisionId", "id") REFERENCES "JobRevision"("id", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobAssignment" ADD CONSTRAINT "job_assignment_job_company_fkey"
  FOREIGN KEY ("jobId", "companyId") REFERENCES "Job"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobRevision" ADD CONSTRAINT "job_revision_city_canton_scope_fkey"
  FOREIGN KEY ("cityId", "cantonId") REFERENCES "City"("id", "cantonId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobStatusEvent" ADD CONSTRAINT "job_status_event_revision_scope_fkey"
  FOREIGN KEY ("jobRevisionId", "jobId") REFERENCES "JobRevision"("id", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "company_membership_id_company_user_unique"
  UNIQUE ("id", "companyId", "userId");
ALTER TABLE "JobAssignment" ADD CONSTRAINT "job_assignment_membership_scope_fkey"
  FOREIGN KEY ("membershipId", "companyId", "userId")
  REFERENCES "CompanyMembership"("id", "companyId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "application_submitted_revision_job_fkey"
  FOREIGN KEY ("submittedJobRevisionId", "jobId") REFERENCES "JobRevision"("id", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "application_id_submitted_revision_unique"
  UNIQUE ("id", "submittedJobRevisionId");
ALTER TABLE "ApplicationSubmissionSnapshot" ADD CONSTRAINT "application_snapshot_application_revision_unique"
  UNIQUE ("applicationId", "jobRevisionId");
ALTER TABLE "ApplicationSubmissionSnapshot" ADD CONSTRAINT "application_snapshot_revision_scope_fkey"
  FOREIGN KEY ("applicationId", "jobRevisionId")
  REFERENCES "Application"("id", "submittedJobRevisionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobAlertDigest" ADD CONSTRAINT "job_alert_digest_id_alert_unique" UNIQUE ("id", "jobAlertId");
ALTER TABLE "JobAlertDigestItem" ADD CONSTRAINT "job_alert_digest_item_scope_fkey"
  FOREIGN KEY ("digestId", "jobAlertId") REFERENCES "JobAlertDigest"("id", "jobAlertId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobAlertUnsubscribeToken" ADD CONSTRAINT "job_alert_unsubscribe_token_scope_fkey"
  FOREIGN KEY ("digestId", "jobAlertId") REFERENCES "JobAlertDigest"("id", "jobAlertId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "conversation_id_company_unique" UNIQUE ("id", "companyId");
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "conversation_participant_company_scope_fkey"
  FOREIGN KEY ("conversationId", "companyId") REFERENCES "Conversation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadarSearchSession" ADD CONSTRAINT "radar_search_session_membership_scope_fkey"
  FOREIGN KEY ("membershipId", "companyId", "requestingUserId")
  REFERENCES "CompanyMembership"("id", "companyId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployerContactRequest" ADD CONSTRAINT "contact_request_scope_unique" UNIQUE ("id", "companyId", "candidateProfileId");
ALTER TABLE "IdentityRevealGrant" ADD CONSTRAINT "identity_reveal_request_scope_fkey"
  FOREIGN KEY ("contactRequestId", "companyId", "candidateProfileId")
  REFERENCES "EmployerContactRequest"("id", "companyId", "candidateProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "order_id_company_unique" UNIQUE ("id", "companyId");
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_order_company_fkey"
  FOREIGN KEY ("orderId", "companyId") REFERENCES "Order"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "subscription_source_order_company_fkey"
  FOREIGN KEY ("sourceOrderId", "companyId") REFERENCES "Order"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "subscription_id_company_unique" UNIQUE ("id", "companyId");
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "subscription_change_current_scope_fkey"
  FOREIGN KEY ("currentSubscriptionId", "companyId")
  REFERENCES "EmployerSubscription"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "subscription_change_successor_scope_fkey"
  FOREIGN KEY ("successorSubscriptionId", "companyId")
  REFERENCES "EmployerSubscription"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChangeSchedule" ADD CONSTRAINT "subscription_change_successor_company_unique"
  UNIQUE ("successorSubscriptionId", "companyId");
ALTER TABLE "JobBoost" ADD CONSTRAINT "job_boost_job_company_fkey"
  FOREIGN KEY ("jobId", "companyId") REFERENCES "Job"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OccupationCode" ADD CONSTRAINT "occupation_code_id_version_unique"
  UNIQUE ("id", "occupationCodeVersionId");
ALTER TABLE "JobReportingCheck" ADD CONSTRAINT "job_reporting_code_version_scope_fkey"
  FOREIGN KEY ("occupationCodeId", "occupationCodeVersionId")
  REFERENCES "OccupationCode"("id", "occupationCodeVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "privacy_request_id_user_unique" UNIQUE ("id", "requesterUserId");
ALTER TABLE "PrivacyIdentityChallenge" ADD CONSTRAINT "privacy_challenge_request_user_scope_fkey"
  FOREIGN KEY ("privacyRequestId", "userId") REFERENCES "PrivacyRequest"("id", "requesterUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentRevision" ADD CONSTRAINT "content_revision_id_page_unique" UNIQUE ("id", "contentPageId");
ALTER TABLE "ContentPage" ADD CONSTRAINT "content_current_revision_id_unique"
  UNIQUE ("currentPublishedRevisionId", "id");
ALTER TABLE "ContentPage" ADD CONSTRAINT "content_current_revision_scope_fkey"
  FOREIGN KEY ("currentPublishedRevisionId", "id")
  REFERENCES "ContentRevision"("id", "contentPageId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentEvent" ADD CONSTRAINT "content_event_revision_scope_fkey"
  FOREIGN KEY ("contentRevisionId", "contentPageId")
  REFERENCES "ContentRevision"("id", "contentPageId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial uniqueness and NULL-safe scope uniqueness.
CREATE UNIQUE INDEX "company_single_primary_location_unique" ON "CompanyLocation" ("companyId") WHERE "isPrimary";
CREATE UNIQUE INDEX "conversation_participant_user_unique" ON "ConversationParticipant" ("conversationId", "userId")
  WHERE "kind" = 'USER' AND "userId" IS NOT NULL;
CREATE UNIQUE INDEX "conversation_participant_company_unique" ON "ConversationParticipant" ("conversationId", "companyId")
  WHERE "kind" = 'COMPANY_PRINCIPAL' AND "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "candidate_single_active_cv_unique" ON "CandidateDocumentMetadata" ("candidateProfileId")
  WHERE "status" = 'ACTIVE' AND "purpose" = 'CV';
CREATE UNIQUE INDEX "application_single_cv_unique" ON "ApplicationSubmissionDocument" ("applicationId");
CREATE UNIQUE INDEX "company_active_invitation_unique" ON "CompanyInvitation" ("companyId", "inviteeEmailNormalized") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "company_open_claim_unique" ON "CompanyClaimRequest" ("candidateCompanyId", "requesterEmployerUserId") WHERE "status" IN ('PENDING', 'NEEDS_EVIDENCE');
CREATE UNIQUE INDEX "company_open_verification_unique" ON "CompanyVerificationRequest" ("companyId") WHERE "status" IN ('DRAFT', 'PENDING', 'CHANGES_REQUESTED');
CREATE UNIQUE INDEX "job_active_assignment_unique" ON "JobAssignment" ("jobId", "userId", "role") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "contact_request_pending_unique" ON "EmployerContactRequest" ("companyId", "candidateProfileId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "privacy_active_challenge_unique" ON "PrivacyIdentityChallenge" ("privacyRequestId") WHERE "verifiedAt" IS NULL AND "consumedAt" IS NULL;
CREATE UNIQUE INDEX "subscription_pending_change_unique" ON "SubscriptionChangeSchedule" ("companyId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "cluster_single_activated_unique" ON "ClusterLaunchAssessment" ("cantonId", "categoryId", "policyVersion") WHERE "status" = 'ACTIVATED';
CREATE UNIQUE INDEX "plan_single_default_free_unique" ON "Plan" ("isDefaultFree") WHERE "isDefaultFree";
CREATE UNIQUE INDEX "additional_job_permit_active_company_unique" ON "AdditionalJobPermit" ("companyId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "additional_job_permit_active_job_unique" ON "AdditionalJobPermit" ("targetJobId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "import_access_grant_active_source_unique" ON "ImportAccessGrant" ("companyId", "importSourceId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "credit_ledger_purchased_grant_source_unique" ON "CreditLedgerEntry" ("sourceOrderLineId")
  WHERE "kind" = 'GRANT' AND "fundingSource" = 'PURCHASED_PACK' AND "sourceOrderLineId" IS NOT NULL;
CREATE UNIQUE INDEX "salary_band_scope_unique" ON "SalaryBand"
  ("salaryDatasetVersionId", "categoryId", "cantonId", "seniority", "workloadMin", "workloadMax", "period") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "metric_daily_scope_unique" ON "MetricDaily"
  ("metricKey", "definitionVersion", "calendarDate", "companyId", "cantonId", "categoryId") NULLS NOT DISTINCT;

-- Half-open effective ranges. Adjacent [a,b) and [b,c) ranges are valid.
ALTER TABLE "PlanVersion" ADD CONSTRAINT "plan_version_active_range_excl"
  EXCLUDE USING gist ("planId" WITH =, tstzrange("validFrom", COALESCE("validTo", 'infinity'::timestamptz), '[)') WITH &&)
  WHERE ("status" = 'ACTIVE');
ALTER TABLE "ProductVersion" ADD CONSTRAINT "product_version_active_range_excl"
  EXCLUDE USING gist ("productId" WITH =, tstzrange("validFrom", COALESCE("validTo", 'infinity'::timestamptz), '[)') WITH &&)
  WHERE ("status" = 'ACTIVE');
ALTER TABLE "TaxRateVersion" ADD CONSTRAINT "tax_rate_approved_range_excl"
  EXCLUDE USING gist ("jurisdiction" WITH =, "taxType" WITH =,
    tstzrange("validFrom", COALESCE("validTo", 'infinity'::timestamptz), '[)') WITH &&)
  WHERE ("reviewStatus" = 'APPROVED');
ALTER TABLE "SalaryDatasetVersion" ADD CONSTRAINT "salary_dataset_approved_range_excl"
  EXCLUDE USING gist ("datasetKey" WITH =,
    tstzrange("validFrom", COALESCE("validTo", 'infinity'::timestamptz), '[)') WITH &&)
  WHERE ("reviewStatus" = 'APPROVED');
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "subscription_effective_range_excl"
  EXCLUDE USING gist ("companyId" WITH =, tstzrange("currentPeriodStart", "currentPeriodEnd", '[)') WITH &&)
  WHERE ("status" IN ('SCHEDULED', 'ACTIVE', 'CANCELLING'));
ALTER TABLE "JobBoost" ADD CONSTRAINT "job_boost_effective_range_excl"
  EXCLUDE USING gist ("jobId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "entitlement_grant_effective_range_excl"
  EXCLUDE USING gist ("companyId" WITH =, "key" WITH =, tstzrange("validFrom", "validTo", '[)') WITH &&)
  WHERE ("revokedAt" IS NULL);

-- Cross-row and cross-tenant invariants that Prisma cannot express.
CREATE FUNCTION phase02_raise_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '23514', CONSTRAINT = 'phase02_append_only';
END;
$$;

CREATE FUNCTION enforce_company_last_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  remaining_owner boolean;
BEGIN
  IF OLD."role" = 'OWNER' AND OLD."status" = 'ACTIVE'
    AND (TG_OP = 'DELETE' OR NEW."role" <> 'OWNER' OR NEW."status" <> 'ACTIVE') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD."companyId"::text, 0));
    SELECT EXISTS (
      SELECT 1 FROM "CompanyMembership"
      WHERE "companyId" = OLD."companyId" AND "id" <> OLD."id"
        AND "role" = 'OWNER' AND "status" = 'ACTIVE'
    ) INTO remaining_owner;
    IF NOT remaining_owner THEN
      RAISE EXCEPTION 'An active company must retain an active owner'
        USING ERRCODE = '23514', CONSTRAINT = 'company_last_owner_check';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER company_membership_last_owner_trigger
BEFORE UPDATE OR DELETE ON "CompanyMembership"
FOR EACH ROW EXECUTE FUNCTION enforce_company_last_owner();

CREATE FUNCTION enforce_company_onboarding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' THEN
    IF nullif(btrim(NEW."name"), '') IS NULL
      OR nullif(btrim(NEW."slug"), '') IS NULL
      OR nullif(btrim(NEW."industry"), '') IS NULL
      OR nullif(btrim(NEW."size"), '') IS NULL
      OR nullif(btrim(NEW."about"), '') IS NULL
      OR (nullif(btrim(NEW."website"), '') IS NULL AND nullif(btrim(NEW."uid"), '') IS NULL)
      OR (SELECT count(*) FROM "CompanyLocation" WHERE "companyId" = NEW."id" AND "isPrimary") <> 1 THEN
      RAISE EXCEPTION 'Company onboarding predicate is incomplete'
        USING ERRCODE = '23514', CONSTRAINT = 'company_onboarding_complete_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_onboarding_trigger
BEFORE INSERT OR UPDATE OF "status", "name", "slug", "industry", "size", "about", "website", "uid" ON "Company"
FOR EACH ROW EXECUTE FUNCTION enforce_company_onboarding();

CREATE FUNCTION phase02_assert_company_onboarding(company_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  company_row "Company"%ROWTYPE;
BEGIN
  SELECT * INTO company_row FROM "Company" WHERE "id" = company_id;
  IF NOT FOUND OR company_row."status" <> 'ACTIVE' THEN
    RETURN;
  END IF;

  IF nullif(btrim(company_row."name"), '') IS NULL
    OR nullif(btrim(company_row."slug"), '') IS NULL
    OR nullif(btrim(company_row."industry"), '') IS NULL
    OR nullif(btrim(company_row."size"), '') IS NULL
    OR nullif(btrim(company_row."about"), '') IS NULL
    OR (nullif(btrim(company_row."website"), '') IS NULL AND nullif(btrim(company_row."uid"), '') IS NULL)
    OR (SELECT count(*) FROM "CompanyLocation" WHERE "companyId" = company_id AND "isPrimary") <> 1 THEN
    RAISE EXCEPTION 'Company onboarding predicate is incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'company_onboarding_complete_check';
  END IF;
END;
$$;

CREATE FUNCTION phase02_lock_company_location_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  company_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    company_ids := ARRAY[NEW."companyId"];
  ELSIF TG_OP = 'DELETE' THEN
    company_ids := ARRAY[OLD."companyId"];
  ELSE
    company_ids := ARRAY[OLD."companyId", NEW."companyId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT company_id
    FROM unnest(company_ids) AS company_ids_to_lock(company_id)
    WHERE company_id IS NOT NULL
    ORDER BY company_id
  ) INTO company_ids;

  PERFORM 1 FROM "Company"
    WHERE "id" = ANY(company_ids)
    ORDER BY "id"
    FOR UPDATE;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION phase02_assert_company_after_location_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  company_ids uuid[];
  company_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    company_ids := ARRAY[NEW."companyId"];
  ELSIF TG_OP = 'DELETE' THEN
    company_ids := ARRAY[OLD."companyId"];
  ELSE
    company_ids := ARRAY[OLD."companyId", NEW."companyId"];
  END IF;

  FOR company_id IN
    SELECT DISTINCT affected_company_id
    FROM unnest(company_ids) AS affected_company_ids(affected_company_id)
    WHERE affected_company_id IS NOT NULL
    ORDER BY affected_company_id
  LOOP
    PERFORM phase02_assert_company_onboarding(company_id);
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER company_location_parent_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "CompanyLocation"
FOR EACH ROW EXECUTE FUNCTION phase02_lock_company_location_parent();

CREATE CONSTRAINT TRIGGER company_location_onboarding_guard_trigger
AFTER INSERT OR UPDATE OR DELETE ON "CompanyLocation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase02_assert_company_after_location_mutation();

CREATE FUNCTION enforce_candidate_onboarding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  preference_row "CandidatePreference"%ROWTYPE;
BEGIN
  IF NEW."onboardingStatus" = 'COMPLETE' THEN
    SELECT * INTO preference_row FROM "CandidatePreference" WHERE "candidateProfileId" = NEW."id";
    IF nullif(btrim(NEW."firstName"), '') IS NULL OR nullif(btrim(NEW."lastName"), '') IS NULL OR NEW."cantonId" IS NULL
      OR preference_row."id" IS NULL
      OR (COALESCE(cardinality(preference_row."desiredTitles"), 0) = 0
          AND NOT EXISTS (SELECT 1 FROM "CandidatePreferenceCategory" WHERE "candidatePreferenceId" = preference_row."id"))
      OR COALESCE(cardinality(preference_row."desiredJobTypes"), 0) = 0
      OR preference_row."workloadMin" IS NULL OR preference_row."workloadMax" IS NULL
      OR preference_row."remotePreference" IS NULL
      OR NOT EXISTS (SELECT 1 FROM "CandidateSkill" WHERE "candidateProfileId" = NEW."id")
      OR NOT EXISTS (SELECT 1 FROM "CandidateLanguage" WHERE "candidateProfileId" = NEW."id") THEN
      RAISE EXCEPTION 'Candidate onboarding predicate is incomplete'
        USING ERRCODE = '23514', CONSTRAINT = 'candidate_onboarding_complete_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidate_onboarding_trigger
BEFORE INSERT OR UPDATE OF "onboardingStatus", "firstName", "lastName", "cantonId" ON "CandidateProfile"
FOR EACH ROW EXECUTE FUNCTION enforce_candidate_onboarding();

CREATE FUNCTION phase02_assert_candidate_onboarding(candidate_profile_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  profile_row "CandidateProfile"%ROWTYPE;
  preference_row "CandidatePreference"%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM "CandidateProfile" WHERE "id" = candidate_profile_id;
  IF NOT FOUND OR profile_row."onboardingStatus" <> 'COMPLETE' THEN
    RETURN;
  END IF;

  SELECT * INTO preference_row FROM "CandidatePreference" WHERE "candidateProfileId" = candidate_profile_id;
  IF nullif(btrim(profile_row."firstName"), '') IS NULL
    OR nullif(btrim(profile_row."lastName"), '') IS NULL
    OR profile_row."cantonId" IS NULL
    OR preference_row."id" IS NULL
    OR (COALESCE(cardinality(preference_row."desiredTitles"), 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM "CandidatePreferenceCategory" WHERE "candidatePreferenceId" = preference_row."id"
      ))
    OR COALESCE(cardinality(preference_row."desiredJobTypes"), 0) = 0
    OR preference_row."workloadMin" IS NULL
    OR preference_row."workloadMax" IS NULL
    OR preference_row."remotePreference" IS NULL
    OR NOT EXISTS (SELECT 1 FROM "CandidateSkill" WHERE "candidateProfileId" = candidate_profile_id)
    OR NOT EXISTS (SELECT 1 FROM "CandidateLanguage" WHERE "candidateProfileId" = candidate_profile_id) THEN
    RAISE EXCEPTION 'Candidate onboarding predicate is incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'candidate_onboarding_complete_check';
  END IF;
END;
$$;

CREATE FUNCTION phase02_lock_candidate_direct_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    candidate_ids := ARRAY[NEW."candidateProfileId"];
  ELSIF TG_OP = 'DELETE' THEN
    candidate_ids := ARRAY[OLD."candidateProfileId"];
  ELSE
    candidate_ids := ARRAY[OLD."candidateProfileId", NEW."candidateProfileId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT candidate_id
    FROM unnest(candidate_ids) AS candidate_ids_to_lock(candidate_id)
    WHERE candidate_id IS NOT NULL
    ORDER BY candidate_id
  ) INTO candidate_ids;

  PERFORM 1 FROM "CandidateProfile"
    WHERE "id" = ANY(candidate_ids)
    ORDER BY "id"
    FOR UPDATE;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION phase02_assert_candidate_after_direct_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate_ids uuid[];
  candidate_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    candidate_ids := ARRAY[NEW."candidateProfileId"];
  ELSIF TG_OP = 'DELETE' THEN
    candidate_ids := ARRAY[OLD."candidateProfileId"];
  ELSE
    candidate_ids := ARRAY[OLD."candidateProfileId", NEW."candidateProfileId"];
  END IF;

  FOR candidate_id IN
    SELECT DISTINCT affected_candidate_id
    FROM unnest(candidate_ids) AS affected_candidate_ids(affected_candidate_id)
    WHERE affected_candidate_id IS NOT NULL
    ORDER BY affected_candidate_id
  LOOP
    PERFORM phase02_assert_candidate_onboarding(candidate_id);
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION phase02_lock_candidate_preference_category_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  preference_ids uuid[];
  candidate_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    preference_ids := ARRAY[NEW."candidatePreferenceId"];
  ELSIF TG_OP = 'DELETE' THEN
    preference_ids := ARRAY[OLD."candidatePreferenceId"];
  ELSE
    preference_ids := ARRAY[OLD."candidatePreferenceId", NEW."candidatePreferenceId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT preference."candidateProfileId"
    FROM "CandidatePreference" AS preference
    WHERE preference."id" = ANY(preference_ids)
    ORDER BY preference."candidateProfileId"
  ) INTO candidate_ids;

  PERFORM 1 FROM "CandidateProfile"
    WHERE "id" = ANY(candidate_ids)
    ORDER BY "id"
    FOR UPDATE;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION phase02_assert_candidate_after_preference_category_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  preference_ids uuid[];
  candidate_ids uuid[];
  candidate_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    preference_ids := ARRAY[NEW."candidatePreferenceId"];
  ELSIF TG_OP = 'DELETE' THEN
    preference_ids := ARRAY[OLD."candidatePreferenceId"];
  ELSE
    preference_ids := ARRAY[OLD."candidatePreferenceId", NEW."candidatePreferenceId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT preference."candidateProfileId"
    FROM "CandidatePreference" AS preference
    WHERE preference."id" = ANY(preference_ids)
    ORDER BY preference."candidateProfileId"
  ) INTO candidate_ids;

  FOREACH candidate_id IN ARRAY candidate_ids LOOP
    PERFORM phase02_assert_candidate_onboarding(candidate_id);
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER candidate_skill_parent_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "CandidateSkill"
FOR EACH ROW EXECUTE FUNCTION phase02_lock_candidate_direct_parent();
CREATE CONSTRAINT TRIGGER candidate_skill_onboarding_guard_trigger
AFTER INSERT OR UPDATE OR DELETE ON "CandidateSkill"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase02_assert_candidate_after_direct_mutation();

CREATE TRIGGER candidate_language_parent_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "CandidateLanguage"
FOR EACH ROW EXECUTE FUNCTION phase02_lock_candidate_direct_parent();
CREATE CONSTRAINT TRIGGER candidate_language_onboarding_guard_trigger
AFTER INSERT OR UPDATE OR DELETE ON "CandidateLanguage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase02_assert_candidate_after_direct_mutation();

CREATE TRIGGER candidate_preference_parent_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "CandidatePreference"
FOR EACH ROW EXECUTE FUNCTION phase02_lock_candidate_direct_parent();
CREATE CONSTRAINT TRIGGER candidate_preference_onboarding_guard_trigger
AFTER INSERT OR UPDATE OR DELETE ON "CandidatePreference"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase02_assert_candidate_after_direct_mutation();

CREATE TRIGGER candidate_preference_category_parent_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "CandidatePreferenceCategory"
FOR EACH ROW EXECUTE FUNCTION phase02_lock_candidate_preference_category_parent();
CREATE CONSTRAINT TRIGGER candidate_preference_category_onboarding_guard_trigger
AFTER INSERT OR UPDATE OR DELETE ON "CandidatePreferenceCategory"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase02_assert_candidate_after_preference_category_mutation();

CREATE FUNCTION enforce_job_revision_benefit_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "JobRevisionBenefit"
      WHERE "jobRevisionId" = NEW."jobRevisionId" AND "id" <> NEW."id") >= 10 THEN
    RAISE EXCEPTION 'A revision may contain at most ten benefits'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_benefit_limit_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_revision_benefit_limit_trigger
BEFORE INSERT OR UPDATE ON "JobRevisionBenefit"
FOR EACH ROW EXECUTE FUNCTION enforce_job_revision_benefit_limit();

CREATE FUNCTION enforce_application_document_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  application_candidate uuid;
  document_candidate uuid;
  document_purpose "DocumentPurpose";
  document_status "DocumentStatus";
BEGIN
  SELECT "candidateProfileId" INTO application_candidate FROM "Application" WHERE "id" = NEW."applicationId";
  SELECT "candidateProfileId", "purpose", "status"
    INTO document_candidate, document_purpose, document_status
    FROM "CandidateDocumentMetadata" WHERE "id" = NEW."documentMetadataId";
  IF application_candidate IS NULL OR document_candidate IS NULL OR application_candidate <> document_candidate
    OR document_purpose <> 'CV' OR document_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Submission document must be the applicant owned active CV'
      USING ERRCODE = '23514', CONSTRAINT = 'application_document_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER application_document_scope_trigger
BEFORE INSERT OR UPDATE ON "ApplicationSubmissionDocument"
FOR EACH ROW EXECUTE FUNCTION enforce_application_document_scope();

CREATE FUNCTION enforce_conversation_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owning_company uuid;
BEGIN
  IF num_nonnulls(NEW."applicationId", NEW."contactRequestId") <> 1 THEN
    RAISE EXCEPTION 'Conversation requires exactly one origin'
      USING ERRCODE = '23514', CONSTRAINT = 'conversation_origin_xor_check';
  END IF;
  IF NEW."applicationId" IS NOT NULL THEN
    SELECT j."companyId" INTO owning_company
      FROM "Application" a JOIN "Job" j ON j."id" = a."jobId"
      WHERE a."id" = NEW."applicationId";
  ELSE
    SELECT "companyId" INTO owning_company FROM "EmployerContactRequest" WHERE "id" = NEW."contactRequestId";
  END IF;
  IF owning_company IS NULL OR owning_company <> NEW."companyId" THEN
    RAISE EXCEPTION 'Conversation origin is outside the company scope'
      USING ERRCODE = '23514', CONSTRAINT = 'conversation_company_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_scope_trigger
BEFORE INSERT OR UPDATE ON "Conversation"
FOR EACH ROW EXECUTE FUNCTION enforce_conversation_scope();

CREATE FUNCTION enforce_job_published_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_row "JobRevision"%ROWTYPE;
BEGIN
  IF NEW."status" = 'PUBLISHED' THEN
    SELECT * INTO revision_row FROM "JobRevision" WHERE "id" = NEW."publishedRevisionId" FOR UPDATE;
    IF revision_row."id" IS NULL OR revision_row."jobId" <> NEW."id"
      OR revision_row."validThrough" IS DISTINCT FROM NEW."expiresAt"
      OR revision_row."categoryId" IS DISTINCT FROM NEW."publishedCategoryId"
      OR revision_row."cantonId" IS DISTINCT FROM NEW."publishedCantonId"
      OR revision_row."cityId" IS DISTINCT FROM NEW."publishedCityId"
      OR revision_row."salaryPeriod" IS DISTINCT FROM NEW."publishedSalaryPeriod"
      OR revision_row."salaryMin" IS DISTINCT FROM NEW."publishedSalaryMin"
      OR revision_row."salaryMax" IS DISTINCT FROM NEW."publishedSalaryMax"
      OR revision_row."validThrough" <= CURRENT_TIMESTAMP
      OR revision_row."validThrough" > CURRENT_TIMESTAMP + interval '90 days' THEN
      RAISE EXCEPTION 'Published Job projections must match the bounded published revision'
        USING ERRCODE = '23514', CONSTRAINT = 'job_published_projection_match_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_published_projection_trigger
BEFORE INSERT OR UPDATE OF "status", "publishedRevisionId", "expiresAt", "publishedCategoryId", "publishedCantonId", "publishedCityId", "publishedSalaryPeriod", "publishedSalaryMin", "publishedSalaryMax" ON "Job"
FOR EACH ROW EXECUTE FUNCTION enforce_job_published_projection();

CREATE FUNCTION enforce_radar_profile_eligibility() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  eligible boolean;
BEGIN
  IF NEW."publishedAt" IS NOT NULL AND NEW."withdrawnAt" IS NULL THEN
    SELECT u."status" = 'ACTIVE' AND cp."onboardingStatus" = 'COMPLETE'
      AND COALESCE((
        SELECT cc."granted" FROM "CandidateConsent" cc
        WHERE cc."candidateProfileId" = cp."id" AND cc."kind" = 'TALENT_RADAR_VISIBILITY'
          AND cc."effectiveAt" <= CURRENT_TIMESTAMP
        ORDER BY cc."effectiveAt" DESC, cc."createdAt" DESC, cc."id" DESC LIMIT 1
      ), false)
      INTO eligible
      FROM "CandidateProfile" cp JOIN "User" u ON u."id" = cp."userId"
      WHERE cp."id" = NEW."candidateProfileId";
    IF NOT COALESCE(eligible, false) THEN
      RAISE EXCEPTION 'Radar profile is not eligible for publication'
        USING ERRCODE = '23514', CONSTRAINT = 'radar_profile_eligibility_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER radar_profile_eligibility_trigger
BEFORE INSERT OR UPDATE OF "publishedAt", "withdrawnAt" ON "RadarProfile"
FOR EACH ROW EXECUTE FUNCTION enforce_radar_profile_eligibility();

CREATE FUNCTION enforce_contact_request_funding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  funded_company uuid;
  funded_type "CreditType";
  funded_source "CreditFundingSource";
  funded_kind "CreditLedgerKind";
  funded_amount integer;
BEGIN
  SELECT ca."companyId", ca."creditType", cle."fundingSource", cle."kind", cle."amount"
    INTO funded_company, funded_type, funded_source, funded_kind, funded_amount
    FROM "CreditLedgerEntry" cle JOIN "CreditAccount" ca ON ca."id" = cle."accountId"
    WHERE cle."id" = NEW."creditLedgerEntryId";
  IF funded_company IS NULL OR funded_company <> NEW."companyId" OR funded_type <> 'TALENT_CONTACT'
    OR funded_source <> NEW."fundingSource" OR funded_kind <> 'CONSUME' OR funded_amount <> -1 THEN
    RAISE EXCEPTION 'Contact request must use one matching consumed Talent Contact credit'
      USING ERRCODE = '23514', CONSTRAINT = 'contact_request_funding_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contact_request_funding_trigger
BEFORE INSERT OR UPDATE OF "companyId", "creditLedgerEntryId", "fundingSource" ON "EmployerContactRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_contact_request_funding();

CREATE FUNCTION enforce_identity_reveal_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_status "ContactRequestStatus";
  conversation_request uuid;
  conversation_company uuid;
BEGIN
  SELECT "status" INTO request_status FROM "EmployerContactRequest"
    WHERE "id" = NEW."contactRequestId" AND "companyId" = NEW."companyId" AND "candidateProfileId" = NEW."candidateProfileId";
  IF request_status IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'Identity reveal requires the matching accepted contact request'
      USING ERRCODE = '23514', CONSTRAINT = 'identity_reveal_accepted_request_check';
  END IF;
  IF NEW."conversationId" IS NOT NULL THEN
    SELECT "contactRequestId", "companyId" INTO conversation_request, conversation_company
      FROM "Conversation" WHERE "id" = NEW."conversationId";
    IF conversation_request IS DISTINCT FROM NEW."contactRequestId" OR conversation_company IS DISTINCT FROM NEW."companyId" THEN
      RAISE EXCEPTION 'Identity reveal conversation scope mismatch'
        USING ERRCODE = '23514', CONSTRAINT = 'identity_reveal_conversation_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_reveal_scope_trigger
BEFORE INSERT OR UPDATE OF "candidateProfileId", "companyId", "contactRequestId", "conversationId" ON "IdentityRevealGrant"
FOR EACH ROW EXECUTE FUNCTION enforce_identity_reveal_scope();

CREATE FUNCTION enforce_identity_reveal_grant_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['revokedAt', 'revokedByUserId', 'revokeReason'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['revokedAt', 'revokedByUserId', 'revokeReason'])
    OR (OLD."revokedAt" IS NOT NULL AND (
      OLD."revokedAt" IS DISTINCT FROM NEW."revokedAt"
      OR OLD."revokedByUserId" IS DISTINCT FROM NEW."revokedByUserId"
      OR OLD."revokeReason" IS DISTINCT FROM NEW."revokeReason"
    )) THEN
    RAISE EXCEPTION 'Identity reveal Grant scope and snapshot are immutable; revocation is one-way'
      USING ERRCODE = '23514', CONSTRAINT = 'identity_reveal_grant_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_reveal_grant_immutable_trigger
BEFORE UPDATE OR DELETE ON "IdentityRevealGrant"
FOR EACH ROW EXECUTE FUNCTION enforce_identity_reveal_grant_immutable();

CREATE FUNCTION enforce_identity_reveal_field_open() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_revoked_at timestamptz;
BEGIN
  SELECT "revokedAt" INTO grant_revoked_at
    FROM "IdentityRevealGrant" WHERE "id" = NEW."grantId" FOR UPDATE;
  IF NOT FOUND OR grant_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Reveal fields may only be appended to an existing unrevoked Grant'
      USING ERRCODE = '23514', CONSTRAINT = 'identity_reveal_field_unrevoked_grant_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_reveal_field_open_trigger
BEFORE INSERT ON "IdentityRevealGrantField"
FOR EACH ROW EXECUTE FUNCTION enforce_identity_reveal_field_open();

CREATE FUNCTION enforce_identity_reveal_confirmation_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_row "IdentityRevealGrant"%ROWTYPE;
  candidate_user_id uuid;
  complete_distinct_count integer;
  added_distinct_count integer;
  stored_fields "RevealField"[];
  prior_fields "RevealField"[];
  expected_added_fields "RevealField"[];
BEGIN
  SELECT * INTO grant_row FROM "IdentityRevealGrant"
    WHERE "id" = NEW."grantId" FOR UPDATE;
  SELECT "userId" INTO candidate_user_id FROM "CandidateProfile"
    WHERE "id" = grant_row."candidateProfileId";
  SELECT count(DISTINCT field) INTO complete_distinct_count
    FROM unnest(NEW."completeFieldSet") AS complete_fields(field);
  SELECT count(DISTINCT field) INTO added_distinct_count
    FROM unnest(NEW."newlyAddedFields") AS added_fields(field);
  SELECT COALESCE(array_agg(stored."field" ORDER BY stored."field"), ARRAY[]::"RevealField"[])
    INTO stored_fields
    FROM "IdentityRevealGrantField" stored WHERE stored."grantId" = NEW."grantId";
  SELECT confirmation."completeFieldSet" INTO prior_fields
    FROM "IdentityRevealConfirmation" confirmation
    WHERE confirmation."grantId" = NEW."grantId"
    ORDER BY cardinality(confirmation."completeFieldSet") DESC, confirmation."createdAt" DESC, confirmation."id" DESC
    LIMIT 1;
  prior_fields := COALESCE(prior_fields, ARRAY[]::"RevealField"[]);
  SELECT COALESCE(array_agg(candidate_field ORDER BY candidate_field), ARRAY[]::"RevealField"[])
    INTO expected_added_fields
    FROM unnest(NEW."completeFieldSet") AS candidate_fields(candidate_field)
    WHERE NOT (candidate_field = ANY(prior_fields));
  IF grant_row."id" IS NULL OR grant_row."revokedAt" IS NOT NULL
    OR candidate_user_id IS DISTINCT FROM NEW."actorUserId"
    OR grant_row."contactRequestId" IS DISTINCT FROM NEW."contactRequestId"
    OR grant_row."conversationId" IS DISTINCT FROM NEW."conversationId"
    OR complete_distinct_count <> cardinality(NEW."completeFieldSet")
    OR added_distinct_count <> cardinality(NEW."newlyAddedFields")
    OR NOT (stored_fields <@ NEW."completeFieldSet" AND NEW."completeFieldSet" <@ stored_fields)
    OR NOT (prior_fields <@ NEW."completeFieldSet")
    OR NOT (expected_added_fields <@ NEW."newlyAddedFields" AND NEW."newlyAddedFields" <@ expected_added_fields) THEN
    RAISE EXCEPTION 'Reveal confirmation must match the candidate-owned Grant scope and typed field set'
      USING ERRCODE = '23514', CONSTRAINT = 'identity_reveal_confirmation_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_reveal_confirmation_scope_trigger
BEFORE INSERT ON "IdentityRevealConfirmation"
FOR EACH ROW EXECUTE FUNCTION enforce_identity_reveal_confirmation_scope();

CREATE FUNCTION enforce_identity_reveal_confirmed_field_set() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_grant_id uuid;
  stored_fields "RevealField"[];
BEGIN
  target_grant_id := COALESCE(
    (to_jsonb(NEW) ->> 'grantId')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid
  );
  SELECT COALESCE(array_agg(stored."field" ORDER BY stored."field"), ARRAY[]::"RevealField"[])
    INTO stored_fields
    FROM "IdentityRevealGrantField" stored WHERE stored."grantId" = target_grant_id;
  IF cardinality(stored_fields) = 0 OR NOT EXISTS (
    SELECT 1 FROM "IdentityRevealConfirmation" confirmation
    WHERE confirmation."grantId" = target_grant_id
      AND confirmation."completeFieldSet" <@ stored_fields
      AND stored_fields <@ confirmation."completeFieldSet"
  ) THEN
    RAISE EXCEPTION 'Every Reveal Grant field set requires matching append-only candidate confirmation'
      USING ERRCODE = '23514', CONSTRAINT = 'identity_reveal_confirmed_field_set_check';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER identity_reveal_grant_confirmation_guard_trigger
AFTER INSERT ON "IdentityRevealGrant"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_identity_reveal_confirmed_field_set();

CREATE CONSTRAINT TRIGGER identity_reveal_field_confirmation_guard_trigger
AFTER INSERT ON "IdentityRevealGrantField"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_identity_reveal_confirmed_field_set();

CREATE FUNCTION enforce_application_submission_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  application_row "Application"%ROWTYPE;
  candidate_row "CandidateProfile"%ROWTYPE;
  candidate_email varchar(320);
  company_name varchar(200);
  revision_row "JobRevision"%ROWTYPE;
BEGIN
  SELECT * INTO application_row FROM "Application" WHERE "id" = NEW."applicationId" FOR UPDATE;
  SELECT * INTO candidate_row FROM "CandidateProfile" WHERE "id" = application_row."candidateProfileId";
  SELECT "email" INTO candidate_email FROM "User" WHERE "id" = candidate_row."userId";
  SELECT c."name" INTO company_name FROM "Job" j JOIN "Company" c ON c."id" = j."companyId"
    WHERE j."id" = application_row."jobId";
  SELECT * INTO revision_row FROM "JobRevision" WHERE "id" = application_row."submittedJobRevisionId";
  IF application_row."id" IS NULL OR NEW."jobRevisionId" IS DISTINCT FROM application_row."submittedJobRevisionId"
    OR NEW."coverLetterSnapshot" IS DISTINCT FROM application_row."coverLetter"
    OR NEW."candidateFirstName" IS DISTINCT FROM candidate_row."firstName"
    OR NEW."candidateLastName" IS DISTINCT FROM candidate_row."lastName"
    OR NEW."candidateEmail" IS DISTINCT FROM candidate_email
    OR NEW."recipientCompanyName" IS DISTINCT FROM company_name
    OR NEW."applicationContactKind" IS DISTINCT FROM revision_row."applicationContactKind"
    OR NEW."applicationContactValue" IS DISTINCT FROM revision_row."applicationContactValue"
    OR NEW."responseTargetDays" IS DISTINCT FROM revision_row."responseTargetDays"
    OR NEW."applicationEffort" IS DISTINCT FROM revision_row."applicationEffort"
    OR NEW."requiredDocumentKinds" IS DISTINCT FROM revision_row."requiredDocumentKinds"
    OR NEW."submittedAt" IS DISTINCT FROM application_row."submittedAt" THEN
    RAISE EXCEPTION 'Application submission snapshot must match the confirmed immutable submission inputs'
      USING ERRCODE = '23514', CONSTRAINT = 'application_submission_snapshot_match_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER application_submission_snapshot_match_trigger
BEFORE INSERT ON "ApplicationSubmissionSnapshot"
FOR EACH ROW EXECUTE FUNCTION enforce_application_submission_snapshot();

CREATE FUNCTION enforce_application_submission_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."jobId" IS DISTINCT FROM NEW."jobId"
    OR OLD."submittedJobRevisionId" IS DISTINCT FROM NEW."submittedJobRevisionId"
    OR OLD."candidateProfileId" IS DISTINCT FROM NEW."candidateProfileId"
    OR OLD."coverLetter" IS DISTINCT FROM NEW."coverLetter"
    OR OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt" THEN
    RAISE EXCEPTION 'Application submission identity and content are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'application_submission_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER application_submission_immutable_trigger
BEFORE UPDATE ON "Application"
FOR EACH ROW EXECUTE FUNCTION enforce_application_submission_immutable();

CREATE FUNCTION enforce_privacy_correction_field() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_type "PrivacyRequestType";
  request_ids uuid[];
  existing_field_count integer;
  previous_request_id uuid;
  previous_field_code "PrivacyCorrectionFieldCode";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    request_ids := ARRAY[OLD."privacyRequestId", NEW."privacyRequestId"];
    previous_request_id := OLD."privacyRequestId";
    previous_field_code := OLD."fieldCode";
  ELSE
    request_ids := ARRAY[NEW."privacyRequestId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT request_id
    FROM unnest(request_ids) AS correction_request_ids(request_id)
    WHERE request_id IS NOT NULL
    ORDER BY request_id
  ) INTO request_ids;

  PERFORM 1 FROM "PrivacyRequest"
    WHERE "id" = ANY(request_ids)
    ORDER BY "id"
    FOR UPDATE;

  SELECT "type" INTO request_type FROM "PrivacyRequest" WHERE "id" = NEW."privacyRequestId";
  IF request_type IS DISTINCT FROM 'CORRECT' THEN
    RAISE EXCEPTION 'Correction fields belong only to correction requests'
      USING ERRCODE = '23514', CONSTRAINT = 'privacy_correction_request_type_check';
  END IF;

  SELECT count(*) INTO existing_field_count
  FROM "PrivacyRequestCorrectionField" AS correction_field
  WHERE correction_field."privacyRequestId" = NEW."privacyRequestId"
    AND NOT (
      previous_request_id IS NOT NULL
      AND correction_field."privacyRequestId" = previous_request_id
      AND correction_field."fieldCode" = previous_field_code
    );

  IF existing_field_count >= 5 THEN
    RAISE EXCEPTION 'A correction request accepts at most five fields'
      USING ERRCODE = '23514', CONSTRAINT = 'privacy_correction_field_limit_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_correction_field_trigger
BEFORE INSERT OR UPDATE ON "PrivacyRequestCorrectionField"
FOR EACH ROW EXECUTE FUNCTION enforce_privacy_correction_field();

CREATE FUNCTION enforce_privacy_correction_request_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM 'CORRECT'
    AND EXISTS (
      SELECT 1 FROM "PrivacyRequestCorrectionField" WHERE "privacyRequestId" = OLD."id"
    ) THEN
    RAISE EXCEPTION 'Correction fields belong only to correction requests'
      USING ERRCODE = '23514', CONSTRAINT = 'privacy_correction_request_type_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_correction_request_type_trigger
BEFORE UPDATE OF "type" ON "PrivacyRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_privacy_correction_request_type();

CREATE FUNCTION enforce_application_employer_note_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owning_company uuid;
BEGIN
  SELECT j."companyId" INTO owning_company
    FROM "Application" a JOIN "Job" j ON j."id" = a."jobId"
    WHERE a."id" = NEW."applicationId";
  IF owning_company IS NULL OR owning_company <> NEW."companyId" THEN
    RAISE EXCEPTION 'Employer note is outside the application company scope'
      USING ERRCODE = '23514', CONSTRAINT = 'application_employer_note_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER application_employer_note_scope_trigger
BEFORE INSERT OR UPDATE OF "applicationId", "companyId" ON "ApplicationEmployerNote"
FOR EACH ROW EXECUTE FUNCTION enforce_application_employer_note_scope();

CREATE FUNCTION enforce_subscription_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'activatedAt', 'endedAt', 'updatedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'activatedAt', 'endedAt', 'updatedAt'])
    OR (OLD."activatedAt" IS NOT NULL AND OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt")
    OR (OLD."endedAt" IS NOT NULL AND OLD."endedAt" IS DISTINCT FROM NEW."endedAt")
    OR NOT (NEW."status" = OLD."status"
      OR (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
      OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('CANCELLING', 'EXPIRED'))
      OR (OLD."status" = 'CANCELLING' AND NEW."status" = 'CANCELLED')) THEN
    RAISE EXCEPTION 'Subscription commercial and period snapshots are immutable outside lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'employer_subscription_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employer_subscription_snapshot_immutable_trigger
BEFORE UPDATE OR DELETE ON "EmployerSubscription"
FOR EACH ROW EXECUTE FUNCTION enforce_subscription_snapshot_immutable();

CREATE FUNCTION enforce_subscription_change_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Subscription change snapshots are immutable and may leave PENDING only once'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_change_snapshot_immutable';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['status', 'appliedAt', 'revokedAt', 'updatedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'appliedAt', 'revokedAt', 'updatedAt'])
    OR NOT (OLD."status" = 'PENDING' AND NEW."status" IN ('APPLIED', 'REVOKED')) THEN
    RAISE EXCEPTION 'Subscription change snapshots are immutable and may leave PENDING only once'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_change_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_change_snapshot_immutable_trigger
BEFORE UPDATE OR DELETE ON "SubscriptionChangeSchedule"
FOR EACH ROW EXECUTE FUNCTION enforce_subscription_change_immutable();

CREATE FUNCTION enforce_subscription_change_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_row "EmployerSubscription"%ROWTYPE;
  successor_row "EmployerSubscription"%ROWTYPE;
  retained_count integer;
  retained_distinct_count integer;
BEGIN
  SELECT * INTO current_row FROM "EmployerSubscription"
    WHERE "id" = NEW."currentSubscriptionId" FOR UPDATE;
  IF current_row."id" IS NULL OR current_row."companyId" IS DISTINCT FROM NEW."companyId"
    OR current_row."status" NOT IN ('ACTIVE', 'CANCELLING')
    OR NEW."effectiveAt" IS DISTINCT FROM current_row."currentPeriodEnd" THEN
    RAISE EXCEPTION 'Subscription change must use the current Company subscription period boundary'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_change_boundary_check';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CompanyMembership"
    WHERE "companyId" = NEW."companyId" AND "userId" = NEW."retainedDefaultOwnerId"
      AND "role" = 'OWNER' AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Subscription change snapshot requires an active retained default Owner'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_change_retained_owner_check';
  END IF;
  SELECT count(*), count(DISTINCT retained_id)
    INTO retained_count, retained_distinct_count
    FROM unnest(NEW."retainedMembershipIds") AS retained_memberships(retained_id);
  IF retained_count = 0 OR retained_count <> retained_distinct_count OR EXISTS (
    SELECT 1 FROM unnest(NEW."retainedMembershipIds") AS retained_memberships(retained_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM "CompanyMembership" membership
      WHERE membership."id"::text = retained_id AND membership."companyId" = NEW."companyId"
        AND membership."status" = 'ACTIVE'
    )
  ) THEN
    RAISE EXCEPTION 'Subscription change retained membership snapshot is outside the active Company scope'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_change_retained_membership_check';
  END IF;
  IF NEW."kind" = 'DOWNGRADE' THEN
    SELECT * INTO successor_row FROM "EmployerSubscription"
      WHERE "id" = NEW."successorSubscriptionId" FOR UPDATE;
    IF successor_row."id" IS NULL OR successor_row."companyId" IS DISTINCT FROM NEW."companyId"
      OR successor_row."status" <> 'SCHEDULED'
      OR successor_row."currentPeriodStart" IS DISTINCT FROM NEW."effectiveAt" THEN
      RAISE EXCEPTION 'Downgrade successor must start at the same Company period boundary'
        USING ERRCODE = '23514', CONSTRAINT = 'subscription_change_successor_boundary_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_change_boundary_trigger
BEFORE INSERT OR UPDATE OF "companyId", "currentSubscriptionId", "successorSubscriptionId", "kind", "effectiveAt", "retainedMembershipIds", "retainedDefaultOwnerId"
ON "SubscriptionChangeSchedule"
FOR EACH ROW EXECUTE FUNCTION enforce_subscription_change_boundary();

CREATE FUNCTION enforce_order_line_context() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_company uuid;
  product_type "ProductType";
  product_credit_type "CreditType";
  product_credit_amount integer;
  target_company uuid;
BEGIN
  SELECT "companyId" INTO order_company FROM "Order" WHERE "id" = NEW."orderId";
  IF num_nonnulls(NEW."planVersionId", NEW."productVersionId") <> 1 THEN
    RAISE EXCEPTION 'OrderLine requires exactly one catalog version'
      USING ERRCODE = '23514', CONSTRAINT = 'order_line_catalog_reference_xor_check';
  END IF;
  IF NEW."planVersionId" IS NOT NULL THEN
    IF NEW."fulfillmentContext" <> 'SUBSCRIPTION' OR num_nonnulls(NEW."targetJobId", NEW."targetImportSourceId", NEW."targetCreditType") <> 0 THEN
      RAISE EXCEPTION 'Plan line requires only the subscription context'
        USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
    END IF;
  ELSE
    SELECT p."type", pv."creditType", pv."creditAmount"
      INTO product_type, product_credit_type, product_credit_amount
      FROM "ProductVersion" pv JOIN "Product" p ON p."id" = pv."productId"
      WHERE pv."id" = NEW."productVersionId";
    CASE product_type
      WHEN 'JOB_BOOST' THEN
        IF NEW."fulfillmentContext" <> 'JOB_BOOST' OR NEW."targetJobId" IS NULL
          OR NEW."targetImportSourceId" IS NOT NULL OR NEW."targetCreditType" IS NOT NULL THEN
          RAISE EXCEPTION 'Job Boost line requires its owned target Job'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      WHEN 'ADDITIONAL_JOB' THEN
        IF NEW."fulfillmentContext" <> 'ADDITIONAL_JOB' OR NEW."targetJobId" IS NULL
          OR NEW."targetImportSourceId" IS NOT NULL OR NEW."targetCreditType" IS NOT NULL THEN
          RAISE EXCEPTION 'Additional Job line requires its owned target Job'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      WHEN 'IMPORT_SETUP' THEN
        IF NEW."fulfillmentContext" <> 'IMPORT_SETUP' OR NEW."targetImportSourceId" IS NULL
          OR NEW."targetJobId" IS NOT NULL OR NEW."targetCreditType" IS NOT NULL THEN
          RAISE EXCEPTION 'Import Setup line requires its Import Source context'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      WHEN 'CONTACT_PACK' THEN
        IF NEW."fulfillmentContext" <> 'CONTACT_PACK' OR NEW."targetCreditType" <> 'TALENT_CONTACT'
          OR product_credit_type IS DISTINCT FROM 'TALENT_CONTACT' OR COALESCE(product_credit_amount, 0) <= 0
          OR NEW."targetJobId" IS NOT NULL OR NEW."targetImportSourceId" IS NOT NULL THEN
          RAISE EXCEPTION 'Contact Pack line requires the typed Talent Contact context'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      ELSE
        RAISE EXCEPTION 'Product type is dormant and cannot create a P0 OrderLine'
          USING ERRCODE = '23514', CONSTRAINT = 'order_line_product_p0_gate_check';
    END CASE;
    IF NEW."targetJobId" IS NOT NULL THEN
      SELECT "companyId" INTO target_company FROM "Job" WHERE "id" = NEW."targetJobId";
      IF target_company IS NULL OR target_company <> order_company THEN
        RAISE EXCEPTION 'OrderLine target Job is outside the Order company'
          USING ERRCODE = '23514', CONSTRAINT = 'order_line_target_company_check';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_line_context_trigger
BEFORE INSERT OR UPDATE ON "OrderLine"
FOR EACH ROW EXECUTE FUNCTION enforce_order_line_context();

CREATE FUNCTION enforce_invoice_line_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_order uuid;
  line_order uuid;
BEGIN
  SELECT "orderId" INTO invoice_order FROM "Invoice" WHERE "id" = NEW."invoiceId";
  SELECT "orderId" INTO line_order FROM "OrderLine" WHERE "id" = NEW."orderLineId";
  IF invoice_order IS NULL OR line_order IS NULL OR invoice_order <> line_order THEN
    RAISE EXCEPTION 'InvoiceLine must snapshot an OrderLine from the same Order'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_line_order_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_line_scope_trigger
BEFORE INSERT OR UPDATE ON "InvoiceLine"
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_line_scope();

CREATE FUNCTION enforce_credit_ledger_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_company uuid;
  account_type "CreditType";
  account_source "CreditFundingSource";
  account_start timestamptz;
  account_end timestamptz;
  purchased_company uuid;
  purchased_order_status "OrderStatus";
  purchased_context "FulfillmentContextType";
  purchased_target_type "CreditType";
  purchased_product_type "CreditType";
  purchased_amount integer;
  referenced_entry "CreditLedgerEntry"%ROWTYPE;
  resulting_balance bigint;
BEGIN
  SELECT "companyId", "creditType", "fundingSource", "periodStart", "periodEnd"
    INTO account_company, account_type, account_source, account_start, account_end
    FROM "CreditAccount" WHERE "id" = NEW."accountId" FOR UPDATE;
  IF account_source IS NULL OR account_source <> NEW."fundingSource"
    OR NEW."validFrom" <> account_start OR NEW."validTo" <> account_end THEN
    RAISE EXCEPTION 'Ledger entry funding scope must match its account period'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_account_scope_check';
  END IF;
  IF NEW."kind" = 'REVERSAL' THEN
    SELECT * INTO referenced_entry FROM "CreditLedgerEntry" WHERE "id" = NEW."reversalOfEntryId" FOR UPDATE;
    IF referenced_entry."id" IS NULL OR referenced_entry."accountId" <> NEW."accountId"
      OR referenced_entry."kind" <> 'CONSUME' OR NEW."amount" <> -referenced_entry."amount"
      OR referenced_entry."fundingSource" <> NEW."fundingSource" THEN
      RAISE EXCEPTION 'Ledger reversal must exactly invert one consume in the same account'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_reversal_exact_check';
    END IF;
  END IF;
  IF NEW."kind" = 'CONSUME' AND NOT (NEW."validFrom" <= NEW."createdAt" AND NEW."createdAt" < NEW."validTo") THEN
    RAISE EXCEPTION 'Credit consumption must occur inside the half-open funding period'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_consume_period_check';
  END IF;
  IF NEW."fundingSource" = 'PLAN_ALLOWANCE' AND NEW."kind" = 'GRANT'
    AND (NEW."sourcePlanVersionId" IS NULL OR NEW."sourceOrderLineId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Plan allowance grant requires only a PlanVersion source'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_source_check';
  ELSIF NEW."fundingSource" = 'PURCHASED_PACK' AND NEW."kind" = 'GRANT'
    AND (NEW."sourceOrderLineId" IS NULL OR NEW."sourcePlanVersionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Purchased pack grant requires only an OrderLine source'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_source_check';
  ELSIF NEW."fundingSource" = 'ADMIN_GRANT' AND NEW."kind" = 'GRANT'
    AND (NEW."sourceOrderLineId" IS NOT NULL OR NEW."sourcePlanVersionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Admin grant cannot claim a catalog source'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_source_check';
  END IF;
  IF NEW."fundingSource" = 'PURCHASED_PACK' AND NEW."kind" = 'GRANT' THEN
    SELECT o."companyId", o."status", ol."fulfillmentContext", ol."targetCreditType",
      pv."creditType", pv."creditAmount" * ol."quantity"
      INTO purchased_company, purchased_order_status, purchased_context, purchased_target_type,
        purchased_product_type, purchased_amount
      FROM "OrderLine" ol
      JOIN "Order" o ON o."id" = ol."orderId"
      JOIN "ProductVersion" pv ON pv."id" = ol."productVersionId"
      WHERE ol."id" = NEW."sourceOrderLineId";
    IF purchased_company IS DISTINCT FROM account_company OR purchased_order_status <> 'PAID'
      OR purchased_context <> 'CONTACT_PACK' OR purchased_target_type IS DISTINCT FROM account_type
      OR purchased_product_type IS DISTINCT FROM account_type OR purchased_amount IS DISTINCT FROM NEW."amount" THEN
      RAISE EXCEPTION 'Purchased credit grant must exactly match one paid company-scoped credit pack line'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_purchased_source_scope_check';
    END IF;
  END IF;
  SELECT COALESCE(sum("amount"), 0) + NEW."amount" INTO resulting_balance
    FROM "CreditLedgerEntry" WHERE "accountId" = NEW."accountId";
  IF resulting_balance < 0 THEN
    RAISE EXCEPTION 'Credit ledger balance cannot become negative'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_nonnegative_balance_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_ledger_entry_trigger
BEFORE INSERT ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION enforce_credit_ledger_entry();

CREATE FUNCTION enforce_job_boost_funding() RETURNS trigger
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
    IF funded_company IS DISTINCT FROM NEW."companyId" OR funded_job IS DISTINCT FROM NEW."jobId"
      OR funded_order_status <> 'PAID'
      OR funding_context <> 'JOB_BOOST' OR duration_days IS NULL
      OR NEW."endsAt" <> NEW."startsAt" + make_interval(days => duration_days) THEN
      RAISE EXCEPTION 'Purchased Job Boost must match its OrderLine target and duration'
        USING ERRCODE = '23514', CONSTRAINT = 'job_boost_order_funding_scope_check';
    END IF;
  ELSE
    SELECT ca."companyId", ca."creditType", cle."kind", cle."amount"
      INTO ledger_company, ledger_type, ledger_kind, ledger_amount
      FROM "CreditLedgerEntry" cle JOIN "CreditAccount" ca ON ca."id" = cle."accountId"
      WHERE cle."id" = NEW."consumedCreditLedgerEntryId";
    IF ledger_company IS DISTINCT FROM NEW."companyId" OR ledger_type <> 'JOB_BOOST'
      OR ledger_kind <> 'CONSUME' OR ledger_amount <> -1
      OR NEW."endsAt" <> NEW."startsAt" + interval '7 days' THEN
      RAISE EXCEPTION 'Ledger Job Boost requires one matching seven-day consumed credit'
        USING ERRCODE = '23514', CONSTRAINT = 'job_boost_ledger_funding_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_boost_funding_trigger
BEFORE INSERT OR UPDATE OF "jobId", "companyId", "orderLineId", "consumedCreditLedgerEntryId", "startsAt", "endsAt" ON "JobBoost"
FOR EACH ROW EXECUTE FUNCTION enforce_job_boost_funding();

CREATE FUNCTION enforce_import_decision_rights() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_id uuid;
  committed_job_company uuid;
  committed_job_source uuid;
  committed_job_origin "JobOrigin";
BEGIN
  IF NEW."kind" = 'APPROVE' THEN
    SELECT ir."importSourceId" INTO source_id
      FROM "ImportItem" ii JOIN "ImportRun" ir ON ir."id" = ii."runId"
      WHERE ii."id" = NEW."importItemId";
    IF NOT EXISTS (
      SELECT 1 FROM "ImportSourceCompanyRight" r
      WHERE r."importSourceId" = source_id AND r."companyId" = NEW."selectedCompanyId"
        AND r."validFrom" <= NEW."createdAt" AND (r."validTo" IS NULL OR NEW."createdAt" < r."validTo")
        AND r."revokedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'Approved import item requires a current Company-scoped source right'
        USING ERRCODE = '23514', CONSTRAINT = 'import_decision_source_right_check';
    END IF;
    IF NEW."committedJobId" IS NOT NULL THEN
      SELECT "companyId", "importSourceId", "origin"
        INTO committed_job_company, committed_job_source, committed_job_origin
        FROM "Job" WHERE "id" = NEW."committedJobId";
      IF committed_job_company IS DISTINCT FROM NEW."selectedCompanyId"
        OR committed_job_source IS DISTINCT FROM source_id OR committed_job_origin <> 'IMPORT' THEN
        RAISE EXCEPTION 'Committed import Job must match the approved Company and Import Source'
          USING ERRCODE = '23514', CONSTRAINT = 'import_decision_committed_job_scope_check';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_decision_rights_trigger
BEFORE INSERT OR UPDATE ON "ImportDecision"
FOR EACH ROW EXECUTE FUNCTION enforce_import_decision_rights();

CREATE FUNCTION enforce_import_decision_commit_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ImportDecision evidence is immutable except for one approved Job commit link'
      USING ERRCODE = '23514', CONSTRAINT = 'import_decision_commit_once_check';
  END IF;
  IF OLD."kind" <> 'APPROVE'
    OR OLD."committedJobId" IS NOT NULL
    OR NEW."committedJobId" IS NULL
    OR (to_jsonb(OLD) - 'committedJobId') IS DISTINCT FROM (to_jsonb(NEW) - 'committedJobId') THEN
    RAISE EXCEPTION 'ImportDecision evidence is immutable except for one approved Job commit link'
      USING ERRCODE = '23514', CONSTRAINT = 'import_decision_commit_once_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_decision_commit_once_trigger
BEFORE UPDATE OR DELETE ON "ImportDecision"
FOR EACH ROW EXECUTE FUNCTION enforce_import_decision_commit_once();

CREATE FUNCTION enforce_import_job_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."origin" = 'IMPORT' AND NOT EXISTS (
    SELECT 1
    FROM "ImportDecision" decision
    JOIN "ImportItem" item ON item."id" = decision."importItemId"
    JOIN "ImportRun" run ON run."id" = item."runId"
    WHERE decision."kind" = 'APPROVE'
      AND decision."committedJobId" = NEW."id"
      AND decision."selectedCompanyId" = NEW."companyId"
      AND run."importSourceId" = NEW."importSourceId"
  ) THEN
    RAISE EXCEPTION 'An imported Job requires its approved source-scoped ImportDecision in the same transaction'
      USING ERRCODE = '23514', CONSTRAINT = 'import_job_decision_traceability_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER import_job_decision_traceability_trigger
AFTER INSERT OR UPDATE OF "origin", "importSourceId", "companyId" ON "Job"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_import_job_decision();

CREATE FUNCTION enforce_job_identity_provenance_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Job tenant identity and source provenance are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'job_identity_provenance_immutable';
  END IF;
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."companyId" IS DISTINCT FROM NEW."companyId"
    OR OLD."origin" IS DISTINCT FROM NEW."origin"
    OR OLD."sourceReference" IS DISTINCT FROM NEW."sourceReference"
    OR OLD."importSourceId" IS DISTINCT FROM NEW."importSourceId"
    OR OLD."dataProvenance" IS DISTINCT FROM NEW."dataProvenance"
    OR OLD."createdByUserId" IS DISTINCT FROM NEW."createdByUserId"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Job tenant identity and source provenance are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'job_identity_provenance_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_identity_provenance_immutable_trigger
BEFORE UPDATE OR DELETE ON "Job"
FOR EACH ROW EXECUTE FUNCTION enforce_job_identity_provenance_immutable();

CREATE FUNCTION phase02_raise_released_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable after release', TG_TABLE_NAME
    USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
END;
$$;

CREATE FUNCTION enforce_catalog_version_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_status text := to_jsonb(OLD)->>'status';
  new_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is immutable after release', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  new_status := to_jsonb(NEW)->>'status';
  IF old_status = 'DRAFT' AND new_status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'INACTIVE') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status')
    OR NOT (new_status = old_status
      OR (old_status = 'SCHEDULED' AND new_status IN ('ACTIVE', 'INACTIVE'))
      OR (old_status = 'ACTIVE' AND new_status = 'INACTIVE')) THEN
    RAISE EXCEPTION '% released content is immutable and permits only its catalog lifecycle', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_reviewed_version_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_status text := to_jsonb(OLD)->>'reviewStatus';
  new_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is immutable after approval', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  new_status := to_jsonb(NEW)->>'reviewStatus';
  IF old_status = 'DRAFT' AND new_status IN ('DRAFT', 'APPROVED') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD) - 'reviewStatus') IS DISTINCT FROM (to_jsonb(NEW) - 'reviewStatus')
    OR NOT (old_status = 'APPROVED' AND new_status IN ('APPROVED', 'RETIRED')) THEN
    RAISE EXCEPTION '% approved content is immutable and permits only retirement', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_content_revision_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'IN_REVIEW') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'reviewedAt', 'publishedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'reviewedAt', 'publishedAt'])
    OR (OLD."reviewedAt" IS NOT NULL AND OLD."reviewedAt" IS DISTINCT FROM NEW."reviewedAt")
    OR (OLD."publishedAt" IS NOT NULL AND OLD."publishedAt" IS DISTINCT FROM NEW."publishedAt")
    OR NOT (NEW."status" = OLD."status"
      OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('APPROVED', 'REJECTED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" = 'PUBLISHED')
      OR (OLD."status" = 'PUBLISHED' AND NEW."status" = 'UNPUBLISHED'))
    OR (NEW."status" IN ('APPROVED', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED') AND NEW."reviewedAt" IS NULL)
    OR (NEW."status" IN ('PUBLISHED', 'UNPUBLISHED') AND NEW."publishedAt" IS NULL) THEN
    RAISE EXCEPTION 'ContentRevision authored content is immutable after review begins'
      USING ERRCODE = '23514', CONSTRAINT = 'content_revision_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_order_lifecycle_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'PENDING') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'providerIdempotencyKey', 'providerReference', 'paidAt', 'failedAt', 'cancelledAt', 'expiresAt', 'updatedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'providerIdempotencyKey', 'providerReference', 'paidAt', 'failedAt', 'cancelledAt', 'expiresAt', 'updatedAt'])
    OR NOT (NEW."status" = OLD."status"
      OR (OLD."status" = 'PENDING' AND NEW."status" IN ('PAID', 'FAILED', 'CANCELLED', 'EXPIRED')))
    OR ((NEW."status" = 'PAID') <> (NEW."paidAt" IS NOT NULL))
    OR ((NEW."status" = 'FAILED') <> (NEW."failedAt" IS NOT NULL))
    OR ((NEW."status" = 'CANCELLED') <> (NEW."cancelledAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Order commercial snapshot is immutable outside its lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'order_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_invoice_lifecycle_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'ISSUED') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'paidAt', 'voidedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'paidAt', 'voidedAt'])
    OR NOT (NEW."status" = OLD."status"
      OR (OLD."status" = 'ISSUED' AND NEW."status" IN ('PAID', 'VOID')))
    OR ((NEW."status" = 'PAID') <> (NEW."paidAt" IS NOT NULL))
    OR ((NEW."status" = 'VOID') <> (NEW."voidedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invoice financial snapshot is immutable outside its lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_job_revision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."submittedAt" IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM "Job"
      WHERE "publishedRevisionId" = OLD."id"
        OR ("currentRevisionId" = OLD."id" AND "status" = 'PUBLISHED')
    ) THEN
    RAISE EXCEPTION 'JobRevision is immutable after submission or publication'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER job_revision_released_immutable_trigger
BEFORE UPDATE OR DELETE ON "JobRevision"
FOR EACH ROW EXECUTE FUNCTION enforce_job_revision_immutable();

CREATE FUNCTION enforce_job_revision_child_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    revision_ids := ARRAY[NEW."jobRevisionId"];
  ELSIF TG_OP = 'DELETE' THEN
    revision_ids := ARRAY[OLD."jobRevisionId"];
  ELSE
    revision_ids := ARRAY[OLD."jobRevisionId", NEW."jobRevisionId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT revision_id
    FROM unnest(revision_ids) AS revision_ids_to_lock(revision_id)
    WHERE revision_id IS NOT NULL
    ORDER BY revision_id
  ) INTO revision_ids;

  PERFORM 1 FROM "JobRevision"
    WHERE "id" = ANY(revision_ids)
    ORDER BY "id"
    FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM "JobRevision" AS revision
    WHERE revision."id" = ANY(revision_ids)
      AND (
        revision."submittedAt" IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM "Job"
          WHERE "publishedRevisionId" = revision."id"
            OR ("currentRevisionId" = revision."id" AND "status" = 'PUBLISHED')
        )
      )
  ) THEN
    RAISE EXCEPTION 'JobRevision children are immutable after submission or publication'
      USING ERRCODE = '23514', CONSTRAINT = 'job_revision_released_immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER job_revision_benefit_released_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "JobRevisionBenefit"
FOR EACH ROW EXECUTE FUNCTION enforce_job_revision_child_immutable();
CREATE TRIGGER job_revision_skill_released_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "JobRevisionSkill"
FOR EACH ROW EXECUTE FUNCTION enforce_job_revision_child_immutable();
CREATE TRIGGER job_revision_language_released_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "JobRevisionLanguage"
FOR EACH ROW EXECUTE FUNCTION enforce_job_revision_child_immutable();

CREATE TRIGGER content_revision_released_immutable_trigger
BEFORE UPDATE OR DELETE ON "ContentRevision"
FOR EACH ROW
EXECUTE FUNCTION enforce_content_revision_lifecycle();

CREATE TRIGGER plan_version_released_immutable_trigger
BEFORE UPDATE OR DELETE ON "PlanVersion"
FOR EACH ROW
EXECUTE FUNCTION enforce_catalog_version_lifecycle('plan_version_released_immutable');

CREATE TRIGGER product_version_released_immutable_trigger
BEFORE UPDATE OR DELETE ON "ProductVersion"
FOR EACH ROW
EXECUTE FUNCTION enforce_catalog_version_lifecycle('product_version_released_immutable');

CREATE TRIGGER tax_rate_version_approved_immutable_trigger
BEFORE UPDATE OR DELETE ON "TaxRateVersion"
FOR EACH ROW
EXECUTE FUNCTION enforce_reviewed_version_lifecycle('tax_rate_version_approved_immutable');

CREATE TRIGGER salary_dataset_version_approved_immutable_trigger
BEFORE UPDATE OR DELETE ON "SalaryDatasetVersion"
FOR EACH ROW
EXECUTE FUNCTION enforce_reviewed_version_lifecycle('salary_dataset_version_approved_immutable');

CREATE TRIGGER order_released_immutable_trigger
BEFORE UPDATE OR DELETE ON "Order"
FOR EACH ROW
EXECUTE FUNCTION enforce_order_lifecycle_immutable();

CREATE TRIGGER invoice_released_immutable_trigger
BEFORE UPDATE OR DELETE ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION enforce_invoice_lifecycle_immutable();

CREATE FUNCTION enforce_plan_entitlement_version_mutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    version_ids := ARRAY[NEW."planVersionId"];
  ELSIF TG_OP = 'DELETE' THEN
    version_ids := ARRAY[OLD."planVersionId"];
  ELSE
    version_ids := ARRAY[OLD."planVersionId", NEW."planVersionId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT version_id
    FROM unnest(version_ids) AS version_ids_to_lock(version_id)
    WHERE version_id IS NOT NULL
    ORDER BY version_id
  ) INTO version_ids;

  PERFORM 1 FROM "PlanVersion"
    WHERE "id" = ANY(version_ids)
    ORDER BY "id"
    FOR UPDATE;

  IF EXISTS (SELECT 1 FROM "PlanVersion" WHERE "id" = ANY(version_ids) AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'PlanEntitlement is immutable with a released PlanVersion'
      USING ERRCODE = '23514', CONSTRAINT = 'plan_version_released_immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER plan_entitlement_version_mutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "PlanEntitlement"
FOR EACH ROW EXECUTE FUNCTION enforce_plan_entitlement_version_mutable();

CREATE FUNCTION enforce_salary_band_version_mutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    version_ids := ARRAY[NEW."salaryDatasetVersionId"];
  ELSIF TG_OP = 'DELETE' THEN
    version_ids := ARRAY[OLD."salaryDatasetVersionId"];
  ELSE
    version_ids := ARRAY[OLD."salaryDatasetVersionId", NEW."salaryDatasetVersionId"];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT version_id
    FROM unnest(version_ids) AS version_ids_to_lock(version_id)
    WHERE version_id IS NOT NULL
    ORDER BY version_id
  ) INTO version_ids;

  PERFORM 1 FROM "SalaryDatasetVersion"
    WHERE "id" = ANY(version_ids)
    ORDER BY "id"
    FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM "SalaryDatasetVersion"
    WHERE "id" = ANY(version_ids) AND "reviewStatus" = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'SalaryBand is immutable with an approved SalaryDatasetVersion'
      USING ERRCODE = '23514', CONSTRAINT = 'salary_dataset_version_approved_immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER salary_band_version_mutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "SalaryBand"
FOR EACH ROW EXECUTE FUNCTION enforce_salary_band_version_mutable();

CREATE FUNCTION enforce_order_line_draft_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_status "OrderStatus";
BEGIN
  SELECT "status" INTO order_status FROM "Order" WHERE "id" = NEW."orderId" FOR UPDATE;
  IF order_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'OrderLine cannot be added to a released Order'
      USING ERRCODE = '23514', CONSTRAINT = 'order_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_line_00_draft_parent_trigger
BEFORE INSERT ON "OrderLine"
FOR EACH ROW EXECUTE FUNCTION enforce_order_line_draft_parent();

CREATE FUNCTION enforce_invoice_line_draft_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
BEGIN
  SELECT "status" INTO invoice_status FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR UPDATE;
  IF invoice_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'InvoiceLine cannot be added to a released Invoice'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_line_00_draft_parent_trigger
BEFORE INSERT ON "InvoiceLine"
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_line_draft_parent();

-- Immutable snapshots, events, audit evidence and ledgers are append-only.
DO $$
DECLARE
  protected_table text;
  trigger_number integer := 0;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'CandidateOnboardingEvent',
    'CompanyStatusEvent',
    'CompanyMembershipEvent',
    'CompanyInvitationEvent',
    'CompanyClaimEvent',
    'CompanyVerificationEvent',
    'JobScoreSnapshot',
    'JobStatusEvent',
    'JobAssignmentEvent',
    'JobReportingCheck',
    'ApplicationSubmissionSnapshot',
    'ApplicationSubmissionDocument',
    'ApplicationEvent',
    'JobAlertEvent',
    'JobAlertDigestItem',
    'CandidateConsent',
    'UserConsentEvent',
    'ContactRequestEvent',
    'IdentityRevealGrantField',
    'IdentityRevealConfirmation',
    'PrivacyRequestEvent',
    'AbuseReportEvent',
    'AuditLog',
    'AnalyticsEvent',
    'ClusterLaunchEvent',
    'SubscriptionEvent',
    'OrderLine',
    'InvoiceLine',
    'CreditLedgerEntry',
    'PaymentEvent',
    'SalesActivity',
    'ReferralAttribution',
    'RecruiterMandateEvent',
    'ContentEvent',
    'SupportCaseEvent'
  ] LOOP
    trigger_number := trigger_number + 1;
    EXECUTE format(
      'CREATE TRIGGER phase02_append_only_%s BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION phase02_raise_append_only()',
      trigger_number,
      protected_table
    );
  END LOOP;
END;
$$;
