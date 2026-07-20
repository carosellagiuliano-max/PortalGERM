-- Anonymous submissions must never overwrite a prior Lead's actionable data.
-- Each accepted idempotency key therefore receives an immutable, bounded
-- intake snapshot while SalesLead remains the canonical sales identity.
CREATE TABLE "SalesLeadIntake" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "salesLeadId" UUID NOT NULL,
  "salesActivityId" UUID NOT NULL,
  "organizationName" VARCHAR(200) NOT NULL,
  "contactName" VARCHAR(160) NOT NULL,
  "phoneNormalized" VARCHAR(32),
  "companySizeCode" VARCHAR(64) NOT NULL,
  "hiringNeedCode" VARCHAR(64) NOT NULL,
  "interestCode" VARCHAR(64) NOT NULL,
  "callbackWindowCode" VARCHAR(64),
  "message" VARCHAR(2000) NOT NULL,
  "noticeVersion" VARCHAR(32) NOT NULL,
  "noticeHash" CHAR(64) NOT NULL,
  "slaPolicyVersion" VARCHAR(32) NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "retainUntil" TIMESTAMPTZ(3) NOT NULL,
  "interestedPlanVersionId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalesLeadIntake_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesLeadIntake_phone_normalized_check"
    CHECK ("phoneNormalized" IS NULL OR "phoneNormalized" ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT "SalesLeadIntake_company_size_code_check"
    CHECK ("companySizeCode" IN ('1_9', '10_49', '50_249', '250_999', '1000_PLUS')),
  CONSTRAINT "SalesLeadIntake_hiring_need_code_check"
    CHECK ("hiringNeedCode" IN ('ONE_ROLE', 'TWO_TO_FIVE', 'SIX_TO_TWENTY', 'TWENTY_PLUS', 'EXPLORING')),
  CONSTRAINT "SalesLeadIntake_interest_code_check"
    CHECK ("interestCode" IN ('GENERAL', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE', 'IMPORT')),
  CONSTRAINT "SalesLeadIntake_callback_window_code_check"
    CHECK ("callbackWindowCode" IS NULL OR "callbackWindowCode" IN ('MORNING', 'AFTERNOON', 'ANYTIME')),
  CONSTRAINT "SalesLeadIntake_notice_hash_check"
    CHECK ("noticeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SalesLeadIntake_due_before_retention_check"
    CHECK ("dueAt" < "retainUntil")
);

CREATE UNIQUE INDEX "SalesLeadIntake_salesActivityId_key"
  ON "SalesLeadIntake"("salesActivityId");
CREATE INDEX "SalesLeadIntake_salesLeadId_createdAt_idx"
  ON "SalesLeadIntake"("salesLeadId", "createdAt");
CREATE INDEX "SalesLeadIntake_interestedPlanVersionId_idx"
  ON "SalesLeadIntake"("interestedPlanVersionId");
CREATE INDEX "SalesLeadIntake_retainUntil_idx"
  ON "SalesLeadIntake"("retainUntil");

ALTER TABLE "SalesLeadIntake"
  ADD CONSTRAINT "SalesLeadIntake_salesLeadId_fkey"
    FOREIGN KEY ("salesLeadId") REFERENCES "SalesLead"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesLeadIntake_salesActivityId_fkey"
    FOREIGN KEY ("salesActivityId") REFERENCES "SalesActivity"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesLeadIntake_interestedPlanVersionId_fkey"
    FOREIGN KEY ("interestedPlanVersionId") REFERENCES "PlanVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "sth_guard_sales_lead_intake_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SalesLeadIntake rows are immutable';
END;
$$;

CREATE TRIGGER "SalesLeadIntake_immutable"
BEFORE UPDATE ON "SalesLeadIntake"
FOR EACH ROW
EXECUTE FUNCTION "sth_guard_sales_lead_intake_immutable"();
