-- Completion must be impossible both on INSERT and on a later state transition.
-- The first Phase-22 migration guarded updates; this additive correction closes
-- the direct-COMPLETED insert path without weakening any existing evidence rule.

ALTER TYPE "AuditTargetType" ADD VALUE 'PRIVACY_TOMBSTONE';

DROP TRIGGER IF EXISTS phase22_execution_completion_guard_trigger
  ON "PrivacyExecution";

CREATE OR REPLACE FUNCTION phase22_execution_completion_guard()
RETURNS trigger AS $$
DECLARE
  open_count INTEGER;
  terminal_count INTEGER;
BEGIN
  IF NEW."status" = 'COMPLETED'
     AND (TG_OP = 'INSERT' OR OLD."status" <> 'COMPLETED')
  THEN
    SELECT
      count(*) FILTER (
        WHERE "status" NOT IN ('SUCCEEDED', 'RETAINED')
      ),
      count(*)
      INTO open_count, terminal_count
      FROM "PrivacyProcessorOutcome"
     WHERE "privacyExecutionId" = NEW."id";
    IF open_count <> 0
       OR terminal_count <> cardinality(NEW."requiredProcessors")
       OR NEW."checkpoint" <> cardinality(NEW."requiredProcessors")
    THEN
      RAISE EXCEPTION 'privacy execution cannot complete with open processor outcomes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase22_execution_completion_guard_trigger
BEFORE INSERT OR UPDATE ON "PrivacyExecution"
FOR EACH ROW EXECUTE FUNCTION phase22_execution_completion_guard();
