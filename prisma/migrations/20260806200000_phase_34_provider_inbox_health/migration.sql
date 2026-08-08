CREATE INDEX IF NOT EXISTS "ProviderEventInbox_environment_status_receivedAt_id_idx"
ON "ProviderEventInbox"("environment", "status", "receivedAt", "id");

CREATE INDEX IF NOT EXISTS "ProviderEventInbox_environment_status_nextRetryAt_id_idx"
ON "ProviderEventInbox"("environment", "status", "nextRetryAt", "id");

CREATE INDEX IF NOT EXISTS "EmailProviderEventInbox_environment_status_receivedAt_id_idx"
ON "EmailProviderEventInbox"("environment", "status", "receivedAt", "id");
