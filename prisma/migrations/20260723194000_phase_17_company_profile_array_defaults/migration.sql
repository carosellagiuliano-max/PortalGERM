UPDATE "Company"
SET "values" = ARRAY[]::TEXT[]
WHERE "values" IS NULL;

UPDATE "Company"
SET "benefits" = ARRAY[]::TEXT[]
WHERE "benefits" IS NULL;

ALTER TABLE "Company"
  ALTER COLUMN "values" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "values" SET NOT NULL,
  ALTER COLUMN "benefits" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "benefits" SET NOT NULL;
