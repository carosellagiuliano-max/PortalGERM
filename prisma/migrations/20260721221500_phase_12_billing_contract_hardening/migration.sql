-- Phase 12 billing contract hardening.
--
-- The ledger, retained-seat decisions, tax snapshots and paid invoice copy are
-- commercial evidence.  These guards keep that evidence bound to the exact
-- tenant and source rows from which it was created.

CREATE FUNCTION phase12_enforce_credit_account_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'CreditAccount commercial identity and period are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'credit_account_commercial_snapshot_immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER phase12_credit_account_immutable_trigger
BEFORE UPDATE OR DELETE ON "CreditAccount"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_credit_account_immutable();

CREATE FUNCTION phase12_enforce_subscription_order_retained_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_company uuid;
  retained_owner_membership uuid;
BEGIN
  IF NEW."retainedDefaultOwnerId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT orders."companyId"
    INTO order_company
    FROM "OrderLine" AS line
    JOIN "Order" AS orders ON orders."id" = line."orderId"
   WHERE line."id" = NEW."orderLineId"
   FOR SHARE OF orders;

  SELECT membership."id"
    INTO retained_owner_membership
    FROM "CompanyMembership" AS membership
   WHERE membership."companyId" = order_company
     AND membership."userId" = NEW."retainedDefaultOwnerId"
     AND membership."role" = 'OWNER'
     AND membership."status" = 'ACTIVE'
     AND membership."removedAt" IS NULL
     AND membership."id"::text = ANY(NEW."retainedMembershipIds")
   FOR SHARE;

  IF order_company IS NULL OR retained_owner_membership IS NULL THEN
    RAISE EXCEPTION 'Subscription quote retained Owner membership must be included in retained Seats'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_order_snapshot_retained_owner_membership_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER phase12_subscription_order_retained_owner_trigger
BEFORE INSERT
ON "SubscriptionOrderSnapshot"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_subscription_order_retained_owner();

CREATE FUNCTION phase12_enforce_subscription_change_retained_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  retained_owner_membership uuid;
BEGIN
  SELECT membership."id"
    INTO retained_owner_membership
    FROM "CompanyMembership" AS membership
   WHERE membership."companyId" = NEW."companyId"
     AND membership."userId" = NEW."retainedDefaultOwnerId"
     AND membership."role" = 'OWNER'
     AND membership."status" = 'ACTIVE'
     AND membership."removedAt" IS NULL
     AND membership."id"::text = ANY(NEW."retainedMembershipIds")
   FOR SHARE;

  IF retained_owner_membership IS NULL THEN
    RAISE EXCEPTION 'Subscription change retained Owner membership must be included in retained Seats'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_change_retained_owner_membership_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER phase12_subscription_change_retained_owner_trigger
BEFORE INSERT
ON "SubscriptionChangeSchedule"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_subscription_change_retained_owner();

-- A composite foreign key makes the copied basis-point value a true snapshot
-- contract and also prevents a referenced draft TaxRateVersion from being
-- rewritten underneath an existing OrderLine.
ALTER TABLE "TaxRateVersion"
  ADD CONSTRAINT "tax_rate_version_id_basis_points_unique"
  UNIQUE ("id", "rateBasisPoints");

ALTER TABLE "OrderLine"
  ADD CONSTRAINT "order_line_tax_rate_snapshot_fkey"
  FOREIGN KEY ("taxRateVersionId", "taxRateBasisPoints")
  REFERENCES "TaxRateVersion"("id", "rateBasisPoints")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION phase12_enforce_invoice_order_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_row "Order"%ROWTYPE;
BEGIN
  SELECT *
    INTO order_row
    FROM "Order"
   WHERE "id" = NEW."orderId"
   FOR SHARE;

  -- Existing foreign keys own missing/cross-company reference errors.  Let
  -- those more specific contracts fire before checking a valid scoped copy.
  IF order_row."id" IS NULL
    OR NEW."companyId" IS DISTINCT FROM order_row."companyId" THEN
    RETURN NEW;
  END IF;

  IF order_row."status" <> 'PAID'
    OR NEW."billingLegalNameSnapshot" IS DISTINCT FROM order_row."billingLegalNameSnapshot"
    OR NEW."billingContactEmailSnapshot" IS DISTINCT FROM order_row."billingContactEmailSnapshot"
    OR NEW."billingStreetSnapshot" IS DISTINCT FROM order_row."billingStreetSnapshot"
    OR NEW."billingPostalCodeSnapshot" IS DISTINCT FROM order_row."billingPostalCodeSnapshot"
    OR NEW."billingCitySnapshot" IS DISTINCT FROM order_row."billingCitySnapshot"
    OR NEW."billingCountryCodeSnapshot" IS DISTINCT FROM order_row."billingCountryCodeSnapshot"
    OR NEW."billingUidSnapshot" IS DISTINCT FROM order_row."billingUidSnapshot"
    OR NEW."billingVatNumberSnapshot" IS DISTINCT FROM order_row."billingVatNumberSnapshot"
    OR NEW."currency" IS DISTINCT FROM order_row."currency"
    OR NEW."netTotalRappen" IS DISTINCT FROM order_row."netTotalRappen"
    OR NEW."vatTotalRappen" IS DISTINCT FROM order_row."vatTotalRappen"
    OR NEW."totalRappen" IS DISTINCT FROM order_row."totalRappen" THEN
    RAISE EXCEPTION 'Invoice header must exactly copy its paid Order snapshot'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_paid_order_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER phase12_invoice_order_snapshot_trigger
BEFORE INSERT OR UPDATE OF
  "orderId", "companyId", "billingLegalNameSnapshot",
  "billingContactEmailSnapshot", "billingStreetSnapshot",
  "billingPostalCodeSnapshot", "billingCitySnapshot",
  "billingCountryCodeSnapshot", "billingUidSnapshot",
  "billingVatNumberSnapshot", "currency", "netTotalRappen",
  "vatTotalRappen", "totalRappen"
ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_invoice_order_snapshot();

CREATE OR REPLACE FUNCTION enforce_invoice_line_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_order uuid;
  line_row "OrderLine"%ROWTYPE;
BEGIN
  SELECT "orderId" INTO invoice_order
    FROM "Invoice"
   WHERE "id" = NEW."invoiceId"
   FOR SHARE;

  SELECT * INTO line_row
    FROM "OrderLine"
   WHERE "id" = NEW."orderLineId"
   FOR SHARE;

  IF invoice_order IS NULL
    OR line_row."id" IS NULL
    OR invoice_order IS DISTINCT FROM line_row."orderId" THEN
    RAISE EXCEPTION 'InvoiceLine must snapshot an OrderLine from the same Order'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_line_order_scope_check';
  END IF;

  IF NEW."descriptionSnapshot" IS DISTINCT FROM line_row."descriptionSnapshot"
    OR NEW."quantity" IS DISTINCT FROM line_row."quantity"
    OR NEW."unitNetRappen" IS DISTINCT FROM line_row."unitNetRappen"
    OR NEW."netRappen" IS DISTINCT FROM line_row."netRappen"
    OR NEW."taxRateBasisPoints" IS DISTINCT FROM line_row."taxRateBasisPoints"
    OR NEW."vatRappen" IS DISTINCT FROM line_row."vatRappen"
    OR NEW."totalRappen" IS DISTINCT FROM line_row."totalRappen"
    OR NEW."currency" IS DISTINCT FROM line_row."currency" THEN
    RAISE EXCEPTION 'InvoiceLine must exactly copy its OrderLine snapshot'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_line_order_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$;

-- Freeze the Invoice commercial snapshot at creation while retaining the
-- legitimate DRAFT -> ISSUED -> PAID or DRAFT -> ISSUED -> VOID lifecycle.
CREATE OR REPLACE FUNCTION enforce_invoice_lifecycle_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  same_projection boolean;
  draft_to_issued boolean;
  issued_to_paid boolean;
  issued_to_void boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoice financial snapshot is immutable outside its lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_released_immutable';
  END IF;

  same_projection := OLD."status" = NEW."status"
    AND OLD."issuedAt" IS NOT DISTINCT FROM NEW."issuedAt"
    AND OLD."paidAt" IS NOT DISTINCT FROM NEW."paidAt"
    AND OLD."voidedAt" IS NOT DISTINCT FROM NEW."voidedAt";
  draft_to_issued := OLD."status" = 'DRAFT'
    AND NEW."status" = 'ISSUED'
    AND OLD."issuedAt" IS NULL
    AND NEW."issuedAt" IS NOT NULL
    AND NEW."paidAt" IS NULL
    AND NEW."voidedAt" IS NULL;
  issued_to_paid := OLD."status" = 'ISSUED'
    AND NEW."status" = 'PAID'
    AND OLD."issuedAt" IS NOT DISTINCT FROM NEW."issuedAt"
    AND OLD."paidAt" IS NULL
    AND NEW."paidAt" IS NOT NULL
    AND NEW."voidedAt" IS NULL;
  issued_to_void := OLD."status" = 'ISSUED'
    AND NEW."status" = 'VOID'
    AND OLD."issuedAt" IS NOT DISTINCT FROM NEW."issuedAt"
    AND NEW."paidAt" IS NULL
    AND OLD."voidedAt" IS NULL
    AND NEW."voidedAt" IS NOT NULL;

  IF (to_jsonb(OLD) - ARRAY['status', 'issuedAt', 'paidAt', 'voidedAt'])
      IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['status', 'issuedAt', 'paidAt', 'voidedAt'])
    OR NOT (same_projection OR draft_to_issued OR issued_to_paid OR issued_to_void) THEN
    RAISE EXCEPTION 'Invoice financial snapshot is immutable outside its lifecycle projection'
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_released_immutable';
  END IF;

  RETURN NEW;
END;
$$;
