-- Phase 08 adds a structured, privacy-bounded public employer intake. Existing
-- Phase-05 demo leads remain valid because every new projection field is nullable.
ALTER TYPE "SalesActivityKind" ADD VALUE 'INTAKE_RECEIVED' BEFORE 'NOTE';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_SUBMITTED' BEFORE 'LEAD_STATUS_CHANGED';

ALTER TABLE "SalesLead"
  ADD COLUMN "organizationName" VARCHAR(200),
  ADD COLUMN "contactName" VARCHAR(160),
  ADD COLUMN "phoneNormalized" VARCHAR(32),
  ADD COLUMN "companySizeCode" VARCHAR(64),
  ADD COLUMN "hiringNeedCode" VARCHAR(64),
  ADD COLUMN "interestCode" VARCHAR(64),
  ADD COLUMN "callbackWindowCode" VARCHAR(64),
  ADD COLUMN "message" VARCHAR(2000),
  ADD COLUMN "noticeVersion" VARCHAR(32),
  ADD COLUMN "noticeHash" CHAR(64),
  ADD COLUMN "slaPolicyVersion" VARCHAR(32),
  ADD COLUMN "dueAt" TIMESTAMPTZ(3),
  ADD COLUMN "interestedPlanVersionId" UUID;

ALTER TABLE "SalesLead"
  ADD CONSTRAINT "SalesLead_interestedPlanVersionId_fkey"
    FOREIGN KEY ("interestedPlanVersionId") REFERENCES "PlanVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesLead_phone_normalized_check"
    CHECK ("phoneNormalized" IS NULL OR "phoneNormalized" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "SalesLead_company_size_code_check"
    CHECK (
      "companySizeCode" IS NULL OR "companySizeCode" IN
      ('1_9', '10_49', '50_249', '250_999', '1000_PLUS')
    ),
  ADD CONSTRAINT "SalesLead_hiring_need_code_check"
    CHECK (
      "hiringNeedCode" IS NULL OR "hiringNeedCode" IN
      ('ONE_ROLE', 'TWO_TO_FIVE', 'SIX_TO_TWENTY', 'TWENTY_PLUS', 'EXPLORING')
    ),
  ADD CONSTRAINT "SalesLead_interest_code_check"
    CHECK (
      "interestCode" IS NULL OR "interestCode" IN
      ('GENERAL', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE', 'IMPORT')
    ),
  ADD CONSTRAINT "SalesLead_callback_window_code_check"
    CHECK (
      "callbackWindowCode" IS NULL OR "callbackWindowCode" IN
      ('MORNING', 'AFTERNOON', 'ANYTIME')
    ),
  ADD CONSTRAINT "SalesLead_notice_hash_check"
    CHECK ("noticeHash" IS NULL OR "noticeHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "SalesLead_structured_intake_check"
    CHECK (
      "organizationName" IS NULL OR (
        "contactName" IS NOT NULL
        AND "companySizeCode" IS NOT NULL
        AND "hiringNeedCode" IS NOT NULL
        AND "interestCode" IS NOT NULL
        AND "message" IS NOT NULL
        AND "noticeVersion" IS NOT NULL
        AND "noticeHash" IS NOT NULL
        AND "slaPolicyVersion" IS NOT NULL
        AND "dueAt" IS NOT NULL
      )
    );

CREATE INDEX "SalesLead_status_dueAt_idx" ON "SalesLead"("status", "dueAt");
CREATE INDEX "SalesLead_interestedPlanVersionId_idx"
  ON "SalesLead"("interestedPlanVersionId");

ALTER TABLE "SalesActivity"
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "payloadHash" CHAR(64),
  ADD COLUMN "correlationId" VARCHAR(128);

CREATE UNIQUE INDEX "SalesActivity_idempotencyKey_key"
  ON "SalesActivity"("idempotencyKey");

ALTER TABLE "SalesActivity"
  ADD CONSTRAINT "SalesActivity_payload_hash_check"
    CHECK ("payloadHash" IS NULL OR "payloadHash" ~ '^[a-f0-9]{64}$');

-- dueAt records the immutable initial SLA target. Ops may move nextAt later,
-- but never rewrites what the intake policy originally promised internally.
CREATE OR REPLACE FUNCTION "sth_guard_sales_lead_initial_due_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."dueAt" IS NOT NULL AND NEW."dueAt" IS DISTINCT FROM OLD."dueAt" THEN
    RAISE EXCEPTION 'SalesLead.dueAt is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SalesLead_initial_due_at_immutable"
BEFORE UPDATE OF "dueAt" ON "SalesLead"
FOR EACH ROW
EXECUTE FUNCTION "sth_guard_sales_lead_initial_due_at"();
