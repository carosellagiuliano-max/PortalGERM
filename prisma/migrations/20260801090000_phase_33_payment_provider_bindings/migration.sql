-- Phase 33: explicit Stripe contract/sandbox/live identity, recurring price
-- bindings, durable subscription references, and a PII-minimised Resend/Svix
-- inbox. Historical migrations remain byte-for-byte immutable.

-- PostgreSQL DDL and the compatibility backfills below are deliberately one
-- atomic roll-forward unit. An interrupted deploy therefore leaves neither a
-- half-installed authority model nor partially backfilled provider evidence;
-- `prisma migrate deploy` can safely execute the unapplied migration again.
BEGIN;

CREATE TYPE "PaymentRuntimeMode" AS ENUM ('CONTRACT', 'SANDBOX', 'LIVE');
CREATE TYPE "PaymentCheckoutKind" AS ENUM ('ONE_TIME', 'SUBSCRIPTION');
CREATE TYPE "EmailProviderEventInboxStatus" AS ENUM ('RECEIVED', 'PROJECTED', 'IGNORED', 'FAILED');
CREATE TYPE "SubscriptionProviderInvoiceStatus" AS ENUM ('FAILED', 'PAID', 'CONFLICT');
CREATE TYPE "RefundPaymentSourceKind" AS ENUM ('INITIAL_ORDER', 'SUBSCRIPTION_PROVIDER_INVOICE');

ALTER TYPE "NotificationSuppressionReason" ADD VALUE 'PROVIDER_SUPPRESSION';
ALTER TYPE "PaymentEventKind" ADD VALUE 'RENEWAL_PAID';
ALTER TYPE "PaymentEventKind" ADD VALUE 'RENEWAL_FAILED';

CREATE TABLE "PaymentPriceBinding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planVersionId" UUID NOT NULL,
    "providerActivationId" UUID NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "adapterKey" VARCHAR(96) NOT NULL,
    "adapterVersion" VARCHAR(32) NOT NULL,
    "providerMode" "PaymentRuntimeMode" NOT NULL,
    "providerAccountReference" VARCHAR(128) NOT NULL,
    "providerPriceReference" VARCHAR(255) NOT NULL,
    "billingInterval" "BillingInterval" NOT NULL,
    "amountRappen" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "evidenceDigest" CHAR(64) NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentPriceBinding_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentAttempt"
  ADD COLUMN "adapterKey" VARCHAR(96),
  ADD COLUMN "adapterVersion" VARCHAR(32),
  ADD COLUMN "providerMode" "PaymentRuntimeMode",
  ADD COLUMN "checkoutKind" "PaymentCheckoutKind",
  ADD COLUMN "expectedLiveMode" BOOLEAN,
  ADD COLUMN "paymentPriceBindingId" UUID,
  ADD COLUMN "providerPriceReference" VARCHAR(255),
  ADD COLUMN "providerCustomerReference" VARCHAR(255),
  ADD COLUMN "providerSubscriptionReference" VARCHAR(255),
  ADD COLUMN "providerInvoiceReference" VARCHAR(255),
  ADD COLUMN "checkoutReservationToken" UUID,
  ADD COLUMN "checkoutReservationDigest" CHAR(64),
  ADD COLUMN "checkoutReservedAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastProviderEventRank" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WorkerHandlerActivation"
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "WorkItem"
  ADD COLUMN "leaseHandlerActivationId" UUID,
  ADD COLUMN "leaseHandlerActivationGeneration" INTEGER;

-- Every historical hosted attempt was produced by the Phase-24 one-time test
-- adapter. This explicit compatibility backfill does not promote it to a
-- recurring subscription or to LIVE evidence.
UPDATE "PaymentAttempt"
SET "adapterKey" = 'stripe_sandbox',
    "adapterVersion" = 'v1',
    "providerMode" = 'SANDBOX',
    "checkoutKind" = 'ONE_TIME',
    "expectedLiveMode" = false
WHERE "adapterKey" IS NULL;

UPDATE "PaymentAttempt"
SET "lastProviderEventRank" = CASE
  WHEN "status" = 'SUCCEEDED' THEN 100
  WHEN "status" IN ('FAILED', 'CANCELLED') THEN 30
  WHEN "status" = 'EXPIRED' THEN 20
  ELSE 10
END
WHERE "lastProviderEventAt" IS NOT NULL;

ALTER TABLE "PaymentAttempt"
  ALTER COLUMN "adapterKey" SET NOT NULL,
  ALTER COLUMN "adapterVersion" SET NOT NULL,
  ALTER COLUMN "providerMode" SET NOT NULL,
  ALTER COLUMN "checkoutKind" SET NOT NULL,
  ALTER COLUMN "expectedLiveMode" SET NOT NULL;

ALTER TABLE "ProviderEventInbox"
  ADD COLUMN "adapterKey" VARCHAR(96),
  ADD COLUMN "adapterVersion" VARCHAR(32),
  ADD COLUMN "providerMode" "PaymentRuntimeMode",
  ADD COLUMN "expectedLiveMode" BOOLEAN,
  ADD COLUMN "hydratedPaymentReference" VARCHAR(255),
  ADD COLUMN "hydrationEvidenceDigest" CHAR(64),
  ADD COLUMN "hydrationSource" VARCHAR(64),
  ADD COLUMN "hydratedAt" TIMESTAMPTZ(3);

UPDATE "ProviderEventInbox"
SET "adapterKey" = 'stripe_sandbox',
    "adapterVersion" = 'v1',
    "providerMode" = 'SANDBOX',
    "expectedLiveMode" = false
WHERE "adapterKey" IS NULL;

ALTER TABLE "ProviderEventInbox"
  ALTER COLUMN "adapterKey" SET NOT NULL,
  ALTER COLUMN "adapterVersion" SET NOT NULL,
  ALTER COLUMN "providerMode" SET NOT NULL,
  ALTER COLUMN "expectedLiveMode" SET NOT NULL;

ALTER TABLE "EmployerSubscription"
  ADD COLUMN "paymentProvider" "PaymentProvider",
  ADD COLUMN "paymentRuntimeMode" "PaymentRuntimeMode",
  ADD COLUMN "paymentAdapterKey" VARCHAR(96),
  ADD COLUMN "paymentAdapterVersion" VARCHAR(32),
  ADD COLUMN "providerAccountReference" VARCHAR(128),
  ADD COLUMN "providerCustomerReference" VARCHAR(255),
  ADD COLUMN "providerSubscriptionReference" VARCHAR(255),
  ADD COLUMN "providerPriceReference" VARCHAR(255),
  ADD COLUMN "providerRecurringAmountRappenSnapshot" INTEGER,
  ADD COLUMN "providerLastEventAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerStatusEventAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerStatusRank" INTEGER,
  ADD COLUMN "providerCancellationAt" TIMESTAMPTZ(3);

-- Freeze the exact rendered provider request before the first email network
-- effect. Existing outbox/attempt rows remain valid with a null snapshot;
-- Phase-33 sends bind encrypted material and non-reversible correlation
-- evidence to the exact persisted provider activation.
ALTER TABLE "NotificationOutbox"
  ADD COLUMN "providerRequestActivationId" UUID,
  ADD COLUMN "providerRequestCiphertext" BYTEA,
  ADD COLUMN "providerRequestNonce" BYTEA,
  ADD COLUMN "providerRequestTag" BYTEA,
  ADD COLUMN "providerRequestKeyVersion" VARCHAR(32),
  ADD COLUMN "providerRequestDigest" CHAR(64),
  ADD COLUMN "providerRequestCreatedAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerRequestDestroyedAt" TIMESTAMPTZ(3),
  ADD COLUMN "recipientAddressBindingVersion" VARCHAR(16),
  ADD COLUMN "recipientAddressDigest" CHAR(64),
  ADD COLUMN "recipientAddressDigestKeyVersion" VARCHAR(32),
  ADD COLUMN "recipientAddressExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "recipientAddressDestroyedAt" TIMESTAMPTZ(3);

-- Historical explicit-address rows used the v1 global-AAD envelope. Keep
-- those rows readable for a bounded compatibility window, but never invent a
-- v2 row binding or lookup digest that cannot be derived without plaintext.
-- A far-future availableAt value is capped so the backfill cannot perpetuate
-- an unbounded address-retention promise.
UPDATE "NotificationOutbox"
SET "recipientAddressExpiresAt" =
  LEAST(
    GREATEST("availableAt", "createdAt") + interval '23 hours',
    "createdAt" + interval '31 days'
  )
WHERE "recipientUserId" IS NULL;

ALTER TABLE "NotificationDeliveryAttempt"
  ADD COLUMN "providerActivationId" UUID,
  ADD COLUMN "providerRequestDigest" CHAR(64),
  ADD COLUMN "recipientHash" CHAR(64),
  ADD COLUMN "recipientHashKeyVersion" VARCHAR(32),
  ADD COLUMN "recipientEvidenceRetainUntil" TIMESTAMPTZ(3),
  ADD COLUMN "recipientEvidenceWipedAt" TIMESTAMPTZ(3);

-- Phase 20 made attempts wholly append-only. Phase 33 preserves that audit
-- contract but introduces one narrowly-scoped, irreversible PII compaction.
-- The legacy trigger must be removed before the finite upgrade backfill; a
-- stricter replacement is installed below in the same atomic migration.
DROP TRIGGER "notification_delivery_attempt_append_only"
  ON "NotificationDeliveryAttempt";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "NotificationDeliveryAttempt"
    WHERE NOT isfinite("completedAt")
       OR NOT isfinite("completedAt" + interval '9600 hours')
  ) THEN
    RAISE EXCEPTION 'notification delivery attempt retention cannot be finitely backfilled'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_delivery_attempt_retention_upgrade';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 9,600 hours is exactly 400 x 24 hours and therefore independent of the
-- database session time zone or daylight-saving transitions.
UPDATE "NotificationDeliveryAttempt"
SET "recipientEvidenceRetainUntil" = "completedAt" + interval '9600 hours';

-- An upgrade may encounter evidence whose approved window already elapsed.
-- Compact it in the migration transaction instead of briefly exposing stale
-- PII after cutover. The immutable operational chain remains intact.
UPDATE "NotificationDeliveryAttempt"
SET "providerReceipt" = NULL,
    "providerRequestDigest" = NULL,
    "recipientHash" = NULL,
    "recipientHashKeyVersion" = NULL,
    "recipientEvidenceWipedAt" = date_trunc('milliseconds', CURRENT_TIMESTAMP)
WHERE "recipientEvidenceRetainUntil" <= CURRENT_TIMESTAMP;

ALTER TABLE "NotificationDeliveryAttempt"
  ALTER COLUMN "recipientEvidenceRetainUntil" SET NOT NULL;

ALTER TABLE "NotificationSuppression"
  ADD COLUMN "recipientHashKeyVersion" VARCHAR(32);

-- Every existing Phase-24 refund points at the initial PaymentAttempt. Bind
-- its immutable charge authority before the columns become mandatory. A
-- malformed legacy row without a provider payment reference deliberately
-- aborts the atomic migration instead of receiving invented evidence.
ALTER TABLE "Refund"
  ADD COLUMN "subscriptionProviderInvoiceId" UUID,
  ADD COLUMN "sourceKind" "RefundPaymentSourceKind" NOT NULL DEFAULT 'INITIAL_ORDER',
  ADD COLUMN "sourceProviderPaymentReference" VARCHAR(255),
  ADD COLUMN "sourceAmountRappen" INTEGER;

UPDATE "Refund" refund
SET "sourceProviderPaymentReference" = attempt."providerPaymentReference",
    "sourceAmountRappen" = attempt."amountRappen"
FROM "PaymentAttempt" attempt
WHERE attempt."id" = refund."paymentAttemptId";

ALTER TABLE "Refund"
  ALTER COLUMN "invoiceId" DROP NOT NULL,
  ALTER COLUMN "sourceProviderPaymentReference" SET NOT NULL,
  ALTER COLUMN "sourceAmountRappen" SET NOT NULL;

ALTER TABLE "CreditNote"
  ADD COLUMN "subscriptionProviderInvoiceId" UUID,
  ALTER COLUMN "invoiceId" DROP NOT NULL;

CREATE TABLE "EmailProviderEventInbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "environment" VARCHAR(32) NOT NULL,
    "adapterKey" VARCHAR(96) NOT NULL,
    "adapterVersion" VARCHAR(32) NOT NULL,
    "providerActivationId" UUID NOT NULL,
    "svixId" VARCHAR(255) NOT NULL,
    "providerReceipt" VARCHAR(255) NOT NULL,
    "recipientHashes" TEXT[] NOT NULL,
    "recipientHashesWipedAt" TIMESTAMPTZ(3),
    "eventType" VARCHAR(96) NOT NULL,
    "eventCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadDigest" CHAR(64) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "status" "EmailProviderEventInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailProviderEventInbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionProviderInvoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscriptionId" UUID NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "adapterKey" VARCHAR(96) NOT NULL,
    "adapterVersion" VARCHAR(32) NOT NULL,
    "providerMode" "PaymentRuntimeMode" NOT NULL,
    "providerAccountReference" VARCHAR(128) NOT NULL,
    "providerSubscriptionReference" VARCHAR(255) NOT NULL,
    "providerInvoiceReference" VARCHAR(255) NOT NULL,
    "status" "SubscriptionProviderInvoiceStatus" NOT NULL,
    "amountRappen" INTEGER,
    "currency" CHAR(3),
    "providerPaymentReference" VARCHAR(255),
    "periodStart" TIMESTAMPTZ(3),
    "periodEnd" TIMESTAMPTZ(3),
    "firstFailureAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "conflictedAt" TIMESTAMPTZ(3),
    "paidProjectionDigest" CHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionProviderInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentPriceBinding_providerActivationId_planVersionId_key"
  ON "PaymentPriceBinding"("providerActivationId", "planVersionId");
CREATE UNIQUE INDEX "PaymentPriceBinding_environment_adapterKey_account_price_key"
  ON "PaymentPriceBinding"("environment", "adapterKey", "providerAccountReference", "providerPriceReference");
CREATE INDEX "PaymentPriceBinding_plan_environment_mode_effective_idx"
  ON "PaymentPriceBinding"("planVersionId", "environment", "providerMode", "effectiveAt", "expiresAt");
CREATE UNIQUE INDEX "payment_price_binding_unbounded_active_scope_key"
  ON "PaymentPriceBinding"("planVersionId", "environment", "adapterKey", "providerAccountReference")
  WHERE "revokedAt" IS NULL AND "expiresAt" IS NULL;

CREATE INDEX "PaymentAttempt_providerSubscriptionReference_lastProviderEventAt_idx"
  ON "PaymentAttempt"("providerSubscriptionReference", "lastProviderEventAt");
CREATE UNIQUE INDEX "PaymentAttempt_id_companyId_key"
  ON "PaymentAttempt"("id", "companyId");
CREATE UNIQUE INDEX "payment_attempt_provider_invoice_key"
  ON "PaymentAttempt"("environment", "providerAccountReference", "providerInvoiceReference")
  WHERE "providerInvoiceReference" IS NOT NULL;
CREATE UNIQUE INDEX "PaymentAttempt_checkoutReservationToken_key"
  ON "PaymentAttempt"("checkoutReservationToken");
CREATE UNIQUE INDEX "payment_attempt_open_subscription_order_key"
  ON "PaymentAttempt"("orderId")
  WHERE "checkoutKind" = 'SUBSCRIPTION'
    AND "status" IN ('CREATED', 'CHECKOUT_CREATED', 'PENDING', 'HELD');

CREATE UNIQUE INDEX "ProviderEventInbox_provider_environment_adapter_account_event_key"
  ON "ProviderEventInbox"("provider", "environment", "adapterKey", "providerAccountReference", "providerEventId");

CREATE INDEX "WorkItem_leaseHandlerActivationId_generation_idx"
  ON "WorkItem"("leaseHandlerActivationId", "leaseHandlerActivationGeneration");

CREATE UNIQUE INDEX "EmployerSubscription_providerSubscriptionReference_key"
  ON "EmployerSubscription"("providerSubscriptionReference");
CREATE INDEX "employer_subscription_provider_customer_idx"
  ON "EmployerSubscription"("paymentProvider", "providerAccountReference", "providerCustomerReference")
  WHERE "providerCustomerReference" IS NOT NULL;

CREATE UNIQUE INDEX "EmailProviderEventInbox_environment_adapterKey_svixId_key"
  ON "EmailProviderEventInbox"("environment", "adapterKey", "svixId");
CREATE INDEX "EmailProviderEventInbox_status_receivedAt_id_idx"
  ON "EmailProviderEventInbox"("status", "receivedAt", "id");
CREATE INDEX "EmailProviderEventInbox_providerReceipt_eventCreatedAt_id_idx"
  ON "EmailProviderEventInbox"("providerReceipt", "eventCreatedAt", "id");
CREATE INDEX "EmailProviderEventInbox_providerActivationId_status_receivedAt_idx"
  ON "EmailProviderEventInbox"("providerActivationId", "status", "receivedAt");

CREATE INDEX "NotificationOutbox_providerRequestActivationId_status_createdAt_idx"
  ON "NotificationOutbox"("providerRequestActivationId", "status", "createdAt");
CREATE INDEX "NotificationOutbox_providerRequestDestroyedAt_providerRequestCreatedAt_status_idx"
  ON "NotificationOutbox"("providerRequestDestroyedAt", "providerRequestCreatedAt", "status");
CREATE INDEX "NotificationOutbox_recipientAddressDestroyedAt_status_createdAt_idx"
  ON "NotificationOutbox"("recipientAddressDestroyedAt", "status", "createdAt");
CREATE INDEX "NotificationDeliveryAttempt_providerReceipt_providerClass_providerActivationId_idx"
  ON "NotificationDeliveryAttempt"("providerReceipt", "providerClass", "providerActivationId");
CREATE INDEX "notification_attempt_evidence_retention_idx"
  ON "NotificationDeliveryAttempt"("recipientEvidenceWipedAt", "recipientEvidenceRetainUntil");

CREATE UNIQUE INDEX "subscription_provider_invoice_provider_scope_key"
  ON "SubscriptionProviderInvoice"("provider", "environment", "adapterKey", "providerAccountReference", "providerInvoiceReference");
CREATE INDEX "subscription_provider_invoice_subscription_status_period_idx"
  ON "SubscriptionProviderInvoice"("subscriptionId", "status", "periodStart", "id");
CREATE INDEX "subscription_provider_invoice_company_status_created_idx"
  ON "SubscriptionProviderInvoice"("companyId", "status", "createdAt", "id");
CREATE INDEX "subscription_provider_invoice_attempt_created_idx"
  ON "SubscriptionProviderInvoice"("paymentAttemptId", "createdAt", "id");
CREATE INDEX "Refund_subscriptionProviderInvoiceId_status_requestedAt_id_idx"
  ON "Refund"("subscriptionProviderInvoiceId", "status", "requestedAt", "id");

ALTER TABLE "PaymentPriceBinding"
  ADD CONSTRAINT "PaymentPriceBinding_planVersionId_fkey"
    FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentPriceBinding_providerActivationId_fkey"
    FOREIGN KEY ("providerActivationId") REFERENCES "ProviderActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_paymentPriceBindingId_fkey"
    FOREIGN KEY ("paymentPriceBindingId") REFERENCES "PaymentPriceBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkItem"
  ADD CONSTRAINT "WorkItem_leaseHandlerActivationId_fkey"
    FOREIGN KEY ("leaseHandlerActivationId") REFERENCES "WorkerHandlerActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionProviderInvoice"
  ADD CONSTRAINT "SubscriptionProviderInvoice_subscription_company_fkey"
    FOREIGN KEY ("subscriptionId", "companyId") REFERENCES "EmployerSubscription"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SubscriptionProviderInvoice_paymentAttemptId_companyId_fkey"
    FOREIGN KEY ("paymentAttemptId", "companyId") REFERENCES "PaymentAttempt"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SubscriptionProviderInvoice_order_company_fkey"
    FOREIGN KEY ("orderId", "companyId") REFERENCES "Order"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SubscriptionProviderInvoice_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_subscriptionProviderInvoiceId_fkey"
    FOREIGN KEY ("subscriptionProviderInvoiceId") REFERENCES "SubscriptionProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditNote"
  ADD CONSTRAINT "CreditNote_subscriptionProviderInvoiceId_fkey"
    FOREIGN KEY ("subscriptionProviderInvoiceId") REFERENCES "SubscriptionProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_providerRequestActivationId_fkey"
    FOREIGN KEY ("providerRequestActivationId") REFERENCES "ProviderActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt"
  ADD CONSTRAINT "NotificationDeliveryAttempt_providerActivationId_fkey"
    FOREIGN KEY ("providerActivationId") REFERENCES "ProviderActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailProviderEventInbox"
  ADD CONSTRAINT "EmailProviderEventInbox_providerActivationId_fkey"
    FOREIGN KEY ("providerActivationId") REFERENCES "ProviderActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentPriceBinding"
  ADD CONSTRAINT "payment_price_binding_authority_check" CHECK (
    "amountRappen" > 0
    AND "currency" = 'CHF'
    AND "billingInterval" = 'MONTHLY'
    AND "adapterVersion" ~ '^v[1-9][0-9]*$'
    AND "providerAccountReference" ~ '^acct_[A-Za-z0-9]{8,}$'
    AND "providerPriceReference" ~ '^price_[A-Za-z0-9]{8,}$'
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
    AND ("expiresAt" IS NULL OR "effectiveAt" < "expiresAt")
    AND ("revokedAt" IS NULL OR "revokedAt" >= "effectiveAt")
    AND (
      ("providerMode" = 'CONTRACT' AND "adapterKey" = 'stripe_contract' AND "environment" = 'ci')
      OR (
        "providerMode" = 'SANDBOX'
        AND "adapterKey" = 'stripe_sandbox'
        AND "environment" IN ('local', 'ci', 'staging')
      )
      OR (
        "providerMode" = 'LIVE'
        AND "adapterKey" = 'stripe_live'
        AND "environment" = 'production'
      )
    )
  );

ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "payment_attempt_authority_check";
ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "payment_attempt_state_check";
ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "payment_attempt_authority_check" CHECK (
    "provider" = 'STRIPE'
    AND "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
    AND "amountRappen" > 0
    AND "currency" = 'CHF'
    AND "quoteDigest" ~ '^[a-f0-9]{64}$'
    AND "createdAt" < "expiresAt"
    AND (
      (
        "providerMode" = 'CONTRACT'
        AND "adapterKey" = 'stripe_contract'
        AND "expectedLiveMode" = false
        AND "environment" = 'ci'
      )
      OR (
        "providerMode" = 'SANDBOX'
        AND "adapterKey" = 'stripe_sandbox'
        AND "expectedLiveMode" = false
        AND "environment" IN ('local', 'ci', 'staging')
      )
      OR (
        "providerMode" = 'LIVE'
        AND "adapterKey" = 'stripe_live'
        AND "expectedLiveMode" = true
        AND "environment" = 'production'
      )
    )
    AND (
      "checkoutKind" = 'ONE_TIME'
      OR (
        "checkoutKind" = 'SUBSCRIPTION'
        AND "paymentPriceBindingId" IS NOT NULL
        AND "providerPriceReference" IS NOT NULL
      )
    )
  ),
  ADD CONSTRAINT "payment_attempt_state_check" CHECK (
    ("status" = 'CHECKOUT_CREATED' AND "providerSessionReference" IS NOT NULL)
    OR (
      "status" = 'SUCCEEDED'
      AND "providerPaymentReference" IS NOT NULL
      AND (
        "checkoutKind" = 'ONE_TIME'
        OR (
          "providerCustomerReference" IS NOT NULL
          AND "providerSubscriptionReference" IS NOT NULL
        )
      )
    )
    OR ("status" IN ('FAILED', 'HELD') AND "failureCode" IS NOT NULL)
    OR ("status" IN ('CREATED', 'PENDING', 'CANCELLED', 'EXPIRED'))
  ),
  ADD CONSTRAINT "payment_attempt_provider_ordering_check" CHECK (
    "lastProviderEventRank" BETWEEN 0 AND 100
    AND (
      ("lastProviderEventAt" IS NULL AND "lastProviderEventRank" = 0)
      OR ("lastProviderEventAt" IS NOT NULL AND "lastProviderEventRank" > 0)
    )
  ),
  ADD CONSTRAINT "payment_attempt_checkout_reservation_check" CHECK (
    (
      "checkoutReservationToken" IS NULL
      AND "checkoutReservationDigest" IS NULL
      AND "checkoutReservedAt" IS NULL
    )
    OR (
      "checkoutReservationToken" IS NOT NULL
      AND "checkoutReservationDigest" ~ '^[a-f0-9]{64}$'
      AND "checkoutReservedAt" IS NOT NULL
      AND "checkoutKind" = 'SUBSCRIPTION'
      AND "paymentPriceBindingId" IS NOT NULL
      AND "providerPriceReference" IS NOT NULL
    )
  );

ALTER TABLE "WorkerHandlerActivation"
  ADD CONSTRAINT "worker_handler_activation_generation_check" CHECK (
    "generation" > 0
  );

ALTER TABLE "WorkItem"
  ADD CONSTRAINT "work_item_activation_lease_binding_check" CHECK (
    ("leaseHandlerActivationId" IS NULL) = ("leaseHandlerActivationGeneration" IS NULL)
    AND ("leaseHandlerActivationGeneration" IS NULL OR "leaseHandlerActivationGeneration" > 0)
  );

ALTER TABLE "ProviderEventInbox" DROP CONSTRAINT "provider_event_inbox_evidence_check";
ALTER TABLE "ProviderEventInbox"
  ADD CONSTRAINT "provider_event_inbox_evidence_check" CHECK (
    "provider" = 'STRIPE'
    AND "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
    AND "liveMode" = "expectedLiveMode"
    AND "rawBodyDigest" ~ '^[a-f0-9]{64}$'
    AND "signatureDigest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("normalizedPayload") = 'object'
    AND octet_length("normalizedPayload"::text) <= 32768
    AND "attemptCount" BETWEEN 0 AND 64
    AND (
      (
        "hydratedPaymentReference" IS NULL
        AND "hydrationEvidenceDigest" IS NULL
        AND "hydrationSource" IS NULL
        AND "hydratedAt" IS NULL
      )
      OR (
        "hydratedPaymentReference" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$'
        AND "hydrationEvidenceDigest" ~ '^[a-f0-9]{64}$'
        AND "hydrationSource" = 'STRIPE_INVOICE_PAYMENTS_LIST_V1'
        AND "hydratedAt" IS NOT NULL
        AND "hydratedAt" >= "receivedAt"
        AND "eventType" IN ('invoice.paid', 'invoice.payment_succeeded')
      )
    )
    AND (
      (
        "providerMode" = 'CONTRACT'
        AND "adapterKey" = 'stripe_contract'
        AND "expectedLiveMode" = false
        AND "environment" = 'ci'
      )
      OR (
        "providerMode" = 'SANDBOX'
        AND "adapterKey" = 'stripe_sandbox'
        AND "expectedLiveMode" = false
        AND "environment" IN ('local', 'ci', 'staging')
      )
      OR (
        "providerMode" = 'LIVE'
        AND "adapterKey" = 'stripe_live'
        AND "expectedLiveMode" = true
        AND "environment" = 'production'
      )
    )
  );

ALTER TABLE "EmployerSubscription"
  ADD CONSTRAINT "employer_subscription_provider_binding_check" CHECK (
    (
      "paymentProvider" IS NULL
      AND "paymentRuntimeMode" IS NULL
      AND "paymentAdapterKey" IS NULL
      AND "paymentAdapterVersion" IS NULL
      AND "providerAccountReference" IS NULL
      AND "providerCustomerReference" IS NULL
      AND "providerSubscriptionReference" IS NULL
      AND "providerPriceReference" IS NULL
      AND "providerRecurringAmountRappenSnapshot" IS NULL
      AND "providerLastEventAt" IS NULL
      AND "providerStatusEventAt" IS NULL
      AND "providerStatusRank" IS NULL
      AND "providerCancellationAt" IS NULL
    )
    OR (
      "paymentProvider" = 'STRIPE'
      AND "paymentRuntimeMode" IS NOT NULL
      AND "paymentAdapterKey" IS NOT NULL
      AND "paymentAdapterVersion" IS NOT NULL
      AND "providerAccountReference" IS NOT NULL
      AND "providerCustomerReference" IS NOT NULL
      AND "providerSubscriptionReference" IS NOT NULL
      AND "providerPriceReference" IS NOT NULL
      AND "providerRecurringAmountRappenSnapshot" > 0
      AND "providerLastEventAt" IS NOT NULL
      AND "providerStatusEventAt" IS NOT NULL
      AND "providerStatusRank" IN (10, 30, 40, 100)
      AND "providerStatusEventAt" <= "providerLastEventAt"
      AND (
        ("providerStatusRank" = 100 AND "providerCancellationAt" IS NOT NULL AND "status" = 'CANCELLED')
        OR ("providerStatusRank" <> 100 AND "providerCancellationAt" IS NULL)
      )
      AND (
        ("paymentRuntimeMode" = 'CONTRACT' AND "paymentAdapterKey" = 'stripe_contract')
        OR ("paymentRuntimeMode" = 'SANDBOX' AND "paymentAdapterKey" = 'stripe_sandbox')
        OR ("paymentRuntimeMode" = 'LIVE' AND "paymentAdapterKey" = 'stripe_live')
      )
    )
  );

ALTER TABLE "Refund" DROP CONSTRAINT "refund_money_check";
ALTER TABLE "Refund"
  ADD CONSTRAINT "refund_money_check" CHECK (
    "amountRappen" > 0
    AND "sourceAmountRappen" > 0
    AND "amountRappen" <= "sourceAmountRappen"
    AND "currency" = 'CHF'
    AND "reasonCode" ~ '^[A-Z][A-Z0-9_]{1,63}$'
    AND "sourceProviderPaymentReference" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$'
  ),
  ADD CONSTRAINT "refund_payment_source_check" CHECK (
    (
      "sourceKind" = 'INITIAL_ORDER'
      AND "invoiceId" IS NOT NULL
      AND "subscriptionProviderInvoiceId" IS NULL
    )
    OR (
      "sourceKind" = 'SUBSCRIPTION_PROVIDER_INVOICE'
      AND "invoiceId" IS NULL
      AND "subscriptionProviderInvoiceId" IS NOT NULL
    )
  );

ALTER TABLE "CreditNote" DROP CONSTRAINT "credit_note_money_state_check";
ALTER TABLE "CreditNote"
  ADD CONSTRAINT "credit_note_money_state_check" CHECK (
    "amountRappen" > 0
    AND "currency" = 'CHF'
    AND (
      ("invoiceId" IS NOT NULL AND "subscriptionProviderInvoiceId" IS NULL)
      OR ("invoiceId" IS NULL AND "subscriptionProviderInvoiceId" IS NOT NULL)
    )
    AND (
      ("status" = 'ISSUED' AND "voidedAt" IS NULL)
      OR ("status" = 'VOID' AND "voidedAt" IS NOT NULL)
    )
  );

-- NotificationSuppression predates Phase 33. Its valid legacy SHA-256 values
-- already match the authenticated-HMAC storage shape, so no rewrite or key
-- version can be invented without plaintext. New rows are required to record
-- their authenticated-HMAC key version. Abort explicitly if an older
-- deployment ever admitted another shape or duplicate active suppressions
-- instead of silently legitimising it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "NotificationSuppression"
    WHERE "recipientHash" !~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'legacy notification suppression contains a non-hash recipient value'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_suppression_recipient_hash_upgrade';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "NotificationSuppression"
    WHERE "releasedAt" IS NULL
    GROUP BY "recipientHash"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'legacy notification suppression contains duplicate active recipient hashes'
      USING ERRCODE = '23505', CONSTRAINT = 'notification_suppression_active_recipient_upgrade';
  END IF;
END;
$$;

ALTER TABLE "NotificationSuppression"
  ADD CONSTRAINT "notification_suppression_recipient_hash_check" CHECK (
    "recipientHash" ~ '^[a-f0-9]{64}$'
    AND (
      "recipientHashKeyVersion" IS NULL
      OR "recipientHashKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
    )
  );

-- Phase 20 already installs this exact partial uniqueness contract. Keeping
-- the declaration idempotent here documents and verifies the Phase-33
-- upgrade boundary after the explicit duplicate preflight above.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_suppression_active_recipient_unique"
  ON "NotificationSuppression"("recipientHash")
  WHERE "releasedAt" IS NULL;

ALTER TABLE "SubscriptionProviderInvoice"
  ADD CONSTRAINT "subscription_provider_invoice_projection_check" CHECK (
    "provider" = 'STRIPE'
    AND "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
    AND "adapterVersion" ~ '^v[1-9][0-9]*$'
    AND "providerAccountReference" ~ '^acct_[A-Za-z0-9]{8,}$'
    AND "providerSubscriptionReference" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$'
    AND "providerInvoiceReference" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$'
    AND (
      ("providerMode" = 'CONTRACT' AND "adapterKey" = 'stripe_contract' AND "environment" = 'ci')
      OR ("providerMode" = 'SANDBOX' AND "adapterKey" = 'stripe_sandbox' AND "environment" IN ('local', 'ci', 'staging'))
      OR ("providerMode" = 'LIVE' AND "adapterKey" = 'stripe_live' AND "environment" = 'production')
    )
    AND (
      (
        "status" = 'FAILED'
        AND "firstFailureAt" IS NOT NULL
        AND "amountRappen" IS NULL
        AND "currency" IS NULL
        AND "providerPaymentReference" IS NULL
        AND "periodStart" IS NULL
        AND "periodEnd" IS NULL
        AND "paidAt" IS NULL
        AND "conflictedAt" IS NULL
        AND "paidProjectionDigest" IS NULL
      )
      OR (
        "status" = 'PAID'
        AND "amountRappen" > 0
        AND "currency" = 'CHF'
        AND "providerPaymentReference" IS NOT NULL
        AND "periodStart" IS NOT NULL
        AND "periodEnd" > "periodStart"
        AND "paidAt" IS NOT NULL
        AND "conflictedAt" IS NULL
        AND "paidProjectionDigest" ~ '^[a-f0-9]{64}$'
      )
      OR (
        "status" = 'CONFLICT'
        AND "conflictedAt" IS NOT NULL
        AND "paidProjectionDigest" ~ '^[a-f0-9]{64}$'
      )
    )
  );

ALTER TABLE "EmailProviderEventInbox"
  ADD CONSTRAINT "email_provider_event_inbox_envelope_check" CHECK (
    "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
    AND "adapterKey" ~ '^[a-z][a-z0-9_-]{2,95}$'
    AND "adapterVersion" ~ '^v[1-9][0-9]*$'
    AND "svixId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$'
    AND "providerReceipt" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$'
    AND "eventType" ~ '^[a-z][a-z0-9._-]{2,95}$'
    AND "payloadDigest" ~ '^[a-f0-9]{64}$'
    AND "eventCreatedAt" <= "receivedAt" + interval '5 minutes'
    AND (
      (
        "status" = 'RECEIVED'
        AND "processedAt" IS NULL
        AND cardinality("recipientHashes") BETWEEN 1 AND 250
        AND array_position("recipientHashes", NULL) IS NULL
        AND "recipientHashes"::text ~ '^\{[a-f0-9]{64}(,[a-f0-9]{64})*\}$'
        AND "recipientHashesWipedAt" IS NULL
      )
      OR (
        "status" IN ('PROJECTED', 'IGNORED', 'FAILED')
        AND "processedAt" IS NOT NULL
        AND isfinite("processedAt")
        AND "processedAt" >= "receivedAt"
        AND cardinality("recipientHashes") = 0
        AND "recipientHashesWipedAt" IS NOT NULL
        AND isfinite("recipientHashesWipedAt")
        AND "recipientHashesWipedAt" >= "receivedAt"
      )
    )
  );

ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT "notification_outbox_recipient_shape";

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "notification_outbox_recipient_shape" CHECK (
    -- User-address resolution remains late-bound and therefore stores no
    -- explicit recipient material or retention metadata.
    (
      "recipientUserId" IS NOT NULL
      AND num_nonnulls(
        "recipientAddressCiphertext",
        "recipientAddressNonce",
        "recipientAddressTag",
        "recipientAddressKeyVersion",
        "recipientAddressBindingVersion",
        "recipientAddressDigest",
        "recipientAddressDigestKeyVersion",
        "recipientAddressExpiresAt",
        "recipientAddressDestroyedAt"
      ) = 0
    )
    OR
    -- Read-only compatibility shape for pre-Phase-33 v1 envelopes. The
    -- INSERT guard below forbids creation of another legacy row.
    (
      "recipientUserId" IS NULL
      AND num_nonnulls(
        "recipientAddressCiphertext",
        "recipientAddressNonce",
        "recipientAddressTag",
        "recipientAddressKeyVersion",
        "recipientAddressExpiresAt"
      ) = 5
      AND num_nonnulls(
        "recipientAddressBindingVersion",
        "recipientAddressDigest",
        "recipientAddressDigestKeyVersion",
        "recipientAddressDestroyedAt"
      ) = 0
      AND octet_length("recipientAddressCiphertext") BETWEEN 1 AND 4096
      AND octet_length("recipientAddressNonce") = 12
      AND octet_length("recipientAddressTag") = 16
      AND "recipientAddressKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
      AND isfinite("recipientAddressExpiresAt")
    )
    OR
    -- Every new explicit-address envelope is bound through AES-GCM AAD to
    -- its row identity, dedupe key, template and immutable finite deadline.
    (
      "recipientUserId" IS NULL
      AND num_nonnulls(
        "recipientAddressCiphertext",
        "recipientAddressNonce",
        "recipientAddressTag",
        "recipientAddressKeyVersion",
        "recipientAddressBindingVersion",
        "recipientAddressDigest",
        "recipientAddressDigestKeyVersion",
        "recipientAddressExpiresAt"
      ) = 8
      AND "recipientAddressDestroyedAt" IS NULL
      AND "recipientAddressBindingVersion" = 'v2'
      AND "recipientAddressDigest" ~ '^[a-f0-9]{64}$'
      AND "recipientAddressDigestKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
      AND octet_length("recipientAddressCiphertext") BETWEEN 1 AND 4096
      AND octet_length("recipientAddressNonce") = 12
      AND octet_length("recipientAddressTag") = 16
      AND "recipientAddressKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
      AND isfinite("recipientAddressExpiresAt")
    )
    OR
    -- Logical destruction retains only the immutable finite deadline needed
    -- for evidence and proves that all decryptable/lookup material is gone.
    (
      "recipientUserId" IS NULL
      AND num_nonnulls(
        "recipientAddressCiphertext",
        "recipientAddressNonce",
        "recipientAddressTag",
        "recipientAddressKeyVersion",
        "recipientAddressBindingVersion",
        "recipientAddressDigest",
        "recipientAddressDigestKeyVersion"
      ) = 0
      AND "recipientAddressExpiresAt" IS NOT NULL
      AND isfinite("recipientAddressExpiresAt")
      AND "recipientAddressDestroyedAt" IS NOT NULL
      AND isfinite("recipientAddressDestroyedAt")
    )
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "notification_provider_request_snapshot_check" CHECK (
    (
      "providerRequestActivationId" IS NULL
      AND "providerRequestCiphertext" IS NULL
      AND "providerRequestNonce" IS NULL
      AND "providerRequestTag" IS NULL
      AND "providerRequestKeyVersion" IS NULL
      AND "providerRequestDigest" IS NULL
      AND "providerRequestCreatedAt" IS NULL
      AND "providerRequestDestroyedAt" IS NULL
    )
    OR (
      num_nonnulls(
        "providerRequestActivationId",
        "providerRequestDigest",
        "providerRequestCreatedAt",
        "providerRequestKeyVersion"
      ) = 4
      AND "providerRequestDigest" ~ '^[a-f0-9]{64}$'
      AND "providerRequestKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
      AND (
        (
          num_nonnulls(
            "providerRequestCiphertext",
            "providerRequestNonce",
            "providerRequestTag"
          ) = 3
          AND "providerRequestDestroyedAt" IS NULL
          AND octet_length("providerRequestCiphertext") BETWEEN 1 AND 65536
          AND octet_length("providerRequestNonce") = 12
          AND octet_length("providerRequestTag") = 16
        )
        OR (
          num_nonnulls(
            "providerRequestCiphertext",
            "providerRequestNonce",
            "providerRequestTag"
          ) = 0
          AND "providerRequestDestroyedAt" IS NOT NULL
          AND "providerRequestDestroyedAt" >= "providerRequestCreatedAt"
        )
      )
    )
  );

ALTER TABLE "NotificationDeliveryAttempt"
  ADD CONSTRAINT "notification_delivery_attempt_provider_evidence_check" CHECK (
    "recipientEvidenceWipedAt" IS NOT NULL
    OR (
      (("providerActivationId" IS NULL) = ("providerRequestDigest" IS NULL))
      AND ("providerRequestDigest" IS NULL OR "providerRequestDigest" ~ '^[a-f0-9]{64}$')
      AND (
        (
          "recipientHash" IS NULL
          AND "recipientHashKeyVersion" IS NULL
        )
        OR (
          "recipientHash" ~ '^[a-f0-9]{64}$'
          AND "recipientHashKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
        )
      )
      AND (
        "outcome" <> 'ACCEPTED'
        OR "providerActivationId" IS NULL
        OR (
          "providerReceipt" IS NOT NULL
          AND "providerRequestDigest" IS NOT NULL
          AND "recipientHash" IS NOT NULL
          AND "recipientHashKeyVersion" IS NOT NULL
        )
      )
    )
  );

ALTER TABLE "NotificationDeliveryAttempt"
  ADD CONSTRAINT "notification_attempt_evidence_retention_check" CHECK (
    isfinite("completedAt")
    AND isfinite("recipientEvidenceRetainUntil")
    AND "recipientEvidenceRetainUntil" = "completedAt" + interval '9600 hours'
    AND (
      "recipientEvidenceWipedAt" IS NULL
      OR (
        isfinite("recipientEvidenceWipedAt")
        AND "recipientEvidenceWipedAt" >= "recipientEvidenceRetainUntil"
        AND "providerReceipt" IS NULL
        AND "providerRequestDigest" IS NULL
        AND "recipientHash" IS NULL
        AND "recipientHashKeyVersion" IS NULL
      )
    )
  );

CREATE OR REPLACE FUNCTION phase33_guard_payment_price_binding()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."planVersionId" IS DISTINCT FROM OLD."planVersionId"
     OR NEW."providerActivationId" IS DISTINCT FROM OLD."providerActivationId"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."adapterKey" IS DISTINCT FROM OLD."adapterKey"
     OR NEW."adapterVersion" IS DISTINCT FROM OLD."adapterVersion"
     OR NEW."providerMode" IS DISTINCT FROM OLD."providerMode"
     OR NEW."providerAccountReference" IS DISTINCT FROM OLD."providerAccountReference"
     OR NEW."providerPriceReference" IS DISTINCT FROM OLD."providerPriceReference"
     OR NEW."billingInterval" IS DISTINCT FROM OLD."billingInterval"
     OR NEW."amountRappen" IS DISTINCT FROM OLD."amountRappen"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."evidenceDigest" IS DISTINCT FROM OLD."evidenceDigest"
     OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
  THEN
    RAISE EXCEPTION 'payment price binding authority is immutable; supersede it with a new activation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_payment_price_binding_guard
BEFORE UPDATE OR DELETE ON "PaymentPriceBinding"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_payment_price_binding();

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
     OR NEW."adapterKey" IS DISTINCT FROM OLD."adapterKey"
     OR NEW."adapterVersion" IS DISTINCT FROM OLD."adapterVersion"
     OR NEW."providerMode" IS DISTINCT FROM OLD."providerMode"
     OR NEW."checkoutKind" IS DISTINCT FROM OLD."checkoutKind"
     OR NEW."expectedLiveMode" IS DISTINCT FROM OLD."expectedLiveMode"
     OR NEW."providerAccountReference" IS DISTINCT FROM OLD."providerAccountReference"
     OR NEW."paymentPriceBindingId" IS DISTINCT FROM OLD."paymentPriceBindingId"
     OR NEW."providerPriceReference" IS DISTINCT FROM OLD."providerPriceReference"
     OR NEW."attemptKey" IS DISTINCT FROM OLD."attemptKey"
     OR NEW."quoteDigest" IS DISTINCT FROM OLD."quoteDigest"
     OR NEW."amountRappen" IS DISTINCT FROM OLD."amountRappen"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR (OLD."providerCustomerReference" IS NOT NULL AND NEW."providerCustomerReference" IS DISTINCT FROM OLD."providerCustomerReference")
     OR (OLD."providerSubscriptionReference" IS NOT NULL AND NEW."providerSubscriptionReference" IS DISTINCT FROM OLD."providerSubscriptionReference")
     OR (OLD."providerInvoiceReference" IS NOT NULL AND NEW."providerInvoiceReference" IS DISTINCT FROM OLD."providerInvoiceReference")
     OR (OLD."providerSessionReference" IS NOT NULL AND NEW."providerSessionReference" IS DISTINCT FROM OLD."providerSessionReference")
     OR (OLD."providerPaymentReference" IS NOT NULL AND NEW."providerPaymentReference" IS DISTINCT FROM OLD."providerPaymentReference")
     OR (OLD."checkoutReservationToken" IS NOT NULL AND NEW."checkoutReservationToken" IS DISTINCT FROM OLD."checkoutReservationToken")
     OR (OLD."checkoutReservationDigest" IS NOT NULL AND NEW."checkoutReservationDigest" IS DISTINCT FROM OLD."checkoutReservationDigest")
     OR (OLD."checkoutReservedAt" IS NOT NULL AND NEW."checkoutReservedAt" IS DISTINCT FROM OLD."checkoutReservedAt")
  THEN
    RAISE EXCEPTION 'payment attempt authority snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A worker activation is authority, not configuration cache. Every authority
-- change advances a monotonic generation; claimed leases carry the generation
-- and are fenced before a not-yet-started effect can run.
CREATE OR REPLACE FUNCTION phase33_advance_worker_activation_generation()
RETURNS trigger AS $$
BEGIN
  IF ROW(
       NEW."environment", NEW."handlerKey", NEW."handlerVersion",
       NEW."payloadVersion", NEW."mode", NEW."configurationDigest",
       NEW."deploymentDigest", NEW."owner", NEW."runbookRef", NEW."sloRef",
       NEW."evidenceDigest", NEW."providerUseCase", NEW."leaseMilliseconds",
       NEW."heartbeatMilliseconds", NEW."batchSize", NEW."maxAttempts",
       NEW."maxConcurrency", NEW."killSwitchEngaged", NEW."effectiveAt",
       NEW."expiresAt", NEW."revokedAt", NEW."revokeReasonCode"
     ) IS DISTINCT FROM ROW(
       OLD."environment", OLD."handlerKey", OLD."handlerVersion",
       OLD."payloadVersion", OLD."mode", OLD."configurationDigest",
       OLD."deploymentDigest", OLD."owner", OLD."runbookRef", OLD."sloRef",
       OLD."evidenceDigest", OLD."providerUseCase", OLD."leaseMilliseconds",
       OLD."heartbeatMilliseconds", OLD."batchSize", OLD."maxAttempts",
       OLD."maxConcurrency", OLD."killSwitchEngaged", OLD."effectiveAt",
       OLD."expiresAt", OLD."revokedAt", OLD."revokeReasonCode"
     )
  THEN
    NEW."generation" := OLD."generation" + 1;
  ELSE
    NEW."generation" := OLD."generation";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_worker_activation_generation
BEFORE UPDATE ON "WorkerHandlerActivation"
FOR EACH ROW EXECUTE FUNCTION phase33_advance_worker_activation_generation();

-- Preserve the exact handler authority used by every post-Phase-33 effect and
-- terminal attempt. The WorkItem lease binding is deliberately cleared on
-- completion, so append-only receipts/attempts are the durable provenance.
-- NULL remains valid only for pre-cutover rows and legacy unbound test claims.
ALTER TABLE "WorkAttempt"
  ADD COLUMN "handlerActivationId" UUID,
  ADD COLUMN "handlerActivationGeneration" INTEGER,
  ADD COLUMN "handlerActivationCurrentAtCompletion" BOOLEAN;

ALTER TABLE "WorkEffectReceipt"
  ADD COLUMN "handlerActivationId" UUID,
  ADD COLUMN "handlerActivationGeneration" INTEGER,
  ADD COLUMN "handlerActivationCurrentAtReceipt" BOOLEAN,
  ADD COLUMN "leaseWorkerRunId" UUID,
  ADD COLUMN "leaseFencingToken" INTEGER;

ALTER TABLE "WorkAttempt"
  ADD CONSTRAINT "work_attempt_handler_activation_evidence_check" CHECK (
    ("handlerActivationId" IS NULL) = ("handlerActivationGeneration" IS NULL)
    AND ("handlerActivationId" IS NULL) = ("handlerActivationCurrentAtCompletion" IS NULL)
    AND ("handlerActivationGeneration" IS NULL OR "handlerActivationGeneration" > 0)
  ),
  ADD CONSTRAINT "WorkAttempt_handlerActivationId_fkey"
    FOREIGN KEY ("handlerActivationId") REFERENCES "WorkerHandlerActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkEffectReceipt"
  ADD CONSTRAINT "work_effect_receipt_handler_activation_evidence_check" CHECK (
    ("handlerActivationId" IS NULL) = ("handlerActivationGeneration" IS NULL)
    AND ("handlerActivationId" IS NULL) = ("handlerActivationCurrentAtReceipt" IS NULL)
    AND ("handlerActivationGeneration" IS NULL OR "handlerActivationGeneration" > 0)
  ),
  ADD CONSTRAINT "work_effect_receipt_lease_evidence_check" CHECK (
    ("leaseWorkerRunId" IS NULL) = ("leaseFencingToken" IS NULL)
    AND ("leaseFencingToken" IS NULL OR "leaseFencingToken" > 0)
  ),
  ADD CONSTRAINT "WorkEffectReceipt_handlerActivationId_fkey"
    FOREIGN KEY ("handlerActivationId") REFERENCES "WorkerHandlerActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkEffectReceipt_leaseWorkerRunId_fkey"
    FOREIGN KEY ("leaseWorkerRunId") REFERENCES "WorkerRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WorkAttempt_handlerActivationId_generation_completedAt_idx"
  ON "WorkAttempt"("handlerActivationId", "handlerActivationGeneration", "completedAt");
CREATE INDEX "WorkEffectReceipt_handlerActivationId_generation_createdAt_idx"
  ON "WorkEffectReceipt"("handlerActivationId", "handlerActivationGeneration", "createdAt");

CREATE OR REPLACE FUNCTION phase24_guard_provider_event_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."adapterKey" IS DISTINCT FROM OLD."adapterKey"
     OR NEW."adapterVersion" IS DISTINCT FROM OLD."adapterVersion"
     OR NEW."providerMode" IS DISTINCT FROM OLD."providerMode"
     OR NEW."expectedLiveMode" IS DISTINCT FROM OLD."expectedLiveMode"
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
     OR (
       OLD."hydratedPaymentReference" IS NOT NULL
       AND ROW(
         NEW."hydratedPaymentReference", NEW."hydrationEvidenceDigest",
         NEW."hydrationSource", NEW."hydratedAt"
       ) IS DISTINCT FROM ROW(
         OLD."hydratedPaymentReference", OLD."hydrationEvidenceDigest",
         OLD."hydrationSource", OLD."hydratedAt"
       )
     )
  THEN
    RAISE EXCEPTION 'provider event signature evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase33_guard_refund_payment_source()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
     OR NEW."subscriptionProviderInvoiceId" IS DISTINCT FROM OLD."subscriptionProviderInvoiceId"
     OR NEW."paymentAttemptId" IS DISTINCT FROM OLD."paymentAttemptId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."amountRappen" IS DISTINCT FROM OLD."amountRappen"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."sourceKind" IS DISTINCT FROM OLD."sourceKind"
     OR NEW."sourceProviderPaymentReference" IS DISTINCT FROM OLD."sourceProviderPaymentReference"
     OR NEW."sourceAmountRappen" IS DISTINCT FROM OLD."sourceAmountRappen"
     OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."stepUpEvidenceId" IS DISTINCT FROM OLD."stepUpEvidenceId"
     OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
     OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR (
       OLD."providerRefundReference" IS NOT NULL
       AND NEW."providerRefundReference" IS DISTINCT FROM OLD."providerRefundReference"
     )
  THEN
    RAISE EXCEPTION 'refund payment source and provider binding are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'refund_payment_source_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_refund_payment_source_guard
BEFORE UPDATE OR DELETE ON "Refund"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_refund_payment_source();

CREATE OR REPLACE FUNCTION phase33_guard_email_provider_event_identity()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'email provider event evidence is append-only'
      USING ERRCODE = '23514', CONSTRAINT = 'email_provider_event_inbox_delete_forbidden';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."adapterKey" IS DISTINCT FROM OLD."adapterKey"
     OR NEW."adapterVersion" IS DISTINCT FROM OLD."adapterVersion"
     OR NEW."providerActivationId" IS DISTINCT FROM OLD."providerActivationId"
     OR NEW."svixId" IS DISTINCT FROM OLD."svixId"
     OR NEW."providerReceipt" IS DISTINCT FROM OLD."providerReceipt"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
     OR NEW."eventCreatedAt" IS DISTINCT FROM OLD."eventCreatedAt"
     OR NEW."payloadDigest" IS DISTINCT FROM OLD."payloadDigest"
     OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'email provider event identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'email_provider_event_inbox_identity_immutable';
  END IF;

  IF OLD."status" <> 'RECEIVED' THEN
    RAISE EXCEPTION 'terminal email provider event evidence is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'email_provider_event_inbox_terminal_immutable';
  END IF;

  IF NEW."status" NOT IN ('PROJECTED', 'IGNORED', 'FAILED')
     OR NEW."processedAt" IS NULL
     OR NOT isfinite(NEW."processedAt")
     OR NEW."processedAt" < NEW."receivedAt"
     OR cardinality(NEW."recipientHashes") <> 0
     OR NEW."recipientHashesWipedAt" IS NULL
     OR NOT isfinite(NEW."recipientHashesWipedAt")
     OR NEW."recipientHashesWipedAt" < NEW."receivedAt"
  THEN
    RAISE EXCEPTION 'email provider event must transition once from received to a terminal status while wiping recipient hashes'
      USING ERRCODE = '23514', CONSTRAINT = 'email_provider_event_inbox_terminal_transition_required';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_email_provider_event_identity_guard
BEFORE UPDATE OR DELETE ON "EmailProviderEventInbox"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_email_provider_event_identity();

CREATE OR REPLACE FUNCTION phase33_guard_notification_recipient_envelope()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notification recipient evidence is append-only; expire and wipe it instead'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_recipient_envelope_delete_forbidden';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."recipientUserId" IS NULL
       AND NOT COALESCE(
         (
           num_nonnulls(
             NEW."recipientAddressCiphertext",
             NEW."recipientAddressNonce",
             NEW."recipientAddressTag",
             NEW."recipientAddressKeyVersion",
             NEW."recipientAddressBindingVersion",
             NEW."recipientAddressDigest",
             NEW."recipientAddressDigestKeyVersion",
             NEW."recipientAddressExpiresAt"
           ) = 8
           AND NEW."recipientAddressDestroyedAt" IS NULL
           AND NEW."recipientAddressBindingVersion" = 'v2'
           AND isfinite(NEW."recipientAddressExpiresAt")
           AND NEW."recipientAddressExpiresAt" > NEW."createdAt"
           AND NEW."recipientAddressExpiresAt" <= NEW."createdAt" + interval '31 days'
         ),
         false
       )
    THEN
      RAISE EXCEPTION 'new explicit notification recipients require a finite row-bound v2 envelope'
        USING ERRCODE = '23514', CONSTRAINT = 'notification_recipient_v2_insert_required';
    END IF;
    RETURN NEW;
  END IF;

  -- The fields below either form the authenticated-data binding or define
  -- the immutable semantic request. A new outbox row is required for any
  -- changed recipient, template, dedupe identity, purpose or payload.
  IF ROW(
       NEW."id",
       NEW."recipientUserId",
       NEW."purpose",
       NEW."purposeClass",
       NEW."channel",
       NEW."templateKey",
       NEW."payloadSchemaVersion",
       NEW."payload",
       NEW."dedupeKey",
       NEW."providerDedupeKey",
       NEW."recipientAddressExpiresAt",
       NEW."createdAt"
     ) IS DISTINCT FROM ROW(
       OLD."id",
       OLD."recipientUserId",
       OLD."purpose",
       OLD."purposeClass",
       OLD."channel",
       OLD."templateKey",
       OLD."payloadSchemaVersion",
       OLD."payload",
       OLD."dedupeKey",
       OLD."providerDedupeKey",
       OLD."recipientAddressExpiresAt",
       OLD."createdAt"
     )
  THEN
    RAISE EXCEPTION 'notification recipient identity and AAD binding are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_recipient_identity_immutable';
  END IF;

  IF ROW(
       NEW."recipientAddressCiphertext",
       NEW."recipientAddressNonce",
       NEW."recipientAddressTag",
       NEW."recipientAddressKeyVersion",
       NEW."recipientAddressBindingVersion",
       NEW."recipientAddressDigest",
       NEW."recipientAddressDigestKeyVersion",
       NEW."recipientAddressDestroyedAt"
     ) IS DISTINCT FROM ROW(
       OLD."recipientAddressCiphertext",
       OLD."recipientAddressNonce",
       OLD."recipientAddressTag",
       OLD."recipientAddressKeyVersion",
       OLD."recipientAddressBindingVersion",
       OLD."recipientAddressDigest",
       OLD."recipientAddressDigestKeyVersion",
       OLD."recipientAddressDestroyedAt"
     )
  THEN
    IF OLD."recipientAddressDestroyedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'destroyed notification recipient material cannot be restored or changed'
        USING ERRCODE = '23514', CONSTRAINT = 'notification_recipient_destroyed';
    END IF;

    IF OLD."recipientUserId" IS NOT NULL
       OR NOT (
         num_nonnulls(
           NEW."recipientAddressCiphertext",
           NEW."recipientAddressNonce",
           NEW."recipientAddressTag",
           NEW."recipientAddressKeyVersion",
           NEW."recipientAddressBindingVersion",
           NEW."recipientAddressDigest",
           NEW."recipientAddressDigestKeyVersion"
          ) = 0
          AND NEW."recipientAddressDestroyedAt" IS NOT NULL
          AND isfinite(NEW."recipientAddressDestroyedAt")
        )
    THEN
      RAISE EXCEPTION 'notification recipient material is immutable except exact one-way destruction'
        USING ERRCODE = '23514', CONSTRAINT = 'notification_recipient_envelope_immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_notification_recipient_envelope_guard
BEFORE INSERT OR UPDATE OR DELETE ON "NotificationOutbox"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_notification_recipient_envelope();

CREATE OR REPLACE FUNCTION phase33_guard_notification_provider_request()
RETURNS trigger AS $$
BEGIN
  IF OLD."providerRequestActivationId" IS NOT NULL THEN
    IF NEW."providerRequestActivationId" IS DISTINCT FROM OLD."providerRequestActivationId"
       OR NEW."providerRequestDigest" IS DISTINCT FROM OLD."providerRequestDigest"
       OR NEW."providerRequestCreatedAt" IS DISTINCT FROM OLD."providerRequestCreatedAt"
       OR NEW."providerRequestKeyVersion" IS DISTINCT FROM OLD."providerRequestKeyVersion"
    THEN
      RAISE EXCEPTION 'notification provider request evidence is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'notification_provider_request_immutable';
    END IF;

    IF OLD."providerRequestDestroyedAt" IS NOT NULL THEN
      IF ROW(
           NEW."providerRequestCiphertext",
           NEW."providerRequestNonce",
           NEW."providerRequestTag",
           NEW."providerRequestDestroyedAt"
         ) IS DISTINCT FROM ROW(
           OLD."providerRequestCiphertext",
           OLD."providerRequestNonce",
           OLD."providerRequestTag",
           OLD."providerRequestDestroyedAt"
         )
      THEN
        RAISE EXCEPTION 'destroyed notification provider material cannot be restored'
          USING ERRCODE = '23514', CONSTRAINT = 'notification_provider_request_destroyed';
      END IF;
    ELSIF ROW(
            NEW."providerRequestCiphertext",
            NEW."providerRequestNonce",
            NEW."providerRequestTag"
          ) IS DISTINCT FROM ROW(
            OLD."providerRequestCiphertext",
            OLD."providerRequestNonce",
            OLD."providerRequestTag"
          )
          AND NOT (
            num_nonnulls(
              NEW."providerRequestCiphertext",
              NEW."providerRequestNonce",
              NEW."providerRequestTag"
            ) = 0
            AND NEW."providerRequestDestroyedAt" IS NOT NULL
          )
    THEN
      RAISE EXCEPTION 'notification provider request material is immutable except one-way destruction'
        USING ERRCODE = '23514', CONSTRAINT = 'notification_provider_request_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_notification_provider_request_guard
BEFORE UPDATE OF
  "providerRequestActivationId",
  "providerRequestCiphertext",
  "providerRequestNonce",
  "providerRequestTag",
  "providerRequestKeyVersion",
  "providerRequestDigest",
  "providerRequestCreatedAt",
  "providerRequestDestroyedAt"
ON "NotificationOutbox"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_notification_provider_request();

-- The table-level CHECK intentionally retains historical ACCEPTED attempts
-- whose Phase-20 adapters had no activation snapshot. From this cutover
-- onward, however, an accepted provider effect is not admissible without all
-- five immutable correlation fields, including the recipient-HMAC key
-- version required for deterministic rotation evidence.
CREATE OR REPLACE FUNCTION phase33_guard_notification_attempt_insert()
RETURNS trigger AS $$
BEGIN
  IF NEW."recipientEvidenceRetainUntil" IS NULL
     OR NEW."recipientEvidenceWipedAt" IS NOT NULL
     OR NOT isfinite(NEW."completedAt")
     OR NOT isfinite(NEW."recipientEvidenceRetainUntil")
     OR NEW."recipientEvidenceRetainUntil" IS DISTINCT FROM
        NEW."completedAt" + interval '9600 hours'
  THEN
    RAISE EXCEPTION 'new notification delivery attempts require an exact finite 400-day evidence-retention contract'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_delivery_attempt_retention_contract_required';
  END IF;

  IF (NEW."outcome" = 'ACCEPTED'
     AND num_nonnulls(
       NEW."providerActivationId",
       NEW."providerRequestDigest",
       NEW."providerReceipt",
       NEW."recipientHash",
       NEW."recipientHashKeyVersion"
     ) <> 5
     ) OR (
       NEW."outcome" = 'ACCEPTED'
       AND NOT COALESCE(
         NEW."recipientHashKeyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$',
         false
       )
     )
  THEN
    RAISE EXCEPTION 'accepted notification delivery requires complete provider evidence'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_delivery_attempt_accepted_evidence_required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_notification_attempt_insert_guard
BEFORE INSERT ON "NotificationDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_notification_attempt_insert();

CREATE OR REPLACE FUNCTION phase33_guard_notification_attempt_append_only()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notification delivery attempts are append-only after insert'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_delivery_attempt_append_only';
  END IF;

  IF OLD."recipientEvidenceWipedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'compacted notification delivery evidence cannot be restored or changed'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_delivery_attempt_evidence_destroyed';
  END IF;

  IF ROW(
       NEW."id", NEW."outboxId", NEW."attemptNumber", NEW."leaseOwner",
       NEW."leaseExpiresAt", NEW."providerClass", NEW."outcome",
       NEW."providerActivationId", NEW."errorCode", NEW."nextAvailableAt",
       NEW."startedAt", NEW."completedAt", NEW."createdAt",
       NEW."recipientEvidenceRetainUntil"
     ) IS DISTINCT FROM ROW(
       OLD."id", OLD."outboxId", OLD."attemptNumber", OLD."leaseOwner",
       OLD."leaseExpiresAt", OLD."providerClass", OLD."outcome",
       OLD."providerActivationId", OLD."errorCode", OLD."nextAvailableAt",
       OLD."startedAt", OLD."completedAt", OLD."createdAt",
       OLD."recipientEvidenceRetainUntil"
     )
     OR num_nonnulls(
       NEW."providerReceipt", NEW."providerRequestDigest",
       NEW."recipientHash", NEW."recipientHashKeyVersion"
     ) <> 0
     OR NEW."recipientEvidenceWipedAt" IS NULL
     OR NOT isfinite(NEW."recipientEvidenceWipedAt")
     OR NEW."recipientEvidenceWipedAt" < OLD."recipientEvidenceRetainUntil"
     OR NEW."recipientEvidenceWipedAt" > CURRENT_TIMESTAMP
     OR CURRENT_TIMESTAMP < OLD."recipientEvidenceRetainUntil"
  THEN
    RAISE EXCEPTION 'notification delivery evidence is immutable except exact one-way compaction after 400 days'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_delivery_attempt_append_only';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_notification_attempt_append_only_guard
BEFORE UPDATE OR DELETE ON "NotificationDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_notification_attempt_append_only();

CREATE OR REPLACE FUNCTION phase33_guard_notification_suppression()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notification suppressions are append-only; release them instead'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_suppression_delete_forbidden';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."recipientHash" !~ '^[a-f0-9]{64}$'
       OR NEW."recipientHashKeyVersion" IS NULL
       OR NEW."recipientHashKeyVersion" !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$'
       OR (
         NEW."releasedAt" IS NOT NULL
         AND NOT isfinite(NEW."releasedAt")
       )
    THEN
      RAISE EXCEPTION 'new notification suppressions require a keyed recipient hash and safe key version'
        USING ERRCODE = '23514', CONSTRAINT = 'notification_suppression_recipient_hash_version_required';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."recipientHash" IS DISTINCT FROM OLD."recipientHash"
     OR NEW."recipientHashKeyVersion" IS DISTINCT FROM OLD."recipientHashKeyVersion"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'notification suppression identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_suppression_identity_immutable';
  END IF;

  IF OLD."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'released notification suppression is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_suppression_released_immutable';
  END IF;

  IF NEW."releasedAt" IS NULL OR NOT isfinite(NEW."releasedAt") THEN
    RAISE EXCEPTION 'notification suppression release is a one-way transition to a finite timestamp'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_suppression_release_transition_required';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_notification_suppression_guard
BEFORE INSERT OR UPDATE OR DELETE ON "NotificationSuppression"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_notification_suppression();

-- A provider activation is an authority snapshot, not mutable configuration.
-- Operational health may be refreshed in place, but identity/contract/cost/
-- validity evidence is superseded by a new row. Revocation and the emergency
-- kill switch only move towards less authority and can never be rolled back.
ALTER TABLE "ProviderActivation"
  ADD CONSTRAINT "provider_activation_revocation_monotonic_check" CHECK (
    (
      "revokedAt" IS NULL
      AND "revokeReasonCode" IS NULL
    )
    OR (
      "revokedAt" IS NOT NULL
      AND "revokeReasonCode" IS NOT NULL
      AND btrim("revokeReasonCode") <> ''
      AND "effectiveAt" IS NOT NULL
      AND "revokedAt" >= "effectiveAt"
      AND "killSwitchEngaged"
    )
  );

CREATE OR REPLACE FUNCTION phase33_guard_provider_activation_authority()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider activation authority is append-only; revoke and supersede it instead'
      USING ERRCODE = '23514', CONSTRAINT = 'provider_activation_identity_immutable';
  END IF;

  IF ROW(
       NEW."id", NEW."environment", NEW."useCase", NEW."adapterKey",
       NEW."adapterVersion", NEW."mode", NEW."configurationDigest",
       NEW."secretVersionRef", NEW."region", NEW."dpaRef",
       NEW."contractRef", NEW."approvalRef", NEW."evidenceDigest",
       NEW."owner", NEW."runbookRef", NEW."quotaUnits",
       NEW."sustainableCapacity", NEW."unitCostMicros",
       NEW."unitCostSource", NEW."effectiveAt", NEW."expiresAt",
       NEW."createdAt"
     ) IS DISTINCT FROM ROW(
       OLD."id", OLD."environment", OLD."useCase", OLD."adapterKey",
       OLD."adapterVersion", OLD."mode", OLD."configurationDigest",
       OLD."secretVersionRef", OLD."region", OLD."dpaRef",
       OLD."contractRef", OLD."approvalRef", OLD."evidenceDigest",
       OLD."owner", OLD."runbookRef", OLD."quotaUnits",
       OLD."sustainableCapacity", OLD."unitCostMicros",
       OLD."unitCostSource", OLD."effectiveAt", OLD."expiresAt",
       OLD."createdAt"
     )
  THEN
    RAISE EXCEPTION 'provider activation identity is immutable; revoke and supersede it instead'
      USING ERRCODE = '23514', CONSTRAINT = 'provider_activation_identity_immutable';
  END IF;

  IF OLD."killSwitchEngaged" AND NOT NEW."killSwitchEngaged" THEN
    RAISE EXCEPTION 'provider activation kill switch cannot be disengaged'
      USING ERRCODE = '23514', CONSTRAINT = 'provider_activation_kill_switch_monotonic';
  END IF;

  IF OLD."revokedAt" IS NOT NULL
     AND (
       NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
       OR NEW."revokeReasonCode" IS DISTINCT FROM OLD."revokeReasonCode"
     )
  THEN
    RAISE EXCEPTION 'provider activation revocation cannot be changed or cleared'
      USING ERRCODE = '23514', CONSTRAINT = 'provider_activation_revocation_monotonic';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_provider_activation_authority_guard
BEFORE UPDATE OR DELETE ON "ProviderActivation"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_provider_activation_authority();

-- A signed success is the terminal authority for an initial charge, including
-- when Stripe delivers an equal-second failure first. The commercial snapshot
-- remains immutable; only FAILED/EXPIRED -> PAID is added to the lifecycle.
CREATE OR REPLACE FUNCTION enforce_order_lifecycle_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'PENDING') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY['status', 'providerIdempotencyKey', 'providerReference', 'paidAt', 'failedAt', 'cancelledAt', 'expiresAt', 'updatedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'providerIdempotencyKey', 'providerReference', 'paidAt', 'failedAt', 'cancelledAt', 'expiresAt', 'updatedAt'])
    OR NOT (
      NEW."status" = OLD."status"
      OR (OLD."status" = 'PENDING' AND NEW."status" IN ('PAID', 'FAILED', 'CANCELLED', 'EXPIRED'))
      OR (OLD."status" IN ('FAILED', 'EXPIRED') AND NEW."status" = 'PAID')
    )
    OR ((NEW."status" = 'PAID') <> (NEW."paidAt" IS NOT NULL))
    OR ((NEW."status" = 'FAILED') <> (NEW."failedAt" IS NOT NULL))
    OR ((NEW."status" = 'CANCELLED') <> (NEW."cancelledAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Order commercial snapshot is immutable outside its lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'order_released_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phase33_guard_subscription_provider_invoice()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId"
     OR NEW."paymentAttemptId" IS DISTINCT FROM OLD."paymentAttemptId"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."adapterKey" IS DISTINCT FROM OLD."adapterKey"
     OR NEW."adapterVersion" IS DISTINCT FROM OLD."adapterVersion"
     OR NEW."providerMode" IS DISTINCT FROM OLD."providerMode"
     OR NEW."providerAccountReference" IS DISTINCT FROM OLD."providerAccountReference"
     OR NEW."providerSubscriptionReference" IS DISTINCT FROM OLD."providerSubscriptionReference"
     OR NEW."providerInvoiceReference" IS DISTINCT FROM OLD."providerInvoiceReference"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR (OLD."status" = 'CONFLICT' AND NEW IS DISTINCT FROM OLD)
     OR (OLD."status" = 'PAID' AND NEW."status" NOT IN ('PAID', 'CONFLICT'))
     OR (OLD."status" = 'FAILED' AND NEW."status" NOT IN ('FAILED', 'PAID', 'CONFLICT'))
     OR (
       OLD."firstFailureAt" IS NOT NULL
       AND (
         NEW."firstFailureAt" IS NULL
         OR NEW."firstFailureAt" > OLD."firstFailureAt"
       )
     )
     OR (
       OLD."paidAt" IS NOT NULL
       AND (
         NEW."firstFailureAt" IS DISTINCT FROM OLD."firstFailureAt"
         OR NEW."amountRappen" IS DISTINCT FROM OLD."amountRappen"
         OR NEW."currency" IS DISTINCT FROM OLD."currency"
         OR NEW."providerPaymentReference" IS DISTINCT FROM OLD."providerPaymentReference"
         OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
         OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
         OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
         OR NEW."paidProjectionDigest" IS DISTINCT FROM OLD."paidProjectionDigest"
       )
     )
     OR (OLD."conflictedAt" IS NOT NULL AND NEW."conflictedAt" IS DISTINCT FROM OLD."conflictedAt")
  THEN
    RAISE EXCEPTION 'subscription provider invoice authority is immutable or non-monotonic'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_provider_invoice_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_subscription_provider_invoice_guard
BEFORE UPDATE OR DELETE ON "SubscriptionProviderInvoice"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_subscription_provider_invoice();

-- Preserve the historic subscription snapshot invariant while allowing only
-- monotonic provider-driven period rollover and a separate conservative
-- provider-status cursor. Stripe event timestamps have only second precision;
-- an equal-second signal may therefore advance only to a safer semantic rank.
CREATE OR REPLACE FUNCTION enforce_subscription_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR (to_jsonb(OLD) - ARRAY[
          'status', 'activatedAt', 'endedAt', 'updatedAt',
          'currentPeriodStart', 'currentPeriodEnd', 'providerLastEventAt',
          'providerStatusEventAt', 'providerStatusRank', 'providerCancellationAt'
        ])
      IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY[
          'status', 'activatedAt', 'endedAt', 'updatedAt',
          'currentPeriodStart', 'currentPeriodEnd', 'providerLastEventAt',
          'providerStatusEventAt', 'providerStatusRank', 'providerCancellationAt'
        ])
    OR (OLD."activatedAt" IS NOT NULL AND OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt")
    OR (OLD."endedAt" IS NOT NULL AND OLD."endedAt" IS DISTINCT FROM NEW."endedAt")
    OR (
      NEW."providerLastEventAt" IS DISTINCT FROM OLD."providerLastEventAt"
      AND (
        NEW."providerSubscriptionReference" IS NULL
        OR NEW."providerLastEventAt" IS NULL
        OR (OLD."providerLastEventAt" IS NOT NULL AND NEW."providerLastEventAt" < OLD."providerLastEventAt")
      )
    )
    OR (
      (NEW."providerStatusEventAt" IS DISTINCT FROM OLD."providerStatusEventAt"
       OR NEW."providerStatusRank" IS DISTINCT FROM OLD."providerStatusRank")
      AND NOT (
        NEW."providerSubscriptionReference" IS NOT NULL
        AND NEW."providerStatusEventAt" IS NOT NULL
        AND NEW."providerStatusRank" IN (10, 30, 40, 100)
        AND (
          OLD."providerStatusEventAt" IS NULL
          OR (NEW."providerStatusRank" = 100 AND OLD."providerStatusRank" <> 100)
          OR NEW."providerStatusEventAt" > OLD."providerStatusEventAt"
          OR (
            NEW."providerStatusEventAt" = OLD."providerStatusEventAt"
            AND NEW."providerStatusRank" > OLD."providerStatusRank"
          )
        )
      )
    )
    OR (
      NEW."providerCancellationAt" IS DISTINCT FROM OLD."providerCancellationAt"
      AND NOT (
        OLD."providerCancellationAt" IS NULL
        AND NEW."providerCancellationAt" IS NOT NULL
        AND NEW."providerStatusRank" = 100
        AND NEW."status" = 'CANCELLED'
      )
    )
    OR (
      (NEW."currentPeriodStart" IS DISTINCT FROM OLD."currentPeriodStart"
       OR NEW."currentPeriodEnd" IS DISTINCT FROM OLD."currentPeriodEnd")
      AND NOT (
        NEW."providerSubscriptionReference" IS NOT NULL
        AND NEW."currentPeriodStart" >= OLD."currentPeriodStart"
        AND NEW."currentPeriodEnd" >= OLD."currentPeriodEnd"
        AND NEW."currentPeriodEnd" > NEW."currentPeriodStart"
        AND (
          NEW."providerStatusEventAt" IS DISTINCT FROM OLD."providerStatusEventAt"
          OR NEW."providerStatusRank" IS DISTINCT FROM OLD."providerStatusRank"
          OR EXISTS (
            SELECT 1
            FROM "SubscriptionProviderInvoice" spi
            WHERE spi."subscriptionId" = NEW."id"
              AND spi."companyId" = NEW."companyId"
              AND spi."providerSubscriptionReference" = NEW."providerSubscriptionReference"
              AND spi."status" = 'PAID'
              AND spi."periodStart" = NEW."currentPeriodStart"
              AND spi."periodEnd" = NEW."currentPeriodEnd"
          )
        )
      )
    )
    OR NOT (
      NEW."status" = OLD."status"
      OR (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
      OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('CANCELLING', 'EXPIRED', 'SUSPENDED', 'CANCELLED'))
      OR (OLD."status" = 'CANCELLING' AND NEW."status" IN ('ACTIVE', 'CANCELLED', 'SUSPENDED'))
      OR (OLD."status" = 'SUSPENDED' AND NEW."status" IN ('ACTIVE', 'CANCELLING', 'EXPIRED', 'CANCELLED'))
    )
  THEN
    RAISE EXCEPTION 'Subscription commercial and provider snapshots are immutable outside monotonic lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'employer_subscription_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Privacy export bytes are verified before the candidate's single-use grant
-- is consumed. A short database claim prevents two downloads from racing
-- while storage is opened outside the transaction; failed verification can
-- release the claim without consuming either authority or artifact.
ALTER TABLE "PrivacyExportArtifact"
  ADD COLUMN "downloadClaimId" UUID,
  ADD COLUMN "downloadClaimedAt" TIMESTAMPTZ(3),
  ADD COLUMN "downloadClaimExpiresAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "privacy_export_download_claim_shape_check" CHECK (
    (
      "downloadClaimId" IS NULL
      AND "downloadClaimedAt" IS NULL
      AND "downloadClaimExpiresAt" IS NULL
    )
    OR (
      "downloadClaimId" IS NOT NULL
      AND "downloadClaimedAt" IS NOT NULL
      AND "downloadClaimExpiresAt" IS NOT NULL
      AND "downloadClaimExpiresAt" > "downloadClaimedAt"
      AND "status" = 'READY'
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NULL
    )
  );

CREATE UNIQUE INDEX "PrivacyExportArtifact_downloadClaimId_key"
  ON "PrivacyExportArtifact"("downloadClaimId")
  WHERE "downloadClaimId" IS NOT NULL;
CREATE INDEX "PrivacyExportArtifact_status_downloadClaimExpiresAt_idx"
  ON "PrivacyExportArtifact"("status", "downloadClaimExpiresAt");

-- The worker may reconstruct a missing generic effect receipt only from the
-- consumed dual approval and the matching completed execution. Freeze those
-- authority/evidence snapshots once they reach that boundary.
CREATE OR REPLACE FUNCTION phase33_guard_consumed_privacy_approval()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."kind" = 'PRIVACY' AND OLD."status" = 'CONSUMED' THEN
      RAISE EXCEPTION 'consumed privacy approval evidence is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'consumed_privacy_approval_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."kind" = 'PRIVACY'
     AND OLD."status" = 'CONSUMED'
     AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'consumed privacy approval evidence is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'consumed_privacy_approval_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_consumed_privacy_approval_guard
BEFORE UPDATE OR DELETE ON "PrivilegedApproval"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_consumed_privacy_approval();

CREATE OR REPLACE FUNCTION phase33_guard_privacy_execution_authority()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy execution authority snapshot is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'privacy_execution_authority_immutable';
  END IF;
  IF NEW."privacyRequestId" IS DISTINCT FROM OLD."privacyRequestId"
     OR NEW."inventoryVersionId" IS DISTINCT FROM OLD."inventoryVersionId"
     OR NEW."processingApprovalId" IS DISTINCT FROM OLD."processingApprovalId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."subjectClass" IS DISTINCT FROM OLD."subjectClass"
     OR NEW."subjectReferenceHash" IS DISTINCT FROM OLD."subjectReferenceHash"
     OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
     OR NEW."requiredProcessors" IS DISTINCT FROM OLD."requiredProcessors"
     OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
     OR NEW."approvalEvidenceRef" IS DISTINCT FROM OLD."approvalEvidenceRef"
     OR NEW."stepUpEvidenceRef" IS DISTINCT FROM OLD."stepUpEvidenceRef"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'privacy execution authority snapshot is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'privacy_execution_authority_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase33_privacy_execution_authority_guard
BEFORE UPDATE OR DELETE ON "PrivacyExecution"
FOR EACH ROW EXECUTE FUNCTION phase33_guard_privacy_execution_authority();

COMMIT;
