-- Normalize each media column independently across every provenance before the
-- deny-by-default constraints are installed. Reviewed values and NULL stay intact.
UPDATE "Company"
SET
  "logoStorageKey" = '/assets/company-media/default-logo.svg'
WHERE "logoStorageKey" IS NOT NULL
  AND "logoStorageKey" NOT IN (
    '/assets/company-media/default-logo.svg'
  );

UPDATE "Company"
SET
  "coverStorageKey" = '/assets/company-media/default-cover.svg'
WHERE "coverStorageKey" IS NOT NULL
  AND "coverStorageKey" NOT IN (
    '/assets/company-media/default-cover.svg',
    '/assets/company-media/alpine-cover.svg'
  );

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_logoStorageKey_reviewed_manifest_check"
  CHECK (
    "logoStorageKey" IS NULL
    OR "logoStorageKey" IN ('/assets/company-media/default-logo.svg')
  ),
  ADD CONSTRAINT "Company_coverStorageKey_reviewed_manifest_check"
  CHECK (
    "coverStorageKey" IS NULL
    OR "coverStorageKey" IN (
      '/assets/company-media/default-cover.svg',
      '/assets/company-media/alpine-cover.svg'
    )
  );
