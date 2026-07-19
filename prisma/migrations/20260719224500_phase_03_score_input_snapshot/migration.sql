-- Fair Job Score v2 must remain reproducible after a JobRevision is edited.
-- Phase 03 is the first score-producing phase, so an existing snapshot would
-- indicate an invalid deployment order and intentionally blocks this migration.
ALTER TABLE "JobScoreSnapshot"
  ADD COLUMN "inputSnapshot" JSONB NOT NULL;
