import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runCommercialLifecycleSignals } from "@/lib/analytics/commercial-signals";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { EmailProvider } from "@/lib/providers/email";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const NOW = new Date("2026-07-21T10:00:00.000Z");
const PERIOD_START = new Date(NOW.getTime() - 2 * DAY);
const dateAfterDays = (days: number) => new Date(NOW.getTime() + days * DAY);
const id = (sequence: number) =>
  `c1200000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const IDS = Object.freeze({
  suspendedAdmin: id(1),
  activeAdmin: id(2),
  canton: id(3),
  city: id(4),
  freePlan: id(5),
  freePlanVersion: id(6),
  paidPlan: id(7),
  paidPlanVersion: id(8),
  company30: id(10),
  company14: id(11),
  company7: id(12),
  usageCompany: id(13),
  suspendedCompany: id(14),
  demoCompany: id(15),
  cancelledCompany: id(16),
  endedCompany: id(17),
  outsideWindowCompany: id(18),
  freeUsageCompany: id(19),
  subscription30: id(30),
  subscription14: id(31),
  subscription7: id(32),
  usageSubscription: id(33),
  suspendedSubscription: id(34),
  demoSubscription: id(35),
  cancelledSubscription: id(36),
  endedSubscription: id(37),
  outsideWindowSubscription: id(38),
  credit14Account: id(40),
  credit14Grant: id(41),
  credit7Account: id(42),
  credit7Grant: id(43),
  credit14BoostAccount: id(44),
  credit14BoostGrant: id(45),
  usageOwner: id(50),
  usageRecruiterA: id(51),
  usageRecruiterB: id(52),
  usageRecruiterC: id(53),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_commercial_signals");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await seedCommercialSignalFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 commercial lifecycle signals", () => {
  it("persists exact live signals once and heals an email failure idempotently", async () => {
    const sentEmails: Array<Parameters<EmailProvider["send"]>[0]> = [];
    const recordedEmailKeys = new Set<string>();
    let failFirstAttempt = true;
    const emailProvider: EmailProvider = Object.freeze({
      async send(input: Parameters<EmailProvider["send"]>[0]) {
        sentEmails.push(input);
        const key = String(input.data.idempotencyKey);
        if (failFirstAttempt) {
          failFirstAttempt = false;
          throw new Error("simulated email persistence interruption");
        }
        const created = !recordedEmailKeys.has(key);
        recordedEmailKeys.add(key);
        return { logId: `commercial-email-${key}`, created };
      },
    });
    const first = await runCommercialLifecycleSignals({
      correlationId: id(80),
      database: db(),
      emailProvider,
      includeDemo: false,
      now: NOW,
    });

    expect(first).toEqual({
      candidates: 9,
      created: 9,
      emailsRecorded: 8,
      existing: 0,
    });

    const tasks = await db().systemTask.findMany({
      where: { policyVersion: "COMMERCIAL_LIFECYCLE_V1" },
      orderBy: [{ reasonCode: "asc" }, { companyId: "asc" }],
      select: {
        id: true,
        companyId: true,
        dueAt: true,
        evidenceReference: true,
        idempotencyKey: true,
        ownerUserId: true,
        reasonCode: true,
        status: true,
        thresholdCode: true,
      },
    });
    expect(tasks).toHaveLength(9);
    expect(
      tasks.map(({ companyId, dueAt, reasonCode, thresholdCode }) => ({
        companyId,
        dueAt,
        reasonCode,
        thresholdCode,
      })),
    ).toEqual([
      {
        companyId: IDS.company14,
        dueAt: dateAfterDays(14),
        reasonCode: "CREDIT_EXPIRY_14D",
        thresholdCode: "14D",
      },
      {
        companyId: IDS.company7,
        dueAt: dateAfterDays(7),
        reasonCode: "CREDIT_EXPIRY_7D",
        thresholdCode: "7D",
      },
      {
        companyId: IDS.outsideWindowCompany,
        dueAt: NOW,
        reasonCode: "PAID_COMPANY_INACTIVE_30D",
        thresholdCode: "30D",
      },
      {
        companyId: IDS.usageCompany,
        dueAt: dateAfterDays(7),
        reasonCode: "SEAT_LIMIT_80",
        thresholdCode: "80_PERCENT",
      },
      {
        companyId: IDS.freeUsageCompany,
        dueAt: dateAfterDays(7),
        reasonCode: "SEAT_LIMIT_80",
        thresholdCode: "80_PERCENT",
      },
      {
        companyId: IDS.cancelledCompany,
        dueAt: dateAfterDays(29),
        reasonCode: "SUBSCRIPTION_CANCELLING",
        thresholdCode: "CANCELLING",
      },
      {
        companyId: IDS.company14,
        dueAt: dateAfterDays(14),
        reasonCode: "SUBSCRIPTION_END_14D",
        thresholdCode: "14D",
      },
      {
        companyId: IDS.company30,
        dueAt: dateAfterDays(30),
        reasonCode: "SUBSCRIPTION_END_30D",
        thresholdCode: "30D",
      },
      {
        companyId: IDS.company7,
        dueAt: dateAfterDays(7),
        reasonCode: "SUBSCRIPTION_END_7D",
        thresholdCode: "7D",
      },
    ]);
    expect(tasks.every((task) => task.status === "ASSIGNED")).toBe(true);
    expect(tasks.every((task) => task.ownerUserId === IDS.activeAdmin)).toBe(true);

    const seatTask = tasks.find(
      (task) =>
        task.reasonCode === "SEAT_LIMIT_80" &&
        task.companyId === IDS.usageCompany,
    );
    expect(seatTask).toEqual(
      expect.objectContaining({
        companyId: IDS.usageCompany,
        evidenceReference: `subscription:${IDS.usageSubscription}:seats:4/5`,
      }),
    );
    const freeSeatTask = tasks.find(
      (task) =>
        task.reasonCode === "SEAT_LIMIT_80" &&
        task.companyId === IDS.freeUsageCompany,
    );
    expect(freeSeatTask).toEqual(
      expect.objectContaining({
        companyId: IDS.freeUsageCompany,
        evidenceReference: `plan-version:${IDS.freePlanVersion}:seats:4/5`,
      }),
    );
    expect(
      tasks.find(
        (task) =>
          task.companyId === IDS.company14 &&
          task.reasonCode === "CREDIT_EXPIRY_14D",
      ),
    ).toEqual(
      expect.objectContaining({
        evidenceReference:
          "credit-expiry:2026-08-04:JOB_BOOST+TALENT_CONTACT:2-grants",
      }),
    );
    expect(
      await db().systemTask.count({
        where: {
          companyId: {
            in: [
              IDS.company30,
              IDS.company14,
              IDS.company7,
              IDS.suspendedCompany,
              IDS.demoCompany,
              IDS.cancelledCompany,
              IDS.endedCompany,
              IDS.outsideWindowCompany,
            ],
          },
          reasonCode: { in: ["ACTIVE_JOB_LIMIT_80", "SEAT_LIMIT_80"] },
        },
      }),
    ).toBe(0);
    expect(
      await db().systemTask.count({
        where: {
          companyId: {
            in: [
              IDS.suspendedCompany,
              IDS.demoCompany,
              IDS.endedCompany,
            ],
          },
        },
      }),
    ).toBe(0);

    const taskIds = tasks.map((task) => task.id);
    const taskKeys = tasks.map((task) => task.idempotencyKey).sort();
    expect(new Set(taskKeys).size).toBe(9);
    await expect(
      db().notification.count({
        where: {
          recipientUserId: IDS.activeAdmin,
          kind: "SYSTEM_TASK_ASSIGNED",
          dedupeKey: { in: taskKeys },
        },
      }),
    ).resolves.toBe(9);
    await expect(
      db().notification.count({ where: { recipientUserId: IDS.suspendedAdmin } }),
    ).resolves.toBe(0);
    await expect(
      db().auditLog.count({
        where: {
          action: "SYSTEM_TASK_ASSIGNED",
          capability: "COMMERCIAL_SIGNAL_PROJECT",
          targetId: { in: taskIds },
        },
      }),
    ).resolves.toBe(9);
    expect(sentEmails).toHaveLength(9);
    expect(recordedEmailKeys.size).toBe(8);
    expect(new Set(sentEmails.map((email) => email.data.idempotencyKey))).toEqual(
      new Set(taskKeys),
    );

    const retry = await runCommercialLifecycleSignals({
      correlationId: id(81),
      database: db(),
      emailProvider,
      includeDemo: false,
      now: NOW,
    });
    expect(retry).toEqual({
      candidates: 9,
      created: 0,
      emailsRecorded: 1,
      existing: 9,
    });
    expect(sentEmails).toHaveLength(18);
    expect(recordedEmailKeys.size).toBe(9);
    await expect(
      db().systemTask.count({ where: { id: { in: taskIds } } }),
    ).resolves.toBe(9);
    await expect(
      db().notification.count({
        where: { kind: "SYSTEM_TASK_ASSIGNED", dedupeKey: { in: taskKeys } },
      }),
    ).resolves.toBe(9);
    await expect(
      db().auditLog.count({
        where: { action: "SYSTEM_TASK_ASSIGNED", targetId: { in: taskIds } },
      }),
    ).resolves.toBe(9);

    const completedTask = tasks.find(
      (task) => task.reasonCode === "SUBSCRIPTION_CANCELLING",
    );
    if (completedTask === undefined) throw new Error("Cancelling task missing.");
    await db().systemTask.update({
      where: { id: completedTask.id },
      data: { status: "DONE", outcomeCode: "RETAINED" },
    });

    const ordinaryRetry = await runCommercialLifecycleSignals({
      correlationId: id(82),
      database: db(),
      emailProvider,
      includeDemo: false,
      now: NOW,
    });
    expect(ordinaryRetry).toEqual({
      candidates: 9,
      created: 0,
      emailsRecorded: 0,
      existing: 9,
    });
    expect(sentEmails).toHaveLength(26);
    expect(recordedEmailKeys.size).toBe(9);
    await expect(
      db().systemTask.count({ where: { id: completedTask.id, status: "DONE" } }),
    ).resolves.toBe(1);
  });
});

async function seedCommercialSignalFixtures(client: DatabaseClient) {
  await client.user.createMany({
    data: [
      {
        id: IDS.suspendedAdmin,
        email: "suspended-commercial-admin@example.ch",
        emailNormalized: "suspended-commercial-admin@example.ch",
        role: "ADMIN",
        status: "SUSPENDED",
        dataProvenance: "TEST",
        createdAt: new Date(NOW.getTime() - 10 * DAY),
      },
      {
        id: IDS.activeAdmin,
        email: "active-commercial-admin@example.ch",
        emailNormalized: "active-commercial-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
        createdAt: new Date(NOW.getTime() - 9 * DAY),
      },
    ],
  });
  await client.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "commercial-signals-zuerich",
      language: "DE",
    },
  });
  await client.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zürich Commercial Signals",
      slug: "commercial-signals-zuerich",
    },
  });

  const companies = [
    [IDS.company30, "Commercial 30 AG", "commercial-30", "LIVE"],
    [IDS.company14, "Commercial 14 AG", "commercial-14", "LIVE"],
    [IDS.company7, "Commercial 7 AG", "commercial-7", "LIVE"],
    [IDS.usageCompany, "Commercial Usage AG", "commercial-usage", "LIVE"],
    [IDS.suspendedCompany, "Commercial Suspended AG", "commercial-suspended", "LIVE"],
    [IDS.demoCompany, "Commercial Demo AG", "commercial-demo", "DEMO"],
    [IDS.cancelledCompany, "Commercial Cancelled AG", "commercial-cancelled", "LIVE"],
    [IDS.endedCompany, "Commercial Ended AG", "commercial-ended", "LIVE"],
    [IDS.outsideWindowCompany, "Commercial Outside AG", "commercial-outside", "LIVE"],
    [IDS.freeUsageCompany, "Commercial Free Usage AG", "commercial-free-usage", "LIVE"],
  ] as const;
  for (const [companyId, name, slug, dataProvenance] of companies) {
    await client.company.create({
      data: {
        id: companyId,
        name,
        slug,
        industry: "Technology",
        size: "10-49",
        website: `https://${slug}.example.test`,
        about: "A complete company profile for commercial signal persistence tests.",
        values: [],
        benefits: [],
        status: "DRAFT",
        dataProvenance,
      },
    });
    await client.companyLocation.create({
      data: {
        companyId,
        cantonId: IDS.canton,
        cityId: IDS.city,
        address: "Teststrasse 12",
        postalCode: "8000",
        isPrimary: true,
      },
    });
    await client.company.update({
      where: { id: companyId },
      data: { status: "ACTIVE" },
    });
  }
  await client.company.update({
    where: { id: IDS.suspendedCompany },
    data: { status: "SUSPENDED" },
  });

  await createPlanVersion(client, {
    planId: IDS.freePlan,
    planVersionId: IDS.freePlanVersion,
    code: "FREE_COMMERCIAL_TEST",
    name: "Free Commercial Test",
    isDefaultFree: true,
    netPriceRappen: 0,
  });
  await createPlanVersion(client, {
    planId: IDS.paidPlan,
    planVersionId: IDS.paidPlanVersion,
    code: "STARTER_COMMERCIAL_TEST",
    name: "Starter Commercial Test",
    isDefaultFree: false,
    netPriceRappen: 14_900,
  });

  await createSubscription(client, IDS.subscription30, IDS.company30, "ACTIVE", dateAfterDays(30));
  await createSubscription(client, IDS.subscription14, IDS.company14, "ACTIVE", dateAfterDays(14));
  await createSubscription(client, IDS.subscription7, IDS.company7, "ACTIVE", dateAfterDays(7));
  await createSubscription(client, IDS.usageSubscription, IDS.usageCompany, "ACTIVE", dateAfterDays(29));
  await createSubscription(client, IDS.suspendedSubscription, IDS.suspendedCompany, "ACTIVE", dateAfterDays(30));
  await createSubscription(client, IDS.demoSubscription, IDS.demoCompany, "ACTIVE", dateAfterDays(30));
  await createSubscription(client, IDS.cancelledSubscription, IDS.cancelledCompany, "CANCELLING", dateAfterDays(29));
  await createSubscription(client, IDS.endedSubscription, IDS.endedCompany, "ACTIVE", NOW);
  await createSubscription(
    client,
    IDS.outsideWindowSubscription,
    IDS.outsideWindowCompany,
    "ACTIVE",
    dateAfterDays(31),
    new Date(NOW.getTime() - 31 * DAY),
  );

  await createPlanAllowanceGrant(client, {
    accountId: IDS.credit14Account,
    companyId: IDS.company14,
    grantId: IDS.credit14Grant,
    subscriptionId: IDS.subscription14,
    validTo: dateAfterDays(14),
  });
  await createPlanAllowanceGrant(client, {
    accountId: IDS.credit14BoostAccount,
    companyId: IDS.company14,
    creditType: "JOB_BOOST",
    grantId: IDS.credit14BoostGrant,
    amount: 1,
    subscriptionId: IDS.subscription14,
    validTo: dateAfterDays(14),
  });
  await createPlanAllowanceGrant(client, {
    accountId: IDS.credit7Account,
    companyId: IDS.company7,
    grantId: IDS.credit7Grant,
    subscriptionId: IDS.subscription7,
    validTo: dateAfterDays(7),
  });

  await client.user.createMany({
    data: ([
      [IDS.usageOwner, "usage-owner@example.ch", "EMPLOYER"],
      [IDS.usageRecruiterA, "usage-a@example.ch", "RECRUITER"],
      [IDS.usageRecruiterB, "usage-b@example.ch", "RECRUITER"],
      [IDS.usageRecruiterC, "usage-c@example.ch", "RECRUITER"],
    ] as const).map(([userId, email, role]) => ({
      id: userId,
      email,
      emailNormalized: email,
      role,
      status: "ACTIVE" as const,
      dataProvenance: "TEST" as const,
      lastLoginAt: NOW,
    })),
  });
  await client.companyMembership.createMany({
    data: ([
      [IDS.usageOwner, "OWNER"],
      [IDS.usageRecruiterA, "RECRUITER"],
      [IDS.usageRecruiterB, "RECRUITER"],
      [IDS.usageRecruiterC, "RECRUITER"],
    ] as const).flatMap(([userId, role]) =>
      [IDS.usageCompany, IDS.freeUsageCompany].map((companyId) => ({
        companyId,
        userId,
        role,
        status: "ACTIVE" as const,
        joinedAt: PERIOD_START,
      })),
    ),
  });
}

async function createPlanVersion(
  client: DatabaseClient,
  input: Readonly<{
    code: string;
    isDefaultFree: boolean;
    name: string;
    netPriceRappen: number;
    planId: string;
    planVersionId: string;
  }>,
) {
  await client.plan.create({
    data: {
      id: input.planId,
      code: input.code,
      name: input.name,
      isDefaultFree: input.isDefaultFree,
    },
  });
  await client.planVersion.create({
    data: {
      id: input.planVersionId,
      planId: input.planId,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: input.netPriceRappen,
      monthlyEquivalentRappen: input.netPriceRappen,
      currency: "CHF",
      isPublic: true,
      isSelfService: true,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await client.planEntitlement.createMany({
    data: [
      {
        planVersionId: input.planVersionId,
        key: "ACTIVE_JOB_LIMIT",
        valueType: "INTEGER",
        integerValue: 5,
      },
      {
        planVersionId: input.planVersionId,
        key: "SEAT_LIMIT",
        valueType: "INTEGER",
        integerValue: 5,
      },
      {
        planVersionId: input.planVersionId,
        key: "TALENT_RADAR_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: true,
      },
      {
        planVersionId: input.planVersionId,
        key: "TALENT_CONTACT_ALLOWANCE",
        valueType: "INTEGER",
        integerValue: 10,
      },
      {
        planVersionId: input.planVersionId,
        key: "JOB_BOOST_ALLOWANCE",
        valueType: "INTEGER",
        integerValue: 1,
      },
      {
        planVersionId: input.planVersionId,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "BASIC",
      },
      {
        planVersionId: input.planVersionId,
        key: "ENHANCED_COMPANY_PROFILE",
        valueType: "BOOLEAN",
        booleanValue: false,
      },
      {
        planVersionId: input.planVersionId,
        key: "EMPLOYER_IMPORT_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: false,
      },
    ],
  });
  await client.planVersion.update({
    where: { id: input.planVersionId },
    data: { status: "ACTIVE" },
  });
}

async function createSubscription(
  client: DatabaseClient,
  subscriptionId: string,
  companyId: string,
  status: "ACTIVE" | "CANCELLING" | "CANCELLED",
  currentPeriodEnd: Date,
  currentPeriodStart: Date = PERIOD_START,
) {
  await client.employerSubscription.create({
    data: {
      id: subscriptionId,
      companyId,
      planVersionId: IDS.paidPlanVersion,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 14_900,
      monthlyEquivalentRappenSnapshot: 14_900,
      currencySnapshot: "CHF",
      activatedAt: currentPeriodStart,
      endedAt: status === "CANCELLED" ? NOW : null,
    },
  });
}

async function createPlanAllowanceGrant(
  client: DatabaseClient,
  input: Readonly<{
    accountId: string;
    amount?: number;
    companyId: string;
    creditType?: "TALENT_CONTACT" | "JOB_BOOST";
    grantId: string;
    subscriptionId: string;
    validTo: Date;
  }>,
) {
  await client.creditAccount.create({
    data: {
      id: input.accountId,
      companyId: input.companyId,
      creditType: input.creditType ?? "TALENT_CONTACT",
      fundingSource: "PLAN_ALLOWANCE",
      periodStart: PERIOD_START,
      periodEnd: input.validTo,
    },
  });
  await client.creditLedgerEntry.create({
    data: {
      id: input.grantId,
      accountId: input.accountId,
      fundingSource: "PLAN_ALLOWANCE",
      kind: "GRANT",
      amount: input.amount ?? 5,
      sourcePlanVersionId: IDS.paidPlanVersion,
      sourceSubscriptionId: input.subscriptionId,
      validFrom: PERIOD_START,
      validTo: input.validTo,
      idempotencyKey: `commercial-grant:${input.grantId}`,
      reasonCode: "PLAN_ALLOWANCE",
      createdAt: PERIOD_START,
    },
  });
}

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Commercial signal integration database unavailable.");
  }
  return database;
}
