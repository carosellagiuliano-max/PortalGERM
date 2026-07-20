-- Phase 06 persists normalized registration-only signals so employer account
-- creation can serialize collision checks without overloading public profile
-- or billing fields. Existing companies remain valid with NULL signals.
ALTER TABLE "Company"
  ADD COLUMN "registrationEmailDomainNormalized" VARCHAR(253),
  ADD COLUMN "registrationNameNormalized" VARCHAR(200),
  ADD COLUMN "registrationCantonId" UUID;

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_registrationCantonId_fkey"
  FOREIGN KEY ("registrationCantonId") REFERENCES "Canton"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_registration_name_canton_pair_check"
  CHECK (
    ("registrationNameNormalized" IS NULL AND "registrationCantonId" IS NULL)
    OR
    ("registrationNameNormalized" IS NOT NULL AND "registrationCantonId" IS NOT NULL)
  ),
  ADD CONSTRAINT "Company_registration_email_domain_normalized_check"
  CHECK (
    "registrationEmailDomainNormalized" IS NULL
    OR "registrationEmailDomainNormalized" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  ADD CONSTRAINT "Company_registration_name_normalized_check"
  CHECK (
    "registrationNameNormalized" IS NULL
    OR (
      length("registrationNameNormalized") >= 2
      AND "registrationNameNormalized" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
  );

CREATE INDEX "Company_registrationEmailDomainNormalized_idx"
  ON "Company"("registrationEmailDomainNormalized");

CREATE INDEX "Company_registrationNameNormalized_registrationCantonId_idx"
  ON "Company"("registrationNameNormalized", "registrationCantonId");

CREATE INDEX "Company_registrationCantonId_idx"
  ON "Company"("registrationCantonId");
