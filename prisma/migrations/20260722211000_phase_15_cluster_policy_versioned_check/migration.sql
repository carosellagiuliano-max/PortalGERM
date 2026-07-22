-- Keep historical, differently versioned launch evidence readable while the
-- Phase-15 thresholds remain a database backstop for CLUSTER_LAUNCH_POLICY_V1.
-- The index drop removes a redundant index created by an early local draft;
-- `cluster_single_activated_unique` already enforces the same invariant.
DROP INDEX IF EXISTS "ClusterLaunchAssessment_one_active_pair_policy_key";

ALTER TABLE "ClusterLaunchAssessment"
DROP CONSTRAINT IF EXISTS "phase15_cluster_ready_thresholds_check";

ALTER TABLE "ClusterLaunchAssessment"
ADD CONSTRAINT "phase15_cluster_ready_thresholds_check" CHECK (
  "status" = 'DRAFT'
  OR "policyVersion" <> 'CLUSTER_LAUNCH_POLICY_V1'
  OR (
    "dataProvenance" = 'LIVE'
    AND "liveJobCount" >= 50
    AND "activeCandidateCount" >= 200
    AND "activeEmployerCount" >= 15
    AND "medianApplicationsTimes2" >= 6
    AND "responseRateBasisPoints" >= 7000
    AND "contentCoverageBasisPoints" >= 8000
  )
);
