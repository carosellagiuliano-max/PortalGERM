ALTER TABLE "DocumentReadGrant"
  DROP CONSTRAINT "document_read_grant_audience_shape";

ALTER TABLE "DocumentReadGrant"
  ADD CONSTRAINT "document_read_grant_audience_shape" CHECK (
    (
      "companyId" IS NULL
      AND "applicationId" IS NULL
      AND "membershipId" IS NULL
    )
    OR (
      "companyId" IS NOT NULL
      AND "applicationId" IS NOT NULL
      AND "membershipId" IS NOT NULL
    )
    OR (
      "companyId" IS NOT NULL
      AND "applicationId" IS NULL
      AND "membershipId" IS NULL
    )
  );
