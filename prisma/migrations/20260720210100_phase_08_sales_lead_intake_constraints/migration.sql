-- PostgreSQL makes a freshly-added enum value usable only after the migration
-- transaction commits, so the intake-kind constraint deliberately follows in
-- its own migration.
ALTER TABLE "SalesActivity"
  ADD CONSTRAINT "SalesActivity_intake_identity_check"
    CHECK (
      (
        "kind" = 'INTAKE_RECEIVED'
        AND "idempotencyKey" IS NOT NULL
        AND "payloadHash" IS NOT NULL
        AND "correlationId" IS NOT NULL
      ) OR (
        "kind" <> 'INTAKE_RECEIVED'
        AND "idempotencyKey" IS NULL
        AND "payloadHash" IS NULL
        AND "correlationId" IS NULL
      )
    );
