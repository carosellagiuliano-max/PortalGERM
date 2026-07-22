import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { listBoundaryAccessibleMembershipIds } from "@/lib/billing/membership-access";
import {
  projectDueSubscriptionBoundaries,
  projectSubscriptionBoundaries,
  scheduleSubscriptionCancellation,
} from "@/lib/billing/subscriptions";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createCompanyAccessRepository } from "@/lib/security/company-access";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const PERIOD_START = new Date("2026-07-01T10:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T10:00:00.000Z");
const SCHEDULE_AT = new Date("2026-07-21T10:00:00.000Z");

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtures:
  | Readonly<{
      adminId: string;
      companyId: string;
      membershipId: string;
      ownerId: string;
      pendingInvitationId: string;
      recruiterMembershipId: string;
      subscriptionId: string;
    }>
  | undefined;

function client() {
  if (database === undefined) throw new Error("Billing lifecycle DB unavailable.");
  return database;
}

function data() {
  if (fixtures === undefined) throw new Error("Billing lifecycle fixtures unavailable.");
  return fixtures;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_subscription_lifecycle");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  fixtures = await seedLifecycleFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 subscription lifecycle", () => {
  it("schedules cancellation once, snapshots deterministic retained seats, and projects exact boundary", async () => {
    const dependencies = {
      actor: {
        userId: data().ownerId,
        email: "phase12-owner@example.ch",
        companyId: data().companyId,
        membershipId: data().membershipId,
        membershipRole: "OWNER" as const,
      },
      correlationId: randomUUID(),
      database: client(),
      now: SCHEDULE_AT,
    };
    const first = await scheduleSubscriptionCancellation(
      {
        idempotencyKey: "phase12-cancel-fixture",
        retainedMembershipIds: [data().membershipId],
      },
      dependencies,
    );
    expect(first).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          subscriptionId: data().subscriptionId,
          effectiveAt: PERIOD_END,
        }),
      }),
    );
    const replay = await scheduleSubscriptionCancellation(
      {
        idempotencyKey: "phase12-cancel-fixture",
        retainedMembershipIds: [data().membershipId],
      },
      dependencies,
    );
    expect(replay).toEqual(expect.objectContaining({ ok: true, replay: true }));
    await expect(
      scheduleSubscriptionCancellation(
        {
          idempotencyKey: "phase12-cancel-fixture",
          retainedMembershipIds: [data().recruiterMembershipId],
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_MISMATCH" });

    const schedule = await client().subscriptionChangeSchedule.findUniqueOrThrow({
      where: { idempotencyKey: "phase12-cancel-fixture" },
    });
    expect(schedule.kind).toBe("CANCEL");
    expect(schedule.status).toBe("PENDING");
    expect(schedule.retainedMembershipIds).toEqual([data().membershipId]);
    expect(
      await client().employerSubscription.findUniqueOrThrow({
        where: { id: data().subscriptionId },
        select: { status: true },
      }),
    ).toEqual({ status: "CANCELLING" });

    const beforeBoundary = await getPrismaEffectiveEntitlements(
      data().companyId,
      new Date(PERIOD_END.getTime() - 1),
      client(),
    );
    expect(beforeBoundary.ok && beforeBoundary.value.source.planSlug).toBe(
      "STARTER",
    );

    const projected = await projectDueSubscriptionBoundaries({}, {
      actor: {
        userId: data().adminId,
        email: "phase12-projector-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      database: client(),
      now: PERIOD_END,
    });
    expect(projected).toEqual({
      ok: true,
      value: {
        appliedCancellationCount: 1,
        appliedDowngradeCount: 0,
        expiredSubscriptionCount: 0,
      },
    });
    expect(
      await client().employerSubscription.findUniqueOrThrow({
        where: { id: data().subscriptionId },
        select: { status: true, endedAt: true },
      }),
    ).toEqual({ status: "CANCELLED", endedAt: PERIOD_END });
    expect(await client().employerSubscription.count({
      where: { companyId: data().companyId },
    })).toBe(1);
    expect(
      await client().companyMembership.findUniqueOrThrow({
        where: { id: data().recruiterMembershipId },
        select: { status: true },
      }),
    ).toEqual({ status: "SUSPENDED" });
    expect(
      await client().companyInvitation.findUniqueOrThrow({
        where: { id: data().pendingInvitationId },
        select: { status: true, revokedAt: true },
      }),
    ).toEqual({ status: "REVOKED", revokedAt: PERIOD_END });

    const atBoundary = await getPrismaEffectiveEntitlements(
      data().companyId,
      PERIOD_END,
      client(),
    );
    expect(atBoundary.ok && atBoundary.value.source).toEqual(
      expect.objectContaining({ kind: "DEFAULT_FREE", planSlug: "FREE_BASIC" }),
    );
    expect(
      await client().subscriptionEvent.count({
        where: { subscriptionId: data().subscriptionId, kind: "CANCELLED" },
      }),
    ).toBe(1);
    await expect(
      client().auditLog.findFirstOrThrow({
        where: {
          action: "SUBSCRIPTION_CHANGED",
          targetId: data().subscriptionId,
        },
        select: { actorUserId: true, capability: true, result: true },
      }),
    ).resolves.toEqual({
      actorUserId: data().adminId,
      capability: "BILLING_BOUNDARY_PROJECT",
      result: "SUCCEEDED",
    });

    const retry = await projectDueSubscriptionBoundaries({}, {
      actor: {
        userId: data().adminId,
        email: "phase12-projector-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      database: client(),
      now: new Date(PERIOD_END.getTime() + 1_000),
    });
    expect(retry).toEqual({
      ok: true,
      value: {
        appliedCancellationCount: 0,
        appliedDowngradeCount: 0,
        expiredSubscriptionCount: 0,
      },
    });
    await expect(
      client().auditLog.count({
        where: {
          action: "SUBSCRIPTION_CHANGED",
          targetId: data().subscriptionId,
          capability: "BILLING_BOUNDARY_PROJECT",
        },
      }),
    ).resolves.toBe(1);
  });

  it("projects an unscheduled natural lapse only to EXPIRED", async () => {
    const natural = await createNaturalLapseFixture(client());
    await expect(
      listBoundaryAccessibleMembershipIds(
        client(),
        natural.companyId,
        new Date(PERIOD_END.getTime() - 1),
      ),
    ).resolves.toBeNull();
    await expect(
      listBoundaryAccessibleMembershipIds(
        client(),
        natural.companyId,
        PERIOD_END,
      ),
    ).resolves.toEqual([natural.ownerMembershipId]);
    const accessAtBoundary = createCompanyAccessRepository(
      client(),
      () => PERIOD_END,
    );
    await expect(
      accessAtBoundary.findActiveMembership({
        companyId: natural.companyId,
        userId: natural.ownerId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ membershipId: natural.ownerMembershipId }),
    );
    await expect(
      accessAtBoundary.findActiveMembership({
        companyId: natural.companyId,
        userId: natural.recruiterId,
      }),
    ).resolves.toBeNull();
    const result = await projectSubscriptionBoundaries({
      database: client(),
      now: PERIOD_END,
      correlationId: randomUUID(),
    });
    expect(result.expiredSubscriptionCount).toBe(1);
    expect(
      await client().employerSubscription.findUniqueOrThrow({
        where: { id: natural.subscriptionId },
        select: { status: true },
      }),
    ).toEqual({ status: "EXPIRED" });
    expect(
      await client().subscriptionEvent.findFirstOrThrow({
        where: { subscriptionId: natural.subscriptionId, kind: "EXPIRED" },
        select: { reasonCode: true },
      }),
    ).toEqual({ reasonCode: "TERM_ENDED_WITHOUT_RENEWAL" });
    await expect(
      client().companyMembership.findUniqueOrThrow({
        where: { id: natural.recruiterMembershipId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "SUSPENDED" });
    await expect(
      client().companyInvitation.findUniqueOrThrow({
        where: { id: natural.pendingInvitationId },
        select: { status: true, revokedAt: true },
      }),
    ).resolves.toEqual({ status: "REVOKED", revokedAt: PERIOD_END });
  });

  it("isolates a poisoned due schedule and still projects the next Company", async () => {
    const poisonEnd = new Date(PERIOD_END.getTime() - 1_000);
    const poisoned = await createManualBoundaryFixture(
      client(),
      "poisoned",
      poisonEnd,
      "DOWNGRADE",
    );
    const healthy = await createManualBoundaryFixture(
      client(),
      "healthy",
      PERIOD_END,
      "CANCEL",
    );

    const result = await projectSubscriptionBoundaries({
      database: client(),
      now: PERIOD_END,
      correlationId: randomUUID(),
    });
    expect(result).toEqual({
      appliedCancellationCount: 1,
      appliedDowngradeCount: 0,
      expiredSubscriptionCount: 0,
    });
    await expect(
      client().subscriptionChangeSchedule.findUniqueOrThrow({
        where: { id: poisoned.scheduleId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PENDING" });
    await expect(
      client().employerSubscription.findUniqueOrThrow({
        where: { id: poisoned.subscriptionId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE" });
    await expect(
      client().subscriptionChangeSchedule.findUniqueOrThrow({
        where: { id: healthy.scheduleId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "APPLIED" });
    await expect(
      client().employerSubscription.findUniqueOrThrow({
        where: { id: healthy.subscriptionId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "CANCELLED" });
  });
});

async function createManualBoundaryFixture(
  db: DatabaseClient,
  suffix: string,
  periodEnd: Date,
  kind: "CANCEL" | "DOWNGRADE",
) {
  const city = await db.city.findFirstOrThrow({
    select: { id: true, cantonId: true },
  });
  const company = await createActiveCompany(
    db,
    `Phase 12 ${suffix} boundary AG`,
    `phase12-${suffix}-boundary-${randomUUID()}`,
    city.cantonId,
    city.id,
  );
  const email = `phase12-${suffix}-owner-${randomUUID()}@example.ch`;
  const owner = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      role: "EMPLOYER",
      status: "ACTIVE",
    },
  });
  const membership = await db.companyMembership.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
  const starter = await db.planVersion.findFirstOrThrow({
    where: { plan: { code: "STARTER" }, status: "ACTIVE" },
  });
  const current = await db.employerSubscription.create({
    data: {
      companyId: company.id,
      planVersionId: starter.id,
      status: "ACTIVE",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: periodEnd,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 14_900,
      monthlyEquivalentRappenSnapshot: 14_900,
      currencySnapshot: "CHF",
      activatedAt: PERIOD_START,
    },
  });
  const successor = kind === "DOWNGRADE"
    ? await db.employerSubscription.create({
        data: {
          companyId: company.id,
          planVersionId: starter.id,
          status: "SCHEDULED",
          currentPeriodStart: periodEnd,
          currentPeriodEnd: new Date(periodEnd.getTime() + 30 * 86_400_000),
          billingIntervalSnapshot: "MONTHLY",
          termMonthsSnapshot: 1,
          recurringNetRappenSnapshot: 14_900,
          monthlyEquivalentRappenSnapshot: 14_900,
          currencySnapshot: "CHF",
        },
      })
    : null;
  const schedule = await db.subscriptionChangeSchedule.create({
    data: {
      companyId: company.id,
      currentSubscriptionId: current.id,
      successorSubscriptionId: successor?.id ?? null,
      kind,
      status: "PENDING",
      effectiveAt: periodEnd,
      retainedMembershipIds: [membership.id],
      retainedDefaultOwnerId: owner.id,
      invitationRevocationScope: { policyVersion: "BILLING_POLICY_V1" },
      actorUserId: owner.id,
      idempotencyKey: `phase12-${suffix}-${randomUUID()}`,
    },
  });
  if (kind === "CANCEL") {
    await db.employerSubscription.update({
      where: { id: current.id },
      data: { status: "CANCELLING" },
    });
  }
  return {
    scheduleId: schedule.id,
    subscriptionId: current.id,
  };
}

async function seedLifecycleFixtures(db: DatabaseClient) {
  const admin = await db.user.create({
    data: {
      email: "phase12-projector-admin@example.ch",
      emailNormalized: "phase12-projector-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  const owner = await db.user.create({
    data: {
      email: "phase12-owner@example.ch",
      emailNormalized: "phase12-owner@example.ch",
      role: "EMPLOYER",
      status: "ACTIVE",
    },
  });
  const recruiter = await db.user.create({
    data: {
      email: "phase12-recruiter@example.ch",
      emailNormalized: "phase12-recruiter@example.ch",
      role: "RECRUITER",
      status: "ACTIVE",
    },
  });
  const canton = await db.canton.create({
    data: {
      code: "ZH",
      name: "Zürich",
      slug: "zuerich",
      language: "DE",
      sortOrder: 1,
    },
  });
  const city = await db.city.create({
    data: {
      cantonId: canton.id,
      name: "Zürich",
      slug: "zuerich",
      sortOrder: 1,
    },
  });
  const company = await createActiveCompany(
    db,
    "Phase 12 Lifecycle AG",
    "phase12-lifecycle-ag",
    canton.id,
    city.id,
  );
  const membership = await db.companyMembership.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
  const recruiterMembership = await db.companyMembership.create({
    data: {
      companyId: company.id,
      userId: recruiter.id,
      role: "RECRUITER",
      status: "ACTIVE",
      joinedAt: new Date("2025-02-01T00:00:00.000Z"),
    },
  });
  const invitation = await db.companyInvitation.create({
    data: {
      companyId: company.id,
      inviterUserId: owner.id,
      inviteeEmailNormalized: "pending@example.ch",
      intendedRole: "RECRUITER",
      tokenHash: "a".repeat(64),
      status: "PENDING",
      expiresAt: new Date("2026-08-15T00:00:00.000Z"),
    },
  });
  const free = await createPlanVersion(db, {
    code: "FREE_BASIC",
    name: "Free Basic",
    isDefaultFree: true,
    netPriceRappen: 0,
    activeJobLimit: 1,
    seatLimit: 1,
  });
  const starter = await createPlanVersion(db, {
    code: "STARTER",
    name: "Starter",
    isDefaultFree: false,
    netPriceRappen: 14_900,
    activeJobLimit: 3,
    seatLimit: 2,
  });
  void free;
  const subscription = await db.employerSubscription.create({
    data: {
      companyId: company.id,
      planVersionId: starter.id,
      status: "ACTIVE",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 14_900,
      monthlyEquivalentRappenSnapshot: 14_900,
      currencySnapshot: "CHF",
      activatedAt: PERIOD_START,
    },
  });
  return {
    adminId: admin.id,
    companyId: company.id,
    membershipId: membership.id,
    ownerId: owner.id,
    pendingInvitationId: invitation.id,
    recruiterMembershipId: recruiterMembership.id,
    subscriptionId: subscription.id,
  };
}

async function createNaturalLapseFixture(db: DatabaseClient) {
  const city = await db.city.findFirstOrThrow({ select: { id: true, cantonId: true } });
  const company = await createActiveCompany(
    db,
    "Phase 12 Natural Lapse AG",
    "phase12-natural-lapse-ag",
    city.cantonId,
    city.id,
  );
  const starter = await db.planVersion.findFirstOrThrow({
    where: { plan: { code: "STARTER" }, status: "ACTIVE" },
  });
  const ownerEmail = `phase12-natural-owner-${randomUUID()}@example.ch`;
  const recruiterEmail = `phase12-natural-recruiter-${randomUUID()}@example.ch`;
  const owner = await db.user.create({
    data: {
      email: ownerEmail,
      emailNormalized: ownerEmail,
      role: "EMPLOYER",
      status: "ACTIVE",
    },
  });
  const recruiter = await db.user.create({
    data: {
      email: recruiterEmail,
      emailNormalized: recruiterEmail,
      role: "RECRUITER",
      status: "ACTIVE",
    },
  });
  const ownerMembership = await db.companyMembership.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
  const recruiterMembership = await db.companyMembership.create({
    data: {
      companyId: company.id,
      userId: recruiter.id,
      role: "RECRUITER",
      status: "ACTIVE",
      joinedAt: new Date("2025-02-01T00:00:00.000Z"),
    },
  });
  const pendingInvitation = await db.companyInvitation.create({
    data: {
      companyId: company.id,
      inviterUserId: owner.id,
      inviteeEmailNormalized: `phase12-natural-invite-${randomUUID()}@example.ch`,
      intendedRole: "VIEWER",
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      status: "PENDING",
      expiresAt: new Date("2026-08-15T00:00:00.000Z"),
    },
  });
  const subscription = await db.employerSubscription.create({
    data: {
      companyId: company.id,
      planVersionId: starter.id,
      status: "ACTIVE",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 14_900,
      monthlyEquivalentRappenSnapshot: 14_900,
      currencySnapshot: "CHF",
      activatedAt: PERIOD_START,
    },
  });
  return {
    companyId: company.id,
    ownerMembershipId: ownerMembership.id,
    ownerId: owner.id,
    pendingInvitationId: pendingInvitation.id,
    recruiterMembershipId: recruiterMembership.id,
    recruiterId: recruiter.id,
    subscriptionId: subscription.id,
  };
}

async function createActiveCompany(
  db: DatabaseClient,
  name: string,
  slug: string,
  cantonId: string,
  cityId: string,
) {
  const company = await db.company.create({
    data: {
      name,
      slug,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Deterministische Phase-12-Testfirma.",
      website: "https://example.ch",
      values: [],
      benefits: [],
    },
  });
  await db.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId,
      cityId,
      isPrimary: true,
      address: "Teststrasse 12",
      postalCode: "8000",
    },
  });
  return db.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
}

async function createPlanVersion(
  db: DatabaseClient,
  input: Readonly<{
    activeJobLimit: number;
    code: string;
    isDefaultFree: boolean;
    name: string;
    netPriceRappen: number;
    seatLimit: number;
  }>,
) {
  const plan = await db.plan.create({
    data: {
      code: input.code,
      name: input.name,
      isDefaultFree: input.isDefaultFree,
    },
  });
  const version = await db.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: input.netPriceRappen,
      monthlyEquivalentRappen: input.netPriceRappen,
      currency: "CHF",
      isPublic: true,
      isSelfService: !input.isDefaultFree,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      entitlements: {
        create: [
          integerEntitlement("ACTIVE_JOB_LIMIT", input.activeJobLimit),
          integerEntitlement("SEAT_LIMIT", input.seatLimit),
          booleanEntitlement("TALENT_RADAR_ACCESS", false),
          integerEntitlement("TALENT_CONTACT_ALLOWANCE", 0),
          integerEntitlement("JOB_BOOST_ALLOWANCE", 0),
          {
            key: "ANALYTICS_LEVEL",
            valueType: "ANALYTICS_LEVEL",
            analyticsLevelValue: "BASIC",
          },
          booleanEntitlement("ENHANCED_COMPANY_PROFILE", false),
          booleanEntitlement("EMPLOYER_IMPORT_ACCESS", false),
        ],
      },
    },
  });
  return db.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
}

function integerEntitlement(
  key: "ACTIVE_JOB_LIMIT" | "SEAT_LIMIT" | "TALENT_CONTACT_ALLOWANCE" | "JOB_BOOST_ALLOWANCE",
  value: number,
) {
  return { key, valueType: "INTEGER" as const, integerValue: value };
}

function booleanEntitlement(
  key: "TALENT_RADAR_ACCESS" | "ENHANCED_COMPANY_PROFILE" | "EMPLOYER_IMPORT_ACCESS",
  value: boolean,
) {
  return { key, valueType: "BOOLEAN" as const, booleanValue: value };
}
