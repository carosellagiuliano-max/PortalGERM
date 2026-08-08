import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CANDIDATE_RECOMMENDATION_QUERY_POLICY_V1,
  listCandidateRecommendationProjections,
} from "@/lib/candidate/recommendation-read-model";
import {
  createDatabaseClient,
  type DatabaseClient,
  type DatabaseQueryObservation,
} from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-29T12:00:00.000Z");
const DAY_MS = 86_400_000;
const TOTAL_CANDIDATES = 48;
const INELIGIBLE_CANARIES = 3;
const PAGE_SIZE = 24;
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let observations: DatabaseQueryObservation[] = [];
let canaryJobIds: readonly string[] = [];

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_recommendations");
  database = createDatabaseClient(migrated.connectionString, {
    onQuery: (observation) => observations.push(observation),
  });
  canaryJobIds = await seedRecommendationCandidates(db());
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 recommendation batch budget", () => {
  it("hydrates 48 candidates without a per-job query and excludes every freshness/trust canary", async () => {
    const queryCounts: number[] = [];
    const elapsedMs: number[] = [];
    let finalSlugs: readonly string[] = [];

    for (let sample = 0; sample < 22; sample += 1) {
      observations = [];
      const startedAt = performance.now();
      const projections = await listCandidateRecommendationProjections(
        db(),
        {
          categorySlugs: Object.freeze([]),
          jobTypes: Object.freeze([]),
          remoteTypes: Object.freeze([]),
        },
        NOW,
      );
      const elapsed = performance.now() - startedAt;
      if (sample >= 2) {
        elapsedMs.push(elapsed);
        queryCounts.push(
          observations.filter(
            ({ driverControl, transactionControl }) =>
              !transactionControl && !driverControl,
          ).length,
        );
      }

      expect(projections).toHaveLength(TOTAL_CANDIDATES - INELIGIBLE_CANARIES);
      expect(projections.some(({ job }) => canaryJobIds.includes(job.id))).toBe(
        false,
      );
      finalSlugs = projections.slice(0, PAGE_SIZE).map(({ job }) => job.slug);
    }

    const p95Ms = percentile95(elapsedMs);
    console.info(
      `PHASE30_RECOMMENDATION_PROBE queryCounts=${queryCounts.join(",")} p95Ms=${p95Ms.toFixed(1)}`,
    );
    expect(new Set(finalSlugs).size).toBe(PAGE_SIZE);
    expect(Math.max(...queryCounts)).toBeLessThanOrEqual(
      CANDIDATE_RECOMMENDATION_QUERY_POLICY_V1.maximumSqlQueries,
    );
    expect(p95Ms).toBeLessThanOrEqual(
      CANDIDATE_RECOMMENDATION_QUERY_POLICY_V1.p95BudgetMs,
    );
  });

  it("keeps synthetic response evidence local and suppresses it in public preview recommendations", async () => {
    const selection = {
      categorySlugs: Object.freeze([]),
      jobTypes: Object.freeze([]),
      remoteTypes: Object.freeze([]),
    };
    const local = await listCandidateRecommendationProjections(
      db(),
      selection,
      NOW,
      { applicationEnvironment: "local" },
    );
    const preview = await listCandidateRecommendationProjections(
      db(),
      selection,
      NOW,
      { applicationEnvironment: "preview" },
    );

    expect(local).toHaveLength(TOTAL_CANDIDATES - INELIGIBLE_CANARIES);
    expect(local.every(({ job }) => job.response.known)).toBe(true);
    expect(preview).toHaveLength(TOTAL_CANDIDATES - INELIGIBLE_CANARIES);
    expect(
      preview.every(({ job }) =>
        !job.response.known &&
        job.response.targetDays === null &&
        job.response.onTimeRateBps === null &&
        job.response.sampleSizeBucket === null),
    ).toBe(true);
  });

  it("never uses the Company response projection as Job recommendation eligibility", async () => {
    await db().company.updateMany({
      where: { slug: "phase30-empfehlungen-ag" },
      data: { responseTargetDays: 365 },
    });
    try {
      const projections = await listCandidateRecommendationProjections(
        db(),
        {
          categorySlugs: Object.freeze([]),
          jobTypes: Object.freeze([]),
          remoteTypes: Object.freeze([]),
        },
        NOW,
        { applicationEnvironment: "local" },
      );

      expect(projections).toHaveLength(TOTAL_CANDIDATES - INELIGIBLE_CANARIES);
      expect(projections.every(({ job }) => !job.response.known)).toBe(true);
    } finally {
      await db().company.updateMany({
        where: { slug: "phase30-empfehlungen-ag" },
        data: { responseTargetDays: 5 },
      });
    }
  });
});

async function seedRecommendationCandidates(client: DatabaseClient) {
  const ownerId = randomUUID();
  const companyId = randomUUID();
  const foreignCompanyId = randomUUID();
  const categoryId = randomUUID();
  const cantonId = randomUUID();
  const cityId = randomUUID();
  const publishedAt = new Date(NOW.getTime() - DAY_MS);
  const validThrough = new Date(NOW.getTime() + 90 * DAY_MS);
  const dueAt = new Date(NOW.getTime() + 29 * DAY_MS);

  await client.user.create({
    data: {
      id: ownerId,
      email: "phase30-recommendations@example.test",
      emailNormalized: "phase30-recommendations@example.test",
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: publishedAt,
    },
  });
  await client.canton.create({
    data: {
      id: cantonId,
      code: "ZH",
      name: "Zürich",
      slug: "phase30-recommendations-zuerich",
      language: "DE",
    },
  });
  await client.city.create({
    data: {
      id: cityId,
      cantonId,
      name: "Zürich",
      slug: "phase30-recommendations-zuerich-city",
    },
  });
  await client.category.create({
    data: {
      id: categoryId,
      name: "Phase 30 Empfehlungen",
      slug: "phase30-empfehlungen",
    },
  });
  await client.company.createMany({
    data: [
      {
        id: companyId,
        name: "Phase 30 Empfehlungen AG",
        slug: "phase30-empfehlungen-ag",
        status: "DRAFT",
        industry: "Technology",
        size: "10-49",
        website: "https://phase30-recommendations.example.test",
        about: "Fiktive Firma für den isolierten Empfehlungslasttest.",
        values: [],
        benefits: [],
        responseTargetDays: 5,
        responseSampleSize: 20,
        responseWithinTargetBps: 8_500,
        dataProvenance: "LIVE",
      },
      {
        id: foreignCompanyId,
        name: "Phase 30 Unverified Canary AG",
        slug: "phase30-unverified-canary-ag",
        status: "DRAFT",
        industry: "Technology",
        size: "10-49",
        website: "https://phase30-unverified.example.test",
        about: "Fiktive, nicht verifizierte Canary-Firma.",
        values: [],
        benefits: [],
        responseTargetDays: 5,
        responseSampleSize: 20,
        responseWithinTargetBps: 8_500,
        dataProvenance: "LIVE",
      },
    ],
  });
  await client.companyMembership.createMany({
    data: [companyId, foreignCompanyId].map((targetCompanyId) => ({
      companyId: targetCompanyId,
      userId: ownerId,
      role: "OWNER" as const,
      status: "ACTIVE" as const,
    })),
  });
  await client.companyLocation.createMany({
    data: [companyId, foreignCompanyId].map((targetCompanyId) => ({
      companyId: targetCompanyId,
      cantonId,
      cityId,
      isPrimary: true,
    })),
  });
  await client.company.updateMany({
    where: { id: { in: [companyId, foreignCompanyId] } },
    data: { status: "ACTIVE" },
  });
  await client.companyVerificationRequest.create({
    data: {
      companyId,
      requestedByUserId: ownerId,
      status: "VERIFIED",
      evidenceMetadata: { source: "phase30-recommendation-query-test" },
      createdAt: publishedAt,
    },
  });

  const candidates = Array.from({ length: TOTAL_CANDIDATES }, (_, index) => {
    const jobId = randomUUID();
    const revisionId = randomUUID();
    return Object.freeze({
      index,
      jobId,
      revisionId,
      companyId: index === TOTAL_CANDIDATES - 1 ? foreignCompanyId : companyId,
      freshnessState:
        index === TOTAL_CANDIDATES - 3
          ? ("STALE" as const)
          : index === TOTAL_CANDIDATES - 2
            ? ("HOLD" as const)
            : ("ACTIVE" as const),
    });
  });

  await client.job.createMany({
    data: candidates.map((candidate) => ({
      id: candidate.jobId,
      companyId: candidate.companyId,
      slug: `phase30-recommendation-${candidate.index + 1}`,
      status: "DRAFT" as const,
      sourceReference: "platform-manual",
      createdByUserId: ownerId,
      dataProvenance: "LIVE" as const,
    })),
  });
  await client.jobRevision.createMany({
    data: candidates.map((candidate) => ({
      id: candidate.revisionId,
      jobId: candidate.jobId,
      revisionNumber: 1,
      title: `Softwareentwicklerin Plattform ${candidate.index + 1}`,
      description:
        "Eine eindeutige, vollständige Stelle für den Phase-30-Empfehlungstest.",
      tasks: ["Plattform entwickeln", `Bereich ${candidate.index + 1}`],
      requirements: ["EFZ oder HF Informatik"],
      applicationProcessSteps: ["Online-Bewerbung"],
      requiredDocumentKinds: ["CV" as const],
      jobType: "PERMANENT" as const,
      remoteType: "HYBRID" as const,
      categoryId,
      cantonId,
      cityId,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE" as const,
      applicationContactKind: "EMAIL" as const,
      applicationContactValue: "jobs@example.test",
      authoredByUserId: ownerId,
      contentChecksum: createHash("sha256")
        .update(`phase30-recommendation-${candidate.index}`)
        .digest("hex"),
      submittedAt: new Date(publishedAt.getTime() - DAY_MS),
      approvedAt: publishedAt,
    })),
  });
  for (const candidate of candidates) {
    await client.job.update({
      where: { id: candidate.jobId },
      data: {
        status: "PUBLISHED",
        currentRevisionId: candidate.revisionId,
        publishedRevisionId: candidate.revisionId,
        publishedAt,
        expiresAt: validThrough,
        publishedCategoryId: categoryId,
        publishedCantonId: cantonId,
        publishedCityId: cityId,
      },
    });
  }
  await client.jobFreshnessProjection.createMany({
    data: candidates.map((candidate) => {
      const candidateDueAt =
        candidate.freshnessState === "ACTIVE"
          ? dueAt
          : new Date(NOW.getTime() - 1);
      return {
        jobId: candidate.jobId,
        policyVersion: "JOB_FRESHNESS_POLICY_V1",
        state: candidate.freshnessState,
        publishedAt,
        lastConfirmedAt: publishedAt,
        dueAt: candidateDueAt,
        reminder7At: new Date(candidateDueAt.getTime() - 7 * DAY_MS),
        reminder24At: new Date(candidateDueAt.getTime() - DAY_MS),
        enforceAt: candidateDueAt,
      };
    }),
  });

  return Object.freeze(
    candidates
      .filter(
        ({ freshnessState, companyId: targetCompanyId }) =>
          freshnessState !== "ACTIVE" || targetCompanyId === foreignCompanyId,
      )
      .map(({ jobId }) => jobId),
  );
}

function percentile95(samples: readonly number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Phase 30 recommendation database unavailable.");
  }
  return database;
}
