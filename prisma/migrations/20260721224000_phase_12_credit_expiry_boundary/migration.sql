-- Phase 12 credit-expiry boundary hardening.
--
-- Credit grants use a half-open validity window.  An EXPIRE entry is the
-- append-only projection of the unused balance at (or after) the referenced
-- Grant's exclusive validTo boundary; writing it earlier would destroy a
-- balance that is still spendable.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "CreditLedgerEntry" AS expiry
      LEFT JOIN "CreditLedgerEntry" AS grant_entry
        ON grant_entry."id" = expiry."consumedGrantEntryId"
     WHERE expiry."kind" = 'EXPIRE'
       AND (
         expiry."consumedGrantEntryId" IS NULL
         OR expiry."sourcePlanVersionId" IS NOT NULL
         OR expiry."sourceSubscriptionId" IS NOT NULL
         OR expiry."sourceOrderLineId" IS NOT NULL
         OR grant_entry."id" IS NULL
         OR grant_entry."kind" <> 'GRANT'
         OR grant_entry."accountId" IS DISTINCT FROM expiry."accountId"
         OR grant_entry."fundingSource" IS DISTINCT FROM expiry."fundingSource"
         OR grant_entry."validFrom" IS DISTINCT FROM expiry."validFrom"
         OR grant_entry."validTo" IS DISTINCT FROM expiry."validTo"
         OR expiry."createdAt" < grant_entry."validTo"
       )
  ) THEN
    RAISE EXCEPTION 'Existing Credit expiry predates or escapes its exact Grant boundary'
      USING ERRCODE = '23514',
            CONSTRAINT = 'credit_ledger_expiry_grant_boundary_check';
  END IF;
END;
$$;

CREATE FUNCTION phase12_enforce_credit_expiry_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_row "CreditLedgerEntry"%ROWTYPE;
BEGIN
  IF NEW."kind" <> 'EXPIRE' THEN
    RETURN NEW;
  END IF;

  IF NEW."consumedGrantEntryId" IS NULL
    OR NEW."sourcePlanVersionId" IS NOT NULL
    OR NEW."sourceSubscriptionId" IS NOT NULL
    OR NEW."sourceOrderLineId" IS NOT NULL THEN
    RAISE EXCEPTION 'Credit expiry requires exactly one concrete Grant source'
      USING ERRCODE = '23514',
            CONSTRAINT = 'credit_ledger_expiry_grant_lineage_check';
  END IF;

  SELECT *
    INTO grant_row
    FROM "CreditLedgerEntry"
   WHERE "id" = NEW."consumedGrantEntryId"
   FOR UPDATE;

  IF grant_row."id" IS NULL
    OR grant_row."kind" <> 'GRANT'
    OR grant_row."accountId" IS DISTINCT FROM NEW."accountId"
    OR grant_row."fundingSource" IS DISTINCT FROM NEW."fundingSource"
    OR grant_row."validFrom" IS DISTINCT FROM NEW."validFrom"
    OR grant_row."validTo" IS DISTINCT FROM NEW."validTo" THEN
    RAISE EXCEPTION 'Credit expiry must preserve the exact referenced Grant lineage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'credit_ledger_expiry_grant_lineage_check';
  END IF;

  IF NEW."createdAt" IS NULL OR NEW."createdAt" < grant_row."validTo" THEN
    RAISE EXCEPTION 'Credit expiry cannot precede the referenced Grant validTo boundary'
      USING ERRCODE = '23514',
            CONSTRAINT = 'credit_ledger_expiry_grant_boundary_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER phase12_credit_expiry_boundary_trigger
BEFORE INSERT ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION phase12_enforce_credit_expiry_boundary();
