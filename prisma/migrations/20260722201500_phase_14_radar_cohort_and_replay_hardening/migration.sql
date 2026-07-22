-- Phase 14 hardening: the exact eligible cohort is distinct from the bounded
-- 20-card sample, and idempotency must bind the complete anonymous command.
ALTER TABLE "RadarSearchSession"
  DROP CONSTRAINT "radar_search_session_result_check",
  ADD CONSTRAINT "radar_search_session_result_check"
  CHECK ("resultCount" >= 0 AND "createdAt" < "expiresAt");

ALTER TABLE "EmployerContactRequest"
  ADD COLUMN "commandFingerprint" char(64);

UPDATE "EmployerContactRequest"
SET "commandFingerprint" = encode(
  digest('phase14-legacy-contact-command:' || "id"::text, 'sha256'),
  'hex'
);

ALTER TABLE "EmployerContactRequest"
  ALTER COLUMN "commandFingerprint" SET NOT NULL,
  ADD CONSTRAINT "contact_request_command_fingerprint_check"
  CHECK ("commandFingerprint" ~ '^[a-f0-9]{64}$');
