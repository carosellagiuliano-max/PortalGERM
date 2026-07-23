DROP TRIGGER "phase02_append_only_23" ON "AuditLog";

CREATE FUNCTION phase16_enforce_audit_log_retention() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."ipHash" IS NOT NULL
    AND NEW."ipHash" IS NULL
    AND NEW."ipHashVersion" IS NULL
    AND OLD."createdAt" <= statement_timestamp() - INTERVAL '30 days'
    AND (
      to_jsonb(NEW) - 'ipHash' - 'ipHashVersion'
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD) - 'ipHash' - 'ipHashVersion'
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AuditLog is append-only except for expired IP-hash retention'
    USING ERRCODE = '23514',
      CONSTRAINT = 'phase16_audit_ip_retention_only';
END;
$$;

CREATE TRIGGER phase16_audit_log_retention_only
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION phase16_enforce_audit_log_retention();
