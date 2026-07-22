-- A release decision is consumed when a controlled ProductVersion is
-- scheduled. A delayed SCHEDULED -> ACTIVE projection must not invalidate the
-- already-approved version merely because the decision evidence has since
-- reached its expiry boundary.
ALTER TYPE "AuditAction" ADD VALUE 'ORDER_EXPIRED' AFTER 'ORDER_CANCELLED';

CREATE OR REPLACE FUNCTION enforce_product_release_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  product_row "Product"%ROWTYPE;
  decision_row "ProductReleaseDecision"%ROWTYPE;
  expected_tier text;
  decision_required boolean := false;
  decision_freshness_required boolean := false;
BEGIN
  SELECT * INTO product_row FROM "Product" WHERE "id" = NEW."productId";
  IF product_row."id" IS NULL THEN
    RETURN NEW;
  END IF;

  IF product_row."type" = 'SUCCESS_FEE' THEN
    IF NEW."status" IN ('SCHEDULED', 'ACTIVE') OR NEW."isPublic" OR NEW."isSelfService" THEN
      RAISE EXCEPTION 'Success Fee cannot be released'
        USING ERRCODE = '23514', CONSTRAINT = 'success_fee_release_disabled';
    END IF;
    IF NEW."releaseDecisionId" IS NOT NULL THEN
      RAISE EXCEPTION 'Success Fee cannot consume a release decision'
        USING ERRCODE = '23514', CONSTRAINT = 'success_fee_release_disabled';
    END IF;
    RETURN NEW;
  END IF;

  IF product_row."type" IN ('ADDITIONAL_JOB', 'IMPORT_SETUP') THEN
    expected_tier := 'P1';
    decision_required := NEW."status" IN ('SCHEDULED', 'ACTIVE');
  ELSIF product_row."type" IN ('FEATURED_JOB', 'FEATURED_EMPLOYER', 'NEWSLETTER', 'SOCIAL_PUSH') THEN
    expected_tier := 'P2';
    IF NEW."status" IN ('SCHEDULED', 'ACTIVE') OR NEW."isPublic" OR NEW."isSelfService" THEN
      RAISE EXCEPTION 'P2 lacks its inventory/channel requirement and remains inactive'
        USING ERRCODE = '23514', CONSTRAINT = 'p2_release_disabled';
    END IF;
  END IF;

  IF product_row."type" = 'ADDITIONAL_JOB' AND NEW."status" IN ('SCHEDULED', 'ACTIVE') THEN
    IF NEW."netPriceRappen" <> 12900 OR NEW."durationDays" <> 30
      OR NEW."creditType" IS NOT NULL OR NEW."creditAmount" IS NOT NULL
      OR NOT NEW."isPublic" OR NOT NEW."isSelfService"
      OR NEW."requiresLegalReview" THEN
      RAISE EXCEPTION 'Additional Job release contract is invalid'
        USING ERRCODE = '23514', CONSTRAINT = 'additional_job_release_contract';
    END IF;
  ELSIF product_row."type" = 'IMPORT_SETUP' AND NEW."status" IN ('SCHEDULED', 'ACTIVE') THEN
    IF NEW."netPriceRappen" <> 75000 OR NEW."durationDays" IS NOT NULL
      OR NEW."creditType" IS NOT NULL OR NEW."creditAmount" IS NOT NULL
      OR NEW."isPublic" OR NEW."isSelfService"
      OR NEW."requiresLegalReview" THEN
      RAISE EXCEPTION 'Import Setup must remain a private approved service'
        USING ERRCODE = '23514', CONSTRAINT = 'import_setup_release_contract';
    END IF;
  ELSIF expected_tier = 'P2' AND NEW."isSelfService" THEN
    RAISE EXCEPTION 'P2 has no registered self-service fulfillment handler'
      USING ERRCODE = '23514', CONSTRAINT = 'p2_fulfillment_handler_missing';
  END IF;

  IF decision_required AND NEW."releaseDecisionId" IS NULL THEN
    RAISE EXCEPTION 'P1/P2 release requires an explicit Admin decision'
      USING ERRCODE = '23514', CONSTRAINT = 'product_release_decision_required';
  END IF;

  IF decision_required THEN
    IF TG_OP = 'INSERT' THEN
      decision_freshness_required := true;
    ELSE
      decision_freshness_required :=
        NEW."releaseDecisionId" IS DISTINCT FROM OLD."releaseDecisionId"
        OR OLD."status" NOT IN ('SCHEDULED', 'ACTIVE');
    END IF;
  END IF;

  IF NEW."releaseDecisionId" IS NOT NULL THEN
    SELECT * INTO decision_row
      FROM "ProductReleaseDecision"
      WHERE "id" = NEW."releaseDecisionId";
    IF decision_row."id" IS NULL
      OR decision_row."productId" <> NEW."productId"
      OR decision_row."releaseTier" <> expected_tier
      OR decision_row."allowsPublic" <> NEW."isPublic"
      OR decision_row."allowsSelfService" <> NEW."isSelfService"
      OR (decision_freshness_required
        AND (decision_row."expiresAt" <= CURRENT_TIMESTAMP
          OR decision_row."expiresAt" <= NEW."validFrom")) THEN
      RAISE EXCEPTION 'Release decision does not match the exact ProductVersion scope'
        USING ERRCODE = '23514', CONSTRAINT = 'product_release_decision_scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Paid permit scope and lifetime are immutable. Only explicit one-way
-- lifecycle transitions are allowed, and DELETE is forbidden so fulfillment
-- evidence remains reconstructable.
CREATE OR REPLACE FUNCTION enforce_additional_job_permit_fulfillment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_company uuid;
  source_job uuid;
  source_status "OrderStatus";
  source_paid_at timestamptz;
  source_context "FulfillmentContextType";
  source_type "ProductType";
  source_price integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Additional Job Permit fulfillment evidence cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'additional_job_permit_immutable';
  END IF;

  SELECT o."companyId", ol."targetJobId", o."status", o."paidAt",
      ol."fulfillmentContext", p."type", pv."netPriceRappen"
    INTO source_company, source_job, source_status, source_paid_at,
      source_context, source_type, source_price
    FROM "OrderLine" ol
    JOIN "Order" o ON o."id" = ol."orderId"
    JOIN "ProductVersion" pv ON pv."id" = ol."productVersionId"
    JOIN "Product" p ON p."id" = pv."productId"
    WHERE ol."id" = NEW."orderLineId";

  IF source_company IS DISTINCT FROM NEW."companyId"
    OR source_job IS DISTINCT FROM NEW."targetJobId"
    OR source_status <> 'PAID' OR source_paid_at IS NULL
    OR source_context <> 'ADDITIONAL_JOB'
    OR source_type <> 'ADDITIONAL_JOB' OR source_price <> 12900
    OR NEW."activatedAt" IS DISTINCT FROM source_paid_at
    OR NEW."validFrom" IS DISTINCT FROM source_paid_at
    OR NEW."validTo" IS DISTINCT FROM source_paid_at + INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Additional Job Permit must exactly fulfill one paid eligible line'
      USING ERRCODE = '23514', CONSTRAINT = 'additional_job_permit_fulfillment_scope';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE'
      OR NEW."consumedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Additional Job Permit must start active and unconsumed'
        USING ERRCODE = '23514', CONSTRAINT = 'additional_job_permit_lifecycle';
    END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
      OR NEW."targetJobId" IS DISTINCT FROM OLD."targetJobId"
      OR NEW."orderLineId" IS DISTINCT FROM OLD."orderLineId"
      OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom"
      OR NEW."validTo" IS DISTINCT FROM OLD."validTo"
      OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR NOT (
        (NEW."status" = OLD."status"
          AND NEW."consumedAt" IS NOT DISTINCT FROM OLD."consumedAt"
          AND NEW."revokedAt" IS NOT DISTINCT FROM OLD."revokedAt")
        OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'CONSUMED'
          AND OLD."consumedAt" IS NULL AND NEW."consumedAt" IS NOT NULL
          AND NEW."consumedAt" >= NEW."validFrom"
          AND NEW."consumedAt" < NEW."validTo"
          AND NEW."revokedAt" IS NULL)
        OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED'
          AND NEW."consumedAt" IS NULL
          AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
          AND NEW."revokedAt" >= NEW."validFrom")
        OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'EXPIRED'
          AND NEW."consumedAt" IS NULL AND NEW."revokedAt" IS NULL
          AND CURRENT_TIMESTAMP >= NEW."validTo")
      ) THEN
      RAISE EXCEPTION 'Additional Job Permit scope is immutable and lifecycle is restricted'
        USING ERRCODE = '23514', CONSTRAINT = 'additional_job_permit_lifecycle';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER additional_job_permit_fulfillment_trigger ON "AdditionalJobPermit";
CREATE TRIGGER additional_job_permit_fulfillment_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "AdditionalJobPermit"
FOR EACH ROW EXECUTE FUNCTION enforce_additional_job_permit_fulfillment();

-- Import Access Grant rows are durable paid-fulfillment evidence. The existing
-- lifecycle trigger constrains INSERT and UPDATE; this companion trigger makes
-- deletion fail closed as well.
CREATE FUNCTION prevent_import_access_grant_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Import Access Grant fulfillment evidence cannot be deleted'
    USING ERRCODE = '23514', CONSTRAINT = 'import_access_grant_immutable';
END;
$$;

CREATE TRIGGER import_access_grant_delete_trigger
BEFORE DELETE ON "ImportAccessGrant"
FOR EACH ROW EXECUTE FUNCTION prevent_import_access_grant_delete();
