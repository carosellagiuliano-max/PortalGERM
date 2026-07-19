-- Phase 03 needs an explicit country scope for fully remote jobs. Canton is
-- optional only for that case; onsite/hybrid publications remain city scoped.
ALTER TABLE "JobRevision"
  ADD COLUMN "remoteCountryCode" CHAR(2),
  ALTER COLUMN "cantonId" DROP NOT NULL;

ALTER TABLE "JobRevision"
  ADD CONSTRAINT "JobRevision_location_scope_check"
  CHECK (
    (
      "remoteType" = 'REMOTE'
      AND "remoteCountryCode" = 'CH'
      AND "cantonId" IS NULL
      AND "cityId" IS NULL
    )
    OR
    (
      "remoteType" IN ('ONSITE', 'HYBRID')
      AND "remoteCountryCode" IS NULL
      AND "cantonId" IS NOT NULL
      AND "cityId" IS NOT NULL
    )
  );

-- One domain event can legitimately notify multiple recipients. Retry
-- idempotency therefore belongs to recipient + kind + domain dedupe key.
DROP INDEX "Notification_dedupeKey_key";

CREATE UNIQUE INDEX "Notification_recipientUserId_kind_dedupeKey_key"
  ON "Notification"("recipientUserId", "kind", "dedupeKey");
