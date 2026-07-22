-- Phase 14: bind every paid Radar contact to a member-scoped daily sample,
-- persist one-use Reveal confirmation evidence, and complete Privacy case data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "EmployerContactRequest"
    WHERE char_length("messagePreview") > 500
  ) THEN
    RAISE EXCEPTION 'Phase 14 cannot narrow contact messages: values above 500 characters exist';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "EmployerContactRequest" request
    WHERE NOT EXISTS (
      SELECT 1 FROM "CompanyMembership" membership
      WHERE membership."companyId" = request."companyId"
        AND membership."userId" = request."requestingUserId"
    )
  ) THEN
    RAISE EXCEPTION 'Phase 14 cannot backfill Radar sessions without a scoped requesting membership';
  END IF;
END $$;

DROP INDEX "RadarSearchSession_companyId_filterHash_calendarDate_policy_key";
CREATE UNIQUE INDEX "RadarSearchSession_companyId_membershipId_filterHash_calendarDate_policy_key"
  ON "RadarSearchSession"("companyId", "membershipId", "filterHash", "calendarDate", "policyVersion");
CREATE UNIQUE INDEX "RadarSearchSession_id_companyId_requestingUserId_key"
  ON "RadarSearchSession"("id", "companyId", "requestingUserId");

ALTER TABLE "EmployerContactRequest"
  ADD COLUMN "radarSearchSessionId" uuid,
  ADD COLUMN "subject" varchar(200);

UPDATE "EmployerContactRequest" request
SET "radarSearchSessionId" = (
  SELECT session_candidate."radarSearchSessionId"
  FROM "RadarSearchSessionCandidate" session_candidate
  JOIN "RadarSearchSession" session
    ON session."id" = session_candidate."radarSearchSessionId"
  WHERE session."companyId" = request."companyId"
    AND session."requestingUserId" = request."requestingUserId"
    AND session_candidate."candidateProfileId" = request."candidateProfileId"
  ORDER BY session."createdAt" DESC, session."id" DESC
  LIMIT 1
)
WHERE request."radarSearchSessionId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "RadarSearchSessionCandidate" session_candidate
    JOIN "RadarSearchSession" session
      ON session."id" = session_candidate."radarSearchSessionId"
    WHERE session."companyId" = request."companyId"
      AND session."requestingUserId" = request."requestingUserId"
      AND session_candidate."candidateProfileId" = request."candidateProfileId"
  );

INSERT INTO "RadarSearchSession" (
  "id", "companyId", "membershipId", "requestingUserId", "filterHash",
  "calendarDate", "policyVersion", "normalizedFilters", "resultCount",
  "expiresAt", "createdAt"
)
SELECT
  gen_random_uuid(), request."companyId", membership."id",
  request."requestingUserId",
  encode(digest('phase14-legacy-contact:' || request."id"::text, 'sha256'), 'hex'),
  (request."createdAt" AT TIME ZONE 'Europe/Zurich')::date,
  'radar-privacy-v1',
  jsonb_build_object('legacyHistoricalContact', true),
  1,
  request."createdAt" + interval '15 minutes',
  request."createdAt"
FROM "EmployerContactRequest" request
JOIN LATERAL (
  SELECT scoped_membership."id"
  FROM "CompanyMembership" scoped_membership
  WHERE scoped_membership."companyId" = request."companyId"
    AND scoped_membership."userId" = request."requestingUserId"
  ORDER BY scoped_membership."createdAt", scoped_membership."id"
  LIMIT 1
) membership ON true
WHERE request."radarSearchSessionId" IS NULL;

INSERT INTO "RadarSearchSessionCandidate" (
  "id", "radarSearchSessionId", "candidateProfileId", "position"
)
SELECT gen_random_uuid(), session."id", request."candidateProfileId", 0
FROM "EmployerContactRequest" request
JOIN "RadarSearchSession" session
  ON session."companyId" = request."companyId"
 AND session."requestingUserId" = request."requestingUserId"
 AND session."filterHash" = encode(
   digest('phase14-legacy-contact:' || request."id"::text, 'sha256'),
   'hex'
 )
WHERE request."radarSearchSessionId" IS NULL;

UPDATE "EmployerContactRequest" request
SET "radarSearchSessionId" = session."id"
FROM "RadarSearchSession" session
WHERE request."radarSearchSessionId" IS NULL
  AND session."companyId" = request."companyId"
  AND session."requestingUserId" = request."requestingUserId"
  AND session."filterHash" = encode(
    digest('phase14-legacy-contact:' || request."id"::text, 'sha256'),
    'hex'
  );

UPDATE "EmployerContactRequest" request
SET "subject" = COALESCE(
  (
    SELECT nullif(btrim(conversation."subject"), '')
    FROM "Conversation" conversation
    WHERE conversation."contactRequestId" = request."id"
    LIMIT 1
  ),
  'Talent Radar Kontaktanfrage'
);

ALTER TABLE "EmployerContactRequest"
  ALTER COLUMN "radarSearchSessionId" SET NOT NULL,
  ALTER COLUMN "subject" SET NOT NULL,
  ALTER COLUMN "messagePreview" TYPE varchar(500);

ALTER TABLE "EmployerContactRequest"
  ADD CONSTRAINT "EmployerContactRequest_radar_session_scope_fkey"
  FOREIGN KEY ("radarSearchSessionId", "companyId", "requestingUserId")
  REFERENCES "RadarSearchSession"("id", "companyId", "requestingUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployerContactRequest_radar_candidate_scope_fkey"
  FOREIGN KEY ("radarSearchSessionId", "candidateProfileId")
  REFERENCES "RadarSearchSessionCandidate"("radarSearchSessionId", "candidateProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "contact_request_terminal_projection_check"
  CHECK (
    ("status" = 'PENDING' AND "terminalAt" IS NULL)
    OR ("status" <> 'PENDING' AND "terminalAt" IS NOT NULL AND "terminalAt" >= "createdAt")
  );

ALTER TABLE "ContactRequestEvent"
  ADD COLUMN "idempotencyKey" varchar(128) NOT NULL
  DEFAULT gen_random_uuid()::text;
ALTER TABLE "ContactRequestEvent"
  ALTER COLUMN "idempotencyKey" DROP DEFAULT;
CREATE UNIQUE INDEX "ContactRequestEvent_idempotencyKey_key"
  ON "ContactRequestEvent"("idempotencyKey");

ALTER TABLE "IdentityRevealConfirmation"
  ADD COLUMN "confirmationKeyVersion" varchar(32) NOT NULL
    DEFAULT 'legacy-evidence-v1',
  ADD COLUMN "confirmationTokenDigest" varchar(128) NOT NULL
    DEFAULT encode(digest(gen_random_uuid()::text, 'sha256'), 'hex');
ALTER TABLE "IdentityRevealConfirmation"
  ALTER COLUMN "confirmationKeyVersion" DROP DEFAULT,
  ALTER COLUMN "confirmationTokenDigest" DROP DEFAULT;
CREATE UNIQUE INDEX "IdentityRevealConfirmation_confirmationTokenDigest_key"
  ON "IdentityRevealConfirmation"("confirmationTokenDigest");

ALTER TABLE "PrivacyRequest"
  ADD COLUMN "noticeVersion" varchar(32),
  ADD COLUMN "domainEventRefs" text[];
UPDATE "PrivacyRequest"
SET "noticeVersion" = 'privacy-request-v1', "domainEventRefs" = ARRAY[]::text[];
ALTER TABLE "PrivacyRequest"
  ALTER COLUMN "noticeVersion" SET NOT NULL,
  ALTER COLUMN "domainEventRefs" SET NOT NULL;
ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "PrivacyRequest_assignedAdminUserId_fkey"
  FOREIGN KEY ("assignedAdminUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "privacy_request_assignment_projection_check"
  CHECK (
    ("assignedAdminUserId" IS NULL AND "assignmentReasonCode" IS NULL)
    OR ("assignedAdminUserId" IS NOT NULL AND nullif(btrim("assignmentReasonCode"), '') IS NOT NULL)
  );

ALTER TABLE "PrivacyRequestEvent"
  ALTER COLUMN "safeNote" TYPE varchar(1000);
