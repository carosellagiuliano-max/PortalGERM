CREATE TABLE "TrustSafetyContainmentEffect" (
  "id" UUID NOT NULL,
  "trustSafetyCaseId" UUID NOT NULL,
  "effectScope" VARCHAR(64) NOT NULL,
  "targetType" VARCHAR(48) NOT NULL,
  "targetId" VARCHAR(160) NOT NULL,
  "previousState" VARCHAR(48) NOT NULL,
  "appliedState" VARCHAR(48) NOT NULL,
  "reversible" BOOLEAN NOT NULL DEFAULT true,
  "reasonCode" VARCHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "appliedAt" TIMESTAMPTZ(3) NOT NULL,
  "reversedAt" TIMESTAMPTZ(3),
  CONSTRAINT "TrustSafetyContainmentEffect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrustSafetyContainmentEffect_state_change"
    CHECK ("previousState" <> "appliedState"),
  CONSTRAINT "TrustSafetyContainmentEffect_reversal_time"
    CHECK ("reversedAt" IS NULL OR "reversedAt" >= "appliedAt")
);

CREATE UNIQUE INDEX "TrustSafetyContainmentEffect_idempotencyKey_key"
  ON "TrustSafetyContainmentEffect" ("idempotencyKey");
CREATE INDEX "TrustSafetyContainmentEffect_case_open_scope_idx"
  ON "TrustSafetyContainmentEffect"
  ("trustSafetyCaseId", "reversedAt", "effectScope", "id");
CREATE INDEX "TrustSafetyContainmentEffect_target_open_idx"
  ON "TrustSafetyContainmentEffect" ("targetType", "targetId", "reversedAt");

ALTER TABLE "TrustSafetyContainmentEffect"
  ADD CONSTRAINT "TrustSafetyContainmentEffect_case_fkey"
  FOREIGN KEY ("trustSafetyCaseId")
  REFERENCES "TrustSafetyCase" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION phase25_guard_containment_effect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TrustSafetyContainmentEffect is durable evidence';
  END IF;
  IF
    (to_jsonb(NEW) - 'reversedAt') IS DISTINCT FROM
      (to_jsonb(OLD) - 'reversedAt')
    OR OLD."reversedAt" IS NOT NULL
    OR NEW."reversedAt" IS NULL
    OR NEW."reversedAt" < OLD."appliedAt"
  THEN
    RAISE EXCEPTION 'Only the first valid containment reversal is allowed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase25_guard_containment_effect
  BEFORE UPDATE OR DELETE ON "TrustSafetyContainmentEffect"
  FOR EACH ROW EXECUTE FUNCTION phase25_guard_containment_effect();
