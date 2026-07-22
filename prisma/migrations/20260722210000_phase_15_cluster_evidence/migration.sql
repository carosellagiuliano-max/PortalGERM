-- Phase 15: metric evidence is immutable; lifecycle/approval projections remain mutable.
CREATE FUNCTION phase15_protect_cluster_launch_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."cantonId" IS DISTINCT FROM OLD."cantonId"
    OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
    OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
    OR NEW."evaluatedAt" IS DISTINCT FROM OLD."evaluatedAt"
    OR NEW."evidenceWindowStart" IS DISTINCT FROM OLD."evidenceWindowStart"
    OR NEW."evidenceWindowEnd" IS DISTINCT FROM OLD."evidenceWindowEnd"
    OR NEW."liveJobCount" IS DISTINCT FROM OLD."liveJobCount"
    OR NEW."activeCandidateCount" IS DISTINCT FROM OLD."activeCandidateCount"
    OR NEW."activeEmployerCount" IS DISTINCT FROM OLD."activeEmployerCount"
    OR NEW."responseRateBasisPoints" IS DISTINCT FROM OLD."responseRateBasisPoints"
    OR NEW."contentCoverageBasisPoints" IS DISTINCT FROM OLD."contentCoverageBasisPoints"
    OR NEW."medianApplicationsTimes2" IS DISTINCT FROM OLD."medianApplicationsTimes2"
    OR NEW."dataProvenance" IS DISTINCT FROM OLD."dataProvenance"
    OR NEW."evidenceHash" IS DISTINCT FROM OLD."evidenceHash"
    OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Cluster launch evidence is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cluster_launch_evidence_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase15_cluster_launch_evidence_immutable
BEFORE UPDATE ON "ClusterLaunchAssessment"
FOR EACH ROW EXECUTE FUNCTION phase15_protect_cluster_launch_evidence();

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
