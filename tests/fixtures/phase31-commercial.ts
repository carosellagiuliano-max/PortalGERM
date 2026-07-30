import { createHash, randomUUID } from "node:crypto";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

export const PHASE31_NOW = new Date("2026-07-30T12:00:00.000Z");
export const PHASE31_ADMIN_PRODUCT =
  "31000000-0000-4000-8000-000000000001";
export const PHASE31_ADMIN_OPS =
  "31000000-0000-4000-8000-000000000002";
export const PHASE31_EXPERT = "31000000-0000-4000-8000-000000000003";
export const PHASE31_CANTON = "31000000-0000-4000-8000-000000000004";
export const PHASE31_CATEGORY = "31000000-0000-4000-8000-000000000005";
export const PHASE31_COMPANY_ONE =
  "31000000-0000-4000-8000-000000000006";
export const PHASE31_COMPANY_TWO =
  "31000000-0000-4000-8000-000000000007";
let assessmentSequence = 0;

export type Phase31Fixture = Readonly<{
  database: DatabaseClient;
  dispose: () => Promise<void>;
}>;

export async function createPhase31Fixture(
  databaseName: string,
): Promise<Phase31Fixture> {
  const migrated = await createMigratedTestDatabase(databaseName);
  const database = createDatabaseClient(migrated.connectionString);
  await seedCommercialActors(database);
  return {
    database,
    async dispose() {
      await database.$disconnect();
      await migrated.dispose();
    },
  };
}

export async function seedCommercialActors(database: DatabaseClient) {
  await database.user.createMany({
    data: [
      {
        id: PHASE31_ADMIN_PRODUCT,
        email: "phase31-product@example.ch",
        emailNormalized: "phase31-product@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
      {
        id: PHASE31_ADMIN_OPS,
        email: "phase31-ops@example.ch",
        emailNormalized: "phase31-ops@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
      {
        id: PHASE31_EXPERT,
        email: "phase31-expert@example.ch",
        emailNormalized: "phase31-expert@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
    ],
  });
  await database.canton.create({
    data: {
      id: PHASE31_CANTON,
      code: "ZG",
      name: "Zug",
      slug: `phase31-zug-${randomUUID()}`,
      language: "DE",
      isActive: true,
    },
  });
  await database.category.create({
    data: {
      id: PHASE31_CATEGORY,
      name: `Phase 31 Pflege ${randomUUID()}`,
      slug: `phase31-pflege-${randomUUID()}`,
      isActive: true,
    },
  });
  await database.company.createMany({
    data: [
      {
        id: PHASE31_COMPANY_ONE,
        name: "Phase 31 Buyer One AG",
        slug: `phase31-buyer-one-${randomUUID()}`,
        status: "DRAFT",
        dataProvenance: "TEST",
      },
      {
        id: PHASE31_COMPANY_TWO,
        name: "Phase 31 Buyer Two AG",
        slug: `phase31-buyer-two-${randomUUID()}`,
        status: "DRAFT",
        dataProvenance: "TEST",
      },
    ],
  });
}

export async function seedActivatedClusterAssessment(
  database: DatabaseClient,
  suffix: string = randomUUID(),
) {
  assessmentSequence += 1;
  const assessedAt = new Date(
    PHASE31_NOW.getTime() - 86_400_000 + assessmentSequence,
  );
  const category = await database.category.create({
    data: {
      id: randomUUID(),
      name: `Phase 31 Cluster ${suffix}`,
      slug: `phase31-cluster-${suffix}-${randomUUID()}`,
      isActive: true,
    },
  });
  const assessment = await database.clusterLaunchAssessment.create({
    data: {
      id: randomUUID(),
      cantonId: PHASE31_CANTON,
      categoryId: category.id,
      policyVersion: "CLUSTER_LAUNCH_POLICY_V2",
      evaluatedAt: assessedAt,
      evidenceWindowStart: new Date(assessedAt.getTime() - 30 * 86_400_000),
      evidenceWindowEnd: assessedAt,
      liveJobCount: 50,
      activeCandidateCount: 200,
      activeEmployerCount: 15,
      responseRateBasisPoints: 7_000,
      contentCoverageBasisPoints: 8_000,
      medianApplicationsTimes2: 6,
      dataProvenance: "LIVE",
      evidenceHash: phase31Digest(`assessment:${suffix}`),
      validUntil: new Date(PHASE31_NOW.getTime() + 30 * 86_400_000),
      status: "READY",
      productApprovedByUserId: PHASE31_ADMIN_PRODUCT,
      productApprovedAt: new Date(PHASE31_NOW.getTime() - 3_000),
      opsApprovedByUserId: PHASE31_ADMIN_OPS,
      opsApprovedAt: new Date(PHASE31_NOW.getTime() - 2_000),
    },
  });
  const corpusDigest = phase31Digest(`corpus:${suffix}`);
  await database.clusterSearchQualityEvidence.create({
    data: {
      id: randomUUID(),
      clusterLaunchAssessmentId: assessment.id,
      selectionStatus: "SELECTED",
      searchPolicyVersion: "search-policy-v2",
      taxonomyVersion: "taxonomy-de-ch-v1",
      rankingVersion: "ranking-v2",
      querySetDigest: phase31Digest(`queries:${suffix}`),
      topKJudgmentDigest: phase31Digest(`judgments:${suffix}`),
      corpusDigest,
      precisionAt10Bps: 8_000,
      recallAt10Bps: 8_000,
      coverageBps: 8_000,
      relevantTopKJobs: 5,
      expertReviewedAt: new Date(PHASE31_NOW.getTime() - 86_400_000),
      expertReviewerUserId: PHASE31_EXPERT,
    },
  });
  await database.clusterLaunchAssessment.update({
    where: { id: assessment.id },
    data: {
      status: "ACTIVATED",
      activatedAt: new Date(PHASE31_NOW.getTime() - 1_000),
    },
  });
  return { assessmentId: assessment.id, corpusDigest };
}

export async function seedPublicCommercialCluster(
  database: DatabaseClient,
  clusterCode = "ZG_PFLEGE",
) {
  const cluster = await seedActivatedClusterAssessment(database);
  const decision = await database.commercialClusterDecision.create({
    data: {
      id: randomUUID(),
      assessmentId: cluster.assessmentId,
      clusterCode,
      status: "PUBLIC_ACTIVE",
      policyVersion: "phase31-v1",
      selectedCorpusDigest: cluster.corpusDigest,
      evidenceDigest: phase31Digest(`cluster-decision:${cluster.assessmentId}`),
      productApprovedByUserId: PHASE31_ADMIN_PRODUCT,
      opsApprovedByUserId: PHASE31_ADMIN_OPS,
      decidedAt: PHASE31_NOW,
      activatedAt: PHASE31_NOW,
    },
  });
  return decision;
}

export async function seedApprovedCommercialModels(database: DatabaseClient) {
  const capacity = await database.capacityModelRelease.create({
    data: {
      id: randomUUID(),
      versionCode: `capacity-${randomUUID()}`,
      status: "APPROVED",
      modelDigest: phase31Digest(`capacity:${randomUUID()}`),
      modelPayload: {
        workTypes: 6,
        source: "TECHNICAL_TEST_FIXTURE_NOT_MARKET_EVIDENCE",
      },
      maximumUtilizationBps: 8_000,
      measuredUtilizationBps: 6_000,
      maximumConciergeCogsRappenPerCustomer: 40_000,
      measuredConciergeCogsRappenPerCustomer: 30_000,
      approvedByUserId: PHASE31_ADMIN_OPS,
      approvedAt: PHASE31_NOW,
    },
  });
  const cashflow = await database.cashflowModelRelease.create({
    data: {
      id: randomUUID(),
      versionCode: `cashflow-${randomUUID()}`,
      scenarioCode: "TECHNICAL_TEST_BASE",
      horizonMonths: 18,
      status: "APPROVED",
      modelDigest: phase31Digest(`cashflow:${randomUUID()}`),
      modelPayload: {
        months: 18,
        source: "TECHNICAL_TEST_FIXTURE_NOT_FINANCE_APPROVAL",
      },
      openingCashRappen: 1_000_000,
      closingCashRappen: 2_000_000,
      peakFundingNeedRappen: 0,
      breakEvenMonth: 12,
      approvedByUserId: PHASE31_ADMIN_PRODUCT,
      approvedAt: PHASE31_NOW,
    },
  });
  const service = await database.servicePolicyRelease.create({
    data: {
      id: randomUUID(),
      versionCode: `recovery-${randomUUID()}`,
      status: "APPROVED",
      policyDigest: phase31Digest(`recovery-policy:${randomUUID()}`),
      customerCopyDigest: phase31Digest(`recovery-copy:${randomUUID()}`),
      supportedOfferKinds: ["HIRING_SPRINT"],
      responseSlaMinutes: 240,
      remedyCodes: ["RETRY", "EXTENSION", "CREDIT", "REFUND"],
      escalationOwner: "Phase 31 test owner",
      approvedByUserId: PHASE31_ADMIN_OPS,
      approvedAt: PHASE31_NOW,
    },
  });
  return { capacity, cashflow, service };
}

export function phase31Digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
