import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const billing = vi.hoisted(() => ({
  getPrismaEffectiveEntitlements: vi.fn(),
}));

vi.mock("@/lib/billing/prisma-publish-quota", () => ({
  getPrismaEffectiveEntitlements: billing.getPrismaEffectiveEntitlements,
}));

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { getEmployerAnalyticsData, type EmployerAnalyticsAccess } from "@/lib/employer/analytics";
import { getEmployerDashboardData, type EmployerDashboardAccess } from "@/lib/employer/dashboard";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const DAY = 86_400_000;
const NOW = new Date("2026-07-21T12:00:00.000Z");
const id = (sequence: number) => `b2000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
const IDS = {
  recruiter: id(1),
  primaryOwner: id(2),
  foreignOwner: id(3),
  company: id(4),
  foreignCompany: id(5),
  recruiterMembership: id(6),
  primaryOwnerMembership: id(7),
  foreignOwnerMembership: id(8),
  category: id(9),
  canton: id(10),
  city: id(11),
  assignedJob: id(20),
  assignedRevision: id(21),
  unassignedJob: id(22),
  unassignedRevision: id(23),
  expiredJob: id(24),
  expiredRevision: id(25),
  foreignJob: id(26),
  foreignRevision: id(27),
};
const ACCESS = {
  companyId: IDS.company,
  membershipId: IDS.recruiterMembership,
  membershipRole: "RECRUITER",
  userId: IDS.recruiter,
} as const satisfies EmployerDashboardAccess & EmployerAnalyticsAccess;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase10_dashboard_analytics_scope");
  database = createDatabaseClient(migrated.connectionString);
  await seed(getDatabase());
});

beforeEach(() => {
  billing.getPrismaEffectiveEntitlements.mockReset();
  billing.getPrismaEffectiveEntitlements.mockImplementation(async (companyId: string, at: Date) => effectiveEntitlements(companyId, at));
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 10 dashboard and analytics PostgreSQL actor scope", () => {
  it("shows a Recruiter only active-assignment data and excludes unassigned, expired and foreign jobs", async () => {
    const [dashboard, analytics] = await Promise.all([
      getEmployerDashboardData(ACCESS, getDatabase(), NOW),
      getEmployerAnalyticsData(ACCESS, getDatabase(), NOW),
    ]);
    if (dashboard === null || analytics === null) throw new Error("Expected an authorized Recruiter projection.");

    expect(dashboard.companyName).toBe("Scoped Metrics AG");
    expect(dashboard.lowScoreJobs).toEqual([{ id: IDS.assignedJob, title: "Assigned Job", points: 40, maxPoints: 100 }]);
    expect(dashboard.diagnosticJobs).toEqual([{ id: IDS.assignedJob, title: "Assigned Job", views: 30, applications: 0 }]);

    expect(analytics.metrics.allowed).toBe(true);
    if (!analytics.metrics.allowed || analytics.metrics.totals.status !== "VALUE") throw new Error("Expected publishable scoped metrics.");
    expect(analytics.metrics.totals.detailViews).toBe(20);
    expect(analytics.scoreSuggestions).toEqual([{ jobId: IDS.assignedJob, title: "Assigned Job", score: 40, max: 100 }]);
    expect(analytics.diagnosticJobs).toEqual([{ jobId: IDS.assignedJob, title: "Assigned Job", views: 20, applications: 0 }]);
    expect(analytics.salaryFunnelEvidence).toMatchObject({ status: "INSUFFICIENT", transparentJobs: 1, opaqueJobs: 0 });
  });

  it("returns null before entitlement or resource reads once the selected membership is inactive", async () => {
    await getDatabase().companyMembership.update({
      where: { id: IDS.recruiterMembership },
      data: { status: "REMOVED", removedAt: NOW },
    });
    billing.getPrismaEffectiveEntitlements.mockClear();

    await expect(getEmployerDashboardData(ACCESS, getDatabase(), NOW)).resolves.toBeNull();
    await expect(getEmployerAnalyticsData(ACCESS, getDatabase(), NOW)).resolves.toBeNull();
    expect(billing.getPrismaEffectiveEntitlements).not.toHaveBeenCalled();
  });
});

async function seed(client: DatabaseClient) {
  await client.user.createMany({ data: [
    { id: IDS.recruiter, email: "scope-recruiter@example.ch", emailNormalized: "scope-recruiter@example.ch", role: "RECRUITER" },
    { id: IDS.primaryOwner, email: "scope-owner@example.ch", emailNormalized: "scope-owner@example.ch", role: "EMPLOYER" },
    { id: IDS.foreignOwner, email: "foreign-owner@example.ch", emailNormalized: "foreign-owner@example.ch", role: "EMPLOYER" },
  ] });
  await client.category.create({ data: { id: IDS.category, name: "Scope Engineering", slug: "scope-engineering" } });
  await client.canton.create({ data: { id: IDS.canton, code: "ZH", name: "Zürich", slug: "scope-zuerich", language: "DE" } });
  await client.city.create({ data: { id: IDS.city, cantonId: IDS.canton, name: "Zürich", slug: "scope-zuerich" } });
  await client.company.createMany({ data: [
    completeCompany(IDS.company, "Scoped Metrics AG", "scoped-metrics", "https://scoped.example.test"),
    completeCompany(IDS.foreignCompany, "Foreign Metrics AG", "foreign-metrics", "https://foreign.example.test"),
  ] });
  await client.companyLocation.createMany({ data: [
    { companyId: IDS.company, cantonId: IDS.canton, cityId: IDS.city, isPrimary: true },
    { companyId: IDS.foreignCompany, cantonId: IDS.canton, cityId: IDS.city, isPrimary: true },
  ] });
  await client.companyMembership.createMany({ data: [
    { id: IDS.primaryOwnerMembership, companyId: IDS.company, userId: IDS.primaryOwner, role: "OWNER", status: "ACTIVE" },
    { id: IDS.recruiterMembership, companyId: IDS.company, userId: IDS.recruiter, role: "RECRUITER", status: "ACTIVE" },
    { id: IDS.foreignOwnerMembership, companyId: IDS.foreignCompany, userId: IDS.foreignOwner, role: "OWNER", status: "ACTIVE" },
  ] });
  await client.company.updateMany({ where: { id: { in: [IDS.company, IDS.foreignCompany] } }, data: { status: "ACTIVE" } });

  const jobs = [
    { jobId: IDS.assignedJob, revisionId: IDS.assignedRevision, companyId: IDS.company, creatorId: IDS.recruiter, title: "Assigned Job", points: 40, salary: true },
    { jobId: IDS.unassignedJob, revisionId: IDS.unassignedRevision, companyId: IDS.company, creatorId: IDS.primaryOwner, title: "Unassigned Job", points: 30, salary: false },
    { jobId: IDS.expiredJob, revisionId: IDS.expiredRevision, companyId: IDS.company, creatorId: IDS.primaryOwner, title: "Expired Assignment Job", points: 20, salary: false },
    { jobId: IDS.foreignJob, revisionId: IDS.foreignRevision, companyId: IDS.foreignCompany, creatorId: IDS.foreignOwner, title: "Foreign Job", points: 10, salary: false },
  ] as const;
  for (const [index, fixture] of jobs.entries()) {
    await client.job.create({
      data: { id: fixture.jobId, companyId: fixture.companyId, slug: `scope-job-${index}`, status: "DRAFT", origin: "MANUAL", sourceReference: `scope:${index}`, createdByUserId: fixture.creatorId },
    });
    await client.jobRevision.create({ data: revision(fixture, index) });
    await client.job.update({ where: { id: fixture.jobId }, data: { currentRevisionId: fixture.revisionId } });
    await client.jobScoreSnapshot.create({
      data: {
        id: id(30 + index),
        jobRevisionId: fixture.revisionId,
        scoreVersion: "fair-job-v2",
        scorePoints: fixture.points,
        maxPoints: 100,
        inputSnapshot: {},
        evidence: {},
        factorBreakdown: {},
        evidenceHash: String(index + 1).repeat(64),
        calculatedAt: new Date(NOW.getTime() - DAY),
      },
    });
    await client.jobViewAggregate.create({
      data: {
        id: id(50 + index),
        jobId: fixture.jobId,
        windowStart: new Date(NOW.getTime() - 6 * DAY),
        windowEnd: NOW,
        viewCount: 30 + index,
        threshold: 20,
        definitionVersion: "scope-v1",
        refreshedAt: NOW,
      },
    });
  }
  await client.jobAssignment.createMany({ data: [
    {
      id: id(40), membershipId: IDS.recruiterMembership, companyId: IDS.company, jobId: IDS.assignedJob, userId: IDS.recruiter,
      role: "EDITOR", status: "ACTIVE", assignedByUserId: IDS.primaryOwner, validFrom: new Date(NOW.getTime() - 2 * DAY),
    },
    {
      id: id(41), membershipId: IDS.recruiterMembership, companyId: IDS.company, jobId: IDS.expiredJob, userId: IDS.recruiter,
      role: "EDITOR", status: "ACTIVE", assignedByUserId: IDS.primaryOwner, validFrom: new Date(NOW.getTime() - 2 * DAY), expiresAt: NOW,
    },
  ] });

  const eventRows = jobs.flatMap((fixture, jobIndex) => Array.from({ length: 20 + jobIndex * 5 }, (_, eventIndex) => ({
    id: id(100 + jobIndex * 100 + eventIndex),
    producer: "scope-test",
    dedupeKey: `scope:${jobIndex}:${eventIndex}`,
    kind: "JOB_DETAIL_VIEWED" as const,
    schemaVersion: "v1",
    purpose: "PRODUCT_ANALYTICS" as const,
    occurredAt: new Date(NOW.getTime() - DAY),
    pseudonymousActorId: `scope-subject-${jobIndex}-${eventIndex}`,
    companyId: fixture.companyId,
    jobId: fixture.jobId,
    actorProvenanceSnapshot: "LIVE" as const,
    companyProvenanceSnapshot: "LIVE" as const,
    jobProvenanceSnapshot: "LIVE" as const,
    properties: {},
    retainUntil: new Date(NOW.getTime() + 365 * DAY),
  })));
  await client.analyticsEvent.createMany({ data: eventRows });
}

function completeCompany(idValue: string, name: string, slug: string, website: string) {
  return { id: idValue, name, slug, industry: "Technology", size: "10-49", website, about: "A complete company for isolated dashboard and analytics scope tests.", status: "DRAFT" as const, values: [], benefits: [], dataProvenance: "TEST" as const };
}

function revision(
  fixture: Readonly<{ jobId: string; revisionId: string; creatorId: string; title: string; salary: boolean }>,
  index: number,
) {
  return {
    id: fixture.revisionId,
    jobId: fixture.jobId,
    revisionNumber: 1,
    contentLanguage: "DE" as const,
    title: fixture.title,
    description: `Persisted scope test description number ${index}.`,
    tasks: [],
    requirements: [],
    niceToHave: [],
    applicationProcessSteps: [],
    requiredDocumentKinds: ["NONE" as const],
    jobType: "PERMANENT" as const,
    remoteType: "HYBRID" as const,
    remoteCountryCode: null,
    categoryId: IDS.category,
    cantonId: IDS.canton,
    cityId: IDS.city,
    locationLabel: "Zürich",
    workloadMin: 80,
    workloadMax: 100,
    salaryPeriod: fixture.salary ? "YEARLY" as const : null,
    salaryMin: fixture.salary ? 100_000 : null,
    salaryMax: fixture.salary ? 120_000 : null,
    startDate: null,
    startByArrangement: true,
    validThrough: new Date(NOW.getTime() + 30 * DAY),
    responseTargetDays: 10,
    applicationEffort: "SIMPLE" as const,
    applicationContactKind: "EMAIL" as const,
    applicationContactValue: "jobs@example.ch",
    authoredByUserId: fixture.creatorId,
    contentChecksum: String(index + 5).repeat(64),
  };
}

function effectiveEntitlements(companyId: string, at: Date) {
  const rights = {
    ACTIVE_JOB_LIMIT: 10,
    SEAT_LIMIT: 10,
    TALENT_RADAR_ACCESS: true,
    TALENT_CONTACT_ALLOWANCE: 0,
    JOB_BOOST_ALLOWANCE: 0,
    ANALYTICS_LEVEL: "ADVANCED" as const,
    ENHANCED_COMPANY_PROFILE: false,
    EMPLOYER_IMPORT_ACCESS: false,
  };
  const emptyCredits = { JOB_BOOST: 0, TALENT_CONTACT: 0, NEWSLETTER: 0, SOCIAL_PUSH: 0 };
  return {
    ok: true as const,
    value: {
      companyId,
      resolvedAt: at,
      source: { kind: "DEFAULT_FREE" as const, planSlug: "pro", planVersionId: id(900), subscriptionId: null },
      planRights: rights,
      rights,
      appliedGrantIds: [],
      fundableBySource: { PLAN_ALLOWANCE: emptyCredits, PURCHASED_PACK: emptyCredits, ADMIN_GRANT: emptyCredits },
    },
  };
}

function getDatabase() {
  if (database === undefined) throw new Error("Dashboard/analytics integration database unavailable.");
  return database;
}
