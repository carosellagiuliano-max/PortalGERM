-- A fully remote Swiss revision deliberately has no canton/city scope. The
-- publication trigger already compares both nullable projections with the
-- immutable published revision, while JobRevision_location_scope_check
-- enforces REMOTE/CH versus ONSITE|HYBRID/canton+city.
ALTER TABLE "Job"
  DROP CONSTRAINT "job_published_projection_presence_check";

ALTER TABLE "Job"
  ADD CONSTRAINT "job_published_projection_presence_check"
  CHECK (
    "status" <> 'PUBLISHED'
    OR (
      "publishedRevisionId" IS NOT NULL
      AND "publishedAt" IS NOT NULL
      AND "expiresAt" IS NOT NULL
      AND "publishedCategoryId" IS NOT NULL
      AND "publishedAt" < "expiresAt"
    )
  );
