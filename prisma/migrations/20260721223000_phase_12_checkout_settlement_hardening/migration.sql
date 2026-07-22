-- Phase 12 checkout settlement hardening.
--
-- Import Setup approvals use ImportSetupApproval.orderLineId first as the
-- live checkout reservation and, after payment, as the immutable fulfillment
-- binding. Historical failed/expired OrderLines remain append-only evidence,
-- so the target side must be one-to-many while the approval owns at most one
-- live reservation/final binding.

DROP INDEX "OrderLine_targetImportSetupApprovalId_key";
CREATE INDEX "OrderLine_targetImportSetupApprovalId_idx"
  ON "OrderLine"("targetImportSetupApprovalId");

CREATE OR REPLACE FUNCTION enforce_import_setup_approval_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reservation_order_status "OrderStatus";
  reservation_order_expires_at timestamptz;
  reservation_target_approval uuid;
  reservation_acquired boolean := false;
  reservation_released boolean := false;
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
    OR OLD."createdAt" <> NEW."createdAt" THEN
    RAISE EXCEPTION 'Import Setup approval evidence is immutable and may be fulfilled once'
      USING ERRCODE = '23514', CONSTRAINT = 'import_setup_approval_immutable';
  END IF;

  IF OLD."status" = 'APPROVED'
    AND NEW."status" = 'APPROVED'
    AND OLD."orderLineId" IS NULL
    AND NEW."orderLineId" IS NOT NULL THEN
    SELECT source_order."status", source_order."expiresAt",
        source_line."targetImportSetupApprovalId"
      INTO reservation_order_status, reservation_order_expires_at,
        reservation_target_approval
      FROM "OrderLine" AS source_line
      JOIN "Order" AS source_order ON source_order."id" = source_line."orderId"
      WHERE source_line."id" = NEW."orderLineId"
      FOR SHARE OF source_line, source_order;
    reservation_acquired :=
      reservation_target_approval IS NOT DISTINCT FROM OLD."id"
      AND reservation_order_status = 'PENDING'
      AND (reservation_order_expires_at IS NULL
        OR reservation_order_expires_at > CURRENT_TIMESTAMP);
  END IF;

  IF OLD."status" = 'APPROVED'
    AND NEW."status" = 'APPROVED'
    AND OLD."orderLineId" IS NOT NULL
    AND NEW."orderLineId" IS NULL THEN
    SELECT source_order."status"
      INTO reservation_order_status
      FROM "OrderLine" AS source_line
      JOIN "Order" AS source_order ON source_order."id" = source_line."orderId"
      WHERE source_line."id" = OLD."orderLineId"
      FOR SHARE OF source_line, source_order;
    reservation_released := reservation_order_status IN (
      'FAILED', 'CANCELLED', 'EXPIRED'
    );
  END IF;

  IF NOT (
    (OLD."status" = NEW."status"
      AND OLD."orderLineId" IS NOT DISTINCT FROM NEW."orderLineId")
    OR reservation_acquired
    OR reservation_released
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('REVOKED', 'EXPIRED')
      AND OLD."orderLineId" IS NULL AND NEW."orderLineId" IS NULL)
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'USED'
      AND OLD."orderLineId" IS NOT NULL
      AND NEW."orderLineId" IS NOT DISTINCT FROM OLD."orderLineId")
  ) THEN
    RAISE EXCEPTION 'Import Setup approval evidence is immutable and may be fulfilled once'
      USING ERRCODE = '23514', CONSTRAINT = 'import_setup_approval_immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve any checkout that was still live while this migration was
-- deployed. The former target-side unique index guarantees at most one such
-- line per approval before this statement; terminal historical lines remain
-- unbound evidence and can therefore be retried.
UPDATE "ImportSetupApproval" AS approval
SET "orderLineId" = source_line."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "OrderLine" AS source_line
JOIN "Order" AS source_order ON source_order."id" = source_line."orderId"
WHERE source_line."targetImportSetupApprovalId" = approval."id"
  AND approval."status" = 'APPROVED'
  AND approval."orderLineId" IS NULL
  AND approval."validUntil" > CURRENT_TIMESTAMP
  AND source_order."status" = 'PENDING'
  AND (source_order."expiresAt" IS NULL
    OR source_order."expiresAt" > CURRENT_TIMESTAMP);
