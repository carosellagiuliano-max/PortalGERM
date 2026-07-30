-- Phase 31 adds immutable, versioned market-validation and release evidence.
-- It is deliberately additive and default-closed: this migration activates no
-- offer, payment provider, public cluster, import sync, add-on or Salary data.

CREATE TYPE "CommercialOfferKind" AS ENUM (
  'CORE_WORKFLOW',
  'HIRING_SPRINT',
  'RETAINER_CREDITS',
  'CONCIERGE',
  'MANAGED_IMPORT',
  'BOOST',
  'PAID_RADAR',
  'SALARY',
  'SUCCESS_FEE'
);

CREATE TYPE "CommercialReleaseStatus" AS ENUM (
  'DRAFT', 'APPROVED', 'PUBLIC_ACTIVE', 'REVOKED'
);

CREATE TYPE "CommercialClusterStatus" AS ENUM (
  'RESEARCH', 'SELECTED', 'PUBLIC_ACTIVE', 'REVOKED'
);

CREATE TYPE "CommercialEvidenceKind" AS ENUM (
  'NET_PAID_WTP',
  'DELIVERY',
  'LEGAL_REVIEW',
  'TAX_REVIEW',
  'AVG_REVIEW',
  'PRIVACY_REVIEW',
  'ACCOUNTING_REVIEW',
  'ORGANIC_REACH',
  'RADAR_FUNNEL'
);

CREATE TYPE "CommercialEvidenceEnvironment" AS ENUM (
  'LIVE_RESEARCH',
  'LIVE_PROVIDER',
  'MANUAL_RECONCILED',
  'SANDBOX',
  'TEST',
  'DEMO',
  'FREE',
  'LOI',
  'LEAD'
);

CREATE TYPE "CommercialDeliveryStatus" AS ENUM (
  'NOT_STARTED', 'STARTED', 'PARTIAL', 'DELIVERED', 'FAILED', 'RECOVERED'
);

CREATE TABLE "CommercialHypothesis" (
  "id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "offerKind" "CommercialOfferKind" NOT NULL,
  "clusterCode" VARCHAR(96) NOT NULL,
  "status" "CommercialReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "minimumIndependentBuyers" INTEGER NOT NULL,
  "minimumNetPaidRappen" INTEGER NOT NULL,
  "measurementWindowStart" TIMESTAMPTZ(3) NOT NULL,
  "measurementWindowEnd" TIMESTAMPTZ(3) NOT NULL,
  "offerDigest" CHAR(64) NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "preRegisteredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialHypothesis_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialHypothesis_code_version_key" UNIQUE ("code", "version"),
  CONSTRAINT "commercial_hypothesis_version_check" CHECK ("version" > 0),
  CONSTRAINT "commercial_hypothesis_threshold_check" CHECK (
    "minimumIndependentBuyers" > 0 AND "minimumNetPaidRappen" > 0
  ),
  CONSTRAINT "commercial_hypothesis_window_check" CHECK (
    "measurementWindowEnd" > "measurementWindowStart"
    AND "preRegisteredAt" <= "measurementWindowStart"
  ),
  CONSTRAINT "commercial_hypothesis_digest_check" CHECK (
    "offerDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "CommercialHypothesis_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CommercialHypothesis_clusterCode_offerKind_status_idx"
  ON "CommercialHypothesis" ("clusterCode", "offerKind", "status");

CREATE TABLE "CommercialEvidence" (
  "id" UUID NOT NULL,
  "hypothesisId" UUID NOT NULL,
  "companyId" UUID,
  "orderLineId" UUID,
  "manualReconciliationReference" VARCHAR(255),
  "kind" "CommercialEvidenceKind" NOT NULL,
  "environment" "CommercialEvidenceEnvironment" NOT NULL,
  "independentBuyer" BOOLEAN NOT NULL DEFAULT false,
  "sellerControlledBuyer" BOOLEAN NOT NULL DEFAULT false,
  "grossPaidRappen" INTEGER NOT NULL DEFAULT 0,
  "refundRappen" INTEGER NOT NULL DEFAULT 0,
  "reversalRappen" INTEGER NOT NULL DEFAULT 0,
  "netPaidRappen" INTEGER NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'CHF',
  "deliveryStatus" "CommercialDeliveryStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "evidenceDigest" CHAR(64) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialEvidence_evidenceDigest_key" UNIQUE ("evidenceDigest"),
  CONSTRAINT "commercial_evidence_digest_check" CHECK (
    "evidenceDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "commercial_evidence_money_check" CHECK (
    "grossPaidRappen" >= 0
    AND "refundRappen" >= 0
    AND "reversalRappen" >= 0
    AND "netPaidRappen" =
      "grossPaidRappen" - "refundRappen" - "reversalRappen"
  ),
  CONSTRAINT "commercial_evidence_wtp_shape_check" CHECK (
    "kind" <> 'NET_PAID_WTP'
    OR (
      "companyId" IS NOT NULL
      AND "independentBuyer"
      AND NOT "sellerControlledBuyer"
      AND "environment" IN ('LIVE_PROVIDER', 'MANUAL_RECONCILED')
      AND "deliveryStatus" IN ('STARTED', 'PARTIAL', 'DELIVERED', 'RECOVERED')
      AND "netPaidRappen" > 0
      AND (
        ("environment" = 'LIVE_PROVIDER'
          AND "orderLineId" IS NOT NULL
          AND "manualReconciliationReference" IS NULL)
        OR
        ("environment" = 'MANUAL_RECONCILED'
          AND "orderLineId" IS NULL
          AND length(trim("manualReconciliationReference")) >= 8)
      )
    )
  ),
  CONSTRAINT "CommercialEvidence_hypothesisId_fkey"
    FOREIGN KEY ("hypothesisId") REFERENCES "CommercialHypothesis"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialEvidence_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialEvidence_orderLineId_fkey"
    FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialEvidence_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CommercialEvidence_hypothesisId_kind_environment_occurredAt_idx"
  ON "CommercialEvidence" ("hypothesisId", "kind", "environment", "occurredAt");
CREATE INDEX "CommercialEvidence_companyId_occurredAt_idx"
  ON "CommercialEvidence" ("companyId", "occurredAt");
CREATE INDEX "CommercialEvidence_orderLineId_idx"
  ON "CommercialEvidence" ("orderLineId");

CREATE TABLE "CommercialClusterDecision" (
  "id" UUID NOT NULL,
  "assessmentId" UUID NOT NULL,
  "clusterCode" VARCHAR(96) NOT NULL,
  "status" "CommercialClusterStatus" NOT NULL DEFAULT 'RESEARCH',
  "policyVersion" VARCHAR(32) NOT NULL,
  "selectedCorpusDigest" CHAR(64) NOT NULL,
  "evidenceDigest" CHAR(64) NOT NULL,
  "productApprovedByUserId" UUID,
  "opsApprovedByUserId" UUID,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL,
  "activatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialClusterDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialClusterDecision_assessmentId_key"
    UNIQUE ("assessmentId"),
  CONSTRAINT "commercial_cluster_digest_check" CHECK (
    "selectedCorpusDigest" ~ '^[a-f0-9]{64}$'
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "commercial_cluster_approval_check" CHECK (
    "status" IN ('RESEARCH', 'REVOKED')
    OR (
      "productApprovedByUserId" IS NOT NULL
      AND "opsApprovedByUserId" IS NOT NULL
      AND "productApprovedByUserId" <> "opsApprovedByUserId"
    )
  ),
  CONSTRAINT "commercial_cluster_activation_check" CHECK (
    ("status" = 'PUBLIC_ACTIVE' AND "activatedAt" IS NOT NULL)
    OR ("status" <> 'PUBLIC_ACTIVE' AND "activatedAt" IS NULL)
  ),
  CONSTRAINT "CommercialClusterDecision_assessmentId_fkey"
    FOREIGN KEY ("assessmentId") REFERENCES "ClusterLaunchAssessment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialClusterDecision_productApprovedByUserId_fkey"
    FOREIGN KEY ("productApprovedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialClusterDecision_opsApprovedByUserId_fkey"
    FOREIGN KEY ("opsApprovedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CommercialClusterDecision_status_decidedAt_idx"
  ON "CommercialClusterDecision" ("status", "decidedAt");
CREATE INDEX "CommercialClusterDecision_clusterCode_status_idx"
  ON "CommercialClusterDecision" ("clusterCode", "status");
CREATE UNIQUE INDEX "CommercialClusterDecision_single_first_cluster_key"
  ON "CommercialClusterDecision" ((1))
  WHERE "status" IN ('SELECTED', 'PUBLIC_ACTIVE');

CREATE TABLE "CapacityModelRelease" (
  "id" UUID NOT NULL,
  "versionCode" VARCHAR(64) NOT NULL,
  "status" "CommercialReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "modelDigest" CHAR(64) NOT NULL,
  "modelPayload" JSONB NOT NULL,
  "maximumUtilizationBps" INTEGER NOT NULL,
  "measuredUtilizationBps" INTEGER NOT NULL,
  "maximumConciergeCogsRappenPerCustomer" INTEGER NOT NULL,
  "measuredConciergeCogsRappenPerCustomer" INTEGER NOT NULL,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapacityModelRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CapacityModelRelease_versionCode_key" UNIQUE ("versionCode"),
  CONSTRAINT "CapacityModelRelease_modelDigest_key" UNIQUE ("modelDigest"),
  CONSTRAINT "capacity_model_digest_check" CHECK (
    "modelDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "capacity_model_limits_check" CHECK (
    "maximumUtilizationBps" BETWEEN 1 AND 8000
    AND "measuredUtilizationBps" BETWEEN 0 AND "maximumUtilizationBps"
    AND "maximumConciergeCogsRappenPerCustomer" > 0
    AND "measuredConciergeCogsRappenPerCustomer"
      BETWEEN 0 AND "maximumConciergeCogsRappenPerCustomer"
  ),
  CONSTRAINT "capacity_model_approval_check" CHECK (
    "status" IN ('DRAFT', 'REVOKED')
    OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  ),
  CONSTRAINT "CapacityModelRelease_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CapacityModelRelease_status_approvedAt_idx"
  ON "CapacityModelRelease" ("status", "approvedAt");

CREATE TABLE "CashflowModelRelease" (
  "id" UUID NOT NULL,
  "versionCode" VARCHAR(64) NOT NULL,
  "scenarioCode" VARCHAR(64) NOT NULL,
  "horizonMonths" INTEGER NOT NULL,
  "status" "CommercialReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "modelDigest" CHAR(64) NOT NULL,
  "modelPayload" JSONB NOT NULL,
  "openingCashRappen" INTEGER NOT NULL,
  "closingCashRappen" INTEGER NOT NULL,
  "peakFundingNeedRappen" INTEGER NOT NULL,
  "breakEvenMonth" INTEGER,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashflowModelRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashflowModelRelease_modelDigest_key" UNIQUE ("modelDigest"),
  CONSTRAINT "CashflowModelRelease_versionCode_scenarioCode_horizonMonths_key"
    UNIQUE ("versionCode", "scenarioCode", "horizonMonths"),
  CONSTRAINT "cashflow_model_digest_check" CHECK (
    "modelDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "cashflow_model_horizon_check" CHECK (
    "horizonMonths" IN (18, 24)
    AND "openingCashRappen" >= 0
    AND "peakFundingNeedRappen" >= 0
    AND ("breakEvenMonth" IS NULL
      OR "breakEvenMonth" BETWEEN 1 AND "horizonMonths")
  ),
  CONSTRAINT "cashflow_model_approval_check" CHECK (
    "status" IN ('DRAFT', 'REVOKED')
    OR (
      "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "breakEvenMonth" IS NOT NULL
    )
  ),
  CONSTRAINT "CashflowModelRelease_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CashflowModelRelease_status_horizonMonths_approvedAt_idx"
  ON "CashflowModelRelease" ("status", "horizonMonths", "approvedAt");

CREATE TABLE "ServicePolicyRelease" (
  "id" UUID NOT NULL,
  "versionCode" VARCHAR(64) NOT NULL,
  "status" "CommercialReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "policyDigest" CHAR(64) NOT NULL,
  "customerCopyDigest" CHAR(64) NOT NULL,
  "supportedOfferKinds" "CommercialOfferKind"[] NOT NULL,
  "responseSlaMinutes" INTEGER NOT NULL,
  "remedyCodes" VARCHAR(32)[] NOT NULL,
  "escalationOwner" VARCHAR(160) NOT NULL,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServicePolicyRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServicePolicyRelease_versionCode_key" UNIQUE ("versionCode"),
  CONSTRAINT "ServicePolicyRelease_policyDigest_key" UNIQUE ("policyDigest"),
  CONSTRAINT "service_policy_digest_check" CHECK (
    "policyDigest" ~ '^[a-f0-9]{64}$'
    AND "customerCopyDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "service_policy_content_check" CHECK (
    "responseSlaMinutes" > 0
    AND cardinality("supportedOfferKinds") > 0
    AND 'EXTENSION' = ANY("remedyCodes")
    AND 'CREDIT' = ANY("remedyCodes")
    AND 'REFUND' = ANY("remedyCodes")
  ),
  CONSTRAINT "service_policy_approval_check" CHECK (
    "status" IN ('DRAFT', 'REVOKED')
    OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  ),
  CONSTRAINT "ServicePolicyRelease_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ServicePolicyRelease_status_approvedAt_idx"
  ON "ServicePolicyRelease" ("status", "approvedAt");

CREATE TABLE "CommercialOfferRelease" (
  "id" UUID NOT NULL,
  "hypothesisId" UUID NOT NULL,
  "productVersionId" UUID,
  "clusterDecisionId" UUID NOT NULL,
  "capacityModelReleaseId" UUID NOT NULL,
  "cashflowModelReleaseId" UUID NOT NULL,
  "servicePolicyReleaseId" UUID NOT NULL,
  "offerKind" "CommercialOfferKind" NOT NULL,
  "status" "CommercialReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "serverPriceRappen" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CHF',
  "allowsPublic" BOOLEAN NOT NULL DEFAULT false,
  "allowsSelfService" BOOLEAN NOT NULL DEFAULT false,
  "legalApprovalReference" VARCHAR(255),
  "taxApprovalReference" VARCHAR(255),
  "avgApprovalReference" VARCHAR(255),
  "privacyApprovalReference" VARCHAR(255),
  "accountingApprovalReference" VARCHAR(255),
  "releaseDigest" CHAR(64) NOT NULL,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialOfferRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialOfferRelease_hypothesisId_key"
    UNIQUE ("hypothesisId"),
  CONSTRAINT "CommercialOfferRelease_releaseDigest_key"
    UNIQUE ("releaseDigest"),
  CONSTRAINT "commercial_offer_release_digest_check" CHECK (
    "releaseDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "commercial_offer_release_price_check" CHECK (
    "serverPriceRappen" > 0 AND "currency" = 'CHF'
  ),
  CONSTRAINT "commercial_offer_release_state_check" CHECK (
    ("status" = 'DRAFT'
      AND NOT "allowsPublic"
      AND NOT "allowsSelfService"
      AND "approvedAt" IS NULL
      AND "activatedAt" IS NULL)
    OR
    ("status" = 'APPROVED'
      AND "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "activatedAt" IS NULL)
    OR
    ("status" = 'PUBLIC_ACTIVE'
      AND "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "activatedAt" IS NOT NULL
      AND "allowsPublic")
    OR
    ("status" = 'REVOKED' AND "activatedAt" IS NULL)
  ),
  CONSTRAINT "commercial_offer_release_external_approval_check" CHECK (
    "status" NOT IN ('APPROVED', 'PUBLIC_ACTIVE')
    OR (
      coalesce(length(trim("legalApprovalReference")), 0) >= 8
      AND coalesce(length(trim("taxApprovalReference")), 0) >= 8
      AND coalesce(length(trim("avgApprovalReference")), 0) >= 8
      AND coalesce(length(trim("privacyApprovalReference")), 0) >= 8
      AND coalesce(length(trim("accountingApprovalReference")), 0) >= 8
    )
  ),
  CONSTRAINT "CommercialOfferRelease_hypothesisId_fkey"
    FOREIGN KEY ("hypothesisId") REFERENCES "CommercialHypothesis"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialOfferRelease_productVersionId_fkey"
    FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialOfferRelease_clusterDecisionId_fkey"
    FOREIGN KEY ("clusterDecisionId") REFERENCES "CommercialClusterDecision"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialOfferRelease_capacityModelReleaseId_fkey"
    FOREIGN KEY ("capacityModelReleaseId") REFERENCES "CapacityModelRelease"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialOfferRelease_cashflowModelReleaseId_fkey"
    FOREIGN KEY ("cashflowModelReleaseId") REFERENCES "CashflowModelRelease"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialOfferRelease_servicePolicyReleaseId_fkey"
    FOREIGN KEY ("servicePolicyReleaseId") REFERENCES "ServicePolicyRelease"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercialOfferRelease_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CommercialOfferRelease_status_offerKind_activatedAt_idx"
  ON "CommercialOfferRelease" ("status", "offerKind", "activatedAt");
CREATE INDEX "CommercialOfferRelease_clusterDecisionId_status_idx"
  ON "CommercialOfferRelease" ("clusterDecisionId", "status");
CREATE UNIQUE INDEX "CommercialOfferRelease_single_first_public_offer_key"
  ON "CommercialOfferRelease" ((1))
  WHERE "status" = 'PUBLIC_ACTIVE';

CREATE FUNCTION phase31_validate_cluster_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  assessment_row "ClusterLaunchAssessment"%ROWTYPE;
  quality_row "ClusterSearchQualityEvidence"%ROWTYPE;
BEGIN
  IF NEW."status" NOT IN ('SELECTED', 'PUBLIC_ACTIVE') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO assessment_row
  FROM "ClusterLaunchAssessment"
  WHERE "id" = NEW."assessmentId";
  SELECT * INTO quality_row
  FROM "ClusterSearchQualityEvidence"
  WHERE "clusterLaunchAssessmentId" = NEW."assessmentId";
  IF assessment_row."status" <> 'ACTIVATED'
    OR assessment_row."validUntil" <= NEW."decidedAt"
    OR assessment_row."productApprovedByUserId" IS NULL
    OR assessment_row."opsApprovedByUserId" IS NULL
    OR assessment_row."productApprovedByUserId" =
       assessment_row."opsApprovedByUserId"
    OR quality_row."selectionStatus" <> 'SELECTED'
    OR quality_row."expertReviewedAt" IS NULL
    OR quality_row."expertReviewerUserId" IS NULL
    OR quality_row."corpusDigest" <> NEW."selectedCorpusDigest"
    OR quality_row."precisionAt10Bps" < 8000
    OR quality_row."recallAt10Bps" < 8000
    OR quality_row."coverageBps" < 8000
    OR quality_row."relevantTopKJobs" < 5
  THEN
    RAISE EXCEPTION 'Phase 31 first-cluster evidence is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'phase31_first_cluster_evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase31_cluster_decision_gate
BEFORE INSERT ON "CommercialClusterDecision"
FOR EACH ROW EXECUTE FUNCTION phase31_validate_cluster_decision();

CREATE FUNCTION phase31_validate_offer_release()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  hypothesis_row "CommercialHypothesis"%ROWTYPE;
  cluster_row "CommercialClusterDecision"%ROWTYPE;
  capacity_status "CommercialReleaseStatus";
  cashflow_status "CommercialReleaseStatus";
  service_status "CommercialReleaseStatus";
  service_offer_kinds "CommercialOfferKind"[];
  paid_buyers INTEGER;
  paid_net BIGINT;
  core_release_count INTEGER;
  addon_evidence_count INTEGER;
BEGIN
  IF NEW."status" NOT IN ('APPROVED', 'PUBLIC_ACTIVE') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO hypothesis_row FROM "CommercialHypothesis"
    WHERE "id" = NEW."hypothesisId";
  SELECT * INTO cluster_row FROM "CommercialClusterDecision"
    WHERE "id" = NEW."clusterDecisionId";
  SELECT "status" INTO capacity_status FROM "CapacityModelRelease"
    WHERE "id" = NEW."capacityModelReleaseId";
  SELECT "status" INTO cashflow_status FROM "CashflowModelRelease"
    WHERE "id" = NEW."cashflowModelReleaseId";
  SELECT "status", "supportedOfferKinds"
    INTO service_status, service_offer_kinds
    FROM "ServicePolicyRelease"
    WHERE "id" = NEW."servicePolicyReleaseId";
  SELECT count(DISTINCT "companyId"), coalesce(sum("netPaidRappen"), 0)
    INTO paid_buyers, paid_net
  FROM "CommercialEvidence"
  WHERE "hypothesisId" = NEW."hypothesisId"
    AND "kind" = 'NET_PAID_WTP'
    AND "environment" IN ('LIVE_PROVIDER', 'MANUAL_RECONCILED')
    AND "independentBuyer"
    AND NOT "sellerControlledBuyer"
    AND "deliveryStatus" IN ('STARTED', 'PARTIAL', 'DELIVERED', 'RECOVERED')
    AND "occurredAt" >= hypothesis_row."measurementWindowStart"
    AND "occurredAt" <= hypothesis_row."measurementWindowEnd"
    AND "netPaidRappen" > 0;
  SELECT count(*) INTO core_release_count
  FROM "CommercialOfferRelease" AS core_release
  JOIN "CommercialHypothesis" AS core_hypothesis
    ON core_hypothesis."id" = core_release."hypothesisId"
  WHERE core_release."clusterDecisionId" = NEW."clusterDecisionId"
    AND core_release."status" IN ('APPROVED', 'PUBLIC_ACTIVE')
    AND core_hypothesis."offerKind" IN (
      'CORE_WORKFLOW',
      'HIRING_SPRINT',
      'RETAINER_CREDITS',
      'CONCIERGE',
      'MANAGED_IMPORT'
    );
  SELECT count(*) INTO addon_evidence_count
  FROM "CommercialEvidence"
  WHERE "hypothesisId" = NEW."hypothesisId"
    AND "environment" = 'LIVE_RESEARCH'
    AND (
      (NEW."offerKind" = 'BOOST' AND "kind" = 'ORGANIC_REACH')
      OR
      (NEW."offerKind" = 'PAID_RADAR'
        AND "kind" IN ('RADAR_FUNNEL', 'PRIVACY_REVIEW'))
    );
  IF hypothesis_row."offerKind" <> NEW."offerKind"
    OR hypothesis_row."status" NOT IN ('APPROVED', 'PUBLIC_ACTIVE')
    OR cluster_row."clusterCode" <> hypothesis_row."clusterCode"
    OR capacity_status NOT IN ('APPROVED', 'PUBLIC_ACTIVE')
    OR cashflow_status NOT IN ('APPROVED', 'PUBLIC_ACTIVE')
    OR service_status NOT IN ('APPROVED', 'PUBLIC_ACTIVE')
    OR NOT (NEW."offerKind" = ANY(service_offer_kinds))
    OR paid_buyers < hypothesis_row."minimumIndependentBuyers"
    OR paid_net < hypothesis_row."minimumNetPaidRappen"
    OR (
      NEW."offerKind" IN ('BOOST', 'PAID_RADAR')
      AND core_release_count < 1
    )
    OR (NEW."offerKind" = 'BOOST' AND addon_evidence_count < 1)
    OR (NEW."offerKind" = 'PAID_RADAR' AND addon_evidence_count < 2)
    OR (NEW."status" = 'PUBLIC_ACTIVE'
      AND cluster_row."status" <> 'PUBLIC_ACTIVE')
  THEN
    RAISE EXCEPTION 'Phase 31 commercial release evidence is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'phase31_commercial_release_evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase31_offer_release_gate
BEFORE INSERT ON "CommercialOfferRelease"
FOR EACH ROW EXECUTE FUNCTION phase31_validate_offer_release();

CREATE FUNCTION phase31_reject_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '23514', CONSTRAINT = 'phase31_evidence_append_only';
END;
$$;

CREATE TRIGGER phase31_hypothesis_append_only
BEFORE UPDATE OR DELETE ON "CommercialHypothesis"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
CREATE TRIGGER phase31_evidence_append_only
BEFORE UPDATE OR DELETE ON "CommercialEvidence"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
CREATE TRIGGER phase31_cluster_decision_append_only
BEFORE UPDATE OR DELETE ON "CommercialClusterDecision"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
CREATE TRIGGER phase31_capacity_release_append_only
BEFORE UPDATE OR DELETE ON "CapacityModelRelease"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
CREATE TRIGGER phase31_cashflow_release_append_only
BEFORE UPDATE OR DELETE ON "CashflowModelRelease"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
CREATE TRIGGER phase31_service_policy_append_only
BEFORE UPDATE OR DELETE ON "ServicePolicyRelease"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
CREATE TRIGGER phase31_offer_release_append_only
BEFORE UPDATE OR DELETE ON "CommercialOfferRelease"
FOR EACH ROW EXECUTE FUNCTION phase31_reject_evidence_mutation();
