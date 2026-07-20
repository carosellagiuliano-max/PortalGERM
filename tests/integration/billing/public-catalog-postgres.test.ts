import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  appEnvironment: "production" as "production" | "local",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => ({ APP_ENV: runtime.appEnvironment }),
}));

import type { EntitlementRights } from "@/lib/billing/entitlements";
import { getPublicPricingCatalog } from "@/lib/billing/public-catalog";
import {
  PUBLIC_PLAN_ORDER_V1,
  PUBLIC_PRODUCT_CODES_V1,
  type PublicPlanCode,
  type PublicProductCode,
} from "@/lib/billing/public-catalog-core";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const AT = new Date("2026-07-20T12:00:00.000Z");
const MISSING_PRODUCT_AT = new Date("2026-07-21T12:00:00.000Z");
const HISTORY_FROM = new Date("2026-01-01T00:00:00.000Z");

const PLAN_DEFINITIONS: ReadonlyArray<
  Readonly<{
    code: PublicPlanCode;
    name: string;
    netPriceRappen: number | null;
    rights: EntitlementRights;
  }>
> = [
  {
    code: "FREE_BASIC",
    name: "Free Basic database row",
    netPriceRappen: 0,
    rights: planRights(),
  },
  {
    code: "STARTER",
    name: "Starter database row",
    netPriceRappen: 15_123,
    rights: planRights({ ACTIVE_JOB_LIMIT: 3, SEAT_LIMIT: 2 }),
  },
  {
    code: "PRO",
    name: "Pro database row",
    netPriceRappen: 40_567,
    rights: planRights({
      ACTIVE_JOB_LIMIT: 10,
      SEAT_LIMIT: 5,
      TALENT_RADAR_ACCESS: true,
      TALENT_CONTACT_ALLOWANCE: 10,
      JOB_BOOST_ALLOWANCE: 3,
      ANALYTICS_LEVEL: "ADVANCED",
      ENHANCED_COMPANY_PROFILE: true,
    }),
  },
  {
    code: "BUSINESS",
    name: "Business database row",
    netPriceRappen: 91_234,
    rights: planRights({
      ACTIVE_JOB_LIMIT: 30,
      SEAT_LIMIT: 15,
      TALENT_RADAR_ACCESS: true,
      TALENT_CONTACT_ALLOWANCE: 50,
      JOB_BOOST_ALLOWANCE: 10,
      ANALYTICS_LEVEL: "PRO",
      ENHANCED_COMPANY_PROFILE: true,
    }),
  },
  {
    code: "ENTERPRISE_CONTRACT",
    name: "Enterprise private contract database row",
    netPriceRappen: null,
    rights: planRights({
      ACTIVE_JOB_LIMIT: 100,
      SEAT_LIMIT: 50,
      TALENT_RADAR_ACCESS: true,
      TALENT_CONTACT_ALLOWANCE: 100,
      JOB_BOOST_ALLOWANCE: 20,
      ANALYTICS_LEVEL: "PRO",
      ENHANCED_COMPANY_PROFILE: true,
    }),
  },
];

const PRODUCT_DEFINITIONS: ReadonlyArray<
  Readonly<{
    code: PublicProductCode;
    name: string;
    type: "JOB_BOOST" | "CONTACT_PACK";
    netPriceRappen: number;
    priority: number;
    durationDays: number | null;
    creditType: "TALENT_CONTACT" | null;
    creditAmount: number | null;
  }>
> = [
  {
    code: "boost-7d",
    name: "Database Boost 7",
    type: "JOB_BOOST",
    netPriceRappen: 8_001,
    priority: 10,
    durationDays: 7,
    creditType: null,
    creditAmount: null,
  },
  {
    code: "boost-30d",
    name: "Database Boost 30",
    type: "JOB_BOOST",
    netPriceRappen: 20_002,
    priority: 20,
    durationDays: 30,
    creditType: null,
    creditAmount: null,
  },
  {
    code: "contact-pack-10",
    name: "Database Contact Pack 10",
    type: "CONTACT_PACK",
    netPriceRappen: 10_003,
    priority: 30,
    durationDays: null,
    creditType: "TALENT_CONTACT",
    creditAmount: 10,
  },
  {
    code: "contact-pack-50",
    name: "Database Contact Pack 50",
    type: "CONTACT_PACK",
    netPriceRappen: 30_004,
    priority: 40,
    durationDays: null,
    creditType: "TALENT_CONTACT",
    creditAmount: 50,
  },
];

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase-08 public catalog database is unavailable.");
  }
  return database;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase08_public_catalog");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  globalThis.swissTalentHubDatabase = database;
  await insertCatalogFixtures(database);
}, 120_000);

afterAll(async () => {
  if (globalThis.swissTalentHubDatabase === database) {
    globalThis.swissTalentHubDatabase = undefined;
  }
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-08 PostgreSQL public pricing catalog", () => {
  it("loads the five plans, four products, DB prices, and success-fee gate from current snapshots", async () => {
    expect(
      await client().planVersion.count({
        where: { plan: { code: "STARTER" }, status: "ACTIVE" },
      }),
    ).toBe(2);
    expect(
      await client().productVersion.count({
        where: { product: { code: "boost-7d" }, status: "ACTIVE" },
      }),
    ).toBe(2);

    const result = await getPublicPricingCatalog(AT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);

    expect(result.value.plans.map(({ code }) => code)).toEqual([
      ...PUBLIC_PLAN_ORDER_V1,
    ]);
    expect(result.value.plans).toHaveLength(5);
    expect(result.value.plans.map(({ code, price }) => [code, price])).toEqual([
      [
        "FREE_BASIC",
        { kind: "MONTHLY_FIXED", netRappen: 0, currency: "CHF" },
      ],
      [
        "STARTER",
        { kind: "MONTHLY_FIXED", netRappen: 15_123, currency: "CHF" },
      ],
      [
        "PRO",
        { kind: "MONTHLY_FIXED", netRappen: 40_567, currency: "CHF" },
      ],
      [
        "BUSINESS",
        { kind: "MONTHLY_FIXED", netRappen: 91_234, currency: "CHF" },
      ],
      ["ENTERPRISE_CONTRACT", { kind: "INDIVIDUAL", currency: "CHF" }],
    ]);
    expect(result.value.plans[4]).toMatchObject({
      code: "ENTERPRISE_CONTRACT",
      catalogDisclosure: "PRIVATE_CONTRACT_TEMPLATE",
      entitlements: null,
    });

    expect(result.value.products).toHaveLength(4);
    expect(result.value.products.map(({ code }) => code)).toEqual([
      ...PUBLIC_PRODUCT_CODES_V1,
    ]);
    expect(
      result.value.products.map(({ code, netPriceRappen }) => [
        code,
        netPriceRappen,
      ]),
    ).toEqual([
      ["boost-7d", 8_001],
      ["boost-30d", 20_002],
      ["contact-pack-10", 10_003],
      ["contact-pack-50", 30_004],
    ]);
    expect(result.value.successFee).toEqual({
      title: "Erfolgsbasierte Vermittlung",
      availability: "DISABLED_LEGAL_REVIEW",
    });
    expect(result.value.taxNotice.kind).toBe("REVIEW_BEFORE_CONTRACT");
  });

  it("fails closed for an unexpected effective active-public product", async () => {
    const product = await client().product.create({
      data: {
        code: "unexpected-public-addon",
        name: "Unexpected public add-on",
        type: "FEATURED_JOB",
        versions: {
          create: {
            version: 1,
            status: "ACTIVE",
            netPriceRappen: 12_345,
            currency: "CHF",
            durationDays: 14,
            creditType: null,
            creditAmount: null,
            isPublic: true,
            isSelfService: true,
            priority: 90,
            requiresLegalReview: false,
            validFrom: new Date(AT),
            validTo: null,
          },
        },
      },
      include: { versions: true },
    });
    const version = product.versions[0];
    if (version === undefined) {
      throw new Error("Unexpected public product version was not persisted.");
    }
    try {
      await expect(getPublicPricingCatalog(AT)).resolves.toEqual({
        ok: false,
        error: { code: "PRODUCT_SET_INVALID" },
      });
    } finally {
      await client().productVersion.update({
        where: { id: version.id },
        data: { status: "INACTIVE" },
      });
    }
  });

  it("fails closed when one required active-public product is missing", async () => {
    await expect(getPublicPricingCatalog(MISSING_PRODUCT_AT)).resolves.toEqual({
      ok: false,
      error: { code: "PRODUCT_SET_INVALID" },
    });
  });
});

function planRights(
  overrides: Partial<EntitlementRights> = {},
): EntitlementRights {
  return {
    ACTIVE_JOB_LIMIT: 1,
    SEAT_LIMIT: 1,
    TALENT_RADAR_ACCESS: false,
    TALENT_CONTACT_ALLOWANCE: 0,
    JOB_BOOST_ALLOWANCE: 0,
    ANALYTICS_LEVEL: "NONE",
    ENHANCED_COMPANY_PROFILE: false,
    EMPLOYER_IMPORT_ACCESS: false,
    ...overrides,
  };
}

async function insertCatalogFixtures(db: DatabaseClient): Promise<void> {
  for (const definition of PLAN_DEFINITIONS) {
    const plan = await db.plan.create({
      data: {
        code: definition.code,
        name: definition.name,
        isDefaultFree: definition.code === "FREE_BASIC",
      },
    });
    const isEnterprise = definition.code === "ENTERPRISE_CONTRACT";

    if (definition.code === "STARTER") {
      await db.planVersion.create({
        data: {
          planId: plan.id,
          version: 1,
          status: "ACTIVE",
          priceMode: "FIXED",
          billingInterval: "MONTHLY",
          termMonths: 1,
          netPriceRappen: 99_999,
          monthlyEquivalentRappen: 99_999,
          currency: "CHF",
          isPublic: true,
          isSelfService: true,
          validFrom: new Date(HISTORY_FROM),
          validTo: new Date(AT),
        },
      });
    }

    const version = await db.planVersion.create({
      data: {
        planId: plan.id,
        version: definition.code === "STARTER" ? 2 : 1,
        status: "DRAFT",
        priceMode: isEnterprise ? "CONTRACT" : "FIXED",
        billingInterval: "MONTHLY",
        termMonths: isEnterprise ? 12 : 1,
        netPriceRappen: definition.netPriceRappen,
        monthlyEquivalentRappen: definition.netPriceRappen,
        currency: "CHF",
        isPublic: !isEnterprise,
        isSelfService:
          definition.code === "STARTER" || definition.code === "PRO",
        validFrom: definition.code === "STARTER"
          ? new Date(AT)
          : new Date(HISTORY_FROM),
        validTo: null,
      },
    });
    await insertPlanEntitlements(db, version.id, definition.rights);
    await db.planVersion.update({
      where: { id: version.id },
      data: { status: "ACTIVE" },
    });
  }

  for (const definition of PRODUCT_DEFINITIONS) {
    const product = await db.product.create({
      data: {
        code: definition.code,
        name: definition.name,
        type: definition.type,
      },
    });
    if (definition.code === "boost-7d") {
      await db.productVersion.create({
        data: {
          productId: product.id,
          version: 1,
          status: "ACTIVE",
          netPriceRappen: 99_999,
          currency: "CHF",
          durationDays: 7,
          creditType: null,
          creditAmount: null,
          isPublic: true,
          isSelfService: true,
          priority: definition.priority,
          requiresLegalReview: false,
          validFrom: new Date(HISTORY_FROM),
          validTo: new Date(AT),
        },
      });
    }
    await db.productVersion.create({
      data: {
        productId: product.id,
        version: definition.code === "boost-7d" ? 2 : 1,
        status: "ACTIVE",
        netPriceRappen: definition.netPriceRappen,
        currency: "CHF",
        durationDays: definition.durationDays,
        creditType: definition.creditType,
        creditAmount: definition.creditAmount,
        isPublic: true,
        isSelfService: true,
        priority: definition.priority,
        requiresLegalReview: false,
        validFrom: definition.code === "boost-7d"
          ? new Date(AT)
          : new Date(HISTORY_FROM),
        validTo: definition.code === "contact-pack-50"
          ? new Date(MISSING_PRODUCT_AT)
          : null,
      },
    });
  }

  const successFee = await db.product.create({
    data: {
      code: "success-fee",
      name: "Success Fee database gate",
      type: "SUCCESS_FEE",
    },
  });
  await db.productVersion.create({
    data: {
      productId: successFee.id,
      version: 1,
      status: "INACTIVE",
      netPriceRappen: 0,
      currency: "CHF",
      durationDays: null,
      creditType: null,
      creditAmount: null,
      isPublic: false,
      isSelfService: false,
      priority: 100,
      requiresLegalReview: true,
      validFrom: new Date(HISTORY_FROM),
      validTo: null,
    },
  });
}

async function insertPlanEntitlements(
  db: DatabaseClient,
  planVersionId: string,
  rights: EntitlementRights,
): Promise<void> {
  await db.planEntitlement.createMany({
    data: [
      {
        planVersionId,
        key: "ACTIVE_JOB_LIMIT",
        valueType: "INTEGER",
        booleanValue: null,
        integerValue: rights.ACTIVE_JOB_LIMIT,
        analyticsLevelValue: null,
      },
      {
        planVersionId,
        key: "SEAT_LIMIT",
        valueType: "INTEGER",
        booleanValue: null,
        integerValue: rights.SEAT_LIMIT,
        analyticsLevelValue: null,
      },
      {
        planVersionId,
        key: "TALENT_RADAR_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: rights.TALENT_RADAR_ACCESS,
        integerValue: null,
        analyticsLevelValue: null,
      },
      {
        planVersionId,
        key: "TALENT_CONTACT_ALLOWANCE",
        valueType: "INTEGER",
        booleanValue: null,
        integerValue: rights.TALENT_CONTACT_ALLOWANCE,
        analyticsLevelValue: null,
      },
      {
        planVersionId,
        key: "JOB_BOOST_ALLOWANCE",
        valueType: "INTEGER",
        booleanValue: null,
        integerValue: rights.JOB_BOOST_ALLOWANCE,
        analyticsLevelValue: null,
      },
      {
        planVersionId,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        booleanValue: null,
        integerValue: null,
        analyticsLevelValue: rights.ANALYTICS_LEVEL,
      },
      {
        planVersionId,
        key: "ENHANCED_COMPANY_PROFILE",
        valueType: "BOOLEAN",
        booleanValue: rights.ENHANCED_COMPANY_PROFILE,
        integerValue: null,
        analyticsLevelValue: null,
      },
      {
        planVersionId,
        key: "EMPLOYER_IMPORT_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: rights.EMPLOYER_IMPORT_ACCESS,
        integerValue: null,
        analyticsLevelValue: null,
      },
    ],
  });
}
