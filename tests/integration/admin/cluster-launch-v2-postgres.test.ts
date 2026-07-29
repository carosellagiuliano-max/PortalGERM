import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { transitionClusterLaunch } from "@/lib/admin/content";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { CLUSTER_LAUNCH_POLICY_V2 } from "@/lib/seo/cluster-launch-policy-v2";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-29T12:00:00.000Z");
const DAY_MS = 86_400_000;
const ADMIN = "30000000-0000-4000-8002-000000000001";
const EXPERT = "30000000-0000-4000-8002-000000000002";
const CANTON = "30000000-0000-4000-8002-000000000003";
const CATEGORY = "30000000-0000-4000-8002-000000000004";
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let assessmentSequence = 0;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_cluster_launch_v2");
  database = createDatabaseClient(migrated.connectionString);
  await seed(db());
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 Cluster Launch V2 PostgreSQL boundary", () => {
  it("rejects V1-style approvals when V2 search-quality evidence is missing", async () => {
    const assessment = await createAssessment();
    await approveBoth(assessment.id);

    await expect(activate(assessment.id)).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
    });
    await expect(
      db().clusterLaunchAssessment.update({
        where: { id: assessment.id },
        data: {
          status: "ACTIVATED",
          activatedAt: new Date(NOW.getTime() + 3_000),
        },
      }),
    ).rejects.toThrow("Cluster V2 search-quality evidence is incomplete");
  });

  it("rejects 79.99 percent in application and database authorization", async () => {
    const assessment = await createAssessment();
    await createEvidence(assessment.id, {
      precisionAt10Bps: 7_999,
      selectionStatus: "SELECTED",
    });
    await approveBoth(assessment.id);

    await expect(activate(assessment.id)).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
    });
    await expect(
      db().clusterLaunchAssessment.update({
        where: { id: assessment.id },
        data: {
          status: "ACTIVATED",
          activatedAt: new Date(NOW.getTime() + 3_000),
        },
      }),
    ).rejects.toThrow("Cluster V2 search-quality evidence is incomplete");
  });

  it("activates exactly at all 80 percent gates and keeps judgments immutable", async () => {
    const assessment = await createAssessment();
    const evidence = await createEvidence(assessment.id, {
      precisionAt10Bps: 8_000,
      selectionStatus: "SELECTED",
    });
    await approveBoth(assessment.id);

    await expect(activate(assessment.id)).resolves.toMatchObject({
      ok: true,
      value: { assessmentId: assessment.id, status: "ACTIVATED" },
    });
    await expect(
      db().clusterLaunchAssessment.findUniqueOrThrow({
        where: { id: assessment.id },
        select: { status: true, activatedAt: true },
      }),
    ).resolves.toMatchObject({
      status: "ACTIVATED",
      activatedAt: new Date(NOW.getTime() + 3_000),
    });
    await expect(
      db().clusterSearchQualityEvidence.update({
        where: { id: evidence.id },
        data: { precisionAt10Bps: 9_000 },
      }),
    ).rejects.toThrow("Cluster search-quality evidence is append-only");
  });

  it("keeps discovery-only evidence non-activatable", async () => {
    const assessment = await createAssessment();
    await createEvidence(assessment.id, {
      precisionAt10Bps: 10_000,
      selectionStatus: "DISCOVERY_ONLY",
    });
    await approveBoth(assessment.id);

    await expect(activate(assessment.id)).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
    });
  });
});

async function createAssessment() {
  assessmentSequence += 1;
  const evaluatedAt = new Date(NOW.getTime() - DAY_MS + assessmentSequence);
  return db().clusterLaunchAssessment.create({
    data: {
      id: randomUUID(),
      cantonId: CANTON,
      categoryId: CATEGORY,
      policyVersion: CLUSTER_LAUNCH_POLICY_V2.version,
      evaluatedAt,
      evidenceWindowStart: new Date(evaluatedAt.getTime() - 30 * DAY_MS),
      evidenceWindowEnd: evaluatedAt,
      liveJobCount: 50,
      activeCandidateCount: 200,
      activeEmployerCount: 15,
      responseRateBasisPoints: 7_000,
      contentCoverageBasisPoints: 8_000,
      medianApplicationsTimes2: 6,
      dataProvenance: "LIVE",
      evidenceHash: digest(`assessment:${randomUUID()}`),
      validUntil: new Date(NOW.getTime() + 30 * DAY_MS),
      status: "READY",
    },
  });
}

function createEvidence(
  assessmentId: string,
  overrides: Readonly<{
    precisionAt10Bps: number;
    selectionStatus: "SELECTED" | "DISCOVERY_ONLY";
  }>,
) {
  return db().clusterSearchQualityEvidence.create({
    data: {
      id: randomUUID(),
      clusterLaunchAssessmentId: assessmentId,
      selectionStatus: overrides.selectionStatus,
      searchPolicyVersion:
        CLUSTER_LAUNCH_POLICY_V2.releases.searchPolicyVersion,
      taxonomyVersion: CLUSTER_LAUNCH_POLICY_V2.releases.taxonomyVersion,
      rankingVersion: CLUSTER_LAUNCH_POLICY_V2.releases.rankingVersion,
      querySetDigest: digest(`queries:${assessmentId}`),
      topKJudgmentDigest: digest(`judgments:${assessmentId}`),
      corpusDigest: digest(`corpus:${assessmentId}`),
      precisionAt10Bps: overrides.precisionAt10Bps,
      recallAt10Bps: 8_000,
      coverageBps: 8_000,
      relevantTopKJobs: 5,
      expertReviewedAt: new Date(NOW.getTime() - 2 * DAY_MS),
      expertReviewerUserId: EXPERT,
      createdAt: new Date(NOW.getTime() - DAY_MS),
    },
  });
}

async function approveBoth(assessmentId: string) {
  requireSuccess(
    await transitionClusterLaunch(
      {
        assessmentId,
        action: "PRODUCT_APPROVE",
        reasonCode: "PRODUCT_EVIDENCE_APPROVED",
        idempotencyKey: randomUUID(),
      },
      deps(new Date(NOW.getTime() + 1_000)),
    ),
  );
  requireSuccess(
    await transitionClusterLaunch(
      {
        assessmentId,
        action: "OPS_APPROVE",
        reasonCode: "OPS_EVIDENCE_APPROVED",
        idempotencyKey: randomUUID(),
      },
      deps(new Date(NOW.getTime() + 2_000)),
    ),
  );
}

function activate(assessmentId: string) {
  return transitionClusterLaunch(
    {
      assessmentId,
      action: "ACTIVATE",
      reasonCode: "SEARCH_QUALITY_AND_DUAL_APPROVAL_COMPLETE",
      idempotencyKey: randomUUID(),
    },
    deps(new Date(NOW.getTime() + 3_000)),
  );
}

function deps(now: Date) {
  return {
    actor: {
      userId: ADMIN,
      email: "phase30-admin@example.ch",
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
      capabilities: [
        "ADMIN_CLUSTER_PRODUCT_APPROVE",
        "ADMIN_CLUSTER_OPS_APPROVE",
        "ADMIN_CLUSTER_ACTIVATE",
      ] as const,
    },
    correlationId: randomUUID(),
    database: db(),
    now,
  };
}

async function seed(client: DatabaseClient) {
  await client.user.createMany({
    data: [
      {
        id: ADMIN,
        email: "phase30-admin@example.ch",
        emailNormalized: "phase30-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
      {
        id: EXPERT,
        email: "phase30-expert@example.ch",
        emailNormalized: "phase30-expert@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
    ],
  });
  await client.canton.create({
    data: {
      id: CANTON,
      code: "ZH",
      name: "Zürich",
      slug: "phase-30-cluster-zuerich",
      language: "DE",
      isActive: true,
    },
  });
  await client.category.create({
    data: {
      id: CATEGORY,
      name: "Phase 30 Pflege",
      slug: "phase-30-pflege",
      isActive: true,
    },
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireSuccess<T>(
  result: Readonly<{ ok: boolean; value?: T; code?: string }>,
) {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected success, received ${result.code ?? "unknown"}.`);
  }
  return result.value;
}

function db(): DatabaseClient {
  if (database === undefined)
    throw new Error("Cluster V2 database unavailable.");
  return database;
}
