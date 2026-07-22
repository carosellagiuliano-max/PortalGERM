import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getAdminFinancialMetrics } from "@/lib/analytics/admin-metrics";
import type { BillingDependencies } from "@/lib/billing/contracts";
import { listBoundaryAccessibleMembershipIds } from "@/lib/billing/membership-access";
import {
  confirmMockPayment,
  createCheckoutOrder,
} from "@/lib/billing/orders";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { projectDueSubscriptionBoundaries } from "@/lib/billing/subscriptions";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  changeCompanyMemberRole,
  removeCompanyMember,
} from "@/lib/employer/team";
import { parseEnvironment } from "@/lib/config/env-schema";
import { MockEmailProvider } from "@/lib/providers/email";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { MockPaymentProvider } from "@/lib/providers/payments";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { createValidEnvironment } from "@/tests/fixtures/environment";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type Fixtures = Awaited<ReturnType<typeof seedTransitionFixtures>>;

const FREE_CHECKOUT_AT = new Date("2026-01-31T22:45:30.000Z");
const FREE_QUOTED_PERIOD_END = new Date("2026-02-28T22:45:30.000Z");
const FREE_CONFIRM_AT = new Date("2026-01-31T23:05:30.000Z");
const FREE_PERIOD_END = new Date("2026-02-28T23:05:30.000Z");
const PAID_PERIOD_START = new Date("2026-07-01T10:00:00.000Z");
const CHANGE_AT = new Date("2026-07-21T10:00:00.000Z");
const UPGRADE_CONFIRM_AT = new Date("2026-07-21T10:01:00.000Z");
const PAID_PERIOD_END = new Date("2026-08-01T10:00:00.000Z");
const DOWNGRADE_PERIOD_END = new Date("2026-09-01T10:00:00.000Z");
const PRORATION_NUMERATOR_SECONDS = 11 * 24 * 60 * 60;
const PRORATION_DENOMINATOR_SECONDS = 31 * 24 * 60 * 60;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtures: Fixtures | undefined;

function client() {
  if (database === undefined) throw new Error("Plan transition DB unavailable.");
  return database;
}

function data() {
  if (fixtures === undefined) throw new Error("Plan transition fixtures unavailable.");
  return fixtures;
}

function dependencies(
  actor: BillingDependencies["actor"],
  now: Date,
): BillingDependencies {
  return Object.freeze({
    actor,
    correlationId: randomUUID(),
    database: client(),
    paymentProvider: new MockPaymentProvider(),
    emailProvider: new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    ),
    now,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_plan_transitions");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  fixtures = await seedTransitionFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("ADR-028 paid plan transitions", () => {
  it("anchors a delayed NEW subscription and paid metric to confirmation time", async () => {
    const checkoutDependencies = dependencies(
      data().free.actor,
      FREE_CHECKOUT_AT,
    );
    const confirmationDependencies = dependencies(
      data().free.actor,
      FREE_CONFIRM_AT,
    );
    await expect(
      client().employerSubscription.count({
        where: { companyId: data().free.actor.companyId },
      }),
    ).resolves.toBe(0);

    const checkout = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        idempotencyKey: "phase12-free-to-starter",
      },
      checkoutDependencies,
    );
    expect(checkout).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    if (!checkout.ok) throw new Error("Free to Starter checkout failed.");

    const quoted = await client().order.findUniqueOrThrow({
      where: { id: checkout.value.orderId },
      include: { lines: { include: { subscriptionSnapshot: true } } },
    });
    expect(quoted).toEqual(
      expect.objectContaining({
        netTotalRappen: 14_900,
        vatTotalRappen: 1_207,
        totalRappen: 16_107,
      }),
    );
    expect(quoted.lines[0]?.subscriptionSnapshot).toEqual(
      expect.objectContaining({
        changeKind: "NEW",
        fulfillmentPeriodStart: FREE_CHECKOUT_AT,
        fulfillmentPeriodEnd: FREE_QUOTED_PERIOD_END,
        quotedNetRappen: 14_900,
      }),
    );

    const confirmed = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "phase12-free-to-starter-confirm",
      },
      confirmationDependencies,
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ subscriptionId: expect.any(String) }),
      }),
    );
    if (!confirmed.ok || confirmed.value.subscriptionId === null) {
      throw new Error("Free to Starter fulfillment failed.");
    }
    await expect(
      client().employerSubscription.findUniqueOrThrow({
        where: { id: confirmed.value.subscriptionId },
        select: {
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
        },
      }),
    ).resolves.toEqual({
      status: "ACTIVE",
      currentPeriodStart: FREE_CONFIRM_AT,
      currentPeriodEnd: FREE_PERIOD_END,
    });

    const paidEvent = await client().paymentEvent.findFirstOrThrow({
      where: { orderId: checkout.value.orderId, kind: "PAID" },
      select: { createdAt: true },
    });
    expect(paidEvent.createdAt).toEqual(FREE_CONFIRM_AT);
    expect(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Zurich",
        year: "numeric",
        month: "2-digit",
      }).format(paidEvent.createdAt),
    ).toBe("2026-02");
    const metricDependencies = (now: Date) => ({
      actor: data().adminActor,
      correlationId: randomUUID(),
      database: client(),
      now,
    });
    const januaryMetrics = await getAdminFinancialMetrics(
      metricDependencies(FREE_CHECKOUT_AT),
    );
    const februaryMetrics = await getAdminFinancialMetrics(
      metricDependencies(FREE_CONFIRM_AT),
    );
    expect(januaryMetrics).toEqual(
      expect.objectContaining({
        month: expect.objectContaining({ label: "2026-01" }),
        monthlyMockPaidPlanNetRappen: 0,
      }),
    );
    expect(februaryMetrics).toEqual(
      expect.objectContaining({
        month: expect.objectContaining({ label: "2026-02" }),
        monthlyMockPaidPlanNetRappen: 14_900,
      }),
    );

    const orderCountBeforeSamePlan = await client().order.count({
      where: { companyId: data().free.actor.companyId },
    });
    await expect(
      createCheckoutOrder(
        {
          kind: "PLAN",
          planSlug: "starter",
          idempotencyKey: "phase12-starter-same-plan",
        },
        confirmationDependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "SAME_PLAN" });
    await expect(
      client().order.count({
        where: { companyId: data().free.actor.companyId },
      }),
    ).resolves.toBe(orderCountBeforeSamePlan);
  });

  it("upgrades Starter immediately using exact remaining-second proration", async () => {
    const deps = dependencies(data().upgrade.actor, CHANGE_AT);
    const checkout = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "pro",
        idempotencyKey: "phase12-starter-to-pro",
      },
      deps,
    );
    expect(checkout).toEqual(
      expect.objectContaining({ ok: true, value: expect.any(Object) }),
    );
    if (!checkout.ok) throw new Error("Starter to Pro checkout failed.");

    const quoted = await client().order.findUniqueOrThrow({
      where: { id: checkout.value.orderId },
      include: { lines: { include: { subscriptionSnapshot: true } } },
    });
    expect(quoted).toEqual(
      expect.objectContaining({
        netTotalRappen: 8_871,
        vatTotalRappen: 719,
        totalRappen: 9_590,
      }),
    );
    expect(quoted.lines).toHaveLength(1);
    expect(quoted.lines[0]).toEqual(
      expect.objectContaining({
        unitNetRappen: 8_871,
        netRappen: 8_871,
        vatRappen: 719,
        totalRappen: 9_590,
      }),
    );
    expect(quoted.lines[0]?.subscriptionSnapshot).toEqual(
      expect.objectContaining({
        changeKind: "UPGRADE",
        sourceSubscriptionId: data().upgrade.subscriptionId,
        sourcePeriodStart: PAID_PERIOD_START,
        sourcePeriodEnd: PAID_PERIOD_END,
        fulfillmentPeriodStart: CHANGE_AT,
        fulfillmentPeriodEnd: PAID_PERIOD_END,
        sourceRecurringNetRappen: 14_900,
        targetRecurringNetRappen: 39_900,
        prorationNumeratorSeconds: PRORATION_NUMERATOR_SECONDS,
        prorationDenominatorSeconds: PRORATION_DENOMINATOR_SECONDS,
        quotedNetRappen: 8_871,
        talentContactAllowanceSnapshot: 3,
        jobBoostAllowanceSnapshot: 1,
      }),
    );

    const confirmPayment = vi.fn(async (input: { orderId: string }) => ({
      provider: "MOCK" as const,
      orderId: input.orderId,
      providerReference: `mock_payment_${"c".repeat(64)}`,
      status: "PAID" as const,
    }));
    const mock = new MockPaymentProvider();
    const delayedDependencies: BillingDependencies = Object.freeze({
      ...dependencies(data().upgrade.actor, UPGRADE_CONFIRM_AT),
      paymentProvider: Object.freeze({
        createCheckout: mock.createCheckout.bind(mock),
        confirmPayment,
        cancel: mock.cancel.bind(mock),
      }),
    });
    await expect(
      confirmMockPayment(
        {
          orderId: checkout.value.orderId,
          idempotencyKey: "phase12-stale-starter-to-pro-confirm",
        },
        delayedDependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    expect(confirmPayment).not.toHaveBeenCalled();
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: checkout.value.orderId },
        select: { status: true, paymentEvents: { select: { kind: true } } },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      paymentEvents: [{ kind: "CHECKOUT_CREATED" }],
    });

    const requote = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "pro",
        idempotencyKey: "phase12-starter-to-pro-requote",
      },
      delayedDependencies,
    );
    expect(requote).toEqual(
      expect.objectContaining({ ok: true, value: expect.any(Object) }),
    );
    if (!requote.ok) throw new Error("Starter to Pro requote failed.");
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: requote.value.orderId },
        select: {
          netTotalRappen: true,
          vatTotalRappen: true,
          totalRappen: true,
          lines: { select: { unitNetRappen: true, netRappen: true } },
        },
      }),
    ).resolves.toEqual({
      netTotalRappen: 8_870,
      vatTotalRappen: 718,
      totalRappen: 9_588,
      lines: [{ unitNetRappen: 8_870, netRappen: 8_870 }],
    });

    const confirmed = await confirmMockPayment(
      {
        orderId: requote.value.orderId,
        idempotencyKey: "phase12-starter-to-pro-requote-confirm",
      },
      delayedDependencies,
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ subscriptionId: expect.any(String) }),
      }),
    );
    if (!confirmed.ok || confirmed.value.subscriptionId === null) {
      throw new Error("Starter to Pro fulfillment failed.");
    }

    const rows = await client().employerSubscription.findMany({
      where: { companyId: data().upgrade.actor.companyId },
      orderBy: [{ currentPeriodStart: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        endedAt: true,
      },
    });
    expect(rows).toEqual([
      {
        id: data().upgrade.subscriptionId,
        status: "EXPIRED",
        currentPeriodStart: PAID_PERIOD_START,
        currentPeriodEnd: PAID_PERIOD_END,
        endedAt: UPGRADE_CONFIRM_AT,
      },
      {
        id: confirmed.value.subscriptionId,
        status: "ACTIVE",
        currentPeriodStart: UPGRADE_CONFIRM_AT,
        currentPeriodEnd: PAID_PERIOD_END,
        endedAt: null,
      },
    ]);
    await expect(
      client().employerSubscription.count({
        where: {
          companyId: data().upgrade.actor.companyId,
          status: { in: ["SCHEDULED", "ACTIVE", "CANCELLING"] },
          currentPeriodStart: { lte: UPGRADE_CONFIRM_AT },
          currentPeriodEnd: { gt: UPGRADE_CONFIRM_AT },
        },
      }),
    ).resolves.toBe(1);

    const grants = await client().creditLedgerEntry.findMany({
      where: {
        sourceSubscriptionId: confirmed.value.subscriptionId,
        kind: "GRANT",
        fundingSource: "PLAN_ALLOWANCE",
      },
      include: { account: { select: { creditType: true } } },
      orderBy: { amount: "asc" },
    });
    expect(
      grants.map((grant) => ({
        amount: grant.amount,
        creditType: grant.account.creditType,
        validFrom: grant.validFrom,
        validTo: grant.validTo,
      })),
    ).toEqual([
      {
        amount: 1,
        creditType: "JOB_BOOST",
        validFrom: UPGRADE_CONFIRM_AT,
        validTo: PAID_PERIOD_END,
      },
      {
        amount: 3,
        creditType: "TALENT_CONTACT",
        validFrom: UPGRADE_CONFIRM_AT,
        validTo: PAID_PERIOD_END,
      },
    ]);
  });

  it("fails closed for non-Owner and foreign or ownerless retained-seat selections", async () => {
    const companyId = data().downgrade.ownerActor.companyId;
    const orderCountBefore = await client().order.count({ where: { companyId } });

    await expect(
      createCheckoutOrder(
        {
          kind: "PLAN",
          planSlug: "starter",
          retainedMembershipIds: [
            data().downgrade.ownerActor.membershipId,
            data().downgrade.recruiterMembershipId,
          ],
          idempotencyKey: "phase12-downgrade-admin-denied",
        },
        dependencies(data().downgrade.adminActor, CHANGE_AT),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    await expect(
      createCheckoutOrder(
        {
          kind: "PLAN",
          planSlug: "starter",
          retainedMembershipIds: [
            data().downgrade.ownerActor.membershipId,
            data().foreignOwnerMembershipId,
          ],
          idempotencyKey: "phase12-downgrade-foreign-seat",
        },
        dependencies(data().downgrade.ownerActor, CHANGE_AT),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });

    await expect(
      createCheckoutOrder(
        {
          kind: "PLAN",
          planSlug: "starter",
          retainedMembershipIds: [data().downgrade.recruiterMembershipId],
          idempotencyKey: "phase12-downgrade-ownerless-seats",
        },
        dependencies(data().downgrade.ownerActor, CHANGE_AT),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    await expect(client().order.count({ where: { companyId } })).resolves.toBe(
      orderCountBefore,
    );
  });

  it("pays one full future Starter month and projects downgrade exactly once", async () => {
    const deps = dependencies(data().downgrade.ownerActor, CHANGE_AT);
    const checkout = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        retainedMembershipIds: [
          data().downgrade.ownerActor.membershipId,
          data().downgrade.recruiterMembershipId,
        ],
        idempotencyKey: "phase12-pro-to-starter",
      },
      deps,
    );
    expect(checkout).toEqual(
      expect.objectContaining({ ok: true, value: expect.any(Object) }),
    );
    if (!checkout.ok) throw new Error("Pro to Starter checkout failed.");

    const confirmed = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "phase12-pro-to-starter-confirm",
      },
      deps,
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ subscriptionId: expect.any(String) }),
      }),
    );
    if (!confirmed.ok || confirmed.value.subscriptionId === null) {
      throw new Error("Pro to Starter fulfillment failed.");
    }

    const paidOrder = await client().order.findUniqueOrThrow({
      where: { id: checkout.value.orderId },
      include: { lines: { include: { subscriptionSnapshot: true } } },
    });
    expect(paidOrder).toEqual(
      expect.objectContaining({
        status: "PAID",
        netTotalRappen: 14_900,
        vatTotalRappen: 1_207,
        totalRappen: 16_107,
      }),
    );
    expect(paidOrder.lines[0]?.subscriptionSnapshot).toEqual(
      expect.objectContaining({
        changeKind: "DOWNGRADE",
        fulfillmentPeriodStart: PAID_PERIOD_END,
        fulfillmentPeriodEnd: DOWNGRADE_PERIOD_END,
        quotedNetRappen: 14_900,
        retainedMembershipIds: [
          data().downgrade.ownerActor.membershipId,
          data().downgrade.recruiterMembershipId,
        ],
        retainedDefaultOwnerId: data().downgrade.ownerActor.userId,
      }),
    );

    const schedules = await client().subscriptionChangeSchedule.findMany({
      where: { companyId: data().downgrade.ownerActor.companyId },
      include: {
        currentSubscription: true,
        successorSubscription: true,
      },
    });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toEqual(
      expect.objectContaining({
        kind: "DOWNGRADE",
        status: "PENDING",
        effectiveAt: PAID_PERIOD_END,
        retainedMembershipIds: [
          data().downgrade.ownerActor.membershipId,
          data().downgrade.recruiterMembershipId,
        ],
        retainedDefaultOwnerId: data().downgrade.ownerActor.userId,
        currentSubscription: expect.objectContaining({
          id: data().downgrade.subscriptionId,
          status: "ACTIVE",
        }),
        successorSubscription: expect.objectContaining({
          id: confirmed.value.subscriptionId,
          status: "SCHEDULED",
          currentPeriodStart: PAID_PERIOD_END,
          currentPeriodEnd: DOWNGRADE_PERIOD_END,
        }),
      }),
    );

    await client().companyMembership.update({
      where: { id: data().downgrade.adminActor.membershipId },
      data: { role: "OWNER" },
    });
    const retainedOwnerGuardDependencies = {
      database: client(),
      environment: parseEnvironment(
        createValidEnvironment({ DATABASE_URL: migrated?.connectionString }),
      ),
      request: {
        correlationId: randomUUID(),
        expectedOrigin: "http://127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        production: false,
        sourceIp: "127.0.0.1",
        userAgent: "Phase 12 retained Owner guard test",
      },
      now: CHANGE_AT,
    } as const;
    const replacementOwnerActor = {
      userId: data().downgrade.adminActor.userId,
      membershipId: data().downgrade.adminActor.membershipId,
      role: "OWNER" as const,
    };
    await expect(
      changeCompanyMemberRole(
        data().downgrade.ownerActor.companyId,
        replacementOwnerActor,
        {
          membershipId: data().downgrade.ownerActor.membershipId,
          role: "ADMIN",
        },
        retainedOwnerGuardDependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "RETAINED_OWNER_REQUIRED" });
    await expect(
      removeCompanyMember(
        data().downgrade.ownerActor.companyId,
        replacementOwnerActor,
        {
          membershipId: data().downgrade.ownerActor.membershipId,
          reason: "Retained Owner must survive the scheduled boundary",
        },
        retainedOwnerGuardDependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "RETAINED_OWNER_REQUIRED" });

    const beforeBoundary = await getPrismaEffectiveEntitlements(
      data().downgrade.ownerActor.companyId,
      new Date(PAID_PERIOD_END.getTime() - 1),
      client(),
    );
    expect(beforeBoundary).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          source: expect.objectContaining({ planSlug: "PRO" }),
          planRights: expect.objectContaining({
            ACTIVE_JOB_LIMIT: 10,
            SEAT_LIMIT: 10,
            TALENT_RADAR_ACCESS: true,
            ANALYTICS_LEVEL: "ADVANCED",
          }),
        }),
      }),
    );
    await expect(
      listBoundaryAccessibleMembershipIds(
        client(),
        data().downgrade.ownerActor.companyId,
        new Date(PAID_PERIOD_END.getTime() - 1),
      ),
    ).resolves.toBeNull();
    await expect(
      listBoundaryAccessibleMembershipIds(
        client(),
        data().downgrade.ownerActor.companyId,
        PAID_PERIOD_END,
      ),
    ).resolves.toEqual([
      data().downgrade.ownerActor.membershipId,
      data().downgrade.recruiterMembershipId,
    ]);

    const projectorDependencies = () => ({
      actor: {
        userId: data().downgrade.adminActor.userId,
        email: data().downgrade.adminActor.email,
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      database: client(),
      now: PAID_PERIOD_END,
    } as const);
    const parallel = await Promise.all([
      projectDueSubscriptionBoundaries({}, projectorDependencies()),
      projectDueSubscriptionBoundaries({}, projectorDependencies()),
    ]);
    expect(parallel.every((result) => result.ok)).toBe(true);
    expect(
      parallel.reduce(
        (sum, result) =>
          sum + (result.ok ? result.value.appliedDowngradeCount : 0),
        0,
      ),
    ).toBe(1);
    expect(
      parallel
        .map((result) =>
          result.ok ? result.value.appliedDowngradeCount : -1,
        )
        .sort(),
    ).toEqual([0, 1]);

    const retry = await projectDueSubscriptionBoundaries({}, {
      ...projectorDependencies(),
      now: new Date(PAID_PERIOD_END.getTime() + 1_000),
    });
    expect(retry).toEqual({
      ok: true,
      value: {
        appliedCancellationCount: 0,
        appliedDowngradeCount: 0,
        expiredSubscriptionCount: 0,
      },
    });

    const projected = await client().subscriptionChangeSchedule.findFirstOrThrow({
      where: { companyId: data().downgrade.ownerActor.companyId },
      include: { currentSubscription: true, successorSubscription: true },
    });
    expect(projected).toEqual(
      expect.objectContaining({
        status: "APPLIED",
        appliedAt: PAID_PERIOD_END,
        currentSubscription: expect.objectContaining({
          status: "EXPIRED",
          endedAt: PAID_PERIOD_END,
        }),
        successorSubscription: expect.objectContaining({
          status: "ACTIVE",
          activatedAt: PAID_PERIOD_END,
        }),
      }),
    );

    const atBoundary = await getPrismaEffectiveEntitlements(
      data().downgrade.ownerActor.companyId,
      PAID_PERIOD_END,
      client(),
    );
    expect(atBoundary).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          source: expect.objectContaining({ planSlug: "STARTER" }),
          planRights: expect.objectContaining({
            ACTIVE_JOB_LIMIT: 3,
            SEAT_LIMIT: 2,
            ANALYTICS_LEVEL: "BASIC",
          }),
        }),
      }),
    );
    await expect(
      client().employerSubscription.count({
        where: {
          companyId: data().downgrade.ownerActor.companyId,
          status: { in: ["SCHEDULED", "ACTIVE", "CANCELLING"] },
          currentPeriodStart: { lte: PAID_PERIOD_END },
          currentPeriodEnd: { gt: PAID_PERIOD_END },
        },
      }),
    ).resolves.toBe(1);

    const grants = await client().creditLedgerEntry.findMany({
      where: {
        sourceSubscriptionId: confirmed.value.subscriptionId,
        kind: "GRANT",
        fundingSource: "PLAN_ALLOWANCE",
      },
      include: { account: { select: { creditType: true } } },
      orderBy: { amount: "asc" },
    });
    expect(
      grants.map((grant) => [grant.account.creditType, grant.amount]),
    ).toEqual([
      ["JOB_BOOST", 2],
      ["TALENT_CONTACT", 4],
    ]);
    await expect(
      client().creditLedgerEntry.count({
        where: { sourceSubscriptionId: confirmed.value.subscriptionId },
      }),
    ).resolves.toBe(2);

    const memberships = await client().companyMembership.findMany({
      where: { companyId: data().downgrade.ownerActor.companyId },
      select: { id: true, status: true },
      orderBy: { id: "asc" },
    });
    expect(new Map(memberships.map((membership) => [membership.id, membership.status]))).toEqual(
      new Map([
        [data().downgrade.ownerActor.membershipId, "ACTIVE"],
        [data().downgrade.recruiterMembershipId, "ACTIVE"],
        [data().downgrade.adminActor.membershipId, "SUSPENDED"],
        [data().downgrade.viewerMembershipId, "SUSPENDED"],
      ]),
    );
    await expect(
      client().companyMembershipEvent.count({
        where: {
          membershipId: {
            in: [
              data().downgrade.adminActor.membershipId,
              data().downgrade.viewerMembershipId,
            ],
          },
          kind: "PLAN_LIMIT_SUSPENDED",
        },
      }),
    ).resolves.toBe(2);
    await expect(
      client().companyInvitation.findUniqueOrThrow({
        where: { id: data().downgrade.pendingInvitationId },
        select: { status: true, revokedAt: true, events: true },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "REVOKED",
        revokedAt: PAID_PERIOD_END,
        events: [expect.objectContaining({ kind: "REVOKED" })],
      }),
    );
    await expect(
      client().subscriptionEvent.count({
        where: {
          subscriptionId: data().downgrade.subscriptionId,
          kind: "EXPIRED",
          reasonCode: "DOWNGRADE_BOUNDARY",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      client().subscriptionEvent.count({
        where: {
          subscriptionId: confirmed.value.subscriptionId,
          kind: "ACTIVATED",
          reasonCode: "DOWNGRADE_BOUNDARY",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      client().auditLog.findMany({
        where: {
          capability: "BILLING_BOUNDARY_PROJECT",
          reasonCode: "DOWNGRADE_BOUNDARY",
          targetId: {
            in: [
              data().downgrade.subscriptionId,
              confirmed.value.subscriptionId,
            ],
          },
        },
        select: { action: true, targetId: true },
        orderBy: [{ action: "asc" }, { targetId: "asc" }],
      }),
    ).resolves.toEqual([
      {
        action: "SUBSCRIPTION_ACTIVATED",
        targetId: confirmed.value.subscriptionId,
      },
      {
        action: "SUBSCRIPTION_EXPIRED",
        targetId: data().downgrade.subscriptionId,
      },
    ]);
  });
});

async function seedTransitionFixtures(db: DatabaseClient) {
  const reviewer = await createUser(db, "tax-reviewer", "ADMIN");
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
  const plans = {
    free: await createPlanVersion(db, {
      code: "FREE_BASIC",
      name: "Free Basic",
      isDefaultFree: true,
      netPriceRappen: 0,
      activeJobLimit: 1,
      seatLimit: 1,
      talentRadarAccess: false,
      contactAllowance: 0,
      boostAllowance: 0,
    }),
    starter: await createPlanVersion(db, {
      code: "STARTER",
      name: "Starter",
      isDefaultFree: false,
      netPriceRappen: 14_900,
      activeJobLimit: 3,
      seatLimit: 2,
      talentRadarAccess: false,
      contactAllowance: 4,
      boostAllowance: 2,
    }),
    pro: await createPlanVersion(db, {
      code: "PRO",
      name: "Pro",
      isDefaultFree: false,
      netPriceRappen: 39_900,
      activeJobLimit: 10,
      seatLimit: 10,
      talentRadarAccess: true,
      contactAllowance: 10,
      boostAllowance: 5,
    }),
  };
  void plans.free;
  await createTaxRate(db, reviewer.id);

  const free = await createCompanyOwnerFixture(db, {
    suffix: "free",
    cantonId: canton.id,
    cityId: city.id,
  });
  const upgrade = await createCompanyOwnerFixture(db, {
    suffix: "upgrade",
    cantonId: canton.id,
    cityId: city.id,
  });
  const upgradeSubscription = await createPaidSubscription(db, {
    companyId: upgrade.actor.companyId,
    planVersionId: plans.starter.id,
    netPriceRappen: 14_900,
  });

  const downgrade = await createCompanyOwnerFixture(db, {
    suffix: "downgrade",
    cantonId: canton.id,
    cityId: city.id,
  });
  const adminUser = await createUser(db, "downgrade-admin", "ADMIN");
  const recruiterUser = await createUser(db, "downgrade-recruiter");
  const viewerUser = await createUser(db, "downgrade-viewer");
  const adminMembership = await createMembership(db, {
    companyId: downgrade.actor.companyId,
    userId: adminUser.id,
    role: "ADMIN",
    joinedAt: new Date("2025-02-01T00:00:00.000Z"),
  });
  const recruiterMembership = await createMembership(db, {
    companyId: downgrade.actor.companyId,
    userId: recruiterUser.id,
    role: "RECRUITER",
    joinedAt: new Date("2025-03-01T00:00:00.000Z"),
  });
  const viewerMembership = await createMembership(db, {
    companyId: downgrade.actor.companyId,
    userId: viewerUser.id,
    role: "VIEWER",
    joinedAt: new Date("2025-04-01T00:00:00.000Z"),
  });
  const pendingInvitation = await db.companyInvitation.create({
    data: {
      companyId: downgrade.actor.companyId,
      inviterUserId: downgrade.actor.userId,
      inviteeEmailNormalized: "phase12-transition-pending@example.ch",
      intendedRole: "RECRUITER",
      tokenHash: "b".repeat(64),
      status: "PENDING",
      expiresAt: new Date("2026-09-15T00:00:00.000Z"),
    },
  });
  const downgradeSubscription = await createPaidSubscription(db, {
    companyId: downgrade.actor.companyId,
    planVersionId: plans.pro.id,
    netPriceRappen: 39_900,
  });

  const foreign = await createCompanyOwnerFixture(db, {
    suffix: "foreign",
    cantonId: canton.id,
    cityId: city.id,
  });

  return Object.freeze({
    adminActor: Object.freeze({
      userId: reviewer.id,
      email: reviewer.email,
      role: reviewer.role,
      status: reviewer.status,
    }),
    free,
    upgrade: Object.freeze({
      actor: upgrade.actor,
      subscriptionId: upgradeSubscription.id,
    }),
    downgrade: Object.freeze({
      ownerActor: downgrade.actor,
      adminActor: Object.freeze({
        userId: adminUser.id,
        email: adminUser.email,
        companyId: downgrade.actor.companyId,
        membershipId: adminMembership.id,
        membershipRole: "ADMIN" as const,
      }),
      recruiterMembershipId: recruiterMembership.id,
      viewerMembershipId: viewerMembership.id,
      pendingInvitationId: pendingInvitation.id,
      subscriptionId: downgradeSubscription.id,
    }),
    foreignOwnerMembershipId: foreign.actor.membershipId,
  });
}

async function createCompanyOwnerFixture(
  db: DatabaseClient,
  input: Readonly<{ suffix: string; cantonId: string; cityId: string }>,
) {
  const owner = await createUser(db, `${input.suffix}-owner`);
  const company = await createActiveCompany(db, input);
  const membership = await createMembership(db, {
    companyId: company.id,
    userId: owner.id,
    role: "OWNER",
    joinedAt: new Date("2025-01-01T00:00:00.000Z"),
  });
  await db.companyBillingProfile.create({
    data: {
      companyId: company.id,
      legalName: `Phase 12 ${input.suffix} AG`,
      billingContactEmail: owner.email,
      street: "Teststrasse 12",
      postalCode: "8000",
      city: "Zürich",
      countryCode: "CH",
    },
  });
  return Object.freeze({
    actor: Object.freeze({
      userId: owner.id,
      email: owner.email,
      companyId: company.id,
      membershipId: membership.id,
      membershipRole: "OWNER" as const,
    }),
  });
}

async function createActiveCompany(
  db: DatabaseClient,
  input: Readonly<{ suffix: string; cantonId: string; cityId: string }>,
) {
  const company = await db.company.create({
    data: {
      name: `Phase 12 ${input.suffix} AG`,
      slug: `phase12-transition-${input.suffix}`,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Deterministische ADR-028-Testfirma.",
      website: "https://example.ch",
      values: [],
      benefits: [],
    },
  });
  await db.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: input.cantonId,
      cityId: input.cityId,
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

function createMembership(
  db: DatabaseClient,
  input: Readonly<{
    companyId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
    joinedAt: Date;
  }>,
) {
  return db.companyMembership.create({
    data: { ...input, status: "ACTIVE" },
  });
}

function createUser(
  db: DatabaseClient,
  suffix: string,
  role: "EMPLOYER" | "ADMIN" = "EMPLOYER",
) {
  const email = `phase12-transition-${suffix}@example.ch`;
  return db.user.create({
    data: { email, emailNormalized: email, role, status: "ACTIVE" },
  });
}

function createPaidSubscription(
  db: DatabaseClient,
  input: Readonly<{
    companyId: string;
    planVersionId: string;
    netPriceRappen: number;
  }>,
) {
  return db.employerSubscription.create({
    data: {
      companyId: input.companyId,
      planVersionId: input.planVersionId,
      status: "ACTIVE",
      currentPeriodStart: PAID_PERIOD_START,
      currentPeriodEnd: PAID_PERIOD_END,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: input.netPriceRappen,
      monthlyEquivalentRappenSnapshot: input.netPriceRappen,
      currencySnapshot: "CHF",
      activatedAt: PAID_PERIOD_START,
    },
  });
}

async function createPlanVersion(
  db: DatabaseClient,
  input: Readonly<{
    code: string;
    name: string;
    isDefaultFree: boolean;
    netPriceRappen: number;
    activeJobLimit: number;
    seatLimit: number;
    talentRadarAccess: boolean;
    contactAllowance: number;
    boostAllowance: number;
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
          booleanEntitlement("TALENT_RADAR_ACCESS", input.talentRadarAccess),
          integerEntitlement(
            "TALENT_CONTACT_ALLOWANCE",
            input.contactAllowance,
          ),
          integerEntitlement("JOB_BOOST_ALLOWANCE", input.boostAllowance),
          {
            key: "ANALYTICS_LEVEL",
            valueType: "ANALYTICS_LEVEL",
            analyticsLevelValue: input.code === "PRO" ? "ADVANCED" : "BASIC",
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

async function createTaxRate(db: DatabaseClient, reviewerId: string) {
  const rate = await db.taxRateVersion.create({
    data: {
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_DEMO",
      rateBasisPoints: 810,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "Fiktive ADR-028-Testannahme",
      reviewStatus: "DRAFT",
    },
  });
  await db.taxRateVersion.update({
    where: { id: rate.id },
    data: {
      reviewStatus: "APPROVED",
      reviewedByUserId: reviewerId,
      reviewedAt: new Date("2026-01-01T00:01:00.000Z"),
    },
  });
}

function integerEntitlement(
  key:
    | "ACTIVE_JOB_LIMIT"
    | "SEAT_LIMIT"
    | "TALENT_CONTACT_ALLOWANCE"
    | "JOB_BOOST_ALLOWANCE",
  value: number,
) {
  return { key, valueType: "INTEGER" as const, integerValue: value };
}

function booleanEntitlement(
  key:
    | "TALENT_RADAR_ACCESS"
    | "ENHANCED_COMPANY_PROFILE"
    | "EMPLOYER_IMPORT_ACCESS",
  value: boolean,
) {
  return { key, valueType: "BOOLEAN" as const, booleanValue: value };
}
