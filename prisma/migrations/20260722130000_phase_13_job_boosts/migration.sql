-- Phase 13: every non-cancelled boost reserves its half-open time window.
-- This keeps expired history immutable and still permits adjacent windows.
ALTER TABLE "JobBoost"
  DROP CONSTRAINT IF EXISTS "job_boost_effective_range_excl";

ALTER TABLE "JobBoost"
  ADD CONSTRAINT "job_boost_effective_range_excl"
  EXCLUDE USING gist (
    "jobId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELLED');
