import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateClusterLaunch } from "@/lib/admin/cluster-launch";
import {
  projectExpiredClusterLaunches,
  transitionClusterLaunch,
} from "@/lib/admin/content";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  applicationSubmissionPayloadHash,
  buildApplicationConfirmationProjection,
} from "@/lib/applications/integrity";
import {
  isClusterIndexable,
  listIndexableClusterLandings,
  loadPublicClusterLanding,
} from "@/lib/seo/cluster-indexability";
import { buildPublicSitemap } from "@/lib/seo/public-sitemap";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-22T12:00:00.000Z");
const DAY_MS = 86_400_000;
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let adminUserId = "";
let cantonId = "";
let categoryId = "";
let cantonSlug = "";
let categorySlug = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase15_cluster_gate");
  database = createDatabaseClient(migrated.connectionString);
  const foundation = await createIsolatedClusterFoundation(database);
  adminUserId = foundation.adminUserId;
  cantonId = foundation.cantonId;
  categoryId = foundation.categoryId;
  cantonSlug = foundation.cantonSlug;
  categorySlug = foundation.categorySlug;
  await createCompleteLiveCohort(database);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 15 LIVE cluster gate", () => {
  it("proves all six metrics, approvals, current content, revoke and expiry", async () => {
    const client = db();
    const evaluationKey = randomUUID();
    const evaluationInput = { cantonId, categoryId, idempotencyKey: evaluationKey };
    const first = requireSuccess(await evaluateClusterLaunch(evaluationInput, deps(NOW)));
    const replay = requireSuccess(await evaluateClusterLaunch(evaluationInput, deps(NOW)));
    expect(first.value.id).toBe(replay.value.id);
    expect(first.replay).not.toBe(true);
    expect(replay.replay).toBe(true);
    expect(first.value).toMatchObject({
      status: "READY",
      liveJobCount: 50,
      activeEmployerCount: 15,
      activeCandidateCount: 200,
      medianApplicationsTimes2: 6,
      responseRateBasisPoints: 7_000,
      contentCoverageBasisPoints: 10_000,
    });
    expect(first.value.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);

    const assessmentId = first.value.id;
    requireSuccess(await transitionClusterLaunch({
      assessmentId,
      action: "PRODUCT_APPROVE",
      reasonCode: "PRODUCT_EVIDENCE_APPROVED",
      idempotencyKey: randomUUID(),
    }, deps(new Date(NOW.getTime() + 1))));
    expect(await isClusterIndexable(cantonId, categoryId, NOW, client)).toBe(false);
    await expectPairAbsentFromClusterSitemap(client, NOW);

    requireSuccess(await transitionClusterLaunch({
      assessmentId,
      action: "OPS_APPROVE",
      reasonCode: "OPS_EVIDENCE_APPROVED",
      idempotencyKey: randomUUID(),
    }, deps(new Date(NOW.getTime() + 2))));
    requireSuccess(await transitionClusterLaunch({
      assessmentId,
      action: "ACTIVATE",
      reasonCode: "DUAL_APPROVAL_COMPLETE",
      idempotencyKey: randomUUID(),
    }, deps(new Date(NOW.getTime() + 3))));

    const activeNow = new Date(NOW.getTime() + 10);
    expect(await isClusterIndexable(cantonId, categoryId, activeNow, client)).toBe(false);
    await expectPairAbsentFromClusterSitemap(client, activeNow);
    await createPublishedClusterContent(client, pairPath(), "pair");
    expect(await isClusterIndexable(cantonId, categoryId, activeNow, client)).toBe(true);

    const cantonBeforeContent = await loadPublicClusterLanding(
      { kind: "canton", cantonSlug },
      { now: activeNow, database: client },
    );
    expect(cantonBeforeContent?.indexable).toBe(false);
    await createPublishedClusterContent(client, `/jobs/kanton/${cantonSlug}`, "canton");
    await createPublishedClusterContent(client, `/jobs/kategorie/${categorySlug}`, "category");
    await createPublishedGuideContent(client);
    const [pair, pairById, canton, category, sitemapClusters] = await Promise.all([
      loadPublicClusterLanding(
        { kind: "pair", cantonSlug, categorySlug },
        { now: activeNow, database: client },
      ),
      loadPublicClusterLanding(
        { kind: "pair", cantonSlug: cantonId, categorySlug: categoryId },
        { now: activeNow, database: client },
      ),
      loadPublicClusterLanding(
        { kind: "canton", cantonSlug },
        { now: activeNow, database: client },
      ),
      loadPublicClusterLanding(
        { kind: "category", categorySlug },
        { now: activeNow, database: client },
      ),
      listIndexableClusterLandings(activeNow, client),
    ]);
    expect(pair).toMatchObject({ indexable: true, canonicalPath: pairPath() });
    expect(pair?.aggregateFacts).toMatchObject({
      kind: "pair",
      eligibleJobCount: 50,
      activeEmployerCount: 15,
      activeCandidateCount: 200,
      responseRateBasisPoints: 7_000,
    });
    expect(pairById).toMatchObject({ indexable: true, canonicalPath: pairPath() });
    expect(canton).toMatchObject({ indexable: true, passingChildCount: 1 });
    expect(category).toMatchObject({ indexable: true, passingChildCount: 1 });
    expect(sitemapClusters.map(({ path }) => path)).toEqual(expect.arrayContaining([
      pairPath(),
      `/jobs/kanton/${cantonSlug}`,
      `/jobs/kategorie/${categorySlug}`,
    ]));
    const publicSitemapPaths = (await buildPublicSitemap({
      origin: "https://swisstalenthub.example",
      now: activeNow,
      database: client,
    })).map(({ url }) => new URL(url).pathname);
    expect(publicSitemapPaths).toEqual(expect.arrayContaining([
      "/jobs/phase-15-engineering-zuerich-jobs-stellen-0",
      "/companies/phase-15-engineering-0-ag",
      "/guide/phase-15-bewerbungsratgeber",
      pairPath(),
      `/jobs/kanton/${cantonSlug}`,
      `/jobs/kategorie/${categorySlug}`,
    ]));
    expect(
      publicSitemapPaths.some((path) =>
        /^\/(?:admin|employer|candidate|api)(?:\/|$)/u.test(path)
      ),
    ).toBe(false);

    await client.category.update({
      where: { id: categoryId },
      data: { isActive: false },
    });
    expect(await loadPublicClusterLanding(
      { kind: "pair", cantonSlug, categorySlug },
      { now: activeNow, database: client },
    )).toBeNull();
    await expectPairAbsentFromClusterSitemap(client, activeNow);
    await expect(loadPublicClusterLanding(
      { kind: "canton", cantonSlug },
      { now: activeNow, database: client },
    )).resolves.toMatchObject({ indexable: false, passingChildCount: 0 });
    await client.category.update({
      where: { id: categoryId },
      data: { isActive: true },
    });
    expect(await isClusterIndexable(cantonId, categoryId, activeNow, client)).toBe(true);

    requireSuccess(await transitionClusterLaunch({
      assessmentId,
      action: "REVOKE",
      reasonCode: "CLUSTER_REVIEW_REQUIRED",
      idempotencyKey: randomUUID(),
    }, deps(new Date(NOW.getTime() + 4))));
    expect(await isClusterIndexable(cantonId, categoryId, activeNow, client)).toBe(false);
    await expectPairAbsentFromClusterSitemap(client, activeNow);

    const reevaluatedAt = new Date(NOW.getTime() + 60 * 60 * 1_000);
    const second = requireSuccess(await evaluateClusterLaunch(
      { cantonId, categoryId, idempotencyKey: randomUUID() },
      deps(reevaluatedAt),
    ));
    expect(second.value.status).toBe("READY");
    requireSuccess(await transitionClusterLaunch({
      assessmentId: second.value.id,
      action: "PRODUCT_APPROVE",
      reasonCode: "PRODUCT_EVIDENCE_APPROVED",
      idempotencyKey: randomUUID(),
    }, deps(new Date(reevaluatedAt.getTime() + 1))));
    requireSuccess(await transitionClusterLaunch({
      assessmentId: second.value.id,
      action: "OPS_APPROVE",
      reasonCode: "OPS_EVIDENCE_APPROVED",
      idempotencyKey: randomUUID(),
    }, deps(new Date(reevaluatedAt.getTime() + 2))));
    requireSuccess(await transitionClusterLaunch({
      assessmentId: second.value.id,
      action: "ACTIVATE",
      reasonCode: "DUAL_APPROVAL_COMPLETE",
      idempotencyKey: randomUUID(),
    }, deps(new Date(reevaluatedAt.getTime() + 3))));
    await expect(client.clusterLaunchAssessment.update({
      where: { id: assessmentId },
      data: { status: "ACTIVATED" },
    })).rejects.toThrow();
    const persisted = await client.clusterLaunchAssessment.findUniqueOrThrow({
      where: { id: second.value.id },
      select: { validUntil: true },
    });
    expect(await isClusterIndexable(
      cantonId,
      categoryId,
      persisted.validUntil,
      client,
    )).toBe(false);
    await expectPairAbsentFromClusterSitemap(client, persisted.validUntil);
    const projected = requireSuccess(await projectExpiredClusterLaunches(
      { idempotencyKey: randomUUID() },
      deps(persisted.validUntil),
    ));
    expect(projected.value.projectedCount).toBe(1);
    await expect(client.clusterLaunchAssessment.findUniqueOrThrow({
      where: { id: second.value.id },
      select: { status: true },
    })).resolves.toEqual({ status: "EXPIRED" });
  }, 180_000);

  it("keeps evaluated evidence immutable at the database boundary", async () => {
    const assessment = await db().clusterLaunchAssessment.findFirstOrThrow({
      where: { dataProvenance: "LIVE", policyVersion: "CLUSTER_LAUNCH_POLICY_V1" },
      orderBy: { evaluatedAt: "asc" },
      select: { id: true },
    });
    await expect(db().clusterLaunchAssessment.update({
      where: { id: assessment.id },
      data: { liveJobCount: 999 },
    })).rejects.toThrow("Cluster launch evidence is immutable");
  });

  it("fails closed at the database boundary for thin READY or DEMO activation", async () => {
    const client = db();
    const base = {
      cantonId,
      categoryId,
      policyVersion: "CLUSTER_LAUNCH_POLICY_V1",
      evidenceWindowStart: new Date(NOW.getTime() - 30 * DAY_MS),
      evidenceWindowEnd: NOW,
      activeCandidateCount: 200,
      activeEmployerCount: 15,
      responseRateBasisPoints: 7_000,
      contentCoverageBasisPoints: 8_000,
      medianApplicationsTimes2: 6,
      evidenceHash: "a".repeat(64),
      validUntil: new Date(NOW.getTime() + 7 * DAY_MS),
      createdAt: NOW,
    } as const;
    const thresholdMinusOne = [
      { liveJobCount: 49 },
      { activeEmployerCount: 14 },
      { activeCandidateCount: 199 },
      { medianApplicationsTimes2: 5 },
      { responseRateBasisPoints: 6_999 },
      { contentCoverageBasisPoints: 7_999 },
    ] as const;
    for (const [index, override] of thresholdMinusOne.entries()) {
      const thin = await client.clusterLaunchAssessment.create({ data: {
        ...base,
        ...override,
        id: randomUUID(),
        evaluatedAt: new Date(
          NOW.getTime() + (2 + index) * 60 * 60 * 1_000,
        ),
        liveJobCount: "liveJobCount" in override ? override.liveJobCount : 50,
        dataProvenance: "LIVE",
        status: "DRAFT",
      } });
      await expect(client.clusterLaunchAssessment.update({
        where: { id: thin.id },
        data: { status: "READY" },
      })).rejects.toThrow();
    }

    const demo = await client.clusterLaunchAssessment.create({ data: {
      ...base,
      id: randomUUID(),
      evaluatedAt: new Date(NOW.getTime() + 9 * 60 * 60 * 1_000),
      liveJobCount: 50,
      dataProvenance: "DEMO",
      status: "DRAFT",
    } });
    await expect(client.clusterLaunchAssessment.update({
      where: { id: demo.id },
      data: { status: "ACTIVATED" },
    })).rejects.toThrow();
  });
});

async function createIsolatedClusterFoundation(client: DatabaseClient) {
  const adminUserIdValue = randomUUID();
  const cantonIdValue = randomUUID();
  const cityId = randomUUID();
  const categoryIdValue = randomUUID();
  await client.user.create({ data: {
    id: adminUserIdValue,
    email: "phase15-admin@example.test",
    emailNormalized: "phase15-admin@example.test",
    role: "ADMIN",
    status: "ACTIVE",
    dataProvenance: "TEST",
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  } });
  await client.canton.create({ data: {
    id: cantonIdValue,
    code: "ZH",
    name: "Zürich",
    slug: "zuerich",
    language: "DE",
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
  } });
  await client.city.create({ data: {
    id: cityId,
    cantonId: cantonIdValue,
    name: "Zürich",
    slug: "zuerich",
    latitude: 47.3769,
    longitude: 8.5417,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  } });
  await client.category.create({ data: {
    id: categoryIdValue,
    name: "Engineering/Technik",
    slug: "engineering-technik",
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  } });
  await client.skill.create({ data: {
    id: randomUUID(),
    name: "System Engineering",
    slug: "system-engineering",
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
  } });
  return Object.freeze({
    adminUserId: adminUserIdValue,
    cantonId: cantonIdValue,
    cantonSlug: "zuerich",
    categoryId: categoryIdValue,
    categorySlug: "engineering-technik",
  });
}

async function createCompleteLiveCohort(client: DatabaseClient) {
  const [city, skill] = await Promise.all([
    client.city.findFirstOrThrow({
      where: { cantonId, isActive: true },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
    client.skill.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ]);
  const employerUserIds = Array.from({ length: 15 }, () => randomUUID());
  const companyIds = Array.from({ length: 15 }, () => randomUUID());
  await client.user.createMany({ data: employerUserIds.map((id, index) => ({
    id,
    email: `phase15-employer-${index}@example.test`,
    emailNormalized: `phase15-employer-${index}@example.test`,
    role: "EMPLOYER" as const,
    status: "ACTIVE" as const,
    dataProvenance: "LIVE" as const,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.company.createMany({ data: companyIds.map((id, index) => ({
    id,
    name: `Phase 15 Engineering ${index} AG`,
    slug: `phase-15-engineering-${index}-ag`,
    industry: "Engineering",
    size: "15-49",
    website: `https://phase15-${index}.example.test`,
    about: "Fiktives LIVE-Unternehmen für den isolierten Phase-15-Liquiditätstest.",
    values: [],
    benefits: [],
    status: "DRAFT" as const,
    dataProvenance: "LIVE" as const,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.companyLocation.createMany({ data: companyIds.map((companyIdValue) => ({
    id: randomUUID(),
    companyId: companyIdValue,
    cantonId,
    cityId: city.id,
    address: "Teststrasse 15",
    postalCode: "8000",
    isPrimary: true,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.company.updateMany({
    where: { id: { in: companyIds } },
    data: { status: "ACTIVE" },
  });
  await client.companyVerificationRequest.createMany({ data: companyIds.map((companyIdValue, index) => ({
    id: randomUUID(),
    companyId: companyIdValue,
    requestedByUserId: employerUserIds[index]!,
    status: "VERIFIED" as const,
    evidenceMetadata: { source: "phase15-isolated-live-cohort" },
    createdAt: new Date(NOW.getTime() - 100 * DAY_MS),
    updatedAt: new Date(NOW.getTime() - 100 * DAY_MS),
  })) });

  const jobIds = Array.from({ length: 50 }, () => randomUUID());
  const revisionIds = Array.from({ length: 50 }, () => randomUUID());
  const validThrough = new Date(NOW.getTime() + 30 * DAY_MS);
  await client.job.createMany({ data: jobIds.map((id, index) => ({
    id,
    companyId: companyIds[index % companyIds.length]!,
    slug: `phase-15-engineering-zuerich-jobs-stellen-${index}`,
    status: "DRAFT" as const,
    sourceReference: `phase15:cluster:${index}`,
    dataProvenance: "LIVE" as const,
    createdByUserId: employerUserIds[index % employerUserIds.length]!,
    createdAt: new Date(NOW.getTime() - 40 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.jobRevision.createMany({ data: revisionIds.map((id, index) => ({
    id,
    jobId: jobIds[index]!,
    revisionNumber: 1,
    title: `Engineering Technik Jobs Stellen Zürich ZH ${index}`,
    description: "Engineering Technik Jobs und Stellen in Zürich ZH mit geprüfter öffentlicher Beschreibung.",
    tasks: ["Engineering Technik Jobs in Zürich verantworten"],
    requirements: ["Erfahrung für Stellen im Kanton ZH"],
    niceToHave: [],
    offer: "Faire Engineering Stelle und transparenter Job in Zürich.",
    applicationProcessSteps: ["Bewerbung", "Gespräch"],
    requiredDocumentKinds: ["NONE"],
    jobType: "PERMANENT" as const,
    remoteType: "HYBRID" as const,
    categoryId,
    cantonId,
    cityId: city.id,
    locationLabel: "Zürich",
    workloadMin: 80,
    workloadMax: 100,
    salaryPeriod: "YEARLY" as const,
    salaryMin: 100_000 + index,
    salaryMax: 120_000 + index,
    startByArrangement: true,
    validThrough,
    responseTargetDays: 5,
    applicationEffort: "SIMPLE" as const,
    applicationContactKind: "EMAIL" as const,
    applicationContactValue: `jobs-${index}@example.test`,
    authoredByUserId: employerUserIds[index % employerUserIds.length]!,
    contentChecksum: hash(`phase15-revision-${index}`),
    submittedAt: new Date(NOW.getTime() - 35 * DAY_MS),
    approvedAt: new Date(NOW.getTime() - 34 * DAY_MS),
    createdAt: new Date(NOW.getTime() - 40 * DAY_MS),
    updatedAt: NOW,
  })) });
  for (let index = 0; index < jobIds.length; index += 1) {
    await client.job.update({
      where: { id: jobIds[index]! },
      data: {
        status: "PUBLISHED",
        currentRevisionId: revisionIds[index]!,
        publishedRevisionId: revisionIds[index]!,
        publishedAt: new Date(NOW.getTime() - 30 * DAY_MS),
        expiresAt: validThrough,
        publishedCategoryId: categoryId,
        publishedCantonId: cantonId,
        publishedCityId: city.id,
        publishedSalaryPeriod: "YEARLY",
        publishedSalaryMin: 100_000 + index,
        publishedSalaryMax: 120_000 + index,
      },
    });
  }

  const candidateUserIds = Array.from({ length: 200 }, () => randomUUID());
  const candidateProfileIds = Array.from({ length: 200 }, () => randomUUID());
  const preferenceIds = Array.from({ length: 200 }, () => randomUUID());
  await client.user.createMany({ data: candidateUserIds.map((id, index) => ({
    id,
    email: `phase15-candidate-${index}@example.test`,
    emailNormalized: `phase15-candidate-${index}@example.test`,
    role: "CANDIDATE" as const,
    status: "ACTIVE" as const,
    dataProvenance: "LIVE" as const,
    createdAt: new Date(NOW.getTime() - 120 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.candidateProfile.createMany({ data: candidateProfileIds.map((id, index) => ({
    id,
    userId: candidateUserIds[index]!,
    cantonId,
    firstName: "Phase",
    lastName: `Candidate ${index}`,
    onboardingStatus: "DRAFT" as const,
    createdAt: new Date(NOW.getTime() - 100 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.candidatePreference.createMany({ data: preferenceIds.map((id, index) => ({
    id,
    candidateProfileId: candidateProfileIds[index]!,
    desiredTitles: ["Engineering Technik"],
    desiredJobTypes: ["PERMANENT"],
    workloadMin: 80,
    workloadMax: 100,
    remotePreference: "HYBRID" as const,
    createdAt: new Date(NOW.getTime() - 100 * DAY_MS),
    updatedAt: NOW,
  })) });
  await client.candidatePreferenceCategory.createMany({ data: preferenceIds.map((candidatePreferenceId) => ({
    candidatePreferenceId,
    categoryId,
  })) });
  await client.candidateSkill.createMany({ data: candidateProfileIds.map((candidateProfileId) => ({
    id: randomUUID(),
    candidateProfileId,
    skillId: skill.id,
    level: 3,
    years: 3,
  })) });
  await client.candidateLanguage.createMany({ data: candidateProfileIds.map((candidateProfileId) => ({
    id: randomUUID(),
    candidateProfileId,
    code: "de",
    level: "B2" as const,
  })) });
  await client.candidateProfile.updateMany({
    where: { id: { in: candidateProfileIds } },
    data: { onboardingStatus: "COMPLETE" },
  });
  await client.savedJob.createMany({ data: candidateProfileIds.map((candidateProfileId, index) => ({
    id: randomUUID(),
    candidateProfileId,
    jobId: jobIds[index % jobIds.length]!,
    createdAt: new Date(NOW.getTime() - 20 * DAY_MS),
  })) });

  const submittedAt = new Date(NOW.getTime() - 10 * DAY_MS);
  const applications = jobIds.flatMap((jobId, jobIndex) =>
    Array.from({ length: 3 }, (_, applicationIndex) => {
      const candidateIndex = (jobIndex * 3 + applicationIndex) % candidateProfileIds.length;
      return {
        id: randomUUID(),
        jobId,
        revisionId: revisionIds[jobIndex]!,
        candidateProfileId: candidateProfileIds[candidateIndex]!,
        candidateUserId: candidateUserIds[candidateIndex]!,
        employerUserId: employerUserIds[jobIndex % employerUserIds.length]!,
        candidateIndex,
        companyIndex: jobIndex % companyIds.length,
        jobIndex,
        sequence: jobIndex * 3 + applicationIndex,
      };
    })
  );
  await client.application.createMany({ data: applications.map((application) => ({
    id: application.id,
    jobId: application.jobId,
    submittedJobRevisionId: application.revisionId,
    candidateProfileId: application.candidateProfileId,
    idempotencyKey: `phase15-${application.id}`,
    submissionPayloadHash: applicationSubmissionPayloadHash({
      confirmationSnapshotHash: confirmationProjection(application).confirmationSnapshotHash,
      coverLetter: null,
      selectedDocumentIds: [],
    }),
    status: "SUBMITTED" as const,
    submittedAt,
    updatedAt: submittedAt,
  })) });
  await client.applicationSubmissionSnapshot.createMany({ data: applications.map((application) => ({
    id: randomUUID(),
    applicationId: application.id,
    jobRevisionId: application.revisionId,
    candidateFirstName: confirmationProjection(application).candidate.firstName,
    candidateLastName: confirmationProjection(application).candidate.lastName,
    candidateEmail: confirmationProjection(application).candidate.email,
    recipientCompanyName: confirmationProjection(application).recipient.companyName,
    applicationContactKind: confirmationProjection(application).recipient.contactKind,
    applicationContactValue: confirmationProjection(application).recipient.contactValue,
    responseTargetDays: confirmationProjection(application).job.responseTargetDays,
    applicationEffort: confirmationProjection(application).job.applicationEffort,
    requiredDocumentKinds: [...confirmationProjection(application).job.requiredDocumentKinds],
    confirmationNoticeVersion: confirmationProjection(application).confirmationVersion,
    confirmationNoticeHash: confirmationProjection(application).confirmationNoticeHash,
    confirmationSnapshotHash: confirmationProjection(application).confirmationSnapshotHash,
    submittedAt,
  })) });
  await client.applicationEvent.createMany({ data: applications.map((application) => ({
    id: randomUUID(),
    applicationId: application.id,
    actorUserId: application.employerUserId,
    kind: "MESSAGE_SENT" as const,
    idempotencyKey: `phase15-response-${application.id}`,
    correlationId: `phase15-response-${application.sequence}`,
    // The workflow event alone is deliberately not accepted as launch evidence.
    // Only the canonical analytics projection below defines first response.
    createdAt: new Date(submittedAt.getTime() + 2 * DAY_MS),
  })) });
  await client.analyticsEvent.createMany({ data: applications.map((application) => ({
    id: randomUUID(),
    producer: "employer-application",
    dedupeKey: `EMPLOYER_RESPONSE:${application.id}`,
    kind: "EMPLOYER_RESPONSE_RECORDED" as const,
    schemaVersion: "1",
    purpose: "ESSENTIAL_OPERATIONAL" as const,
    occurredAt: new Date(
      submittedAt.getTime() + (application.sequence < 105 ? 2 : 7) * DAY_MS,
    ),
    receivedAt: new Date(
      submittedAt.getTime() + (application.sequence < 105 ? 2 : 7) * DAY_MS,
    ),
    companyId: companyIds[application.companyIndex]!,
    jobId: application.jobId,
    actorProvenanceSnapshot: "LIVE" as const,
    companyProvenanceSnapshot: "LIVE" as const,
    jobProvenanceSnapshot: "LIVE" as const,
    properties: {},
    retainUntil: new Date(NOW.getTime() + 400 * DAY_MS),
  })) });

  function confirmationProjection(application: (typeof applications)[number]) {
    return buildApplicationConfirmationProjection({
      candidate: {
        firstName: "Phase",
        lastName: `Candidate ${application.candidateIndex}`,
        email: `phase15-candidate-${application.candidateIndex}@example.test`,
      },
      recipient: {
        companyName: `Phase 15 Engineering ${application.companyIndex} AG`,
        contactKind: "EMAIL",
        contactValue: `jobs-${application.jobIndex}@example.test`,
      },
      job: {
        revisionId: application.revisionId,
        slug: `phase-15-engineering-zuerich-jobs-stellen-${application.jobIndex}`,
        title: `Engineering Technik Jobs Stellen Zürich ZH ${application.jobIndex}`,
        responseTargetDays: 5,
        applicationEffort: "SIMPLE",
        requiredDocumentKinds: ["NONE"],
      },
    });
  }
}

async function createPublishedClusterContent(
  client: DatabaseClient,
  canonicalPath: string,
  suffix: string,
) {
  const pageId = randomUUID();
  const revisionId = randomUUID();
  const body = Array.from({ length: 14 }, (_, index) =>
    `Abschnitt ${index + 1} erklärt den Schweizer Arbeitsmarkt, transparente Bewerbungswege, regionale Besonderheiten und konkrete Orientierung für eine fundierte Stellensuche.`
  ).join("\n\n");
  await client.contentPage.create({ data: {
    id: pageId,
    slug: `phase15-cluster-${suffix}-${randomUUID().slice(0, 8)}`,
    locale: "de-CH",
    type: "CLUSTER",
    canonicalPath,
    dataProvenance: "LIVE",
    createdAt: new Date(NOW.getTime() - DAY_MS),
    updatedAt: NOW,
  } });
  await client.contentRevision.create({ data: {
    id: revisionId,
    contentPageId: pageId,
    revisionNumber: 1,
    status: "PUBLISHED",
    title: `Geprüfte Cluster-Orientierung ${suffix}`,
    excerpt: "Substantielle, redaktionell geprüfte Orientierung für diesen Schweizer Stellenmarkt.",
    body,
    authoredByUserId: adminUserId,
    contentHash: hash(`${canonicalPath}:${body}`),
    reviewedAt: new Date(NOW.getTime() - 3_600_000),
    publishedAt: new Date(NOW.getTime() - 1_800_000),
    createdAt: new Date(NOW.getTime() - DAY_MS),
  } });
  await client.contentPage.update({
    where: { id: pageId },
    data: { currentPublishedRevisionId: revisionId, updatedAt: NOW },
  });
}

async function createPublishedGuideContent(client: DatabaseClient) {
  const pageId = randomUUID();
  const revisionId = randomUUID();
  const slug = "phase-15-bewerbungsratgeber";
  const body = "Dieser redaktionell geprüfte Ratgeber erklärt sichere Bewerbungen, transparente Stellenvergleiche und faire Auswahlprozesse in der Schweiz.";
  await client.contentPage.create({ data: {
    id: pageId,
    slug,
    locale: "de-CH",
    type: "GUIDE",
    canonicalPath: `/guide/${slug}`,
    dataProvenance: "LIVE",
    createdAt: new Date(NOW.getTime() - DAY_MS),
    updatedAt: NOW,
  } });
  await client.contentRevision.create({ data: {
    id: revisionId,
    contentPageId: pageId,
    revisionNumber: 1,
    status: "PUBLISHED",
    title: "Geprüfter Bewerbungsratgeber",
    excerpt: "Sichere Orientierung für Bewerbungen in der Schweiz.",
    body,
    authoredByUserId: adminUserId,
    contentHash: hash(`${slug}:${body}`),
    reviewedAt: new Date(NOW.getTime() - 3_600_000),
    publishedAt: new Date(NOW.getTime() - 1_800_000),
    createdAt: new Date(NOW.getTime() - DAY_MS),
  } });
  await client.contentPage.update({
    where: { id: pageId },
    data: { currentPublishedRevisionId: revisionId, updatedAt: NOW },
  });
}

function deps(now: Date) {
  return Object.freeze({
    actor: {
      userId: adminUserId,
      email: "admin@demo.ch",
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
    },
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

function db(): DatabaseClient {
  if (database === undefined) throw new Error("Phase 15 cluster database unavailable.");
  return database;
}

function pairPath() {
  return `/jobs/kanton/${cantonSlug}/kategorie/${categorySlug}`;
}

async function expectPairAbsentFromClusterSitemap(
  client: DatabaseClient,
  now: Date,
) {
  const paths = (await listIndexableClusterLandings(now, client)).map(
    ({ path }) => path,
  );
  expect(paths).not.toContain(pairPath());
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireSuccess<T>(result: Readonly<{ ok: boolean; value?: T; code?: string }>) {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected success, received ${result.code ?? "unknown"}.`);
  }
  return result as Readonly<{ ok: true; value: T; replay?: boolean }>;
}
