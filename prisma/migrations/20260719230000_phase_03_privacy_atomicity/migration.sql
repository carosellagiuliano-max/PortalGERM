-- Client idempotency is scoped to the authenticated requester. Reusing a
-- harmless client key in another account must not collide or reveal state.
DROP INDEX "PrivacyRequest_idempotencyKey_key";

CREATE UNIQUE INDEX "PrivacyRequest_requesterUserId_idempotencyKey_key"
  ON "PrivacyRequest"("requesterUserId", "idempotencyKey");

CREATE INDEX "PrivacyRequest_requesterUserId_type_status_idx"
  ON "PrivacyRequest"("requesterUserId", "type", "status");

-- Exactly one live workflow per requester and privacy-request type. Terminal
-- history remains append-only and may contain multiple completed cases.
CREATE UNIQUE INDEX "PrivacyRequest_one_open_type_key"
  ON "PrivacyRequest"("requesterUserId", "type")
  WHERE "status" IN ('PENDING', 'IDENTITY_CHECK', 'IN_PROGRESS');
