-- Phase 34: close legal-evidence phantom windows for Talent Radar runtime
-- mutations and reads. Replacements must first retire the currently approved
-- row, which is blocked while a runtime transaction holds its evidence lock.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProcessingApproval"
    WHERE "status" = 'APPROVED'
    GROUP BY "scope", "region", "processorKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot enforce one approved processing approval: duplicate scope/region/processor rows exist'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "processing_approval_one_approved_scope"
  ON "ProcessingApproval" ("scope", "region", "processorKey")
  WHERE "status" = 'APPROVED';

CREATE INDEX IF NOT EXISTS "ProcessingApproval_scope_region_processor_status_created_idx"
  ON "ProcessingApproval" (
    "scope",
    "region",
    "processorKey",
    "status",
    "createdAt"
  );

CREATE OR REPLACE FUNCTION phase34_require_draft_inventory_for_entry()
RETURNS trigger AS $$
DECLARE
  parent_status "PrivacyInventoryStatus";
BEGIN
  SELECT "status"
    INTO parent_status
    FROM "PrivacyDataInventoryVersion"
   WHERE "id" = NEW."inventoryVersionId"
   FOR SHARE;

  IF parent_status IS NULL OR parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'privacy inventory entries may only be inserted while the inventory is DRAFT'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS phase34_inventory_entry_draft_only_insert
  ON "PrivacyDataInventoryEntry";

CREATE TRIGGER phase34_inventory_entry_draft_only_insert
BEFORE INSERT ON "PrivacyDataInventoryEntry"
FOR EACH ROW EXECUTE FUNCTION phase34_require_draft_inventory_for_entry();
