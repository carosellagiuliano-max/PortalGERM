import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  confirmMockPayment,
  createCheckoutOrder,
} from "@/lib/billing/orders";
import type { BillingDependencies } from "@/lib/billing/contracts";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockEmailProvider } from "@/lib/providers/email";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { MockPaymentProvider } from "@/lib/providers/payments";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-21T10:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T10:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T10:00:00.000Z");

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtures:
  | Readonly<{
      starterActor: BillingDependencies["actor"];
      radarActor: BillingDependencies["actor"];
    }>
  | undefined;

function client() {
  if (database === undefined) throw new Error("Checkout test DB unavailable.");
  return database;
}

function data() {
  if (fixtures === undefined) throw new Error("Checkout fixtures unavailable.");
  return fixtures;
}

function dependencies(
  actor: BillingDependencies["actor"],
): BillingDependencies {
  return Object.freeze({
    actor,
    correlationId: randomUUID(),
    database: client(),
    paymentProvider: new MockPaymentProvider(),
    emailProvider: new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    ),
    now: NOW,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_checkout_confirmation");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  fixtures = await seedCheckoutFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 mock checkout confirmation", () => {
  it("confirms Starter exactly once with VAT, Invoice, Subscription and three emails", async () => {
    const deps = dependencies(data().starterActor);
    const checkout = await createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        idempotencyKey: "phase12-starter-checkout",
      },
      deps,
    );
    expect(checkout).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          checkoutUrl: expect.stringMatching(/^\/mock\/checkout\//u),
          status: "PENDING",
        }),
      }),
    );
    if (!checkout.ok) throw new Error("Starter checkout unexpectedly failed.");

    const confirmed = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "phase12-starter-confirm",
      },
      deps,
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          orderId: checkout.value.orderId,
          invoiceNumber: expect.stringMatching(/^STH-2026-[0-9]{5}$/u),
          subscriptionId: expect.any(String),
          creditGrantEntryId: null,
          emailsRecorded: true,
        }),
      }),
    );

    const replay = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "phase12-starter-confirm",
      },
      deps,
    );
    expect(replay).toEqual(expect.objectContaining({ ok: true, replay: true }));

    const order = await client().order.findUniqueOrThrow({
      where: { id: checkout.value.orderId },
      include: {
        invoice: { include: { lines: true } },
        subscription: { include: { events: true } },
        paymentEvents: true,
      },
    });
    expect(order).toEqual(
      expect.objectContaining({
        status: "PAID",
        netTotalRappen: 14_900,
        vatTotalRappen: 1_207,
        totalRappen: 16_107,
      }),
    );
    expect(order.paymentEvents.filter((event) => event.kind === "PAID")).toHaveLength(1);
    expect(order.invoice).toEqual(
      expect.objectContaining({
        status: "PAID",
        netTotalRappen: 14_900,
        vatTotalRappen: 1_207,
        totalRappen: 16_107,
      }),
    );
    expect(order.invoice?.lines).toEqual([
      expect.objectContaining({
        netRappen: 14_900,
        taxRateBasisPoints: 810,
        vatRappen: 1_207,
        totalRappen: 16_107,
      }),
    ]);
    expect(order.subscription).toEqual(
      expect.objectContaining({
        status: "ACTIVE",
        currentPeriodStart: NOW,
        currentPeriodEnd: new Date("2026-08-21T10:00:00.000Z"),
        recurringNetRappenSnapshot: 14_900,
      }),
    );
    expect(order.subscription?.events.map((event) => event.kind)).toEqual([
      "ACTIVATED",
    ]);
    await expectEmailCounts({
      payment_received: 1,
      invoice_issued: 1,
      subscription_activated: 1,
      credits_granted: 0,
    });
    await expect(
      client().auditLog.count({
        where: {
          companyId: data().starterActor.companyId,
          action: { in: ["ORDER_PAID", "INVOICE_ISSUED", "INVOICE_PAID"] },
        },
      }),
    ).resolves.toBe(3);
  });

  it("confirms Contact Pack 10 exactly once as one purchased Ledger grant", async () => {
    const deps = dependencies(data().radarActor);
    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "contact-pack-10",
        quantity: 1,
        idempotencyKey: "phase12-contact-pack-checkout",
      },
      deps,
    );
    expect(checkout).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    if (!checkout.ok) throw new Error("Contact Pack checkout unexpectedly failed.");

    const confirmed = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "phase12-contact-pack-confirm",
      },
      deps,
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          subscriptionId: null,
          creditGrantEntryId: expect.any(String),
          emailsRecorded: true,
        }),
      }),
    );
    const replay = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "phase12-contact-pack-confirm",
      },
      deps,
    );
    expect(replay).toEqual(expect.objectContaining({ ok: true, replay: true }));

    const order = await client().order.findUniqueOrThrow({
      where: { id: checkout.value.orderId },
      include: {
        invoice: true,
        lines: { include: { creditLedgerEntries: true } },
        paymentEvents: true,
      },
    });
    expect(order).toEqual(
      expect.objectContaining({
        status: "PAID",
        netTotalRappen: 9_900,
        vatTotalRappen: 802,
        totalRappen: 10_702,
      }),
    );
    expect(order.invoice).toEqual(
      expect.objectContaining({
        status: "PAID",
        netTotalRappen: 9_900,
        vatTotalRappen: 802,
        totalRappen: 10_702,
      }),
    );
    expect(order.paymentEvents.filter((event) => event.kind === "PAID")).toHaveLength(1);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]?.creditLedgerEntries).toEqual([
      expect.objectContaining({
        fundingSource: "PURCHASED_PACK",
        kind: "GRANT",
        amount: 10,
        validFrom: NOW,
        validTo: new Date("2027-07-21T10:00:00.000Z"),
      }),
    ]);
    await expectEmailCounts({
      payment_received: 2,
      invoice_issued: 2,
      subscription_activated: 1,
      credits_granted: 1,
    });
    await expect(
      client().auditLog.count({
        where: {
          companyId: data().radarActor.companyId,
          action: "CREDITS_GRANTED",
          targetType: "CREDIT_LEDGER_ENTRY",
        },
      }),
    ).resolves.toBe(1);
  });

  it("persists provider failure after the committed Checkout event and replays it safely", async () => {
    let createAttempts = 0;
    const mock = new MockPaymentProvider();
    const deps: BillingDependencies = Object.freeze({
      ...dependencies(data().radarActor),
      paymentProvider: Object.freeze({
        async createCheckout() {
          createAttempts += 1;
          throw new Error("deterministic provider outage");
        },
        confirmPayment: mock.confirmPayment.bind(mock),
        cancel: mock.cancel.bind(mock),
      }),
    });
    const input = {
      kind: "PRODUCT",
      productSlug: "contact-pack-10",
      quantity: 1,
      idempotencyKey: "phase12-provider-failure",
    } as const;

    await expect(createCheckoutOrder(input, deps)).resolves.toEqual({
      ok: false,
      code: "PAYMENT_PROVIDER_FAILED",
    });
    const failed = await client().order.findUniqueOrThrow({
      where: { clientIdempotencyKey: input.idempotencyKey },
      include: { paymentEvents: true, invoice: true },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.failedAt).toEqual(NOW);
    expect(failed.invoice).toBeNull();
    expect(failed.paymentEvents.map((event) => event.kind).sort()).toEqual([
      "CHECKOUT_CREATED",
      "FAILED",
    ]);

    await expect(createCheckoutOrder(input, deps)).resolves.toEqual({
      ok: false,
      code: "PAYMENT_PROVIDER_FAILED",
    });
    expect(createAttempts).toBe(1);
    await expect(
      client().paymentEvent.count({ where: { orderId: failed.id } }),
    ).resolves.toBe(2);
    await expect(
      client().analyticsEvent.count({
        where: {
          producer: "billing-checkout",
          dedupeKey: {
            in: [
              `CHECKOUT_STARTED:${failed.id}`,
              `CHECKOUT_COMPLETED:${failed.id}`,
            ],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it("fails an idempotent replay once its pending checkout reached the expiry boundary", async () => {
    const deps = dependencies(data().radarActor);
    const input = {
      kind: "PRODUCT",
      productSlug: "contact-pack-10",
      quantity: 1,
      idempotencyKey: "phase12-expired-pending-replay",
    } as const;
    const checkout = await createCheckoutOrder(input, deps);
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) throw new Error("Expiry replay fixture checkout failed.");
    await client().order.update({
      where: { id: checkout.value.orderId },
      data: { expiresAt: NOW },
    });

    await expect(createCheckoutOrder(input, deps)).resolves.toEqual({
      ok: false,
      code: "ORDER_EXPIRED",
    });
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: checkout.value.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "EXPIRED" });
    await expect(createCheckoutOrder(input, deps)).resolves.toEqual({
      ok: false,
      code: "ORDER_NOT_PENDING",
    });
    await expect(
      client().auditLog.count({
        where: {
          action: "ORDER_EXPIRED",
          actorKind: "SYSTEM",
          capability: "BILLING_ORDER_EXPIRY_PROJECT",
          companyId: data().radarActor.companyId,
          reasonCode: "ORDER_TTL_ELAPSED",
          result: "SUCCEEDED",
          targetId: checkout.value.orderId,
          targetType: "ORDER",
        },
      }),
    ).resolves.toBe(1);
  });

  it("projects and audits an expired pending order before provider confirmation", async () => {
    const deps = dependencies(data().radarActor);
    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "contact-pack-10",
        quantity: 1,
        idempotencyKey: "phase12-expired-before-confirmation",
      },
      deps,
    );
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) throw new Error("Expiry confirmation fixture failed.");
    await client().order.update({
      where: { id: checkout.value.orderId },
      data: { expiresAt: NOW },
    });

    const confirmationInput = {
      orderId: checkout.value.orderId,
      idempotencyKey: "phase12-expired-confirmation",
    } as const;
    await expect(confirmMockPayment(confirmationInput, deps)).resolves.toEqual({
      ok: false,
      code: "ORDER_EXPIRED",
    });
    await expect(confirmMockPayment(confirmationInput, deps)).resolves.toEqual({
      ok: false,
      code: "ORDER_NOT_PENDING",
    });
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: checkout.value.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "EXPIRED" });
    await expect(
      client().auditLog.count({
        where: {
          action: "ORDER_EXPIRED",
          actorKind: "SYSTEM",
          targetId: checkout.value.orderId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      client().paymentEvent.count({
        where: { orderId: checkout.value.orderId, kind: "PAID" },
      }),
    ).resolves.toBe(0);
  });
});

async function expectEmailCounts(
  expected: Readonly<
    Record<
      | "payment_received"
      | "invoice_issued"
      | "subscription_activated"
      | "credits_granted",
      number
    >
  >,
) {
  for (const [templateKey, count] of Object.entries(expected)) {
    await expect(
      client().emailLog.count({ where: { templateKey } }),
    ).resolves.toBe(count);
  }
}

async function seedCheckoutFixtures(db: DatabaseClient) {
  const reviewer = await db.user.create({
    data: {
      email: "phase12-tax-reviewer@example.ch",
      emailNormalized: "phase12-tax-reviewer@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  const starterOwner = await createOwner(db, "starter");
  const radarOwner = await createOwner(db, "radar");
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
  const starterCompany = await createCompany(
    db,
    "Phase 12 Starter Checkout AG",
    "phase12-starter-checkout-ag",
    canton.id,
    city.id,
  );
  const radarCompany = await createCompany(
    db,
    "Phase 12 Radar Checkout AG",
    "phase12-radar-checkout-ag",
    canton.id,
    city.id,
  );
  const starterMembership = await createOwnerMembership(
    db,
    starterCompany.id,
    starterOwner.id,
  );
  const radarMembership = await createOwnerMembership(
    db,
    radarCompany.id,
    radarOwner.id,
  );
  await Promise.all([
    createBillingProfile(db, starterCompany.id, starterOwner.email),
    createBillingProfile(db, radarCompany.id, radarOwner.email),
  ]);

  await createPlanVersion(db, {
    code: "FREE_BASIC",
    name: "Free Basic",
    isDefaultFree: true,
    netPriceRappen: 0,
    activeJobLimit: 1,
    seatLimit: 1,
    talentRadarAccess: false,
    contactAllowance: 0,
    boostAllowance: 0,
  });
  const starter = await createPlanVersion(db, {
    code: "STARTER",
    name: "Starter",
    isDefaultFree: false,
    netPriceRappen: 14_900,
    activeJobLimit: 3,
    seatLimit: 3,
    talentRadarAccess: false,
    contactAllowance: 0,
    boostAllowance: 0,
  });
  void starter;
  const pro = await createPlanVersion(db, {
    code: "PRO",
    name: "Pro",
    isDefaultFree: false,
    netPriceRappen: 39_900,
    activeJobLimit: 10,
    seatLimit: 10,
    talentRadarAccess: true,
    contactAllowance: 5,
    boostAllowance: 1,
  });
  await db.employerSubscription.create({
    data: {
      companyId: radarCompany.id,
      planVersionId: pro.id,
      status: "ACTIVE",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: 39_900,
      monthlyEquivalentRappenSnapshot: 39_900,
      currencySnapshot: "CHF",
      activatedAt: PERIOD_START,
    },
  });
  await createContactPack(db);
  await createTaxRate(db, reviewer.id);

  return Object.freeze({
    starterActor: Object.freeze({
      userId: starterOwner.id,
      email: starterOwner.email,
      companyId: starterCompany.id,
      membershipId: starterMembership.id,
      membershipRole: "OWNER" as const,
    }),
    radarActor: Object.freeze({
      userId: radarOwner.id,
      email: radarOwner.email,
      companyId: radarCompany.id,
      membershipId: radarMembership.id,
      membershipRole: "OWNER" as const,
    }),
  });
}

async function createOwner(db: DatabaseClient, suffix: string) {
  const email = `phase12-${suffix}-owner@example.ch`;
  return db.user.create({
    data: { email, emailNormalized: email, role: "EMPLOYER", status: "ACTIVE" },
  });
}

async function createCompany(
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
      about: "Deterministische Checkout-Testfirma.",
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

function createOwnerMembership(
  db: DatabaseClient,
  companyId: string,
  userId: string,
) {
  return db.companyMembership.create({
    data: {
      companyId,
      userId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
}

function createBillingProfile(
  db: DatabaseClient,
  companyId: string,
  billingContactEmail: string,
) {
  return db.companyBillingProfile.create({
    data: {
      companyId,
      legalName: "Phase 12 Checkout AG",
      billingContactEmail,
      street: "Teststrasse 12",
      postalCode: "8000",
      city: "Zürich",
      countryCode: "CH",
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
            analyticsLevelValue: input.isDefaultFree ? "NONE" : "BASIC",
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

async function createContactPack(db: DatabaseClient) {
  const product = await db.product.create({
    data: {
      code: "contact-pack-10",
      name: "Talent Radar Contact Pack 10",
      type: "CONTACT_PACK",
    },
  });
  const version = await db.productVersion.create({
    data: {
      productId: product.id,
      version: 1,
      status: "DRAFT",
      netPriceRappen: 9_900,
      currency: "CHF",
      durationDays: null,
      creditType: "TALENT_CONTACT",
      creditAmount: 10,
      isPublic: true,
      isSelfService: true,
      requiresLegalReview: false,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await db.productVersion.update({
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
      source: "Fiktive Phase-12-Testannahme",
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
