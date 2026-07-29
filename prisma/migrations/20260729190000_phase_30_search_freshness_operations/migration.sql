-- Phase 30 is additive and default-closed. It persists technical evidence for
-- search quality, privacy-safe learning, freshness and sitemap capacity, but
-- does not activate a taxonomy, cluster or sitemap shard.

CREATE TYPE "SearchConceptType" AS ENUM (
  'OCCUPATION', 'LOCATION', 'QUALIFICATION', 'CERTIFICATE', 'SKILL', 'INDUSTRY'
);
CREATE TYPE "SearchReleaseStatus" AS ENUM ('DRAFT', 'REVIEWED', 'ACTIVE', 'REVOKED');
CREATE TYPE "SearchAliasKind" AS ENUM (
  'CANONICAL', 'VARIANT', 'ABBREVIATION', 'CONTROLLED_TYPO'
);
CREATE TYPE "SearchLearningStatus" AS ENUM (
  'HIDDEN', 'ACTIONABLE', 'REVIEWED', 'PROMOTED', 'REJECTED', 'EXPIRED'
);
CREATE TYPE "SearchLearningEventKind" AS ENUM (
  'BECAME_ACTIONABLE', 'REVIEWED', 'PROMOTED', 'REJECTED', 'EXPIRED'
);
CREATE TYPE "SearchClusterSelectionStatus" AS ENUM (
  'DISCOVERY_ONLY', 'SELECTED', 'REVOKED'
);
CREATE TYPE "JobFreshnessState" AS ENUM (
  'ACTIVE', 'REVIEW_PENDING', 'HOLD', 'STALE', 'FILLED', 'CLOSED'
);
CREATE TYPE "JobFreshnessEventKind" AS ENUM (
  'PUBLISHED', 'DUPLICATE_HELD', 'REMINDER_7D', 'REMINDER_24H', 'RECONFIRMED',
  'CANDIDATE_REPORTED', 'REVIEW_SLA_EXCEEDED', 'REVIEW_RESOLVED',
  'REVIEW_DISMISSED', 'DUE', 'FILLED', 'CLOSED'
);
CREATE TYPE "JobFreshnessReportStatus" AS ENUM (
  'OPEN', 'HELD', 'CONFIRMED_OUTDATED', 'DISMISSED'
);
CREATE TYPE "SitemapCapacityLevel" AS ENUM (
  'HEALTHY', 'PLAN', 'DEPLOY', 'EXPANSION_BLOCKED'
);

ALTER TYPE "NotificationKind" ADD VALUE 'JOB_FRESHNESS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_FRESHNESS_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_MARKED_FILLED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_FRESHNESS_HELD';

CREATE TABLE "SearchPolicyRelease" (
  "id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "status" "SearchReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "locale" VARCHAR(16) NOT NULL,
  "searchPolicyVersion" VARCHAR(32) NOT NULL,
  "taxonomyVersion" VARCHAR(32) NOT NULL,
  "rankingVersion" VARCHAR(32) NOT NULL,
  "corpusDigest" CHAR(64) NOT NULL,
  "reviewedAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchPolicyRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchPolicyRelease_code_key" UNIQUE ("code"),
  CONSTRAINT "search_policy_release_digest_check"
    CHECK ("corpusDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "search_policy_release_state_check" CHECK (
    ("status" = 'DRAFT' AND "activatedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVIEWED' AND "reviewedAt" IS NOT NULL
        AND "activatedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'ACTIVE' AND "reviewedAt" IS NOT NULL
        AND "activatedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  )
);

CREATE TABLE "SearchConcept" (
  "id" UUID NOT NULL,
  "stableKey" VARCHAR(96) NOT NULL,
  "releaseId" UUID NOT NULL,
  "type" "SearchConceptType" NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "canonicalLabel" VARCHAR(200) NOT NULL,
  "normalizedLabel" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchConcept_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchConcept_releaseId_stableKey_key"
    UNIQUE ("releaseId", "stableKey")
);

CREATE TABLE "SearchAlias" (
  "id" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "conceptId" UUID NOT NULL,
  "kind" "SearchAliasKind" NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "normalizedLabel" VARCHAR(200) NOT NULL,
  "sourceCode" VARCHAR(64) NOT NULL,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "validFrom" TIMESTAMPTZ(3),
  "validUntil" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchAlias_releaseId_normalizedLabel_key"
    UNIQUE ("releaseId", "normalizedLabel"),
  CONSTRAINT "search_alias_validity_check"
    CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" > "validFrom")
);

CREATE TABLE "SearchConceptRelation" (
  "id" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "fromConceptId" UUID NOT NULL,
  "toConceptId" UUID NOT NULL,
  "relationCode" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchConceptRelation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchConceptRelation_releaseId_fromConceptId_toConceptId_relationCode_key"
    UNIQUE ("releaseId", "fromConceptId", "toConceptId", "relationCode"),
  CONSTRAINT "search_concept_relation_no_self"
    CHECK ("fromConceptId" <> "toConceptId")
);

CREATE TABLE "SearchLearningAggregate" (
  "id" UUID NOT NULL,
  "windowStart" DATE NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "searchPolicyVersion" VARCHAR(32) NOT NULL,
  "tokenBucket" CHAR(64) NOT NULL,
  "filterFingerprint" CHAR(64) NOT NULL,
  "resultBucket" VARCHAR(16) NOT NULL,
  "conceptKeys" VARCHAR(96)[] NOT NULL,
  "reviewLabel" VARCHAR(160),
  "observationCount" INTEGER NOT NULL DEFAULT 0,
  "status" "SearchLearningStatus" NOT NULL DEFAULT 'HIDDEN',
  "actionableAt" TIMESTAMPTZ(3),
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByUserId" UUID,
  "releaseOutcomeCode" VARCHAR(64),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SearchLearningAggregate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchLearningAggregate_windowStart_locale_searchPolicyVersion_tokenBucket_filterFingerprint_resultBucket_key"
    UNIQUE ("windowStart", "locale", "searchPolicyVersion", "tokenBucket",
      "filterFingerprint", "resultBucket"),
  CONSTRAINT "search_learning_digest_check" CHECK (
    "tokenBucket" ~ '^[a-f0-9]{64}$'
    AND "filterFingerprint" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "search_learning_count_check" CHECK ("observationCount" >= 0),
  CONSTRAINT "search_learning_review_label_check" CHECK (
    "status" IN ('HIDDEN', 'EXPIRED') OR "reviewLabel" IS NOT NULL
  ),
  CONSTRAINT "search_learning_result_bucket_check"
    CHECK ("resultBucket" IN ('0', '1-9', '10-24', '25-49', '50+'))
);

CREATE TABLE "SearchLearningContribution" (
  "id" UUID NOT NULL,
  "aggregateId" UUID NOT NULL,
  "contributorBucket" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchLearningContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchLearningContribution_aggregateId_contributorBucket_key"
    UNIQUE ("aggregateId", "contributorBucket"),
  CONSTRAINT "search_learning_contributor_digest_check"
    CHECK ("contributorBucket" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "SearchLearningEvent" (
  "id" UUID NOT NULL,
  "aggregateId" UUID NOT NULL,
  "kind" "SearchLearningEventKind" NOT NULL,
  "actorUserId" UUID,
  "reasonCode" VARCHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchLearningEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchLearningEvent_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE TABLE "ClusterSearchQualityEvidence" (
  "id" UUID NOT NULL,
  "clusterLaunchAssessmentId" UUID NOT NULL,
  "selectionStatus" "SearchClusterSelectionStatus" NOT NULL,
  "searchPolicyVersion" VARCHAR(32) NOT NULL,
  "taxonomyVersion" VARCHAR(32) NOT NULL,
  "rankingVersion" VARCHAR(32) NOT NULL,
  "querySetDigest" CHAR(64) NOT NULL,
  "topKJudgmentDigest" CHAR(64) NOT NULL,
  "corpusDigest" CHAR(64) NOT NULL,
  "precisionAt10Bps" INTEGER NOT NULL,
  "recallAt10Bps" INTEGER NOT NULL,
  "coverageBps" INTEGER NOT NULL,
  "relevantTopKJobs" INTEGER NOT NULL,
  "expertReviewedAt" TIMESTAMPTZ(3),
  "expertReviewerUserId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClusterSearchQualityEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClusterSearchQualityEvidence_clusterLaunchAssessmentId_key"
    UNIQUE ("clusterLaunchAssessmentId"),
  CONSTRAINT "cluster_search_quality_digest_check" CHECK (
    "querySetDigest" ~ '^[a-f0-9]{64}$'
    AND "topKJudgmentDigest" ~ '^[a-f0-9]{64}$'
    AND "corpusDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "cluster_search_quality_metric_check" CHECK (
    "precisionAt10Bps" BETWEEN 0 AND 10000
    AND "recallAt10Bps" BETWEEN 0 AND 10000
    AND "coverageBps" BETWEEN 0 AND 10000
    AND "relevantTopKJobs" >= 0
  )
);

CREATE TABLE "JobFreshnessProjection" (
  "jobId" UUID NOT NULL,
  "policyVersion" VARCHAR(32) NOT NULL,
  "state" "JobFreshnessState" NOT NULL DEFAULT 'ACTIVE',
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "reminder7At" TIMESTAMPTZ(3) NOT NULL,
  "reminder24At" TIMESTAMPTZ(3) NOT NULL,
  "reminder7SentAt" TIMESTAMPTZ(3),
  "reminder24SentAt" TIMESTAMPTZ(3),
  "reviewDueAt" TIMESTAMPTZ(3),
  "enforceAt" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "JobFreshnessProjection_pkey" PRIMARY KEY ("jobId"),
  CONSTRAINT "job_freshness_version_check" CHECK ("version" > 0),
  CONSTRAINT "job_freshness_schedule_check" CHECK (
    "dueAt" > "lastConfirmedAt"
    AND "reminder7At" <= "reminder24At"
    AND "reminder24At" < "dueAt"
  ),
  CONSTRAINT "job_freshness_review_shape_check" CHECK (
    ("state" = 'REVIEW_PENDING' AND "reviewDueAt" IS NOT NULL)
    OR ("state" <> 'REVIEW_PENDING')
  )
);

CREATE TABLE "JobFreshnessEvent" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "kind" "JobFreshnessEventKind" NOT NULL,
  "fromState" "JobFreshnessState",
  "toState" "JobFreshnessState" NOT NULL,
  "actorUserId" UUID,
  "reasonCode" VARCHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobFreshnessEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobFreshnessEvent_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE TABLE "JobFreshnessReport" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "abuseReportId" UUID NOT NULL,
  "reporterUserId" UUID NOT NULL,
  "status" "JobFreshnessReportStatus" NOT NULL DEFAULT 'OPEN',
  "reviewDueAt" TIMESTAMPTZ(3) NOT NULL,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "JobFreshnessReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobFreshnessReport_abuseReportId_key" UNIQUE ("abuseReportId")
);

CREATE TABLE "JobPublicationFingerprint" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "sourceScope" VARCHAR(96) NOT NULL,
  "exactFingerprint" CHAR(64) NOT NULL,
  "signatureTokens" VARCHAR(96)[] NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "JobPublicationFingerprint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobPublicationFingerprint_jobId_key" UNIQUE ("jobId"),
  CONSTRAINT "job_publication_fingerprint_digest_check"
    CHECK ("exactFingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "SitemapCapacityObservation" (
  "id" UUID NOT NULL,
  "resourceKey" VARCHAR(64) NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "urlCount" INTEGER NOT NULL,
  "estimatedBytes" BIGINT NOT NULL,
  "runtimeMs" INTEGER NOT NULL,
  "growth7dBps" INTEGER NOT NULL,
  "growth30dBps" INTEGER NOT NULL,
  "forecast90dCount" INTEGER NOT NULL,
  "capacityLevel" "SitemapCapacityLevel" NOT NULL,
  "owner" VARCHAR(96) NOT NULL,
  "successful" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SitemapCapacityObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sitemap_capacity_nonnegative_check" CHECK (
    "urlCount" >= 0 AND "estimatedBytes" >= 0 AND "runtimeMs" >= 0
    AND "forecast90dCount" >= 0
  )
);

CREATE INDEX "SearchPolicyRelease_status_locale_idx"
  ON "SearchPolicyRelease" ("status", "locale");
CREATE INDEX "SearchConcept_releaseId_type_idx"
  ON "SearchConcept" ("releaseId", "type");
CREATE INDEX "SearchAlias_conceptId_idx" ON "SearchAlias" ("conceptId");
CREATE INDEX "SearchLearningAggregate_status_expiresAt_idx"
  ON "SearchLearningAggregate" ("status", "expiresAt");
CREATE INDEX "SearchLearningContribution_createdAt_idx"
  ON "SearchLearningContribution" ("createdAt");
CREATE INDEX "SearchLearningEvent_aggregateId_createdAt_idx"
  ON "SearchLearningEvent" ("aggregateId", "createdAt");
CREATE INDEX "JobFreshnessProjection_state_dueAt_idx"
  ON "JobFreshnessProjection" ("state", "dueAt");
CREATE INDEX "JobFreshnessProjection_state_reviewDueAt_idx"
  ON "JobFreshnessProjection" ("state", "reviewDueAt");
CREATE INDEX "JobFreshnessEvent_jobId_createdAt_idx"
  ON "JobFreshnessEvent" ("jobId", "createdAt");
CREATE INDEX "JobFreshnessReport_status_reviewDueAt_idx"
  ON "JobFreshnessReport" ("status", "reviewDueAt");
CREATE UNIQUE INDEX "job_freshness_report_active_reporter_unique"
  ON "JobFreshnessReport" ("jobId", "reporterUserId")
  WHERE "status" IN ('OPEN', 'HELD');
CREATE UNIQUE INDEX "job_publication_active_exact_unique"
  ON "JobPublicationFingerprint" (
    "companyId", "sourceScope", "exactFingerprint"
  ) WHERE "active";
CREATE INDEX "JobPublicationFingerprint_companyId_active_idx"
  ON "JobPublicationFingerprint" ("companyId", "active");
CREATE INDEX "SitemapCapacityObservation_resourceKey_observedAt_idx"
  ON "SitemapCapacityObservation" ("resourceKey", "observedAt");

ALTER TABLE "SearchConcept"
  ADD CONSTRAINT "SearchConcept_releaseId_fkey" FOREIGN KEY ("releaseId")
  REFERENCES "SearchPolicyRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchAlias"
  ADD CONSTRAINT "SearchAlias_releaseId_fkey" FOREIGN KEY ("releaseId")
  REFERENCES "SearchPolicyRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchAlias"
  ADD CONSTRAINT "SearchAlias_conceptId_fkey" FOREIGN KEY ("conceptId")
  REFERENCES "SearchConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchConceptRelation"
  ADD CONSTRAINT "SearchConceptRelation_releaseId_fkey" FOREIGN KEY ("releaseId")
  REFERENCES "SearchPolicyRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchConceptRelation"
  ADD CONSTRAINT "SearchConceptRelation_fromConceptId_fkey"
  FOREIGN KEY ("fromConceptId") REFERENCES "SearchConcept"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchConceptRelation"
  ADD CONSTRAINT "SearchConceptRelation_toConceptId_fkey"
  FOREIGN KEY ("toConceptId") REFERENCES "SearchConcept"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchLearningEvent"
  ADD CONSTRAINT "SearchLearningEvent_aggregateId_fkey"
  FOREIGN KEY ("aggregateId") REFERENCES "SearchLearningAggregate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchLearningContribution"
  ADD CONSTRAINT "SearchLearningContribution_aggregateId_fkey"
  FOREIGN KEY ("aggregateId") REFERENCES "SearchLearningAggregate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClusterSearchQualityEvidence"
  ADD CONSTRAINT "ClusterSearchQualityEvidence_clusterLaunchAssessmentId_fkey"
  FOREIGN KEY ("clusterLaunchAssessmentId") REFERENCES "ClusterLaunchAssessment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobFreshnessProjection"
  ADD CONSTRAINT "JobFreshnessProjection_jobId_fkey" FOREIGN KEY ("jobId")
  REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobFreshnessEvent"
  ADD CONSTRAINT "JobFreshnessEvent_jobId_fkey" FOREIGN KEY ("jobId")
  REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobFreshnessReport"
  ADD CONSTRAINT "JobFreshnessReport_jobId_fkey" FOREIGN KEY ("jobId")
  REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobFreshnessReport"
  ADD CONSTRAINT "JobFreshnessReport_abuseReportId_fkey"
  FOREIGN KEY ("abuseReportId") REFERENCES "AbuseReport"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobFreshnessReport"
  ADD CONSTRAINT "JobFreshnessReport_reporterUserId_fkey"
  FOREIGN KEY ("reporterUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobPublicationFingerprint"
  ADD CONSTRAINT "JobPublicationFingerprint_jobId_fkey" FOREIGN KEY ("jobId")
  REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobPublicationFingerprint"
  ADD CONSTRAINT "JobPublicationFingerprint_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION phase30_protect_search_release_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'A search release must start as DRAFT'
        USING ERRCODE = '23514',
          CONSTRAINT = 'search_release_initial_state';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."locale" IS DISTINCT FROM OLD."locale"
    OR NEW."searchPolicyVersion" IS DISTINCT FROM OLD."searchPolicyVersion"
    OR NEW."taxonomyVersion" IS DISTINCT FROM OLD."taxonomyVersion"
    OR NEW."rankingVersion" IS DISTINCT FROM OLD."rankingVersion"
    OR NEW."corpusDigest" IS DISTINCT FROM OLD."corpusDigest"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Search release identity is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'search_release_identity_immutable';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" = 'REVIEWED')
      OR (OLD."status" = 'REVIEWED' AND NEW."status" = 'ACTIVE')
      OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED')
    )
  THEN
    RAISE EXCEPTION 'Search release lifecycle transition is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'search_release_lifecycle_transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase30_search_release_lifecycle
BEFORE INSERT OR UPDATE ON "SearchPolicyRelease"
FOR EACH ROW EXECUTE FUNCTION phase30_protect_search_release_lifecycle();

CREATE FUNCTION phase30_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Phase 30 evidence is append-only'
    USING ERRCODE = '23514',
      CONSTRAINT = 'phase30_append_only_evidence';
END;
$$;

CREATE TRIGGER phase30_search_concept_append_only
BEFORE UPDATE OR DELETE ON "SearchConcept"
FOR EACH ROW EXECUTE FUNCTION phase30_reject_append_only_mutation();
CREATE TRIGGER phase30_search_alias_append_only
BEFORE UPDATE OR DELETE ON "SearchAlias"
FOR EACH ROW EXECUTE FUNCTION phase30_reject_append_only_mutation();
CREATE TRIGGER phase30_search_relation_append_only
BEFORE UPDATE OR DELETE ON "SearchConceptRelation"
FOR EACH ROW EXECUTE FUNCTION phase30_reject_append_only_mutation();
CREATE TRIGGER phase30_search_learning_event_append_only
BEFORE UPDATE OR DELETE ON "SearchLearningEvent"
FOR EACH ROW EXECUTE FUNCTION phase30_reject_append_only_mutation();
CREATE TRIGGER phase30_job_freshness_event_append_only
BEFORE UPDATE OR DELETE ON "JobFreshnessEvent"
FOR EACH ROW EXECUTE FUNCTION phase30_reject_append_only_mutation();
CREATE TRIGGER phase30_sitemap_capacity_observation_append_only
BEFORE UPDATE OR DELETE ON "SitemapCapacityObservation"
FOR EACH ROW EXECUTE FUNCTION phase30_reject_append_only_mutation();

CREATE FUNCTION phase30_protect_cluster_search_quality_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cluster search-quality evidence is append-only'
    USING ERRCODE = '23514',
      CONSTRAINT = 'cluster_search_quality_evidence_append_only';
END;
$$;

CREATE TRIGGER phase30_cluster_search_quality_evidence_append_only
BEFORE UPDATE OR DELETE ON "ClusterSearchQualityEvidence"
FOR EACH ROW EXECUTE FUNCTION phase30_protect_cluster_search_quality_evidence();

CREATE FUNCTION phase30_require_cluster_v2_activation_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'ACTIVATED'
    AND (
      TG_OP = 'INSERT'
      OR (TG_OP = 'UPDATE' AND OLD."status" IS DISTINCT FROM NEW."status")
    )
    AND NEW."policyVersion" = 'CLUSTER_LAUNCH_POLICY_V2'
  THEN
    IF NEW."dataProvenance" <> 'LIVE'
      OR NEW."liveJobCount" < 50
      OR NEW."activeCandidateCount" < 200
      OR NEW."activeEmployerCount" < 15
      OR NEW."medianApplicationsTimes2" < 6
      OR NEW."responseRateBasisPoints" < 7000
      OR NEW."contentCoverageBasisPoints" < 8000
      OR NEW."productApprovedAt" IS NULL
      OR NEW."opsApprovedAt" IS NULL
    THEN
      RAISE EXCEPTION 'Cluster V2 base activation evidence is incomplete'
        USING ERRCODE = '23514',
          CONSTRAINT = 'cluster_v2_base_activation_evidence';
    END IF;

    PERFORM 1
    FROM "ClusterSearchQualityEvidence" AS evidence
    WHERE evidence."clusterLaunchAssessmentId" = NEW."id"
      AND evidence."selectionStatus" = 'SELECTED'
      AND evidence."searchPolicyVersion" = 'search-policy-v2'
      AND evidence."taxonomyVersion" = 'taxonomy-de-ch-v1'
      AND evidence."rankingVersion" = 'ranking-v2'
      AND evidence."precisionAt10Bps" >= 8000
      AND evidence."recallAt10Bps" >= 8000
      AND evidence."coverageBps" >= 8000
      AND evidence."relevantTopKJobs" >= 5
      AND evidence."expertReviewedAt" IS NOT NULL
      AND evidence."expertReviewerUserId" IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cluster V2 search-quality evidence is incomplete'
        USING ERRCODE = '23514',
          CONSTRAINT = 'cluster_v2_search_quality_activation_evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase30_cluster_v2_activation_evidence
BEFORE INSERT OR UPDATE OF "status" ON "ClusterLaunchAssessment"
FOR EACH ROW EXECUTE FUNCTION phase30_require_cluster_v2_activation_evidence();

-- Existing publications receive an announced 30-day enforcement cohort.
-- Newly published jobs are enforced immediately by the domain command.
INSERT INTO "JobFreshnessProjection" (
  "jobId", "policyVersion", "state", "publishedAt", "lastConfirmedAt",
  "dueAt", "reminder7At", "reminder24At", "enforceAt", "updatedAt"
)
SELECT
  job."id", 'JOB_FRESHNESS_POLICY_V1', 'ACTIVE'::"JobFreshnessState",
  job."publishedAt", job."publishedAt",
  LEAST(job."publishedAt" + INTERVAL '30 days', job."expiresAt"),
  LEAST(job."publishedAt" + INTERVAL '30 days', job."expiresAt") - INTERVAL '7 days',
  LEAST(job."publishedAt" + INTERVAL '30 days', job."expiresAt") - INTERVAL '1 day',
  CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP
FROM "Job" AS job
WHERE job."status" = 'PUBLISHED'::"JobStatus"
  AND job."publishedAt" IS NOT NULL
  AND job."expiresAt" IS NOT NULL
  AND job."expiresAt" > job."publishedAt"
ON CONFLICT ("jobId") DO NOTHING;
