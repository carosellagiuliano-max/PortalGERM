CREATE TYPE "SubscriptionOrderChangeKind" AS ENUM ('NEW', 'UPGRADE', 'DOWNGRADE');
ALTER TYPE "AuditAction" ADD VALUE 'BILLING_PROFILE_UPDATED';

ALTER TABLE "Order"
  ADD COLUMN "requestFingerprint" CHAR(64);

-- Historical demo orders predate the Phase-12 request fingerprint. The
-- deterministic 64-hex backfill is evidence only; every new command writes a
-- SHA-256 fingerprint over its server-resolved commercial intent.
-- The Phase-02 trigger correctly treats released commercial fields as
-- immutable. Hold an exclusive table lock while suspending only that trigger
-- for this one deterministic schema backfill, then restore it immediately.
LOCK TABLE "Order" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "Order" DISABLE TRIGGER order_released_immutable_trigger;
UPDATE "Order"
SET "requestFingerprint" = md5('phase12-order:' || "id"::text)
  || md5('phase12-company:' || "companyId"::text)
WHERE "requestFingerprint" IS NULL;
ALTER TABLE "Order" ENABLE TRIGGER order_released_immutable_trigger;

ALTER TABLE "Order"
  ALTER COLUMN "requestFingerprint" SET NOT NULL,
  ADD CONSTRAINT "order_request_fingerprint_check"
    CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$');

CREATE TABLE "SubscriptionOrderSnapshot" (
  "id" UUID NOT NULL,
  "orderLineId" UUID NOT NULL,
  "policyVersion" VARCHAR(32) NOT NULL,
  "changeKind" "SubscriptionOrderChangeKind" NOT NULL,
  "sourceSubscriptionId" UUID,
  "sourcePeriodStart" TIMESTAMPTZ(3),
  "sourcePeriodEnd" TIMESTAMPTZ(3),
  "fulfillmentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
  "fulfillmentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
  "sourceRecurringNetRappen" INTEGER,
  "targetRecurringNetRappen" INTEGER NOT NULL,
  "prorationNumeratorSeconds" INTEGER,
  "prorationDenominatorSeconds" INTEGER,
  "quotedNetRappen" INTEGER NOT NULL,
  "activeJobLimitSnapshot" INTEGER NOT NULL,
  "seatLimitSnapshot" INTEGER NOT NULL,
  "talentContactAllowanceSnapshot" INTEGER NOT NULL,
  "jobBoostAllowanceSnapshot" INTEGER NOT NULL,
  "retainedMembershipIds" TEXT[] NOT NULL,
  "retainedDefaultOwnerId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionOrderSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionOrderSnapshot_orderLineId_fkey"
    FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubscriptionOrderSnapshot_sourceSubscriptionId_fkey"
    FOREIGN KEY ("sourceSubscriptionId") REFERENCES "EmployerSubscription"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subscription_order_snapshot_range_check"
    CHECK ("fulfillmentPeriodStart" < "fulfillmentPeriodEnd"
      AND "targetRecurringNetRappen" > 0
      AND "quotedNetRappen" > 0
      AND "activeJobLimitSnapshot" >= 0
      AND "seatLimitSnapshot" >= 1
      AND "talentContactAllowanceSnapshot" >= 0
      AND "jobBoostAllowanceSnapshot" >= 0),
  CONSTRAINT "subscription_order_snapshot_change_check"
    CHECK (
      ("changeKind" = 'NEW'
        AND "sourceSubscriptionId" IS NULL
        AND "sourcePeriodStart" IS NULL
        AND "sourcePeriodEnd" IS NULL
        AND "sourceRecurringNetRappen" IS NULL
        AND "prorationNumeratorSeconds" IS NULL
        AND "prorationDenominatorSeconds" IS NULL
        AND "quotedNetRappen" = "targetRecurringNetRappen"
        AND cardinality("retainedMembershipIds") = 0
        AND "retainedDefaultOwnerId" IS NULL)
      OR
      ("changeKind" = 'UPGRADE'
        AND "sourceSubscriptionId" IS NOT NULL
        AND "sourcePeriodStart" IS NOT NULL
        AND "sourcePeriodEnd" IS NOT NULL
        AND "sourcePeriodStart" < "sourcePeriodEnd"
        AND "sourceRecurringNetRappen" IS NOT NULL
        AND "targetRecurringNetRappen" > "sourceRecurringNetRappen"
        AND "prorationNumeratorSeconds" > 0
        AND "prorationDenominatorSeconds" > 0
        AND "prorationNumeratorSeconds" <= "prorationDenominatorSeconds"
        AND cardinality("retainedMembershipIds") = 0
        AND "retainedDefaultOwnerId" IS NULL)
      OR
      ("changeKind" = 'DOWNGRADE'
        AND "sourceSubscriptionId" IS NOT NULL
        AND "sourcePeriodStart" IS NOT NULL
        AND "sourcePeriodEnd" IS NOT NULL
        AND "sourcePeriodStart" < "sourcePeriodEnd"
        AND "sourceRecurringNetRappen" IS NOT NULL
        AND "targetRecurringNetRappen" < "sourceRecurringNetRappen"
        AND "prorationNumeratorSeconds" IS NULL
        AND "prorationDenominatorSeconds" IS NULL
        AND "quotedNetRappen" = "targetRecurringNetRappen"
        AND cardinality("retainedMembershipIds") BETWEEN 1 AND "seatLimitSnapshot"
        AND "retainedDefaultOwnerId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "SubscriptionOrderSnapshot_orderLineId_key"
  ON "SubscriptionOrderSnapshot"("orderLineId");
CREATE INDEX "SubscriptionOrderSnapshot_sourceSubscriptionId_idx"
  ON "SubscriptionOrderSnapshot"("sourceSubscriptionId");
CREATE INDEX "SubscriptionOrderSnapshot_changeKind_fulfillmentPeriodStart_idx"
  ON "SubscriptionOrderSnapshot"("changeKind", "fulfillmentPeriodStart");
CREATE TRIGGER phase12_subscription_order_snapshot_append_only
BEFORE UPDATE OR DELETE ON "SubscriptionOrderSnapshot"
FOR EACH ROW EXECUTE FUNCTION phase02_raise_append_only();

ALTER TABLE "CreditLedgerEntry"
  ADD COLUMN "sourceSubscriptionId" UUID,
  ADD COLUMN "consumedGrantEntryId" UUID,
  ADD CONSTRAINT "CreditLedgerEntry_sourceSubscriptionId_fkey"
    FOREIGN KEY ("sourceSubscriptionId") REFERENCES "EmployerSubscription"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_consumedGrantEntryId_fkey"
    FOREIGN KEY ("consumedGrantEntryId") REFERENCES "CreditLedgerEntry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase-12 makes the previously implicit allowance lineage explicit. Existing
-- plan grants can be linked without guessing only when exactly one matching
-- subscription owns the same company, plan and half-open billing period.
-- Keep the Phase-02 append-only rule disabled only while the table is held by
-- this migration; it is restored before any new Phase-12 trigger is installed.
LOCK TABLE "CreditLedgerEntry" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "CreditLedgerEntry" DISABLE TRIGGER phase02_append_only_29;
WITH plan_grant_source AS (
  SELECT grant_entry."id" AS grant_id,
    MIN(subscription."id"::text)::uuid AS subscription_id
  FROM "CreditLedgerEntry" AS grant_entry
  JOIN "CreditAccount" AS account ON account."id" = grant_entry."accountId"
  JOIN "EmployerSubscription" AS subscription
    ON subscription."companyId" = account."companyId"
    AND subscription."planVersionId" = grant_entry."sourcePlanVersionId"
    AND subscription."currentPeriodStart" = account."periodStart"
    AND subscription."currentPeriodEnd" = account."periodEnd"
  WHERE grant_entry."kind" = 'GRANT'
    AND grant_entry."fundingSource" = 'PLAN_ALLOWANCE'
  GROUP BY grant_entry."id"
  HAVING COUNT(*) = 1
)
UPDATE "CreditLedgerEntry" AS grant_entry
SET "sourceSubscriptionId" = plan_grant_source.subscription_id
FROM plan_grant_source
WHERE grant_entry."id" = plan_grant_source.grant_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CreditLedgerEntry"
    WHERE "kind" = 'GRANT'
      AND "fundingSource" = 'PLAN_ALLOWANCE'
      AND "sourceSubscriptionId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Historical plan allowance lineage is missing or ambiguous'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_plan_subscription_backfill_check';
  END IF;
END;
$$;

-- Before Phase-12 an account represented a single concrete grant period. Link
-- each historical allocation only if one eligible grant exists; fail closed
-- instead of inventing financial provenance when the history is ambiguous.
WITH allocation_source AS (
  SELECT allocation."id" AS allocation_id,
    MIN(grant_entry."id"::text)::uuid AS grant_id
  FROM "CreditLedgerEntry" AS allocation
  JOIN "CreditLedgerEntry" AS grant_entry
    ON grant_entry."accountId" = allocation."accountId"
    AND grant_entry."fundingSource" = allocation."fundingSource"
    AND grant_entry."kind" = 'GRANT'
    AND grant_entry."createdAt" <= allocation."createdAt"
    AND grant_entry."validFrom" <= allocation."createdAt"
    AND grant_entry."validTo" > allocation."createdAt"
  WHERE allocation."kind" IN ('CONSUME', 'EXPIRE')
  GROUP BY allocation."id"
  HAVING COUNT(*) = 1
)
UPDATE "CreditLedgerEntry" AS allocation
SET "consumedGrantEntryId" = allocation_source.grant_id
FROM allocation_source
WHERE allocation."id" = allocation_source.allocation_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CreditLedgerEntry"
    WHERE "kind" IN ('CONSUME', 'EXPIRE')
      AND "consumedGrantEntryId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Historical credit allocation lineage is missing or ambiguous'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_consumption_backfill_check';
  END IF;
END;
$$;

ALTER TABLE "CreditLedgerEntry" ENABLE TRIGGER phase02_append_only_29;

CREATE INDEX "CreditLedgerEntry_sourceSubscriptionId_idx"
  ON "CreditLedgerEntry"("sourceSubscriptionId");
CREATE INDEX "CreditLedgerEntry_consumedGrantEntryId_createdAt_idx"
  ON "CreditLedgerEntry"("consumedGrantEntryId", "createdAt");
CREATE INDEX "CreditAccount_companyId_creditType_fundingSource_periodEnd_createdAt_id_idx"
  ON "CreditAccount"("companyId", "creditType", "fundingSource", "periodEnd", "createdAt", "id");
CREATE INDEX "PaymentEvent_kind_createdAt_orderId_idx"
  ON "PaymentEvent"("kind", "createdAt", "orderId");
CREATE INDEX "EmployerSubscription_status_currentPeriodStart_currentPeriodEnd_idx"
  ON "EmployerSubscription"("status", "currentPeriodStart", "currentPeriodEnd");

CREATE UNIQUE INDEX "payment_event_single_paid_order_unique"
  ON "PaymentEvent"("orderId") WHERE "kind" = 'PAID';
CREATE UNIQUE INDEX "credit_ledger_plan_grant_subscription_account_unique"
  ON "CreditLedgerEntry"("sourceSubscriptionId", "accountId")
  WHERE "kind" = 'GRANT'
    AND "fundingSource" = 'PLAN_ALLOWANCE'
    AND "sourceSubscriptionId" IS NOT NULL;

-- Planned commercial versions must not overlap either already active or other
-- scheduled versions. Adjacent half-open ranges remain valid.
ALTER TABLE "PlanVersion" DROP CONSTRAINT "plan_version_active_range_excl";
ALTER TABLE "PlanVersion" ADD CONSTRAINT "plan_version_released_range_excl"
  EXCLUDE USING gist (
    "planId" WITH =,
    tstzrange("validFrom", COALESCE("validTo", 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));

ALTER TABLE "ProductVersion" DROP CONSTRAINT "product_version_active_range_excl";
ALTER TABLE "ProductVersion" ADD CONSTRAINT "product_version_released_range_excl"
  EXCLUDE USING gist (
    "productId" WITH =,
    tstzrange("validFrom", COALESCE("validTo", 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));

-- Released content stays immutable. The sole extra mutation is closing an
-- open effective range once, normally to the exact successor boundary.
CREATE OR REPLACE FUNCTION enforce_catalog_version_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_status text := to_jsonb(OLD)->>'status';
  new_status text;
  valid_to_unchanged boolean;
  valid_to_closed_once boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is immutable after release', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  new_status := to_jsonb(NEW)->>'status';
  IF old_status = 'DRAFT' AND new_status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'INACTIVE') THEN
    RETURN NEW;
  END IF;
  valid_to_unchanged := OLD."validTo" IS NOT DISTINCT FROM NEW."validTo";
  valid_to_closed_once := OLD."validTo" IS NULL
    AND NEW."validTo" IS NOT NULL
    AND NEW."validTo" > OLD."validFrom";
  IF (to_jsonb(OLD) - ARRAY['status', 'validTo'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'validTo'])
    OR NOT (valid_to_unchanged OR valid_to_closed_once)
    OR NOT (new_status = old_status
      OR (old_status = 'SCHEDULED' AND new_status IN ('ACTIVE', 'INACTIVE'))
      OR (old_status = 'ACTIVE' AND new_status = 'INACTIVE')) THEN
    RAISE EXCEPTION '% released content is immutable and permits only its catalog lifecycle', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_reviewed_version_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_status text := to_jsonb(OLD)->>'reviewStatus';
  new_status text;
  valid_to_unchanged boolean;
  valid_to_closed_once boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is immutable after approval', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  new_status := to_jsonb(NEW)->>'reviewStatus';
  IF old_status = 'DRAFT' AND new_status IN ('DRAFT', 'APPROVED') THEN
    RETURN NEW;
  END IF;
  valid_to_unchanged := OLD."validTo" IS NOT DISTINCT FROM NEW."validTo";
  valid_to_closed_once := OLD."validTo" IS NULL
    AND NEW."validTo" IS NOT NULL
    AND NEW."validTo" > OLD."validFrom";
  IF (to_jsonb(OLD) - ARRAY['reviewStatus', 'validTo'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['reviewStatus', 'validTo'])
    OR NOT (valid_to_unchanged OR valid_to_closed_once)
    OR NOT (old_status = 'APPROVED' AND new_status IN ('APPROVED', 'RETIRED')) THEN
    RAISE EXCEPTION '% approved content is immutable and permits only retirement', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION phase12_enforce_subscription_order_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_row "OrderLine"%ROWTYPE;
  order_company uuid;
  source_row "EmployerSubscription"%ROWTYPE;
  retained_count integer;
  retained_distinct_count integer;
BEGIN
  SELECT * INTO line_row FROM "OrderLine" WHERE "id" = NEW."orderLineId" FOR SHARE;
  IF line_row."id" IS NULL
    OR line_row."planVersionId" IS NULL
    OR line_row."productVersionId" IS NOT NULL
    OR line_row."fulfillmentContext" <> 'SUBSCRIPTION'
    OR line_row."quantity" <> 1
    OR line_row."netRappen" <> NEW."quotedNetRappen" THEN
    RAISE EXCEPTION 'Subscription quote must exactly snapshot one plan OrderLine'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_order_snapshot_line_check';
  END IF;
  SELECT "companyId" INTO order_company FROM "Order" WHERE "id" = line_row."orderId";
  IF NEW."sourceSubscriptionId" IS NOT NULL THEN
    SELECT * INTO source_row FROM "EmployerSubscription"
      WHERE "id" = NEW."sourceSubscriptionId" FOR SHARE;
    IF source_row."id" IS NULL
      OR source_row."companyId" IS DISTINCT FROM order_company
      OR source_row."currentPeriodStart" IS DISTINCT FROM NEW."sourcePeriodStart"
      OR source_row."currentPeriodEnd" IS DISTINCT FROM NEW."sourcePeriodEnd"
      OR source_row."recurringNetRappenSnapshot" IS DISTINCT FROM NEW."sourceRecurringNetRappen" THEN
      RAISE EXCEPTION 'Subscription quote source is outside the immutable Order scope'
        USING ERRCODE = '23514', CONSTRAINT = 'subscription_order_snapshot_source_check';
    END IF;
  END IF;
  SELECT count(*), count(DISTINCT membership_id)
    INTO retained_count, retained_distinct_count
    FROM unnest(NEW."retainedMembershipIds") AS retained(membership_id);
  IF retained_count <> retained_distinct_count OR EXISTS (
    SELECT 1 FROM unnest(NEW."retainedMembershipIds") AS retained(membership_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM "CompanyMembership" membership
      WHERE membership."id"::text = membership_id
        AND membership."companyId" = order_company
        AND membership."status" = 'ACTIVE'
        AND membership."removedAt" IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Subscription quote retained Seats are outside the Order company'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_order_snapshot_retained_scope_check';
  END IF;
  IF NEW."retainedDefaultOwnerId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CompanyMembership"
    WHERE "companyId" = order_company
      AND "userId" = NEW."retainedDefaultOwnerId"
      AND "role" = 'OWNER'
      AND "status" = 'ACTIVE'
      AND "removedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Subscription quote default Owner is outside the Order company'
      USING ERRCODE = '23514', CONSTRAINT = 'subscription_order_snapshot_owner_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_order_snapshot_scope_trigger
BEFORE INSERT OR UPDATE ON "SubscriptionOrderSnapshot"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_subscription_order_snapshot();

CREATE FUNCTION phase12_enforce_credit_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_row "CreditAccount"%ROWTYPE;
  subscription_row "EmployerSubscription"%ROWTYPE;
  grant_row "CreditLedgerEntry"%ROWTYPE;
  allocation_row "CreditLedgerEntry"%ROWTYPE;
  already_allocated bigint;
  entitlement_key "EntitlementKey";
  entitlement_amount integer;
BEGIN
  SELECT * INTO account_row FROM "CreditAccount" WHERE "id" = NEW."accountId" FOR UPDATE;
  IF NEW."kind" = 'GRANT' AND NEW."fundingSource" = 'PLAN_ALLOWANCE' THEN
    IF NEW."sourceSubscriptionId" IS NULL OR NEW."sourcePlanVersionId" IS NULL
      OR NEW."sourceOrderLineId" IS NOT NULL OR NEW."consumedGrantEntryId" IS NOT NULL THEN
      RAISE EXCEPTION 'Plan allowance grant requires its Subscription and PlanVersion source'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_plan_subscription_source_check';
    END IF;
    SELECT * INTO subscription_row FROM "EmployerSubscription"
      WHERE "id" = NEW."sourceSubscriptionId" FOR SHARE;
    entitlement_key := CASE account_row."creditType"
      WHEN 'TALENT_CONTACT' THEN 'TALENT_CONTACT_ALLOWANCE'::"EntitlementKey"
      WHEN 'JOB_BOOST' THEN 'JOB_BOOST_ALLOWANCE'::"EntitlementKey"
      ELSE NULL
    END;
    SELECT "integerValue" INTO entitlement_amount FROM "PlanEntitlement"
      WHERE "planVersionId" = NEW."sourcePlanVersionId"
        AND "key" = entitlement_key
        AND "valueType" = 'INTEGER';
    IF subscription_row."id" IS NULL
      OR subscription_row."companyId" IS DISTINCT FROM account_row."companyId"
      OR subscription_row."planVersionId" IS DISTINCT FROM NEW."sourcePlanVersionId"
      OR subscription_row."currentPeriodStart" IS DISTINCT FROM account_row."periodStart"
      OR subscription_row."currentPeriodEnd" IS DISTINCT FROM account_row."periodEnd"
      OR entitlement_amount IS NULL
      OR NEW."amount" > entitlement_amount THEN
      RAISE EXCEPTION 'Plan allowance grant exceeds its typed Subscription entitlement'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_plan_subscription_scope_check';
    END IF;
  ELSIF NEW."sourceSubscriptionId" IS NOT NULL THEN
    RAISE EXCEPTION 'Only plan allowance grants may reference a Subscription source'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_subscription_source_kind_check';
  END IF;

  IF NEW."kind" IN ('CONSUME', 'EXPIRE') THEN
    IF NEW."consumedGrantEntryId" IS NULL
      OR NEW."sourcePlanVersionId" IS NOT NULL
      OR NEW."sourceSubscriptionId" IS NOT NULL
      OR NEW."sourceOrderLineId" IS NOT NULL THEN
      RAISE EXCEPTION 'Credit allocation requires exactly one concrete Grant source'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_consume_grant_source_check';
    END IF;
    SELECT * INTO grant_row FROM "CreditLedgerEntry"
      WHERE "id" = NEW."consumedGrantEntryId" FOR UPDATE;
    SELECT COALESCE(
      -sum(allocation."amount" + COALESCE(reversal."amount", 0)),
      0
    ) INTO already_allocated
      FROM "CreditLedgerEntry" allocation
      LEFT JOIN "CreditLedgerEntry" reversal
        ON reversal."reversalOfEntryId" = allocation."id"
        AND reversal."kind" = 'REVERSAL'
      WHERE allocation."consumedGrantEntryId" = NEW."consumedGrantEntryId"
        AND allocation."kind" IN ('CONSUME', 'EXPIRE');
    IF grant_row."id" IS NULL OR grant_row."kind" <> 'GRANT'
      OR grant_row."accountId" IS DISTINCT FROM NEW."accountId"
      OR grant_row."fundingSource" IS DISTINCT FROM NEW."fundingSource"
      OR already_allocated + (-NEW."amount") > grant_row."amount" THEN
      RAISE EXCEPTION 'Credit allocation exceeds or escapes its concrete Grant'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_consume_grant_balance_check';
    END IF;
  ELSIF NEW."kind" = 'REVERSAL' THEN
    SELECT * INTO allocation_row FROM "CreditLedgerEntry"
      WHERE "id" = NEW."reversalOfEntryId" FOR UPDATE;
    IF allocation_row."id" IS NULL
      OR allocation_row."kind" <> 'CONSUME'
      OR allocation_row."consumedGrantEntryId" IS NULL THEN
      RAISE EXCEPTION 'Credit reversal must release one concrete consumed Grant'
        USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_reversal_grant_lineage_check';
    END IF;
    PERFORM 1 FROM "CreditLedgerEntry"
      WHERE "id" = allocation_row."consumedGrantEntryId" FOR UPDATE;
  ELSIF NEW."consumedGrantEntryId" IS NOT NULL THEN
    RAISE EXCEPTION 'Only consume or expire entries may reference a concrete Grant'
      USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_consume_grant_kind_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase12_credit_lineage_trigger
BEFORE INSERT ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_credit_lineage();

CREATE FUNCTION phase12_assert_order_totals(target_order uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  header "Order"%ROWTYPE;
  line_count integer;
  line_net bigint;
  line_vat bigint;
  line_total bigint;
BEGIN
  SELECT * INTO header FROM "Order" WHERE "id" = target_order;
  IF header."id" IS NULL THEN RETURN; END IF;
  SELECT count(*), COALESCE(sum("netRappen"), 0), COALESCE(sum("vatRappen"), 0), COALESCE(sum("totalRappen"), 0)
    INTO line_count, line_net, line_vat, line_total
    FROM "OrderLine" WHERE "orderId" = target_order;
  IF line_count = 0 OR header."netTotalRappen" <> line_net
    OR header."vatTotalRappen" <> line_vat OR header."totalRappen" <> line_total THEN
    RAISE EXCEPTION 'Order header totals must equal the immutable sum of its lines'
      USING ERRCODE = '23514', CONSTRAINT = 'order_line_sum_check';
  END IF;
END;
$$;

CREATE FUNCTION phase12_check_order_header_totals() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM phase12_assert_order_totals(NEW."id"); RETURN NEW; END; $$;
CREATE FUNCTION phase12_check_order_line_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM phase12_assert_order_totals(OLD."orderId");
    RETURN OLD;
  END IF;
  PERFORM phase12_assert_order_totals(NEW."orderId");
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER order_header_totals_deferred_trigger
AFTER INSERT OR UPDATE OF "netTotalRappen", "vatTotalRappen", "totalRappen" ON "Order"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION phase12_check_order_header_totals();
CREATE CONSTRAINT TRIGGER order_line_totals_deferred_trigger
AFTER INSERT OR UPDATE OR DELETE ON "OrderLine"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION phase12_check_order_line_totals();

CREATE FUNCTION phase12_assert_invoice_totals(target_invoice uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  header "Invoice"%ROWTYPE;
  line_count integer;
  line_net bigint;
  line_vat bigint;
  line_total bigint;
BEGIN
  SELECT * INTO header FROM "Invoice" WHERE "id" = target_invoice;
  IF header."id" IS NULL THEN RETURN; END IF;
  SELECT count(*), COALESCE(sum("netRappen"), 0), COALESCE(sum("vatRappen"), 0), COALESCE(sum("totalRappen"), 0)
    INTO line_count, line_net, line_vat, line_total
    FROM "InvoiceLine" WHERE "invoiceId" = target_invoice;
  IF line_count = 0 OR header."netTotalRappen" <> line_net
    OR header."vatTotalRappen" <> line_vat OR header."totalRappen" <> line_total THEN
    RAISE EXCEPTION 'Invoice header totals must equal the immutable sum of its lines'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_line_sum_check';
  END IF;
END;
$$;

CREATE FUNCTION phase12_check_invoice_header_totals() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM phase12_assert_invoice_totals(NEW."id"); RETURN NEW; END; $$;
CREATE FUNCTION phase12_check_invoice_line_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM phase12_assert_invoice_totals(OLD."invoiceId");
    RETURN OLD;
  END IF;
  PERFORM phase12_assert_invoice_totals(NEW."invoiceId");
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER invoice_header_totals_deferred_trigger
AFTER INSERT OR UPDATE OF "netTotalRappen", "vatTotalRappen", "totalRappen" ON "Invoice"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION phase12_check_invoice_header_totals();
CREATE CONSTRAINT TRIGGER invoice_line_totals_deferred_trigger
AFTER INSERT OR UPDATE OR DELETE ON "InvoiceLine"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION phase12_check_invoice_line_totals();
