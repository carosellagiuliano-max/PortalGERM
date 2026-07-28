-- Phase 27 is an additive identity expansion. The legacy User.role remains
-- readable throughout dual-read/canary operation and continues to be the
-- rollback reader. PersonaAssignment never replaces CompanyMembership or the
-- Phase-25 Admin grants as an authorization source.

CREATE TYPE "PersonaKind" AS ENUM ('CANDIDATE', 'EMPLOYER');
CREATE TYPE "PersonaAssignmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "PersonaAssignmentSource" AS ENUM (
  'LEGACY_BACKFILL',
  'REGISTRATION',
  'COMPANY_INVITATION',
  'SELF_SERVICE',
  'SUPPORT_LINK'
);
CREATE TYPE "PersonaAssignmentEventKind" AS ENUM (
  'MIGRATED',
  'CREATED',
  'SUSPENDED',
  'REACTIVATED',
  'REVOKED'
);
CREATE TYPE "PortalContextKind" AS ENUM ('CANDIDATE', 'EMPLOYER', 'ADMIN');

ALTER TYPE "AuditTargetType" ADD VALUE 'PERSONA_ASSIGNMENT';
ALTER TYPE "AuditAction" ADD VALUE 'PERSONA_ASSIGNMENT_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PERSONA_CONTEXT_SWITCHED';
ALTER TYPE "AnalyticsEventKind" ADD VALUE 'PERSONA_CONTEXT_SWITCHED';

ALTER TABLE "Session"
  ADD COLUMN "activePortal" "PortalContextKind",
  ADD COLUMN "activeCompanyId" UUID,
  ADD COLUMN "contextVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "contextChangedAt" TIMESTAMPTZ(3);

ALTER TABLE "AuditLog"
  ADD COLUMN "portalContext" "PortalContextKind",
  ADD COLUMN "sessionContextVersion" INTEGER;

ALTER TABLE "AnalyticsEvent"
  ADD COLUMN "portalContext" "PortalContextKind",
  ADD COLUMN "sessionContextVersion" INTEGER;

CREATE TABLE "PersonaAssignment" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" "PersonaKind" NOT NULL,
  "status" "PersonaAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "PersonaAssignmentSource" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "activatedAt" TIMESTAMPTZ(3) NOT NULL,
  "suspendedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PersonaAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "persona_assignment_version_check" CHECK ("version" > 0),
  CONSTRAINT "persona_assignment_status_time_check" CHECK (
    ("status" = 'ACTIVE' AND "suspendedAt" IS NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'SUSPENDED' AND "suspendedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  )
);

CREATE TABLE "PersonaAssignmentEvent" (
  "id" UUID NOT NULL,
  "personaAssignmentId" UUID NOT NULL,
  "kind" "PersonaAssignmentEventKind" NOT NULL,
  "fromStatus" "PersonaAssignmentStatus",
  "toStatus" "PersonaAssignmentStatus" NOT NULL,
  "source" "PersonaAssignmentSource" NOT NULL,
  "actorUserId" UUID,
  "reasonCode" VARCHAR(64),
  "correlationId" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PersonaAssignmentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "persona_assignment_event_transition_check" CHECK (
    ("kind" IN ('MIGRATED', 'CREATED') AND "fromStatus" IS NULL)
    OR
    ("kind" = 'SUSPENDED' AND "fromStatus" = 'ACTIVE' AND "toStatus" = 'SUSPENDED')
    OR
    ("kind" = 'REACTIVATED' AND "fromStatus" = 'SUSPENDED' AND "toStatus" = 'ACTIVE')
    OR
    ("kind" = 'REVOKED' AND "fromStatus" IS NOT NULL AND "toStatus" = 'REVOKED')
  )
);

CREATE UNIQUE INDEX "PersonaAssignment_userId_kind_key"
  ON "PersonaAssignment" ("userId", "kind");
CREATE UNIQUE INDEX "PersonaAssignment_id_userId_kind_key"
  ON "PersonaAssignment" ("id", "userId", "kind");
CREATE INDEX "PersonaAssignment_userId_status_kind_idx"
  ON "PersonaAssignment" ("userId", "status", "kind");
CREATE INDEX "PersonaAssignment_status_updatedAt_id_idx"
  ON "PersonaAssignment" ("status", "updatedAt", "id");
CREATE INDEX "PersonaAssignmentEvent_personaAssignmentId_createdAt_id_idx"
  ON "PersonaAssignmentEvent" ("personaAssignmentId", "createdAt", "id");
CREATE INDEX "PersonaAssignmentEvent_actorUserId_createdAt_idx"
  ON "PersonaAssignmentEvent" ("actorUserId", "createdAt");
CREATE INDEX "Session_userId_activePortal_revokedAt_idx"
  ON "Session" ("userId", "activePortal", "revokedAt");
CREATE INDEX "Session_activeCompanyId_revokedAt_idx"
  ON "Session" ("activeCompanyId", "revokedAt");
CREATE INDEX "AuditLog_portalContext_createdAt_idx"
  ON "AuditLog" ("portalContext", "createdAt");
CREATE INDEX "AnalyticsEvent_portalContext_occurredAt_idx"
  ON "AnalyticsEvent" ("portalContext", "occurredAt");

ALTER TABLE "Session"
  ADD CONSTRAINT "session_context_version_check"
    CHECK ("contextVersion" > 0),
  ADD CONSTRAINT "session_company_context_check"
    CHECK ("activeCompanyId" IS NULL OR "activePortal" = 'EMPLOYER');

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "audit_session_context_version_check"
    CHECK ("sessionContextVersion" IS NULL OR "sessionContextVersion" > 0);

ALTER TABLE "AnalyticsEvent"
  ADD CONSTRAINT "analytics_session_context_version_check"
    CHECK ("sessionContextVersion" IS NULL OR "sessionContextVersion" > 0);

ALTER TABLE "PersonaAssignment"
  ADD CONSTRAINT "PersonaAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonaAssignmentEvent"
  ADD CONSTRAINT "PersonaAssignmentEvent_personaAssignmentId_fkey"
  FOREIGN KEY ("personaAssignmentId") REFERENCES "PersonaAssignment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill from all persisted evidence, not only the legacy role. This creates
-- navigation candidates, never tenant or Candidate-data rights by itself.
INSERT INTO "PersonaAssignment" (
  "id",
  "userId",
  "kind",
  "status",
  "source",
  "version",
  "activatedAt",
  "suspendedAt",
  "revokedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  users."id",
  'CANDIDATE',
  CASE WHEN users."status" = 'ACTIVE'
    THEN 'ACTIVE'::"PersonaAssignmentStatus"
    ELSE 'SUSPENDED'::"PersonaAssignmentStatus"
  END,
  'LEGACY_BACKFILL',
  1,
  users."createdAt",
  CASE WHEN users."status" = 'ACTIVE' THEN NULL ELSE CURRENT_TIMESTAMP END,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" users
WHERE users."role" = 'CANDIDATE'
   OR EXISTS (
     SELECT 1
       FROM "CandidateProfile" profile
      WHERE profile."userId" = users."id"
   )
ON CONFLICT ("userId", "kind") DO NOTHING;

INSERT INTO "PersonaAssignment" (
  "id",
  "userId",
  "kind",
  "status",
  "source",
  "version",
  "activatedAt",
  "suspendedAt",
  "revokedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  users."id",
  'EMPLOYER',
  CASE WHEN users."status" = 'ACTIVE'
    THEN 'ACTIVE'::"PersonaAssignmentStatus"
    ELSE 'SUSPENDED'::"PersonaAssignmentStatus"
  END,
  'LEGACY_BACKFILL',
  1,
  users."createdAt",
  CASE WHEN users."status" = 'ACTIVE' THEN NULL ELSE CURRENT_TIMESTAMP END,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" users
WHERE users."role" IN ('EMPLOYER', 'RECRUITER')
   OR EXISTS (
     SELECT 1
       FROM "CompanyMembership" membership
      WHERE membership."userId" = users."id"
   )
ON CONFLICT ("userId", "kind") DO NOTHING;

INSERT INTO "PersonaAssignmentEvent" (
  "id",
  "personaAssignmentId",
  "kind",
  "fromStatus",
  "toStatus",
  "source",
  "actorUserId",
  "reasonCode",
  "correlationId",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  assignment."id",
  'MIGRATED',
  NULL,
  assignment."status",
  assignment."source",
  NULL,
  'LEGACY_ROLE_BACKFILL',
  'phase27-migration-' || assignment."id"::text,
  CURRENT_TIMESTAMP
FROM "PersonaAssignment" assignment
WHERE assignment."source" = 'LEGACY_BACKFILL'
  AND NOT EXISTS (
    SELECT 1
      FROM "PersonaAssignmentEvent" event
     WHERE event."personaAssignmentId" = assignment."id"
       AND event."kind" = 'MIGRATED'
  );

UPDATE "Session" session
SET
  "activePortal" = CASE users."role"
    WHEN 'CANDIDATE' THEN 'CANDIDATE'::"PortalContextKind"
    WHEN 'EMPLOYER' THEN 'EMPLOYER'::"PortalContextKind"
    WHEN 'RECRUITER' THEN 'EMPLOYER'::"PortalContextKind"
    WHEN 'ADMIN' THEN 'ADMIN'::"PortalContextKind"
  END,
  "contextChangedAt" = COALESCE(session."contextChangedAt", session."createdAt")
FROM "User" users
WHERE users."id" = session."userId"
  AND session."activePortal" IS NULL;

WITH single_membership AS (
  SELECT
    membership."userId",
    MIN(membership."companyId"::text)::uuid AS "companyId"
  FROM "CompanyMembership" membership
  JOIN "Company" company
    ON company."id" = membership."companyId"
  WHERE membership."status" = 'ACTIVE'
    AND company."status" IN ('DRAFT', 'ACTIVE')
  GROUP BY membership."userId"
  HAVING COUNT(*) = 1
)
UPDATE "Session" session
SET "activeCompanyId" = single_membership."companyId"
FROM single_membership
WHERE session."userId" = single_membership."userId"
  AND session."activePortal" = 'EMPLOYER'
  AND session."activeCompanyId" IS NULL;

-- Event history is immutable. Assignment identity/provenance is immutable;
-- status changes remain possible only through explicit lifecycle services.
CREATE OR REPLACE FUNCTION phase27_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER phase27_persona_assignment_event_append_only
BEFORE UPDATE OR DELETE ON "PersonaAssignmentEvent"
FOR EACH ROW EXECUTE FUNCTION phase27_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION phase27_protect_persona_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."userId" IS DISTINCT FROM NEW."userId"
    OR OLD."kind" IS DISTINCT FROM NEW."kind"
    OR OLD."source" IS DISTINCT FROM NEW."source"
    OR OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'persona assignment identity and provenance are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."version" <= OLD."version" THEN
    RAISE EXCEPTION 'persona assignment version must increase'
      USING ERRCODE = '23514',
            CONSTRAINT = 'persona_assignment_version_monotonic';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase27_persona_assignment_identity
BEFORE UPDATE ON "PersonaAssignment"
FOR EACH ROW EXECUTE FUNCTION phase27_protect_persona_assignment_identity();

-- Any persona or membership authority change invalidates action-bound grants
-- for affected sessions. The selected context is navigation state only; every
-- subsequent read still rechecks PersonaAssignment and CompanyMembership.
CREATE OR REPLACE FUNCTION phase27_revoke_session_bound_grants(
  affected_user_id UUID,
  changed_at TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "StepUpChallenge"
     SET "status" = 'REVOKED',
         "cancelledAt" = changed_at
   WHERE "userId" = affected_user_id
     AND "status" = 'PENDING';

  UPDATE "AuthAssuranceEvidence"
     SET "revokedAt" = changed_at
   WHERE "userId" = affected_user_id
     AND "sessionId" IS NOT NULL
     AND "usedAt" IS NULL
     AND "revokedAt" IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION phase27_invalidate_persona_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_at TIMESTAMPTZ := CURRENT_TIMESTAMP;
  fallback_portal "PortalContextKind";
BEGIN
  fallback_portal := NULL;
  IF NEW."status" <> 'ACTIVE' THEN
    IF NEW."kind" = 'CANDIDATE'
      AND EXISTS (
        SELECT 1 FROM "PersonaAssignment"
         WHERE "userId" = NEW."userId"
           AND "kind" = 'EMPLOYER'
           AND "status" = 'ACTIVE'
      ) THEN
      fallback_portal := 'EMPLOYER';
    ELSIF NEW."kind" = 'EMPLOYER'
      AND EXISTS (
        SELECT 1 FROM "PersonaAssignment"
         WHERE "userId" = NEW."userId"
           AND "kind" = 'CANDIDATE'
           AND "status" = 'ACTIVE'
      ) THEN
      fallback_portal := 'CANDIDATE';
    ELSIF EXISTS (
      SELECT 1 FROM "User"
       WHERE "id" = NEW."userId"
         AND "role" = 'ADMIN'
         AND "status" = 'ACTIVE'
    ) THEN
      fallback_portal := 'ADMIN';
    END IF;
  END IF;

  UPDATE "Session"
     SET "contextVersion" = "contextVersion" + 1,
         "contextChangedAt" = changed_at,
         "activePortal" = CASE
           WHEN NEW."status" <> 'ACTIVE'
             AND "activePortal"::text = NEW."kind"::text
             THEN fallback_portal
           ELSE "activePortal"
         END,
         "activeCompanyId" = CASE
           WHEN NEW."kind" = 'EMPLOYER' AND NEW."status" <> 'ACTIVE'
             THEN NULL
           ELSE "activeCompanyId"
         END
   WHERE "userId" = NEW."userId"
     AND "revokedAt" IS NULL;

  PERFORM phase27_revoke_session_bound_grants(NEW."userId", changed_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase27_persona_assignment_session_invalidation
AFTER UPDATE OF "status", "version" ON "PersonaAssignment"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."version" IS DISTINCT FROM NEW."version"
)
EXECUTE FUNCTION phase27_invalidate_persona_sessions();

CREATE OR REPLACE FUNCTION phase27_invalidate_membership_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_at TIMESTAMPTZ := CURRENT_TIMESTAMP;
BEGIN
  UPDATE "Session"
     SET "contextVersion" = "contextVersion" + 1,
         "contextChangedAt" = changed_at,
         "activeCompanyId" = CASE
           WHEN NEW."status" <> 'ACTIVE'
             AND "activeCompanyId" = NEW."companyId"
             THEN NULL
           ELSE "activeCompanyId"
         END
   WHERE "userId" = NEW."userId"
     AND "revokedAt" IS NULL;

  PERFORM phase27_revoke_session_bound_grants(NEW."userId", changed_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase27_company_membership_session_invalidation
AFTER UPDATE OF "role", "status" ON "CompanyMembership"
FOR EACH ROW
WHEN (
  OLD."role" IS DISTINCT FROM NEW."role"
  OR OLD."status" IS DISTINCT FROM NEW."status"
)
EXECUTE FUNCTION phase27_invalidate_membership_sessions();
