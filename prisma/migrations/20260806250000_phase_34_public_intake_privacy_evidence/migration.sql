-- Phase 34: bind every new public Lead/Abuse intake to the exact privacy
-- notice shown to the user. Historical rows remain explicitly unbound and
-- are never rewritten into synthetic consent/publication evidence.

DO $$
BEGIN
  CREATE TYPE "PublicIntakePrivacyEvidenceMode" AS ENUM (
    'LEGACY_UNBOUND',
    'LOCAL_SYNTHETIC',
    'PUBLISHED_LEGAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- Restart-safe defense in depth for the legal gate. Phase 22 originally
-- created this partial index; the precheck makes an unexpectedly missing or
-- manually damaged deployment fail closed before it can be reconstructed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "LegalPublication"
    WHERE "status" = 'CURRENT'
    GROUP BY "legalDocumentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate CURRENT LegalPublication rows prevent privacy evidence migration';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "legal_publication_one_current"
  ON "LegalPublication"("legalDocumentId")
  WHERE "status" = 'CURRENT';

ALTER TABLE "SalesLeadIntake"
  ADD COLUMN IF NOT EXISTS "privacyEvidenceMode" "PublicIntakePrivacyEvidenceMode" NOT NULL DEFAULT 'LEGACY_UNBOUND',
  ADD COLUMN IF NOT EXISTS "privacyLegalPublicationId" UUID,
  ADD COLUMN IF NOT EXISTS "privacyPublicationHash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "privacyPublicationVersion" VARCHAR(32);

ALTER TABLE "AbuseReport"
  ADD COLUMN IF NOT EXISTS "privacyEvidenceMode" "PublicIntakePrivacyEvidenceMode" NOT NULL DEFAULT 'LEGACY_UNBOUND',
  ADD COLUMN IF NOT EXISTS "privacyLegalPublicationId" UUID,
  ADD COLUMN IF NOT EXISTS "privacyPublicationHash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "privacyPublicationVersion" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "privacyNoticeVersion" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "privacyNoticeHash" CHAR(64);

-- PostgreSQL materializes the NOT NULL default for historical rows while the
-- columns are added. Do not issue a cosmetic UPDATE: SalesLeadIntake has been
-- append-only since Phase 08 and historical evidence must remain untouched.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SalesLeadIntake_privacy_evidence_shape_check'
      AND conrelid = '"SalesLeadIntake"'::regclass
  ) THEN
    ALTER TABLE "SalesLeadIntake"
    ADD CONSTRAINT "SalesLeadIntake_privacy_evidence_shape_check"
    CHECK (
    (
      "privacyEvidenceMode" = 'LEGACY_UNBOUND'
      AND "privacyLegalPublicationId" IS NULL
      AND "privacyPublicationHash" IS NULL
      AND "privacyPublicationVersion" IS NULL
    )
    OR
    (
      "privacyEvidenceMode" = 'LOCAL_SYNTHETIC'
      AND "privacyLegalPublicationId" IS NULL
      AND "privacyPublicationHash" IS NULL
      AND "privacyPublicationVersion" IS NULL
      AND "noticeVersion" = 'employer-demo-privacy-v1'
      AND "noticeHash" = 'ab48247dbd3f161a31c9bdea37abbf95e047bad7563367cda5987feff3501674'
    )
    OR
    (
      "privacyEvidenceMode" = 'PUBLISHED_LEGAL'
      AND "privacyLegalPublicationId" IS NOT NULL
      AND "privacyPublicationHash" ~ '^[a-f0-9]{64}$'
      AND "privacyPublicationVersion" <> ''
      AND "noticeVersion" = 'employer-demo-privacy-v1'
      AND "noticeHash" = 'ab48247dbd3f161a31c9bdea37abbf95e047bad7563367cda5987feff3501674'
    )
    ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "SalesLeadIntake"
  VALIDATE CONSTRAINT "SalesLeadIntake_privacy_evidence_shape_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AbuseReport_privacy_evidence_shape_check'
      AND conrelid = '"AbuseReport"'::regclass
  ) THEN
    ALTER TABLE "AbuseReport"
    ADD CONSTRAINT "AbuseReport_privacy_evidence_shape_check"
    CHECK (
    (
      "privacyEvidenceMode" = 'LEGACY_UNBOUND'
      AND "privacyLegalPublicationId" IS NULL
      AND "privacyPublicationHash" IS NULL
      AND "privacyPublicationVersion" IS NULL
      AND "privacyNoticeVersion" IS NULL
      AND "privacyNoticeHash" IS NULL
    )
    OR
    (
      "privacyEvidenceMode" = 'LOCAL_SYNTHETIC'
      AND "privacyLegalPublicationId" IS NULL
      AND "privacyPublicationHash" IS NULL
      AND "privacyPublicationVersion" IS NULL
      AND "privacyNoticeVersion" = 'abuse-report-privacy-v1'
      AND "privacyNoticeHash" = '70db3e2735065e414b44b9f958467c99a0323a79e1099f0ca54b6e7c20788de7'
    )
    OR
    (
      "privacyEvidenceMode" = 'PUBLISHED_LEGAL'
      AND "privacyLegalPublicationId" IS NOT NULL
      AND "privacyPublicationHash" ~ '^[a-f0-9]{64}$'
      AND "privacyPublicationVersion" <> ''
      AND "privacyNoticeVersion" = 'abuse-report-privacy-v1'
      AND "privacyNoticeHash" = '70db3e2735065e414b44b9f958467c99a0323a79e1099f0ca54b6e7c20788de7'
    )
    ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "AbuseReport"
  VALIDATE CONSTRAINT "AbuseReport_privacy_evidence_shape_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SalesLeadIntake_privacyLegalPublicationId_fkey'
      AND conrelid = '"SalesLeadIntake"'::regclass
  ) THEN
    ALTER TABLE "SalesLeadIntake"
      ADD CONSTRAINT "SalesLeadIntake_privacyLegalPublicationId_fkey"
      FOREIGN KEY ("privacyLegalPublicationId")
      REFERENCES "LegalPublication"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AbuseReport_privacyLegalPublicationId_fkey'
      AND conrelid = '"AbuseReport"'::regclass
  ) THEN
    ALTER TABLE "AbuseReport"
      ADD CONSTRAINT "AbuseReport_privacyLegalPublicationId_fkey"
      FOREIGN KEY ("privacyLegalPublicationId")
      REFERENCES "LegalPublication"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "SalesLeadIntake_privacyLegalPublicationId_idx"
  ON "SalesLeadIntake"("privacyLegalPublicationId");

CREATE INDEX IF NOT EXISTS "AbuseReport_privacyLegalPublicationId_idx"
  ON "AbuseReport"("privacyLegalPublicationId");

CREATE OR REPLACE FUNCTION "sth_validate_sales_lead_intake_privacy_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_matches BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."privacyEvidenceMode" IS DISTINCT FROM OLD."privacyEvidenceMode"
      OR NEW."privacyLegalPublicationId" IS DISTINCT FROM OLD."privacyLegalPublicationId"
      OR NEW."privacyPublicationHash" IS DISTINCT FROM OLD."privacyPublicationHash"
      OR NEW."privacyPublicationVersion" IS DISTINCT FROM OLD."privacyPublicationVersion"
      OR NEW."noticeVersion" IS DISTINCT FROM OLD."noticeVersion"
      OR NEW."noticeHash" IS DISTINCT FROM OLD."noticeHash"
    THEN
      RAISE EXCEPTION 'SalesLeadIntake privacy evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."privacyEvidenceMode" = 'LEGACY_UNBOUND' THEN
    RAISE EXCEPTION 'new SalesLeadIntake rows require bound privacy evidence';
  END IF;

  IF NEW."privacyEvidenceMode" = 'PUBLISHED_LEGAL' THEN
    SELECT EXISTS (
      SELECT 1
      FROM "LegalPublication" publication
      JOIN "LegalRevision" revision
        ON revision."id" = publication."legalRevisionId"
      JOIN "LegalDocument" document
        ON document."id" = publication."legalDocumentId"
      WHERE publication."id" = NEW."privacyLegalPublicationId"
        AND publication."status" = 'CURRENT'
        AND publication."revokedAt" IS NULL
        AND publication."effectiveAt" <= NEW."createdAt"
        AND (publication."expiresAt" IS NULL OR publication."expiresAt" > NEW."createdAt")
        AND publication."publicationHash" = NEW."privacyPublicationHash"
        AND revision."status" = 'APPROVED'
        AND revision."versionLabel" = NEW."privacyPublicationVersion"
        AND revision."contentHash" = publication."publicationHash"
        AND document."type" = 'PRIVACY'
        AND document."locale" = 'de-CH'
        AND document."slug" = 'privacy'
    ) INTO evidence_matches;
    IF NOT evidence_matches THEN
      RAISE EXCEPTION 'SalesLeadIntake privacy publication evidence is stale or invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "SalesLeadIntake_privacy_evidence_insert_guard"
  ON "SalesLeadIntake";

CREATE TRIGGER "SalesLeadIntake_privacy_evidence_insert_guard"
BEFORE INSERT OR UPDATE ON "SalesLeadIntake"
FOR EACH ROW
EXECUTE FUNCTION "sth_validate_sales_lead_intake_privacy_evidence"();

CREATE OR REPLACE FUNCTION "sth_guard_abuse_report_privacy_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_matches BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."privacyEvidenceMode" IS DISTINCT FROM OLD."privacyEvidenceMode"
      OR NEW."privacyLegalPublicationId" IS DISTINCT FROM OLD."privacyLegalPublicationId"
      OR NEW."privacyPublicationHash" IS DISTINCT FROM OLD."privacyPublicationHash"
      OR NEW."privacyPublicationVersion" IS DISTINCT FROM OLD."privacyPublicationVersion"
      OR NEW."privacyNoticeVersion" IS DISTINCT FROM OLD."privacyNoticeVersion"
      OR NEW."privacyNoticeHash" IS DISTINCT FROM OLD."privacyNoticeHash"
    THEN
      RAISE EXCEPTION 'AbuseReport privacy evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."privacyEvidenceMode" = 'LEGACY_UNBOUND' THEN
    RAISE EXCEPTION 'new AbuseReport rows require bound privacy evidence';
  END IF;

  IF NEW."privacyEvidenceMode" = 'PUBLISHED_LEGAL' THEN
    SELECT EXISTS (
      SELECT 1
      FROM "LegalPublication" publication
      JOIN "LegalRevision" revision
        ON revision."id" = publication."legalRevisionId"
      JOIN "LegalDocument" document
        ON document."id" = publication."legalDocumentId"
      WHERE publication."id" = NEW."privacyLegalPublicationId"
        AND publication."status" = 'CURRENT'
        AND publication."revokedAt" IS NULL
        AND publication."effectiveAt" <= NEW."createdAt"
        AND (publication."expiresAt" IS NULL OR publication."expiresAt" > NEW."createdAt")
        AND publication."publicationHash" = NEW."privacyPublicationHash"
        AND revision."status" = 'APPROVED'
        AND revision."versionLabel" = NEW."privacyPublicationVersion"
        AND revision."contentHash" = publication."publicationHash"
        AND document."type" = 'PRIVACY'
        AND document."locale" = 'de-CH'
        AND document."slug" = 'privacy'
    ) INTO evidence_matches;
    IF NOT evidence_matches THEN
      RAISE EXCEPTION 'AbuseReport privacy publication evidence is stale or invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AbuseReport_privacy_evidence_guard"
  ON "AbuseReport";

CREATE TRIGGER "AbuseReport_privacy_evidence_guard"
BEFORE INSERT OR UPDATE ON "AbuseReport"
FOR EACH ROW
EXECUTE FUNCTION "sth_guard_abuse_report_privacy_evidence"();
