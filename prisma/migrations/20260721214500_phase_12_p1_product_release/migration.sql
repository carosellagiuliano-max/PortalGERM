-- Phase 12 P1 fulfillment and explicit P1/P2 release decisions.
-- Decisions are immutable, single-use Admin evidence; they do not make a
-- product fulfillable by themselves and never enable Success Fee.

ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_RELEASE_DECIDED' AFTER 'CATALOG_VERSION_SCHEDULED';
ALTER TYPE "AuditTargetType" ADD VALUE 'PRODUCT_RELEASE_DECISION' AFTER 'PRODUCT_VERSION';

CREATE TABLE "ProductReleaseDecision" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "releaseTier" VARCHAR(2) NOT NULL,
  "allowsPublic" BOOLEAN NOT NULL,
  "allowsSelfService" BOOLEAN NOT NULL,
  "reasonCode" VARCHAR(64) NOT NULL,
  "rationale" VARCHAR(1000) NOT NULL,
  "decidedByUserId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductReleaseDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_release_decision_contract_check" CHECK (
    "releaseTier" IN ('P1', 'P2')
    AND "reasonCode" ~ '^[A-Z][A-Z0-9_]{1,63}$'
    AND char_length(btrim("rationale")) BETWEEN 20 AND 1000
    AND "createdAt" < "expiresAt"
  ),
  CONSTRAINT "ProductReleaseDecision_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductReleaseDecision_decidedByUserId_fkey"
    FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductReleaseDecision_idempotencyKey_key"
  ON "ProductReleaseDecision"("idempotencyKey");
CREATE INDEX "ProductReleaseDecision_productId_expiresAt_idx"
  ON "ProductReleaseDecision"("productId", "expiresAt");

ALTER TABLE "ProductVersion"
  ADD COLUMN "releaseDecisionId" UUID;
CREATE UNIQUE INDEX "ProductVersion_releaseDecisionId_key"
  ON "ProductVersion"("releaseDecisionId");
ALTER TABLE "ProductVersion"
  ADD CONSTRAINT "ProductVersion_releaseDecisionId_fkey"
  FOREIGN KEY ("releaseDecisionId") REFERENCES "ProductReleaseDecision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderLine"
  ADD COLUMN "targetImportSetupApprovalId" UUID;
CREATE UNIQUE INDEX "OrderLine_targetImportSetupApprovalId_key"
  ON "OrderLine"("targetImportSetupApprovalId");
ALTER TABLE "OrderLine"
  ADD CONSTRAINT "OrderLine_targetImportSetupApprovalId_fkey"
  FOREIGN KEY ("targetImportSetupApprovalId") REFERENCES "ImportSetupApproval"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The Phase-02 status-only unique indexes treated already elapsed historical
-- rows as permanently active. Half-open overlap constraints preserve history
-- while still serializing current/future grants and permits.
DROP INDEX "additional_job_permit_active_company_unique";
DROP INDEX "additional_job_permit_active_job_unique";
DROP INDEX "import_access_grant_active_source_unique";
ALTER TABLE "AdditionalJobPermit"
  ADD CONSTRAINT "additional_job_permit_company_range_excl"
  EXCLUDE USING gist (
    "companyId" WITH =,
    tstzrange("validFrom", "validTo", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));
ALTER TABLE "AdditionalJobPermit"
  ADD CONSTRAINT "additional_job_permit_job_range_excl"
  EXCLUDE USING gist (
    "targetJobId" WITH =,
    tstzrange("validFrom", "validTo", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));
ALTER TABLE "ImportAccessGrant"
  ADD CONSTRAINT "import_access_grant_source_range_excl"
  EXCLUDE USING gist (
    "companyId" WITH =,
    "importSourceId" WITH =,
    tstzrange("validFrom", "validTo", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));

CREATE FUNCTION enforce_product_release_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  product_row "Product"%ROWTYPE;
  decision_row "ProductReleaseDecision"%ROWTYPE;
  expected_tier text;
  decision_required boolean := false;
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
  IF NEW."releaseDecisionId" IS NOT NULL THEN
    SELECT * INTO decision_row
      FROM "ProductReleaseDecision"
      WHERE "id" = NEW."releaseDecisionId";
    IF decision_row."id" IS NULL
      OR decision_row."productId" <> NEW."productId"
      OR decision_row."releaseTier" <> expected_tier
      OR decision_row."allowsPublic" <> NEW."isPublic"
      OR decision_row."allowsSelfService" <> NEW."isSelfService"
      OR (NEW."status" IN ('SCHEDULED', 'ACTIVE')
        AND (decision_row."expiresAt" <= CURRENT_TIMESTAMP
          OR decision_row."expiresAt" <= NEW."validFrom")) THEN
      RAISE EXCEPTION 'Release decision does not match the exact ProductVersion scope'
        USING ERRCODE = '23514', CONSTRAINT = 'product_release_decision_scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_release_decision_trigger
BEFORE INSERT OR UPDATE OF "status", "productId", "netPriceRappen",
  "durationDays", "creditType", "creditAmount", "isPublic",
  "isSelfService", "requiresLegalReview", "releaseDecisionId"
ON "ProductVersion"
FOR EACH ROW EXECUTE FUNCTION enforce_product_release_decision();

CREATE FUNCTION enforce_product_release_decision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Product release decisions are immutable, single-use evidence'
    USING ERRCODE = '23514', CONSTRAINT = 'product_release_decision_immutable';
END;
$$;

CREATE TRIGGER product_release_decision_immutable_trigger
BEFORE UPDATE OR DELETE ON "ProductReleaseDecision"
FOR EACH ROW EXECUTE FUNCTION enforce_product_release_decision_immutable();

-- Extend the canonical typed OrderLine context with the exact Import approval.
CREATE OR REPLACE FUNCTION enforce_order_line_context() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_company uuid;
  product_type "ProductType";
  product_credit_type "CreditType";
  product_credit_amount integer;
  target_company uuid;
  approval_company uuid;
  approval_source uuid;
  approval_status "ImportSetupApprovalStatus";
  approval_valid_until timestamptz;
  approval_fulfilled_line uuid;
BEGIN
  SELECT "companyId" INTO order_company FROM "Order" WHERE "id" = NEW."orderId";
  IF num_nonnulls(NEW."planVersionId", NEW."productVersionId") <> 1 THEN
    RAISE EXCEPTION 'OrderLine requires exactly one catalog version'
      USING ERRCODE = '23514', CONSTRAINT = 'order_line_catalog_reference_xor_check';
  END IF;
  IF NEW."planVersionId" IS NOT NULL THEN
    IF NEW."fulfillmentContext" <> 'SUBSCRIPTION'
      OR num_nonnulls(NEW."targetJobId", NEW."targetImportSourceId",
        NEW."targetImportSetupApprovalId", NEW."targetCreditType") <> 0 THEN
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
          OR NEW."targetImportSourceId" IS NOT NULL
          OR NEW."targetImportSetupApprovalId" IS NOT NULL
          OR NEW."targetCreditType" IS NOT NULL THEN
          RAISE EXCEPTION 'Job Boost line requires its owned target Job'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      WHEN 'ADDITIONAL_JOB' THEN
        IF NEW."fulfillmentContext" <> 'ADDITIONAL_JOB' OR NEW."targetJobId" IS NULL
          OR NEW."targetImportSourceId" IS NOT NULL
          OR NEW."targetImportSetupApprovalId" IS NOT NULL
          OR NEW."targetCreditType" IS NOT NULL THEN
          RAISE EXCEPTION 'Additional Job line requires its owned target Job'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      WHEN 'IMPORT_SETUP' THEN
        IF NEW."fulfillmentContext" <> 'IMPORT_SETUP'
          OR NEW."targetImportSourceId" IS NULL
          OR NEW."targetImportSetupApprovalId" IS NULL
          OR NEW."targetJobId" IS NOT NULL OR NEW."targetCreditType" IS NOT NULL THEN
          RAISE EXCEPTION 'Import Setup line requires its exact approval and source context'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      WHEN 'CONTACT_PACK' THEN
        IF NEW."fulfillmentContext" <> 'CONTACT_PACK'
          OR NEW."targetCreditType" <> 'TALENT_CONTACT'
          OR product_credit_type IS DISTINCT FROM 'TALENT_CONTACT'
          OR COALESCE(product_credit_amount, 0) <= 0
          OR NEW."targetJobId" IS NOT NULL OR NEW."targetImportSourceId" IS NOT NULL
          OR NEW."targetImportSetupApprovalId" IS NOT NULL THEN
          RAISE EXCEPTION 'Contact Pack line requires the typed Talent Contact context'
            USING ERRCODE = '23514', CONSTRAINT = 'order_line_fulfillment_context_check';
        END IF;
      ELSE
        RAISE EXCEPTION 'Product type has no registered OrderLine handler'
          USING ERRCODE = '23514', CONSTRAINT = 'order_line_product_handler_gate_check';
    END CASE;
    IF NEW."targetJobId" IS NOT NULL THEN
      SELECT "companyId" INTO target_company FROM "Job" WHERE "id" = NEW."targetJobId";
      IF target_company IS NULL OR target_company <> order_company THEN
        RAISE EXCEPTION 'OrderLine target Job is outside the Order company'
          USING ERRCODE = '23514', CONSTRAINT = 'order_line_target_company_check';
      END IF;
    END IF;
    IF NEW."targetImportSetupApprovalId" IS NOT NULL THEN
      SELECT "companyId", "importSourceId", "status", "validUntil", "orderLineId"
        INTO approval_company, approval_source, approval_status,
          approval_valid_until, approval_fulfilled_line
        FROM "ImportSetupApproval"
        WHERE "id" = NEW."targetImportSetupApprovalId" FOR UPDATE;
      IF approval_company IS DISTINCT FROM order_company
        OR approval_source IS DISTINCT FROM NEW."targetImportSourceId"
        OR approval_status <> 'APPROVED'
        OR approval_valid_until <= CURRENT_TIMESTAMP
        OR approval_fulfilled_line IS NOT NULL THEN
        RAISE EXCEPTION 'Import Setup approval is not current and company/source scoped'
          USING ERRCODE = '23514', CONSTRAINT = 'order_line_import_approval_scope_check';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_import_setup_approval_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Import Setup approval evidence cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'import_setup_approval_immutable';
  END IF;
  IF OLD."companyId" <> NEW."companyId"
    OR OLD."importSourceId" <> NEW."importSourceId"
    OR OLD."sourceRightsEvidence" <> NEW."sourceRightsEvidence"
    OR OLD."mappingEvidence" <> NEW."mappingEvidence"
    OR OLD."approvedByUserId" IS DISTINCT FROM NEW."approvedByUserId"
    OR OLD."approvalReason" IS DISTINCT FROM NEW."approvalReason"
    OR OLD."validUntil" <> NEW."validUntil"
    OR OLD."idempotencyKey" <> NEW."idempotencyKey"
    OR OLD."createdAt" <> NEW."createdAt"
    OR NOT (
      (OLD."status" = NEW."status" AND OLD."orderLineId" IS NOT DISTINCT FROM NEW."orderLineId")
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('REVOKED', 'EXPIRED')
        AND OLD."orderLineId" IS NULL AND NEW."orderLineId" IS NULL)
      OR (OLD."status" = 'APPROVED' AND NEW."status" = 'USED'
        AND OLD."orderLineId" IS NULL AND NEW."orderLineId" IS NOT NULL)
    ) THEN
    RAISE EXCEPTION 'Import Setup approval evidence is immutable and may be fulfilled once'
      USING ERRCODE = '23514', CONSTRAINT = 'import_setup_approval_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_setup_approval_lifecycle_trigger
BEFORE UPDATE OR DELETE ON "ImportSetupApproval"
FOR EACH ROW EXECUTE FUNCTION enforce_import_setup_approval_lifecycle();

CREATE FUNCTION enforce_additional_job_permit_fulfillment() RETURNS trigger
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
    OR source_status <> 'PAID' OR source_context <> 'ADDITIONAL_JOB'
    OR source_type <> 'ADDITIONAL_JOB' OR source_price <> 12900
    OR NEW."status" <> 'ACTIVE' OR NEW."activatedAt" IS DISTINCT FROM source_paid_at
    OR NEW."validFrom" IS DISTINCT FROM source_paid_at
    OR NEW."validTo" IS DISTINCT FROM source_paid_at + INTERVAL '30 days'
    OR NEW."consumedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Additional Job Permit must exactly fulfill one paid eligible line'
      USING ERRCODE = '23514', CONSTRAINT = 'additional_job_permit_fulfillment_scope';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER additional_job_permit_fulfillment_trigger
BEFORE INSERT ON "AdditionalJobPermit"
FOR EACH ROW EXECUTE FUNCTION enforce_additional_job_permit_fulfillment();

CREATE FUNCTION enforce_import_access_grant_fulfillment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_company uuid;
  source_import_source uuid;
  source_approval uuid;
  source_status "OrderStatus";
  source_paid_at timestamptz;
  source_context "FulfillmentContextType";
  source_type "ProductType";
  source_price integer;
  approval_status "ImportSetupApprovalStatus";
  approval_line uuid;
  expected_valid_to timestamptz;
BEGIN
  SELECT o."companyId", ol."targetImportSourceId",
      ol."targetImportSetupApprovalId", o."status", o."paidAt",
      ol."fulfillmentContext", p."type", pv."netPriceRappen"
    INTO source_company, source_import_source, source_approval,
      source_status, source_paid_at, source_context, source_type, source_price
    FROM "OrderLine" ol
    JOIN "Order" o ON o."id" = ol."orderId"
    JOIN "ProductVersion" pv ON pv."id" = ol."productVersionId"
    JOIN "Product" p ON p."id" = pv."productId"
    WHERE ol."id" = NEW."orderLineId";
  SELECT "status", "orderLineId" INTO approval_status, approval_line
    FROM "ImportSetupApproval" WHERE "id" = NEW."importSetupApprovalId";
  -- Product contract: twelve calendar months in Europe/Zurich, preserving the
  -- local wall time and PostgreSQL's end-of-month clamping (not 365 days).
  expected_valid_to :=
    ((source_paid_at AT TIME ZONE 'Europe/Zurich') + INTERVAL '12 months')
      AT TIME ZONE 'Europe/Zurich';
  IF source_company IS DISTINCT FROM NEW."companyId"
    OR source_import_source IS DISTINCT FROM NEW."importSourceId"
    OR source_approval IS DISTINCT FROM NEW."importSetupApprovalId"
    OR source_status <> 'PAID' OR source_context <> 'IMPORT_SETUP'
    OR source_type <> 'IMPORT_SETUP' OR source_price <> 75000
    OR approval_status <> 'USED' OR approval_line IS DISTINCT FROM NEW."orderLineId"
    OR NEW."validFrom" IS DISTINCT FROM source_paid_at
    OR NEW."validTo" IS DISTINCT FROM expected_valid_to
  THEN
    RAISE EXCEPTION 'Import Access Grant must exactly fulfill one used approved paid line'
      USING ERRCODE = '23514', CONSTRAINT = 'import_access_grant_fulfillment_scope';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Import Access Grant must start active and unrevoked'
        USING ERRCODE = '23514', CONSTRAINT = 'import_access_grant_lifecycle';
    END IF;
  ELSE
    IF NEW."companyId" IS DISTINCT FROM OLD."companyId"
      OR NEW."importSourceId" IS DISTINCT FROM OLD."importSourceId"
      OR NEW."importSetupApprovalId" IS DISTINCT FROM OLD."importSetupApprovalId"
      OR NEW."orderLineId" IS DISTINCT FROM OLD."orderLineId"
      OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom"
      OR NEW."validTo" IS DISTINCT FROM OLD."validTo"
      OR NEW."auditCorrelationId" IS DISTINCT FROM OLD."auditCorrelationId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR NOT (
        (NEW."status" = OLD."status"
          AND NEW."revokedAt" IS NOT DISTINCT FROM OLD."revokedAt")
        OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED'
          AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
          AND NEW."revokedAt" >= NEW."validFrom")
        OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'EXPIRED'
          AND NEW."revokedAt" IS NULL AND CURRENT_TIMESTAMP >= NEW."validTo")
      )
    THEN
      RAISE EXCEPTION 'Import Access Grant scope is immutable and lifecycle is restricted'
        USING ERRCODE = '23514', CONSTRAINT = 'import_access_grant_lifecycle';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_access_grant_fulfillment_trigger
BEFORE INSERT OR UPDATE ON "ImportAccessGrant"
FOR EACH ROW EXECUTE FUNCTION enforce_import_access_grant_fulfillment();
