-- Phase 05 seed runs use create-or-verify semantics. A changed contract gets a
-- new seedVersion; existing namespace/version evidence is never repurposed or
-- deleted. An incomplete row persists the first run's anchor before data blocks
-- execute, and completion seals the exact resulting manifest hash.

ALTER TABLE "JobRevision"
  ADD COLUMN "contentLanguage" "Language" NOT NULL DEFAULT 'DE';

ALTER TABLE "OccupationCodeVersion"
  ADD COLUMN "disclaimer" VARCHAR(1000);

UPDATE "OccupationCodeVersion"
SET "disclaimer" = 'Legacy-Datensatz vor Phase 05; Einsatzgrenzen anhand der referenzierten Quelle pruefen.'
WHERE "disclaimer" IS NULL;

ALTER TABLE "OccupationCodeVersion"
  ALTER COLUMN "disclaimer" SET NOT NULL,
  ADD CONSTRAINT "occupation_code_version_disclaimer_check"
    CHECK (length(btrim("disclaimer")) > 0);

CREATE TABLE "DemoSeedManifest" (
  "namespace" VARCHAR(64) NOT NULL,
  "seedVersion" VARCHAR(64) NOT NULL,
  "schemaVersion" VARCHAR(64) NOT NULL,
  "contractHash" VARCHAR(64) NOT NULL,
  "manifestHash" VARCHAR(64),
  "anchorAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DemoSeedManifest_pkey"
    PRIMARY KEY ("namespace", "seedVersion"),
  CONSTRAINT "demo_seed_manifest_namespace_check"
    CHECK (length(btrim("namespace")) > 0),
  CONSTRAINT "demo_seed_manifest_seed_version_check"
    CHECK (length(btrim("seedVersion")) > 0),
  CONSTRAINT "demo_seed_manifest_schema_version_check"
    CHECK (length(btrim("schemaVersion")) > 0),
  CONSTRAINT "demo_seed_manifest_contract_hash_check"
    CHECK ("contractHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "demo_seed_manifest_hash_check"
    CHECK (
      "manifestHash" IS NULL
      OR "manifestHash" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "demo_seed_manifest_completion_check"
    CHECK (
      ("manifestHash" IS NULL AND "completedAt" IS NULL)
      OR (
        "manifestHash" IS NOT NULL
        AND "completedAt" IS NOT NULL
        AND "completedAt" >= "anchorAt"
      )
    )
);

COMMENT ON TABLE "DemoSeedManifest" IS
  'Create-or-verify evidence. Rotate seedVersion for changed contracts; never delete or repurpose a row.';
COMMENT ON COLUMN "DemoSeedManifest"."anchorAt" IS
  'Stable clock persisted by the first run and reused by retries and exact verification.';

CREATE OR REPLACE FUNCTION enforce_demo_seed_manifest_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DemoSeedManifest evidence is immutable; rotate seedVersion instead'
      USING ERRCODE = '23514', CONSTRAINT = 'demo_seed_manifest_immutable';
  END IF;

  IF OLD."namespace" IS DISTINCT FROM NEW."namespace"
     OR OLD."seedVersion" IS DISTINCT FROM NEW."seedVersion"
     OR OLD."schemaVersion" IS DISTINCT FROM NEW."schemaVersion"
     OR OLD."contractHash" IS DISTINCT FROM NEW."contractHash"
     OR OLD."anchorAt" IS DISTINCT FROM NEW."anchorAt"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'DemoSeedManifest identity, contract and anchor are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'demo_seed_manifest_immutable';
  END IF;

  IF OLD."completedAt" IS NOT NULL
     AND (
       OLD."manifestHash" IS DISTINCT FROM NEW."manifestHash"
       OR OLD."completedAt" IS DISTINCT FROM NEW."completedAt"
     ) THEN
    RAISE EXCEPTION 'A completed DemoSeedManifest is sealed'
      USING ERRCODE = '23514', CONSTRAINT = 'demo_seed_manifest_immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER demo_seed_manifest_lifecycle_trigger
BEFORE UPDATE OR DELETE ON "DemoSeedManifest"
FOR EACH ROW
EXECUTE FUNCTION enforce_demo_seed_manifest_lifecycle();
