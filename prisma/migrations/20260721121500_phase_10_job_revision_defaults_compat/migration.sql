-- Preserve compatibility with existing raw fixtures and Prisma creates while
-- retaining the explicit defaults in the Phase 10 schema contract.
ALTER TABLE "JobRevision"
  ALTER COLUMN "niceToHave" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
