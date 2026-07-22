import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  activateBoostWithCredit,
  cancelEmployerBoost,
  syncBoostStatusProjection,
} from "@/lib/billing/boosts";
import { confirmMockPayment, createCheckoutOrder } from "@/lib/billing/orders";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { EmailProvider } from "@/lib/providers/email";
import { MockPaymentProvider } from "@/lib/providers/payments";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const NOW = new Date("2026-07-22T10:00:00.000Z");
const IDS = {
  user: "d1300000-0000-4000-8000-000000000001",
  company: "d1300000-0000-4000-8000-000000000002",
  membership: "d1300000-0000-4000-8000-000000000003",
  canton: "d1300000-0000-4000-8000-000000000004",
  city: "d1300000-0000-4000-8000-000000000005",
  category: "d1300000-0000-4000-8000-000000000006",
  location: "d1300000-0000-4000-8000-000000000007",
  verification: "d1300000-0000-4000-8000-000000000008",
  job: "d1300000-0000-4000-8000-000000000009",
  revision: "d1300000-0000-4000-8000-000000000010",
  score: "d1300000-0000-4000-8000-000000000011",
  account: "d1300000-0000-4000-8000-000000000012",
  grant: "d1300000-0000-4000-8000-000000000013",
} as const;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const emailProvider: EmailProvider = Object.freeze({
  send: vi.fn(async () => ({ logId: randomUUID(), created: true })),
});

function db() {
  if (database === undefined) throw new Error("Phase 13 integration database unavailable.");
  return database;
}

function pool(): Pool {
  if (migrated === undefined) throw new Error("Phase 13 integration pool unavailable.");
  return migrated.pool;
}

function dependencies(now: Date, _correlationId: string) {
  return {
    actor: {
      userId: IDS.user,
      email: "phase13-owner@example.test",
      companyId: IDS.company,
      membershipId: IDS.membership,
      membershipRole: "OWNER" as const,
    },
    correlationId: randomUUID(),
    database: db(),
    emailProvider,
    now,
  };
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase13_job_boosts");
  database = createDatabaseClient(migrated.connectionString);
  await seed(pool(), db());
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 13 Job Boost PostgreSQL lifecycle", () => {
  it("serializes parallel redemptions, permits adjacency, projects once and never refunds cancellation", async () => {
    const parallel = await Promise.all([
      activateBoostWithCredit(
        { jobId: IDS.job, idempotencyKey: "phase13-parallel-a" },
        dependencies(NOW, "phase13-parallel-a"),
      ),
      activateBoostWithCredit(
        { jobId: IDS.job, idempotencyKey: "phase13-parallel-b" },
        dependencies(NOW, "phase13-parallel-b"),
      ),
    ]);
    const successes = parallel.filter((result) => result.ok);
    const failures = parallel.filter((result) => !result.ok);
    expect(successes, JSON.stringify(parallel)).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ok: false, code: "OVERLAPPING_BOOST" });

    const first = successes[0];
    if (first === undefined || !first.ok) throw new Error("Expected one first Boost.");
    expect(first.value.endsAt).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(first.value.fundingSource).toBe("ADMIN_GRANT");
    expect(await db().jobBoost.count({ where: { jobId: IDS.job } })).toBe(1);
    expect(await db().creditLedgerEntry.count({
      where: { consumedGrantEntryId: IDS.grant, kind: "CONSUME" },
    })).toBe(1);

    const winnerKey = first.value.boostId === (parallel[0].ok ? parallel[0].value.boostId : "")
      ? "phase13-parallel-a"
      : "phase13-parallel-b";
    const exactReplay = await activateBoostWithCredit(
      { jobId: IDS.job, idempotencyKey: winnerKey },
      dependencies(new Date(NOW.getTime() + 60_000), "phase13-exact-replay"),
    );
    expect(exactReplay).toMatchObject({ ok: true, replay: true });

    const adjacentAt = first.value.endsAt;
    const adjacent = await activateBoostWithCredit(
      { jobId: IDS.job, idempotencyKey: "phase13-adjacent" },
      dependencies(adjacentAt, "phase13-adjacent"),
    );
    expect(adjacent).toMatchObject({
      ok: true,
      value: { startsAt: adjacentAt },
    });
    if (!adjacent.ok) throw new Error("Expected adjacent Boost.");
    expect(await db().jobBoost.count({ where: { jobId: IDS.job } })).toBe(2);

    const projection = await syncBoostStatusProjection({
      database: db(),
      correlationId: randomUUID(),
      now: adjacentAt,
    });
    expect(projection).toEqual({ activated: 0, expired: 1 });
    await expect(syncBoostStatusProjection({
      database: db(),
      correlationId: randomUUID(),
      now: adjacentAt,
    })).resolves.toEqual({ activated: 0, expired: 0 });

    const beforeCancelConsumes = await db().creditLedgerEntry.count({
      where: { consumedGrantEntryId: IDS.grant, kind: "CONSUME" },
    });
    const cancelled = await cancelEmployerBoost(
      {
        boostId: adjacent.value.boostId,
        reason: "Priorität der Stelle wurde geändert.",
        idempotencyKey: "phase13-cancel-adjacent",
      },
      dependencies(new Date(adjacentAt.getTime() + 1_000), "phase13-cancel"),
    );
    expect(cancelled).toMatchObject({ ok: true });
    expect(await db().creditLedgerEntry.count({
      where: { consumedGrantEntryId: IDS.grant, kind: "CONSUME" },
    })).toBe(beforeCancelConsumes);
    expect(await db().jobBoost.findUnique({
      where: { id: adjacent.value.boostId },
      select: { status: true, cancellationReason: true },
    })).toEqual({
      status: "CANCELLED",
      cancellationReason: "Priorität der Stelle wurde geändert.",
    });
    expect(await db().auditLog.count({
      where: { action: "JOB_BOOST_CANCELLED", targetId: adjacent.value.boostId },
    })).toBe(1);
  });

  it("keeps expired history inside the non-cancelled exclusion constraint", async () => {
    const expired = await db().jobBoost.findFirstOrThrow({
      where: { jobId: IDS.job, status: "EXPIRED" },
      select: { startsAt: true, endsAt: true },
    });
    await expect(db().$transaction(async (transaction) => {
      const consume = await transaction.creditLedgerEntry.create({
        data: {
          accountId: IDS.account,
          fundingSource: "ADMIN_GRANT",
          kind: "CONSUME",
          amount: -1,
          consumedGrantEntryId: IDS.grant,
          validFrom: new Date(NOW.getTime() - DAY),
          validTo: new Date(NOW.getTime() + 40 * DAY),
          idempotencyKey: "phase13-overlap-expired-consume",
          reasonCode: "JOB_BOOST_ACTIVATED",
          actorUserId: IDS.user,
          createdAt: new Date(NOW.getTime() + 2_000),
        },
      });
      await transaction.jobBoost.create({
        data: {
          jobId: IDS.job,
          companyId: IDS.company,
          consumedCreditLedgerEntryId: consume.id,
          idempotencyKey: "phase13-overlap-expired",
          startsAt: expired.startsAt,
          endsAt: expired.endsAt,
          status: "EXPIRED",
          createdAt: new Date(NOW.getTime() + 2_000),
        },
      });
    })).rejects.toThrow();
    expect(await db().creditLedgerEntry.count({
      where: { idempotencyKey: "phase13-overlap-expired-consume" },
    })).toBe(0);
  });

  it("stores the authorized target and fulfills a paid 30-day Boost exactly once", async () => {
    const cashNow = new Date(NOW.getTime() + 14 * DAY);
    const billingDependencies = Object.freeze({
      ...dependencies(cashNow, "phase13-cash"),
      paymentProvider: new MockPaymentProvider(),
    });
    const checkout = await createCheckoutOrder({
      kind: "PRODUCT",
      productSlug: "boost-30d",
      quantity: 1,
      targetJobId: IDS.job,
      idempotencyKey: "phase13-cash-checkout",
    }, billingDependencies);
    expect(checkout).toMatchObject({ ok: true, value: { status: "PENDING" } });
    if (!checkout.ok) throw new Error("Expected a paid Boost checkout.");
    const line = await db().orderLine.findFirstOrThrow({
      where: { orderId: checkout.value.orderId },
      select: { id: true, targetJobId: true, fulfillmentContext: true },
    });
    expect(line).toMatchObject({
      targetJobId: IDS.job,
      fulfillmentContext: "JOB_BOOST",
    });

    const confirmation = {
      orderId: checkout.value.orderId,
      idempotencyKey: "phase13-cash-confirm",
    } as const;
    const confirmed = await confirmMockPayment(confirmation, billingDependencies);
    expect(confirmed).toMatchObject({
      ok: true,
      value: { jobBoostId: expect.any(String), emailsRecorded: true },
    });
    const replay = await confirmMockPayment(confirmation, billingDependencies);
    expect(replay).toMatchObject({ ok: true, replay: true });
    const paidBoosts = await db().jobBoost.findMany({
      where: { orderLineId: line.id },
      select: { startsAt: true, endsAt: true, status: true },
    });
    expect(paidBoosts).toEqual([{
      startsAt: cashNow,
      endsAt: new Date(cashNow.getTime() + 30 * DAY),
      status: "ACTIVE",
    }]);
    expect(await db().auditLog.count({
      where: { action: "JOB_BOOST_ACTIVATED", targetType: "JOB_BOOST" },
    })).toBe(3);
  });
});

async function seed(target: Pool, client: DatabaseClient) {
  const publishedAt = new Date(NOW.getTime() - 20 * DAY);
  const validThrough = new Date(NOW.getTime() + 60 * DAY);
  await target.query(
    'INSERT INTO "User" ("id", "email", "emailNormalized", "role", "status", "dataProvenance", "updatedAt") VALUES ($1, $2, $2, \'EMPLOYER\', \'ACTIVE\', \'TEST\', $3)',
    [IDS.user, "phase13-owner@example.test", NOW],
  );
  await target.query(
    'INSERT INTO "Canton" ("id", "code", "name", "slug", "language", "updatedAt") VALUES ($1, \'ZH\', \'Zürich\', \'phase13-zuerich\', \'DE\', $2)',
    [IDS.canton, NOW],
  );
  await target.query(
    'INSERT INTO "City" ("id", "cantonId", "name", "slug", "updatedAt") VALUES ($1, $2, \'Zürich\', \'phase13-city\', $3)',
    [IDS.city, IDS.canton, NOW],
  );
  await target.query(
    'INSERT INTO "Category" ("id", "name", "slug", "isActive", "updatedAt") VALUES ($1, \'Engineering\', \'phase13-engineering\', true, $2)',
    [IDS.category, NOW],
  );
  await target.query(
    'INSERT INTO "Company" ("id", "name", "slug", "industry", "size", "website", "about", "values", "benefits", "status", "dataProvenance", "updatedAt") VALUES ($1, \'Phase 13 AG\', \'phase13-ag\', \'Software\', \'51-200\', \'https://phase13.example.test\', \'Complete integration company.\', ARRAY[\'Fairness\'], ARRAY[\'Flexibility\'], \'DRAFT\', \'TEST\', $2)',
    [IDS.company, NOW],
  );
  await target.query(
    'INSERT INTO "CompanyLocation" ("id", "companyId", "cantonId", "cityId", "address", "postalCode", "isPrimary", "updatedAt") VALUES ($1, $2, $3, $4, \'Teststrasse 13\', \'8000\', true, $5)',
    [IDS.location, IDS.company, IDS.canton, IDS.city, NOW],
  );
  await target.query(
    'INSERT INTO "CompanyMembership" ("id", "companyId", "userId", "role", "status", "updatedAt") VALUES ($1, $2, $3, \'OWNER\', \'ACTIVE\', $4)',
    [IDS.membership, IDS.company, IDS.user, NOW],
  );
  await target.query('UPDATE "Company" SET "status" = \'ACTIVE\', "updatedAt" = $2 WHERE "id" = $1', [IDS.company, NOW]);
  await target.query(
    'INSERT INTO "CompanyVerificationRequest" ("id", "companyId", "requestedByUserId", "status", "evidenceMetadata", "updatedAt") VALUES ($1, $2, $3, \'VERIFIED\', \'{"phase":13}\'::jsonb, $4)',
    [IDS.verification, IDS.company, IDS.user, NOW],
  );
  await target.query(
    'INSERT INTO "Job" ("id", "companyId", "slug", "status", "origin", "sourceReference", "dataProvenance", "createdByUserId", "updatedAt") VALUES ($1, $2, \'phase13-senior-engineer\', \'DRAFT\', \'MANUAL\', \'integration:phase13\', \'TEST\', $3, $4)',
    [IDS.job, IDS.company, IDS.user, NOW],
  );
  await target.query(
    [
      'INSERT INTO "JobRevision" ("id", "jobId", "revisionNumber", "title", "description", "tasks", "requirements", "applicationProcessSteps", "requiredDocumentKinds", "jobType", "remoteType", "categoryId", "cantonId", "cityId", "locationLabel", "workloadMin", "workloadMax", "salaryPeriod", "salaryMin", "salaryMax", "startByArrangement", "validThrough", "responseTargetDays", "applicationEffort", "inclusionStatement", "applicationContactKind", "applicationContactValue", "authoredByUserId", "contentChecksum", "submittedAt", "approvedAt", "createdAt")',
      'VALUES ($1, $2, 1, \'Senior Engineer\', \'A complete eligible job for Phase 13.\', ARRAY[\'Build products\'], ARRAY[\'PostgreSQL\'], ARRAY[\'Apply\'], ARRAY[\'CV\']::"RequiredDocumentKind"[], \'PERMANENT\', \'ONSITE\', $3, $4, $5, \'Zürich\', 80, 100, \'YEARLY\', 100000, 130000, false, $6, 7, \'SIMPLE\', \'Transparent and inclusive hiring process.\', \'EMAIL\', \'jobs@phase13.example.test\', $7, $8, $9, $10, $11)',
    ].join(" "),
    [IDS.revision, IDS.job, IDS.category, IDS.canton, IDS.city, validThrough, IDS.user, "b".repeat(64), new Date(publishedAt.getTime() - DAY), publishedAt, new Date(publishedAt.getTime() - 2 * DAY)],
  );
  await target.query(
    'UPDATE "Job" SET "status" = \'PUBLISHED\', "currentRevisionId" = $2, "publishedRevisionId" = $2, "publishedAt" = $3, "expiresAt" = $4, "publishedCategoryId" = $5, "publishedCantonId" = $6, "publishedCityId" = $7, "publishedSalaryPeriod" = \'YEARLY\', "publishedSalaryMin" = 100000, "publishedSalaryMax" = 130000, "updatedAt" = $8 WHERE "id" = $1',
    [IDS.job, IDS.revision, publishedAt, validThrough, IDS.category, IDS.canton, IDS.city, NOW],
  );
  await target.query(
    'INSERT INTO "JobScoreSnapshot" ("id", "jobRevisionId", "scoreVersion", "scorePoints", "maxPoints", "inputSnapshot", "evidence", "factorBreakdown", "evidenceHash", "calculatedAt") VALUES ($1, $2, \'v2\', 84, 100, \'{}\'::jsonb, \'{}\'::jsonb, \'{}\'::jsonb, $3, $4)',
    [IDS.score, IDS.revision, "c".repeat(64), publishedAt],
  );
  await client.creditAccount.create({
    data: {
      id: IDS.account,
      companyId: IDS.company,
      creditType: "JOB_BOOST",
      fundingSource: "ADMIN_GRANT",
      periodStart: new Date(NOW.getTime() - DAY),
      periodEnd: new Date(NOW.getTime() + 60 * DAY),
    },
  });
  await client.creditLedgerEntry.create({
    data: {
      id: IDS.grant,
      accountId: IDS.account,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount: 3,
      validFrom: new Date(NOW.getTime() - DAY),
      validTo: new Date(NOW.getTime() + 60 * DAY),
      idempotencyKey: "phase13-admin-grant",
      reasonCode: "CUSTOMER_SUCCESS_GRANT",
      actorUserId: IDS.user,
      createdAt: new Date(NOW.getTime() - DAY),
    },
  });
  await client.companyBillingProfile.create({
    data: {
      companyId: IDS.company,
      legalName: "Phase 13 AG",
      billingContactEmail: "billing@phase13.example.test",
      street: "Teststrasse 13",
      postalCode: "8000",
      city: "Zürich",
      countryCode: "CH",
    },
  });
  const product = await client.product.create({
    data: { code: "boost-30d", name: "Job Boost 30 Tage", type: "JOB_BOOST" },
  });
  const productVersion = await client.productVersion.create({
    data: {
      productId: product.id,
      version: 1,
      status: "DRAFT",
      netPriceRappen: 19_900,
      currency: "CHF",
      durationDays: 30,
      creditType: null,
      creditAmount: null,
      isPublic: true,
      isSelfService: true,
      requiresLegalReview: false,
      validFrom: new Date(NOW.getTime() - DAY),
    },
  });
  await client.productVersion.update({
    where: { id: productVersion.id },
    data: { status: "ACTIVE" },
  });
  const tax = await client.taxRateVersion.create({
    data: {
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_DEMO",
      rateBasisPoints: 810,
      validFrom: new Date(NOW.getTime() - DAY),
      source: "Phase 13 integration rate",
      reviewStatus: "DRAFT",
    },
  });
  await client.taxRateVersion.update({
    where: { id: tax.id },
    data: {
      reviewStatus: "APPROVED",
      reviewedByUserId: IDS.user,
      reviewedAt: NOW,
    },
  });
}
