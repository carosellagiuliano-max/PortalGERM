import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getAdminFunnelDashboard,
  type AdminFunnelCard,
} from "@/lib/analytics/admin-funnels";
import type { AdminDependencies } from "@/lib/admin/common";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AnalyticsEventKind, DataProvenance } from "@/lib/generated/prisma/enums";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const NOW = new Date("2026-07-21T10:00:00.000Z");
const COHORT_AT = new Date("2026-06-10T08:00:00.000Z");
const FILTERS = Object.freeze({ from: "2026-06-01", to: "2026-07-01" });
const uuid = (sequence: number) =>
  `f1200000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const IDS = Object.freeze({
  admin: uuid(1),
  canton: uuid(2),
  category: uuid(3),
  cluster: uuid(4),
  demoCompany: uuid(5),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_admin_funnels");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await seedFunnelFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 admin strategy funnels", () => {
  it("returns no analytics existence signal without the Admin capability", async () => {
    await expect(
      getAdminFunnelDashboard(
        FILTERS,
        {
          ...dependencies(),
          actor: {
            userId: IDS.admin,
            email: "phase12-funnel-admin@example.ch",
            role: "EMPLOYER",
            status: "ACTIVE",
          },
        },
        { demoMode: false },
      ),
    ).resolves.toBeNull();
  });

  it("reproduces all five frozen Phase-03 definitions from deterministic PostgreSQL rows", async () => {
    const dashboard = await getAdminFunnelDashboard(FILTERS, dependencies(), {
      demoMode: false,
    });
    expect(dashboard).not.toBeNull();
    if (dashboard === null) throw new Error("Admin funnel dashboard unavailable.");

    expect(dashboard.provenanceMode).toBe("LIVE_ONLY");
    expect(dashboard.options.clusters).toEqual([
      {
        key: "ZH:engineering-technik",
        cantonCode: "ZH",
        cantonName: "Zürich",
        categorySlug: "engineering-technik",
        categoryName: "Engineering & Technik",
      },
    ]);
    expect(valueCard(dashboard.cards, "CANDIDATE_ACTIVATION")).toMatchObject({
      stages: [
        { label: "Registrierte Kandidaturen", value: 20 },
        { label: "Profil vollständig", value: 17 },
      ],
      rateBps: 8_500,
    });
    expect(valueCard(dashboard.cards, "EMPLOYER_ACTIVATION")).toMatchObject({
      stages: [
        { label: "Onboardete Unternehmen", value: 20 },
        { label: "Stelle publiziert", value: 16 },
      ],
      rateBps: 8_000,
    });
    expect(valueCard(dashboard.cards, "SEARCH_TO_APPLY")).toMatchObject({
      stages: [
        { label: "Suchergebnis-Sessions", value: 20 },
        { label: "Detail-Sessions", value: 19 },
        { label: "Apply-Intent-Sessions", value: 18 },
        { label: "Bewerbungs-Sessions", value: 17 },
      ],
      rateBps: 8_500,
    });
    expect(valueCard(dashboard.cards, "LEAD_FUNNEL")).toMatchObject({
      stages: [
        { label: "Eingereicht", value: 20 },
        { label: "Qualifiziert", value: 12 },
        { label: "Gewonnen", value: 8 },
      ],
      rateBps: 4_000,
    });
    expect(valueCard(dashboard.cards, "CHECKOUT_FUNNEL")).toMatchObject({
      stages: [
        { label: "Gestartete Aufträge", value: 20 },
        { label: "Abgeschlossene Aufträge", value: 15 },
      ],
      rateBps: 7_500,
    });
    expect(
      dashboard.cards.every((card) =>
        card.metricVersion === "v1" &&
        card.window.length > 0 &&
        card.denominatorSubject.length > 0
      ),
    ).toBe(true);

    const serialized = JSON.stringify(dashboard);
    expect(serialized).not.toContain("candidate-live-");
    expect(serialized).not.toContain("session-live-");
    expect(serialized).not.toContain(uuid(100));
  });

  it("applies only allowlisted cluster/channel/Plan cells and suppresses every raw stage below twenty", async () => {
    const enterprise = await getAdminFunnelDashboard(
      { ...FILTERS, channel: "ENTERPRISE" },
      dependencies(),
      { demoMode: false },
    );
    const pro = await getAdminFunnelDashboard(
      { ...FILTERS, plan: "PRO" },
      dependencies(),
      { demoMode: false },
    );
    const cluster = await getAdminFunnelDashboard(
      { ...FILTERS, cluster: "ZH:engineering-technik" },
      dependencies(),
      { demoMode: false },
    );
    if (enterprise === null || pro === null || cluster === null) {
      throw new Error("Filtered admin funnel dashboard unavailable.");
    }

    expect(suppressedCard(enterprise.cards, "LEAD_FUNNEL")).toMatchObject({
      stages: [
        { value: "SUPPRESSED" },
        { value: "SUPPRESSED" },
        { value: "SUPPRESSED" },
      ],
      rateBps: "SUPPRESSED",
    });
    expect(suppressedCard(pro.cards, "CHECKOUT_FUNNEL")).toMatchObject({
      stages: [
        { value: "SUPPRESSED" },
        { value: "SUPPRESSED" },
      ],
      rateBps: "SUPPRESSED",
    });
    expect(valueCard(cluster.cards, "SEARCH_TO_APPLY")).toMatchObject({
      rateBps: 8_500,
      appliedDimensions: ["COHORT_DATE", "CLUSTER"],
    });
  });

  it("includes DEMO only in explicit demo mode and excludes TEST in every mode", async () => {
    const live = await getAdminFunnelDashboard(FILTERS, dependencies(), {
      demoMode: false,
    });
    const demo = await getAdminFunnelDashboard(FILTERS, dependencies(), {
      demoMode: true,
    });
    if (live === null || demo === null) throw new Error("Provenance dashboard unavailable.");

    expect(valueCard(live.cards, "CANDIDATE_ACTIVATION")).toMatchObject({
      stages: [{ value: 20 }, { value: 17 }],
      rateBps: 8_500,
    });
    expect(valueCard(demo.cards, "CANDIDATE_ACTIVATION")).toMatchObject({
      stages: [{ value: 40 }, { value: 37 }],
      rateBps: 9_250,
    });
    expect(demo.provenanceMode).toBe("LIVE_AND_DEMO");
  });

  it("rejects unknown anonymous denominators and honors Search/Lead runtime provenance", async () => {
    const live = await getAdminFunnelDashboard(FILTERS, dependencies(), {
      demoMode: false,
    });
    const demo = await getAdminFunnelDashboard(FILTERS, dependencies(), {
      demoMode: true,
    });
    if (live === null || demo === null) throw new Error("Provenance dashboard unavailable.");

    expect(valueCard(live.cards, "SEARCH_TO_APPLY").stages[0]).toEqual({
      label: "Suchergebnis-Sessions",
      value: 20,
    });
    expect(valueCard(demo.cards, "SEARCH_TO_APPLY").stages[0]).toEqual({
      label: "Suchergebnis-Sessions",
      value: 21,
    });
    expect(valueCard(live.cards, "LEAD_FUNNEL").stages[0]).toEqual({
      label: "Eingereicht",
      value: 20,
    });
    expect(valueCard(demo.cards, "LEAD_FUNNEL").stages).toEqual([
      { label: "Eingereicht", value: 21 },
      { label: "Qualifiziert", value: 13 },
      { label: "Gewonnen", value: 9 },
    ]);
  });
});

async function seedFunnelFixtures(client: DatabaseClient) {
  await client.user.create({
    data: {
      id: IDS.admin,
      email: "phase12-funnel-admin@example.ch",
      emailNormalized: "phase12-funnel-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
      dataProvenance: "LIVE",
    },
  });
  await client.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "phase12-funnel-zuerich",
      language: "DE",
      sortOrder: 1,
    },
  });
  await client.category.create({
    data: {
      id: IDS.category,
      name: "Engineering & Technik",
      slug: "engineering-technik",
      sortOrder: 1,
    },
  });
  await client.clusterLaunchAssessment.create({
    data: {
      id: IDS.cluster,
      cantonId: IDS.canton,
      categoryId: IDS.category,
      policyVersion: "cluster-launch-v1",
      evaluatedAt: new Date("2026-05-01T10:00:00.000Z"),
      evidenceWindowStart: new Date("2026-04-01T00:00:00.000Z"),
      evidenceWindowEnd: new Date("2026-05-01T00:00:00.000Z"),
      liveJobCount: 50,
      activeCandidateCount: 100,
      activeEmployerCount: 20,
      responseRateBasisPoints: 8_000,
      contentCoverageBasisPoints: 8_000,
      medianApplicationsTimes2: 10,
      dataProvenance: "LIVE",
      evidenceHash: "a".repeat(64),
      validUntil: new Date("2026-08-01T00:00:00.000Z"),
      status: "ACTIVATED",
      productApprovedByUserId: IDS.admin,
      productApprovedAt: new Date("2026-05-01T10:01:00.000Z"),
      opsApprovedByUserId: IDS.admin,
      opsApprovedAt: new Date("2026-05-01T10:02:00.000Z"),
      activatedAt: new Date("2026-05-01T10:03:00.000Z"),
    },
  });

  const companyIds = Array.from({ length: 20 }, (_, index) => uuid(100 + index));
  await client.company.createMany({
    data: [
      ...companyIds.map((companyId, index) => ({
        id: companyId,
        name: `Funnel Company ${index + 1}`,
        slug: `phase12-funnel-company-${index + 1}`,
        status: "DRAFT" as const,
        dataProvenance: "LIVE" as const,
        values: [],
        benefits: [],
      })),
      {
        id: IDS.demoCompany,
        name: "Funnel Demo Company",
        slug: "phase12-funnel-demo-company",
        status: "DRAFT" as const,
        dataProvenance: "DEMO" as const,
        values: [],
        benefits: [],
      },
    ],
  });

  let sequence = 1_000;
  const events: FunnelFixture[] = [];
  const add = (input: Omit<FunnelFixture, "id" | "producer" | "dedupeKey" | "schemaVersion" | "purpose" | "receivedAt" | "retainUntil">) => {
    sequence += 1;
    events.push({
      ...input,
      id: uuid(sequence),
      producer: "phase12-funnel-fixture",
      dedupeKey: `phase12-funnel:${sequence}`,
      schemaVersion: "1",
      purpose: PRODUCT_KINDS.has(input.kind) ? "PRODUCT_ANALYTICS" : "ESSENTIAL_OPERATIONAL",
      receivedAt: new Date(input.occurredAt.getTime() + 60_000),
      retainUntil: new Date(NOW.getTime() + 400 * DAY),
    });
  };

  addCandidateCohort(add, "live", "LIVE", 20, 17);
  addCandidateCohort(add, "demo", "DEMO", 20, 20);
  addCandidateCohort(add, "test", "TEST", 20, 0);

  for (let index = 0; index < 20; index += 1) {
    const companyId = companyIds[index] as string;
    const actor = `employer-live-${index}`;
    add(eventInput("COMPANY_ONBOARDING_COMPLETED", index, {
      actor,
      companyId,
      companyProvenance: "LIVE",
      properties: { onboardingRuleVersion: "company-onboarding-v1" },
    }));
    if (index < 16) {
      add(eventInput("JOB_PUBLISHED", index, {
        actor,
        companyId,
        companyProvenance: "LIVE",
        offset: 3 * DAY,
        properties: { fromStatus: "APPROVED", toStatus: "PUBLISHED" },
      }));
    }
  }

  for (let index = 0; index < 20; index += 1) {
    const session = `session-live-${index}`;
    const actor = `search-live-${index}`;
    add(eventInput("SEARCH_RESULTS_VIEWED", index, {
      actor,
      session,
      properties: {
        surface: "JOB_SEARCH",
        locale: "de-CH",
        cantonCode: "ZH",
        categorySlug: "engineering-technik",
        resultCountBucket: "25-49",
      },
    }));
    if (index < 19) add(eventInput("JOB_DETAIL_VIEWED", index, { actor, session, offset: 60_000, properties: { surface: "JOB_DETAIL", locale: "de-CH", placement: "ORGANIC" } }));
    if (index < 18) add(eventInput("APPLY_INTENT_STARTED", index, { actor, session, offset: 120_000, properties: { surface: "JOB_DETAIL", intent: "APPLY" } }));
    if (index < 17) add(eventInput("APPLICATION_SUBMITTED", index, { actor, session, offset: 180_000, properties: { toStatus: "SUBMITTED", applicationEffort: "SIMPLE" } }));
  }

  events.push(
    runtimeSearchEvent(9_001, "runtime-local-search", "DEMO"),
    runtimeSearchEvent(9_002, "runtime-ci-search", "TEST"),
    runtimeSearchEvent(9_003, "runtime-unknown-search", null),
    runtimeLeadEvent(9_101, "runtime-local-lead", "LEAD_SUBMITTED", "DEMO"),
    runtimeLeadEvent(9_102, "runtime-local-lead", "LEAD_QUALIFIED", "DEMO"),
    runtimeLeadEvent(9_103, "runtime-local-lead", "LEAD_WON", "DEMO"),
    runtimeLeadEvent(9_104, "runtime-ci-lead", "LEAD_SUBMITTED", "TEST"),
    runtimeLeadEvent(9_105, "runtime-unknown-lead", "LEAD_SUBMITTED", null),
  );

  for (let index = 0; index < 20; index += 1) {
    const companyId = companyIds[index] as string;
    const session = `lead-live-${index}`;
    const leadPurpose = index < 19 ? "ENTERPRISE" : "EMPLOYER_DEMO";
    add(eventInput("LEAD_SUBMITTED", index, { companyId, companyProvenance: "LIVE", session, properties: { leadPurpose } }));
    if (index < 12) add(eventInput("LEAD_QUALIFIED", index, { companyId, companyProvenance: "LIVE", session, offset: DAY, properties: { leadPurpose } }));
    if (index < 8) add(eventInput("LEAD_WON", index, { companyId, companyProvenance: "LIVE", session, offset: 2 * DAY, properties: { leadPurpose } }));
  }

  for (let index = 0; index < 20; index += 1) {
    const companyId = companyIds[index] as string;
    const session = `checkout-live-${index}`;
    const planSlug = index < 1 ? "starter" : "pro";
    add(eventInput("CHECKOUT_STARTED", index, { companyId, companyProvenance: "LIVE", session, properties: { planSlug, amountRappen: planSlug === "pro" ? 39_900 : 14_900 } }));
    if (index < 15) add(eventInput("CHECKOUT_COMPLETED", index, { companyId, companyProvenance: "LIVE", session, offset: 30 * 60_000, properties: { planSlug, amountRappen: planSlug === "pro" ? 39_900 : 14_900 } }));
  }

  await client.analyticsEvent.createMany({ data: events });
}

type FunnelFixture = Readonly<{
  id: string;
  producer: string;
  dedupeKey: string;
  kind: AnalyticsEventKind;
  schemaVersion: "1";
  purpose: "ESSENTIAL_OPERATIONAL" | "PRODUCT_ANALYTICS";
  occurredAt: Date;
  receivedAt: Date;
  pseudonymousActorId: string | null;
  pseudonymousSessionId: string | null;
  companyId: string | null;
  jobId: null;
  actorProvenanceSnapshot: DataProvenance | null;
  companyProvenanceSnapshot: DataProvenance | null;
  jobProvenanceSnapshot: null;
  properties: Prisma.InputJsonObject;
  retainUntil: Date;
}>;

const PRODUCT_KINDS = new Set<AnalyticsEventKind>([
  "SEARCH_RESULTS_VIEWED",
  "JOB_DETAIL_VIEWED",
  "APPLY_INTENT_STARTED",
]);

function eventInput(
  kind: AnalyticsEventKind,
  index: number,
  input: Readonly<{
    actor?: string;
    session?: string;
    companyId?: string;
    actorProvenance?: DataProvenance;
    companyProvenance?: DataProvenance;
    offset?: number;
    properties: Prisma.InputJsonObject;
  }>,
): Omit<FunnelFixture, "id" | "producer" | "dedupeKey" | "schemaVersion" | "purpose" | "receivedAt" | "retainUntil"> {
  return {
    kind,
    occurredAt: new Date(COHORT_AT.getTime() + index * 10 * 60_000 + (input.offset ?? 0)),
    pseudonymousActorId: input.actor ?? null,
    pseudonymousSessionId: input.session ?? null,
    companyId: input.companyId ?? null,
    jobId: null,
    actorProvenanceSnapshot: input.actorProvenance ?? (input.actor === undefined ? null : "LIVE"),
    companyProvenanceSnapshot: input.companyProvenance ?? null,
    jobProvenanceSnapshot: null,
    properties: input.properties,
  };
}

function addCandidateCohort(
  add: (input: Omit<FunnelFixture, "id" | "producer" | "dedupeKey" | "schemaVersion" | "purpose" | "receivedAt" | "retainUntil">) => void,
  scope: string,
  provenance: DataProvenance,
  denominator: number,
  numerator: number,
) {
  for (let index = 0; index < denominator; index += 1) {
    const actor = `candidate-${scope}-${index}`;
    add(eventInput("CANDIDATE_REGISTERED", index, {
      actor,
      actorProvenance: provenance,
      properties: { onboardingRuleVersion: "candidate-onboarding-v1" },
    }));
    if (index < numerator) {
      add(eventInput("CANDIDATE_PROFILE_COMPLETED", index, {
        actor,
        actorProvenance: provenance,
        offset: 2 * DAY,
        properties: { onboardingRuleVersion: "candidate-onboarding-v1" },
      }));
    }
  }
}

function runtimeSearchEvent(
  sequence: number,
  session: string,
  provenance: DataProvenance | null,
): FunnelFixture {
  return {
    id: uuid(sequence),
    producer: "public-job-view",
    dedupeKey: `SEARCH_RESULTS_VIEWED:${uuid(sequence + 100)}`,
    kind: "SEARCH_RESULTS_VIEWED",
    schemaVersion: "1",
    purpose: "PRODUCT_ANALYTICS",
    occurredAt: new Date(COHORT_AT.getTime() + sequence % 10 * 60_000),
    receivedAt: new Date(COHORT_AT.getTime() + sequence % 10 * 60_000 + 1_000),
    pseudonymousActorId: null,
    pseudonymousSessionId: session,
    companyId: null,
    jobId: null,
    actorProvenanceSnapshot: provenance,
    companyProvenanceSnapshot: null,
    jobProvenanceSnapshot: null,
    properties: {
      surface: "JOB_SEARCH",
      locale: "de-CH",
      resultCountBucket: "10-24",
      sort: "relevance",
      cantonCode: "ZH",
      categorySlug: "engineering-technik",
    },
    retainUntil: new Date(NOW.getTime() + 90 * DAY),
  };
}

function runtimeLeadEvent(
  sequence: number,
  session: string,
  kind: "LEAD_SUBMITTED" | "LEAD_QUALIFIED" | "LEAD_WON",
  provenance: DataProvenance | null,
): FunnelFixture {
  const offset = kind === "LEAD_SUBMITTED"
    ? 0
    : kind === "LEAD_QUALIFIED"
      ? DAY
      : 2 * DAY;
  return {
    id: uuid(sequence),
    producer: kind === "LEAD_SUBMITTED" ? "employer-demo" : "admin-sales-lead",
    dedupeKey: `${kind}:${uuid(sequence + 100)}`,
    kind,
    schemaVersion: "1",
    purpose: "ESSENTIAL_OPERATIONAL",
    occurredAt: new Date(COHORT_AT.getTime() + sequence % 10 * 60_000 + offset),
    receivedAt: new Date(COHORT_AT.getTime() + sequence % 10 * 60_000 + offset + 1_000),
    pseudonymousActorId: null,
    pseudonymousSessionId: session,
    companyId: null,
    jobId: null,
    actorProvenanceSnapshot: provenance,
    companyProvenanceSnapshot: null,
    jobProvenanceSnapshot: null,
    properties: { leadPurpose: "EMPLOYER_DEMO" },
    retainUntil: new Date(NOW.getTime() + 400 * DAY),
  };
}

function dependencies(): AdminDependencies {
  return Object.freeze({
    actor: {
      userId: IDS.admin,
      email: "phase12-funnel-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
    correlationId: "phase12-admin-funnel-test",
    database: db(),
    now: NOW,
  });
}

function valueCard(
  cards: readonly AdminFunnelCard[],
  key: AdminFunnelCard["key"],
) {
  const card = cards.find((candidate) => candidate.key === key);
  expect(card?.status).toBe("VALUE");
  if (card === undefined || card.status !== "VALUE") throw new Error(`${key} is not visible.`);
  return card;
}

function suppressedCard(
  cards: readonly AdminFunnelCard[],
  key: AdminFunnelCard["key"],
) {
  const card = cards.find((candidate) => candidate.key === key);
  expect(card?.status).toBe("SUPPRESSED");
  if (card === undefined || card.status !== "SUPPRESSED") throw new Error(`${key} is not suppressed.`);
  return card;
}

function db() {
  if (database === undefined) throw new Error("Admin funnel integration database unavailable.");
  return database;
}
