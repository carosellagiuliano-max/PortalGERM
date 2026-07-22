import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { projectCatalogLifecycle } from "@/lib/billing/catalog-lifecycle";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const BOUNDARY = new Date("2026-09-01T00:00:00.000Z");
const BEFORE_BOUNDARY = new Date(BOUNDARY.getTime() - 1);
const OLD_FROM = new Date("2026-01-01T00:00:00.000Z");

const PLAN_ID = "12c00000-0000-4000-8000-000000000001";
const OLD_PLAN_VERSION_ID = "12c00000-0000-4000-8000-000000000002";
const NEXT_PLAN_VERSION_ID = "12c00000-0000-4000-8000-000000000003";
const PRODUCT_ID = "12c00000-0000-4000-8000-000000000004";
const OLD_PRODUCT_VERSION_ID = "12c00000-0000-4000-8000-000000000005";
const NEXT_PRODUCT_VERSION_ID = "12c00000-0000-4000-8000-000000000006";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function db() {
  if (database === undefined) {
    throw new Error("Catalog lifecycle test database is unavailable.");
  }
  return database;
}

function dependencies(now: Date) {
  return Object.freeze({
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_catalog_lifecycle");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await insertBoundaryFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 catalog lifecycle projector", () => {
  it("keeps the prior ACTIVE versions effective until the half-open boundary", async () => {
    await expect(
      projectCatalogLifecycle(dependencies(BEFORE_BOUNDARY)),
    ).resolves.toEqual({
      planActivatedCount: 0,
      planDeactivatedCount: 0,
      productActivatedCount: 0,
      productDeactivatedCount: 0,
    });

    await expect(effectivePlanVersionIds(PLAN_ID, BEFORE_BOUNDARY)).resolves.toEqual([
      OLD_PLAN_VERSION_ID,
    ]);
    await expect(
      effectiveProductVersionIds(PRODUCT_ID, BEFORE_BOUNDARY),
    ).resolves.toEqual([OLD_PRODUCT_VERSION_ID]);
    await expect(
      db().auditLog.count({
        where: {
          targetId: {
            in: [
              OLD_PLAN_VERSION_ID,
              NEXT_PLAN_VERSION_ID,
              OLD_PRODUCT_VERSION_ID,
              NEXT_PRODUCT_VERSION_ID,
            ],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it("serializes parallel exact-boundary retries and appends each transition audit once", async () => {
    const [left, right] = await Promise.all([
      projectCatalogLifecycle(dependencies(BOUNDARY)),
      projectCatalogLifecycle(dependencies(BOUNDARY)),
    ]);

    expect(sumResults(left, right)).toEqual({
      planActivatedCount: 1,
      planDeactivatedCount: 1,
      productActivatedCount: 1,
      productDeactivatedCount: 1,
    });
    await expect(
      projectCatalogLifecycle(dependencies(BOUNDARY)),
    ).resolves.toEqual({
      planActivatedCount: 0,
      planDeactivatedCount: 0,
      productActivatedCount: 0,
      productDeactivatedCount: 0,
    });

    await expect(effectivePlanVersionIds(PLAN_ID, BOUNDARY)).resolves.toEqual([
      NEXT_PLAN_VERSION_ID,
    ]);
    await expect(
      effectiveProductVersionIds(PRODUCT_ID, BOUNDARY),
    ).resolves.toEqual([NEXT_PRODUCT_VERSION_ID]);

    const versions = await Promise.all([
      db().planVersion.findUniqueOrThrow({
        where: { id: OLD_PLAN_VERSION_ID },
        select: { status: true },
      }),
      db().planVersion.findUniqueOrThrow({
        where: { id: NEXT_PLAN_VERSION_ID },
        select: { status: true },
      }),
      db().productVersion.findUniqueOrThrow({
        where: { id: OLD_PRODUCT_VERSION_ID },
        select: { status: true },
      }),
      db().productVersion.findUniqueOrThrow({
        where: { id: NEXT_PRODUCT_VERSION_ID },
        select: { status: true },
      }),
    ]);
    expect(versions).toEqual([
      { status: "INACTIVE" },
      { status: "ACTIVE" },
      { status: "INACTIVE" },
      { status: "ACTIVE" },
    ]);

    const audits = await db().auditLog.findMany({
      where: {
        targetId: {
          in: [
            OLD_PLAN_VERSION_ID,
            NEXT_PLAN_VERSION_ID,
            OLD_PRODUCT_VERSION_ID,
            NEXT_PRODUCT_VERSION_ID,
          ],
        },
      },
      orderBy: [{ targetId: "asc" }],
      select: {
        action: true,
        actorKind: true,
        capability: true,
        reasonCode: true,
        targetId: true,
        targetType: true,
      },
    });
    expect(audits).toHaveLength(4);
    expect(audits).toEqual(
      expect.arrayContaining([
        lifecycleAudit(OLD_PLAN_VERSION_ID, "PLAN_VERSION", "DEACTIVATED"),
        lifecycleAudit(NEXT_PLAN_VERSION_ID, "PLAN_VERSION", "ACTIVATED"),
        lifecycleAudit(
          OLD_PRODUCT_VERSION_ID,
          "PRODUCT_VERSION",
          "DEACTIVATED",
        ),
        lifecycleAudit(
          NEXT_PRODUCT_VERSION_ID,
          "PRODUCT_VERSION",
          "ACTIVATED",
        ),
      ]),
    );
  });

  it("moves already expired SCHEDULED and ACTIVE versions directly to INACTIVE", async () => {
    const expiredPlanId = randomUUID();
    const expiredPlanVersionId = randomUUID();
    const expiredProductId = randomUUID();
    const expiredProductVersionId = randomUUID();
    await db().plan.create({
      data: { id: expiredPlanId, code: "EXPIRED_TEST", name: "Expired test" },
    });
    await db().planVersion.create({
      data: fixedPlanVersion({
        id: expiredPlanVersionId,
        planId: expiredPlanId,
        status: "SCHEDULED",
        validFrom: new Date("2026-07-01T00:00:00.000Z"),
        validTo: new Date("2026-08-01T00:00:00.000Z"),
        version: 1,
      }),
    });
    await db().product.create({
      data: {
        id: expiredProductId,
        code: "expired-contact-pack",
        name: "Expired contact pack",
        type: "CONTACT_PACK",
      },
    });
    await db().productVersion.create({
      data: contactPackVersion({
        id: expiredProductVersionId,
        productId: expiredProductId,
        status: "ACTIVE",
        validFrom: new Date("2026-07-01T00:00:00.000Z"),
        validTo: new Date("2026-08-01T00:00:00.000Z"),
        version: 1,
      }),
    });

    const result = await projectCatalogLifecycle(dependencies(BOUNDARY));
    expect(result).toEqual({
      planActivatedCount: 0,
      planDeactivatedCount: 1,
      productActivatedCount: 0,
      productDeactivatedCount: 1,
    });
    await expect(
      projectCatalogLifecycle(dependencies(BOUNDARY)),
    ).resolves.toEqual({
      planActivatedCount: 0,
      planDeactivatedCount: 0,
      productActivatedCount: 0,
      productDeactivatedCount: 0,
    });
    await expect(
      db().auditLog.count({
        where: {
          targetId: { in: [expiredPlanVersionId, expiredProductVersionId] },
          action: "CATALOG_VERSION_DEACTIVATED",
          reasonCode: "CATALOG_VERSION_EXPIRED",
        },
      }),
    ).resolves.toBe(2);
  });
});

async function insertBoundaryFixtures(database: DatabaseClient) {
  await database.plan.create({
    data: { id: PLAN_ID, code: "STARTER", name: "Starter" },
  });
  await database.planVersion.createMany({
    data: [
      fixedPlanVersion({
        id: OLD_PLAN_VERSION_ID,
        planId: PLAN_ID,
        status: "ACTIVE",
        validFrom: OLD_FROM,
        validTo: BOUNDARY,
        version: 1,
      }),
      fixedPlanVersion({
        id: NEXT_PLAN_VERSION_ID,
        planId: PLAN_ID,
        status: "SCHEDULED",
        validFrom: BOUNDARY,
        validTo: null,
        version: 2,
      }),
    ],
  });
  await database.product.create({
    data: {
      id: PRODUCT_ID,
      code: "contact-pack-lifecycle",
      name: "Contact pack lifecycle",
      type: "CONTACT_PACK",
    },
  });
  await database.productVersion.createMany({
    data: [
      contactPackVersion({
        id: OLD_PRODUCT_VERSION_ID,
        productId: PRODUCT_ID,
        status: "ACTIVE",
        validFrom: OLD_FROM,
        validTo: BOUNDARY,
        version: 1,
      }),
      contactPackVersion({
        id: NEXT_PRODUCT_VERSION_ID,
        productId: PRODUCT_ID,
        status: "SCHEDULED",
        validFrom: BOUNDARY,
        validTo: null,
        version: 2,
      }),
    ],
  });
}

function fixedPlanVersion(input: {
  id: string;
  planId: string;
  status: "ACTIVE" | "SCHEDULED";
  validFrom: Date;
  validTo: Date | null;
  version: number;
}) {
  return {
    ...input,
    billingInterval: "MONTHLY" as const,
    currency: "CHF",
    isPublic: true,
    isSelfService: true,
    monthlyEquivalentRappen: 14_900 + input.version * 100,
    netPriceRappen: 14_900 + input.version * 100,
    priceMode: "FIXED" as const,
    termMonths: 1,
  };
}

function contactPackVersion(input: {
  id: string;
  productId: string;
  status: "ACTIVE" | "SCHEDULED";
  validFrom: Date;
  validTo: Date | null;
  version: number;
}) {
  return {
    ...input,
    creditAmount: 10,
    creditType: "TALENT_CONTACT" as const,
    currency: "CHF",
    isPublic: true,
    isSelfService: true,
    netPriceRappen: 9_900 + input.version * 100,
    priority: 1,
    requiresLegalReview: false,
  };
}

async function effectivePlanVersionIds(planId: string, at: Date) {
  const rows = await db().planVersion.findMany({
    where: {
      planId,
      status: "ACTIVE",
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

async function effectiveProductVersionIds(productId: string, at: Date) {
  const rows = await db().productVersion.findMany({
    where: {
      productId,
      status: "ACTIVE",
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

function lifecycleAudit(
  targetId: string,
  targetType: "PLAN_VERSION" | "PRODUCT_VERSION",
  transition: "ACTIVATED" | "DEACTIVATED",
) {
  return {
    action:
      transition === "ACTIVATED"
        ? "MAINTENANCE_PROJECTION_SYNCED"
        : "CATALOG_VERSION_DEACTIVATED",
    actorKind: "SYSTEM",
    capability: "BILLING_CATALOG_LIFECYCLE_PROJECT",
    reasonCode:
      transition === "ACTIVATED"
        ? "CATALOG_VERSION_ACTIVATED"
        : "CATALOG_VERSION_EXPIRED",
    targetId,
    targetType,
  };
}

function sumResults(
  left: Awaited<ReturnType<typeof projectCatalogLifecycle>>,
  right: Awaited<ReturnType<typeof projectCatalogLifecycle>>,
) {
  return {
    planActivatedCount:
      left.planActivatedCount + right.planActivatedCount,
    planDeactivatedCount:
      left.planDeactivatedCount + right.planDeactivatedCount,
    productActivatedCount:
      left.productActivatedCount + right.productActivatedCount,
    productDeactivatedCount:
      left.productDeactivatedCount + right.productDeactivatedCount,
  };
}
