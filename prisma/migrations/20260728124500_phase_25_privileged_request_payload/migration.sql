-- The approval record must carry the minimal, validated request that the
-- independent approver is deciding. A digest alone cannot safely reconstruct
-- the requested role, capability set or bounded validity window.
ALTER TABLE "PrivilegedApproval"
  ADD COLUMN "requestPayload" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "PrivilegedApproval"
  ALTER COLUMN "requestPayload" DROP DEFAULT;
