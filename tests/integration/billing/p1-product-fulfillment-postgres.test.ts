import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminDependencies } from "@/lib/admin/common";
import { addZurichCalendarMonthsClampedV1 } from "@/lib/billing/billing-policy-v1";
import { scheduleProductVersion } from "@/lib/billing/admin-billing";
import type { BillingDependencies } from "@/lib/billing/contracts";
import {
  confirmMockPayment,
  createCheckoutOrder,
} from "@/lib/billing/orders";
import { recordProductReleaseDecision } from "@/lib/billing/product-release";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockEmailProvider } from "@/lib/providers/email";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { MockPaymentProvider } from "@/lib/providers/payments";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const ADDITIONAL_NOW = new Date("2026-07-21T10:00:00.000Z");
// 23:30 Zurich on leap-day. Twelve calendar months must clamp to 28 Feb 2029
// while preserving the Zurich wall time rather than adding a fixed day count.
const IMPORT_NOW = new Date("2028-02-29T22:30:00.000Z");
const IMPORT_RETRY_NOW = new Date("2028-02-29T23:01:00.000Z");
const CATALOG_FROM = new Date("2026-01-01T00:00:00.000Z");
const RELEASE_EXPIRY = new Date("2035-01-01T00:00:00.000Z");

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtures: Awaited<ReturnType<typeof seedFixtures>> | undefined;

function db() {
  if (database === undefined) throw new Error("P1 Billing test DB unavailable.");
  return database;
}

function data() {
  if (fixtures === undefined) throw new Error("P1 Billing fixtures unavailable.");
  return fixtures;
}

function billingDependencies(
  actor: BillingDependencies["actor"],
  now: Date,
  paymentProvider: BillingDependencies["paymentProvider"] = new MockPaymentProvider(),
): BillingDependencies {
  return Object.freeze({
    actor,
    correlationId: randomUUID(),
    database: db(),
    paymentProvider,
    emailProvider: new MockEmailProvider(new PrismaEmailLogRepository(db())),
    now,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_p1_fulfillment");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  fixtures = await seedFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 P1 product release and fulfillment", () => {
  it("fulfills additional-job-30d for one eligible Starter Job exactly once without publishing", async () => {
    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "additional-job-30d",
        quantity: 1,
        targetJobId: data().eligibleJobId,
        idempotencyKey: "p1-additional-job-checkout",
      },
      billingDependencies(data().starterActor, ADDITIONAL_NOW),
    );
    expect(checkout).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    if (!checkout.ok) throw new Error("Additional Job checkout failed.");

    const confirmed = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "p1-additional-job-confirm",
      },
      billingDependencies(data().starterActor, ADDITIONAL_NOW),
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          subscriptionId: null,
          creditGrantEntryId: null,
          additionalJobPermitId: expect.any(String),
          importAccessGrantId: null,
        }),
      }),
    );
    const replay = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "p1-additional-job-confirm",
      },
      billingDependencies(data().starterActor, ADDITIONAL_NOW),
    );
    expect(replay).toEqual(expect.objectContaining({ ok: true, replay: true }));

    const order = await db().order.findUniqueOrThrow({
      where: { id: checkout.value.orderId },
      include: {
        invoice: true,
        lines: { include: { additionalJobPermit: true } },
        paymentEvents: true,
      },
    });
    expect(order).toEqual(
      expect.objectContaining({
        status: "PAID",
        netTotalRappen: 12_900,
        vatTotalRappen: 1_045,
        totalRappen: 13_945,
      }),
    );
    expect(order.paymentEvents.filter((event) => event.kind === "PAID")).toHaveLength(1);
    expect(order.lines).toEqual([
      expect.objectContaining({
        fulfillmentContext: "ADDITIONAL_JOB",
        targetJobId: data().eligibleJobId,
        targetImportSourceId: null,
        targetImportSetupApprovalId: null,
        additionalJobPermit: expect.objectContaining({
          companyId: data().starterActor.companyId,
          targetJobId: data().eligibleJobId,
          status: "ACTIVE",
          validFrom: ADDITIONAL_NOW,
          validTo: new Date("2026-08-20T10:00:00.000Z"),
          activatedAt: ADDITIONAL_NOW,
        }),
      }),
    ]);
    await expect(
      db().additionalJobPermit.count({
        where: { orderLineId: order.lines[0]!.id },
      }),
    ).resolves.toBe(1);
    await expect(
      db().job.findUniqueOrThrow({
        where: { id: data().eligibleJobId },
        select: { status: true, publishedAt: true, publishedRevisionId: true },
      }),
    ).resolves.toEqual({
      status: "APPROVED",
      publishedAt: null,
      publishedRevisionId: null,
    });
  });

  it("rechecks the Additional Job target before provider confirmation and denies wrong plan/context", async () => {
    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "additional-job-30d",
        quantity: 1,
        targetJobId: data().secondEligibleJobId,
        idempotencyKey: "p1-additional-recheck-checkout",
      },
      billingDependencies(data().starterRecheckActor, ADDITIONAL_NOW),
    );
    if (!checkout.ok) throw new Error("Recheck fixture checkout failed.");
    await db().job.update({
      where: { id: data().secondEligibleJobId },
      data: { status: "PAUSED" },
    });
    const confirmPayment = vi.fn(async () => ({
      provider: "MOCK" as const,
      orderId: checkout.value.orderId,
      providerReference: `mock_payment_${"a".repeat(64)}`,
      status: "PAID" as const,
    }));
    const mock = new MockPaymentProvider();
    const paymentProvider = Object.freeze({
      createCheckout: mock.createCheckout.bind(mock),
      confirmPayment,
      cancel: mock.cancel.bind(mock),
    });
    await expect(
      confirmMockPayment(
        {
          orderId: checkout.value.orderId,
          idempotencyKey: "p1-additional-recheck-confirm",
        },
        billingDependencies(data().starterRecheckActor, ADDITIONAL_NOW, paymentProvider),
      ),
    ).resolves.toEqual({ ok: false, code: "ADDITIONAL_JOB_NOT_ELIGIBLE" });
    expect(confirmPayment).not.toHaveBeenCalled();
    await expect(
      db().order.findUniqueOrThrow({
        where: { id: checkout.value.orderId },
        select: { status: true, paymentEvents: { select: { kind: true } } },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      paymentEvents: [{ kind: "CHECKOUT_CREATED" }],
    });

    await expect(
      createCheckoutOrder(
        {
          kind: "PRODUCT",
          productSlug: "additional-job-30d",
          quantity: 1,
          targetJobId: data().proJobId,
          idempotencyKey: "p1-additional-pro-denied",
        },
        billingDependencies(data().proActor, ADDITIONAL_NOW),
      ),
    ).resolves.toEqual({ ok: false, code: "ADDITIONAL_JOB_NOT_ELIGIBLE" });
    await expect(
      db().order.count({
        where: { clientIdempotencyKey: "p1-additional-pro-denied" },
      }),
    ).resolves.toBe(0);

    await expect(
      createCheckoutOrder(
        {
          kind: "PRODUCT",
          productSlug: "additional-job-30d",
          quantity: 1,
          targetJobId: data().tooLongJobId,
          idempotencyKey: "p1-additional-too-long-denied",
        },
        billingDependencies(data().starterRecheckActor, ADDITIONAL_NOW),
      ),
    ).resolves.toEqual({ ok: false, code: "ADDITIONAL_JOB_NOT_ELIGIBLE" });
  });

  it("releases failed and expired Import Setup reservations before exactly-once fulfillment", async () => {
    const mock = new MockPaymentProvider();
    const failingProvider = Object.freeze({
      async createCheckout() {
        throw new Error("deterministic Import Setup provider failure");
      },
      confirmPayment: mock.confirmPayment.bind(mock),
      cancel: mock.cancel.bind(mock),
    });
    await expect(
      createCheckoutOrder(
        {
          kind: "PRODUCT",
          productSlug: "import-setup",
          quantity: 1,
          importSetupApprovalId: data().businessApprovalId,
          idempotencyKey: "p1-import-business-provider-failed",
        },
        billingDependencies(
          data().businessActor,
          IMPORT_NOW,
          failingProvider,
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "PAYMENT_PROVIDER_FAILED" });
    const failedOrder = await db().order.findUniqueOrThrow({
      where: {
        clientIdempotencyKey: "p1-import-business-provider-failed",
      },
      select: { status: true },
    });
    expect(failedOrder.status).toBe("FAILED");
    await expect(
      db().importSetupApproval.findUniqueOrThrow({
        where: { id: data().businessApprovalId },
        select: { status: true, orderLineId: true },
      }),
    ).resolves.toEqual({ status: "APPROVED", orderLineId: null });

    const expiringCheckout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "import-setup",
        quantity: 1,
        importSetupApprovalId: data().businessApprovalId,
        idempotencyKey: "p1-import-business-expiring-checkout",
      },
      billingDependencies(data().businessActor, IMPORT_NOW),
    );
    expect(expiringCheckout.ok).toBe(true);
    if (!expiringCheckout.ok) {
      throw new Error("Expiring Business Import Setup checkout failed.");
    }
    const expiringLine = await db().orderLine.findFirstOrThrow({
      where: { orderId: expiringCheckout.value.orderId },
      select: { id: true },
    });
    await expect(
      db().importSetupApproval.findUniqueOrThrow({
        where: { id: data().businessApprovalId },
        select: { status: true, orderLineId: true },
      }),
    ).resolves.toEqual({
      status: "APPROVED",
      orderLineId: expiringLine.id,
    });
    await expect(
      createCheckoutOrder(
        {
          kind: "PRODUCT",
          productSlug: "import-setup",
          quantity: 1,
          importSetupApprovalId: data().businessApprovalId,
          idempotencyKey: "p1-import-business-live-reservation-denied",
        },
        billingDependencies(data().businessActor, IMPORT_NOW),
      ),
    ).resolves.toEqual({ ok: false, code: "IMPORT_SETUP_NOT_ELIGIBLE" });

    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "import-setup",
        quantity: 1,
        importSetupApprovalId: data().businessApprovalId,
        idempotencyKey: "p1-import-business-retry-checkout",
      },
      billingDependencies(data().businessActor, IMPORT_RETRY_NOW),
    );
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) throw new Error("Business Import Setup retry failed.");
    const retryLine = await db().orderLine.findFirstOrThrow({
      where: { orderId: checkout.value.orderId },
      select: { id: true },
    });
    await expect(
      db().order.findUniqueOrThrow({
        where: { id: expiringCheckout.value.orderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "EXPIRED" });
    await expect(
      db().auditLog.count({
        where: {
          action: "ORDER_EXPIRED",
          actorKind: "SYSTEM",
          capability: "BILLING_ORDER_EXPIRY_PROJECT",
          targetId: expiringCheckout.value.orderId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      db().importSetupApproval.findUniqueOrThrow({
        where: { id: data().businessApprovalId },
        select: { status: true, orderLineId: true },
      }),
    ).resolves.toEqual({
      status: "APPROVED",
      orderLineId: retryLine.id,
    });

    const confirmed = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: "p1-import-business-confirm",
      },
      billingDependencies(data().businessActor, IMPORT_RETRY_NOW),
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          importAccessGrantId: expect.any(String),
          additionalJobPermitId: null,
          creditGrantEntryId: null,
        }),
      }),
    );
    await expect(
      confirmMockPayment(
        {
          orderId: checkout.value.orderId,
          idempotencyKey: "p1-import-business-confirm",
        },
        billingDependencies(data().businessActor, IMPORT_RETRY_NOW),
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true, replay: true }));

    const expectedEnd = addZurichCalendarMonthsClampedV1(
      IMPORT_RETRY_NOW,
      12,
    );
    if (!expectedEnd.ok) throw new Error("Zurich calendar fixture failed.");
    expect(expectedEnd.value).toEqual(new Date("2029-02-28T23:01:00.000Z"));
    const approval = await db().importSetupApproval.findUniqueOrThrow({
      where: { id: data().businessApprovalId },
      include: { accessGrant: true },
    });
    expect(approval).toEqual(
      expect.objectContaining({
        status: "USED",
        orderLineId: expect.any(String),
        accessGrant: expect.objectContaining({
          companyId: data().businessActor.companyId,
          importSourceId: data().importSourceId,
          status: "ACTIVE",
          validFrom: IMPORT_RETRY_NOW,
          validTo: expectedEnd.value,
        }),
      }),
    );
    if (approval.accessGrant === null) {
      throw new Error("Import Access Grant was not created.");
    }
    await expect(
      db().importAccessGrant.update({
        where: { id: approval.accessGrant.id },
        data: { validTo: new Date(expectedEnd.value.getTime() + 1) },
      }),
    ).rejects.toThrow();
    await expect(
      db().importAccessGrant.delete({
        where: { id: approval.accessGrant.id },
      }),
    ).rejects.toThrow();
    await expect(
      db().importAccessGrant.count({
        where: { importSetupApprovalId: data().businessApprovalId },
      }),
    ).resolves.toBe(1);
    await expect(
      db().orderLine.count({
        where: {
          targetImportSetupApprovalId: data().businessApprovalId,
        },
      }),
    ).resolves.toBe(3);
    await expect(
      db().order.findUniqueOrThrow({
        where: { id: checkout.value.orderId },
        select: {
          netTotalRappen: true,
          vatTotalRappen: true,
          totalRappen: true,
          lines: {
            select: {
              fulfillmentContext: true,
              targetImportSourceId: true,
              targetImportSetupApprovalId: true,
            },
          },
        },
      }),
    ).resolves.toEqual({
      netTotalRappen: 75_000,
      vatTotalRappen: 6_075,
      totalRappen: 81_075,
      lines: [
        {
          fulfillmentContext: "IMPORT_SETUP",
          targetImportSourceId: data().importSourceId,
          targetImportSetupApprovalId: data().businessApprovalId,
        },
      ],
    });
    await expect(
      db().importRun.count({ where: { importSourceId: data().importSourceId } }),
    ).resolves.toBe(0);
    await expect(
      db().job.count({ where: { companyId: data().businessActor.companyId } }),
    ).resolves.toBe(0);
  });

  it("allows a private Enterprise contract but denies public, foreign and expired Import Setup contexts", async () => {
    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "import-setup",
        quantity: 1,
        importSetupApprovalId: data().privateEnterpriseApprovalId,
        idempotencyKey: "p1-import-enterprise-checkout",
      },
      billingDependencies(data().privateEnterpriseActor, IMPORT_NOW),
    );
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) throw new Error("Private Enterprise checkout failed.");
    await expect(
      confirmMockPayment(
        {
          orderId: checkout.value.orderId,
          idempotencyKey: "p1-import-enterprise-confirm",
        },
        billingDependencies(data().privateEnterpriseActor, IMPORT_NOW),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ importAccessGrantId: expect.any(String) }),
      }),
    );

    const deniedCases = [
      {
        actor: data().publicEnterpriseActor,
        approvalId: data().publicEnterpriseApprovalId,
        key: "p1-import-public-enterprise-denied",
      },
      {
        actor: data().businessActor,
        approvalId: data().privateEnterpriseApprovalId,
        key: "p1-import-foreign-approval-denied",
      },
      {
        actor: data().businessActor,
        approvalId: data().expiredBusinessApprovalId,
        key: "p1-import-expired-approval-denied",
      },
      {
        actor: data().businessActor,
        approvalId: data().secondBusinessApprovalId,
        key: "p1-import-overlap-denied",
      },
    ] as const;
    for (const denied of deniedCases) {
      await expect(
        createCheckoutOrder(
          {
            kind: "PRODUCT",
            productSlug: "import-setup",
            quantity: 1,
            importSetupApprovalId: denied.approvalId,
            idempotencyKey: denied.key,
          },
          billingDependencies(denied.actor, IMPORT_NOW),
        ),
      ).resolves.toEqual({ ok: false, code: "IMPORT_SETUP_NOT_ELIGIBLE" });
      await expect(
        db().order.count({ where: { clientIdempotencyKey: denied.key } }),
      ).resolves.toBe(0);
    }
  });

  it("requires a fresh, immutable, single-use release decision and keeps P2/Success Fee disabled", async () => {
    const dependencies: AdminDependencies = Object.freeze({
      actor: data().adminActor,
      correlationId: randomUUID(),
      database: db(),
      now: ADDITIONAL_NOW,
    });
    const decisionKey = randomUUID();
    const decision = await recordProductReleaseDecision(
      {
        productId: data().additionalProductId,
        allowsPublic: true,
        allowsSelfService: true,
        reasonCode: "P1_PRODUCT_RELEASE_APPROVED",
        rationale: "Preis, Handler, Zielkontext und Betrieb wurden kontrolliert.",
        idempotencyKey: decisionKey,
      },
      dependencies,
    );
    expect(decision).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ releaseTier: "P1" }),
      }),
    );
    const replay = await recordProductReleaseDecision(
      {
        productId: data().additionalProductId,
        allowsPublic: true,
        allowsSelfService: true,
        reasonCode: "P1_PRODUCT_RELEASE_APPROVED",
        rationale: "Preis, Handler, Zielkontext und Betrieb wurden kontrolliert.",
        idempotencyKey: decisionKey,
      },
      dependencies,
    );
    expect(replay).toEqual(expect.objectContaining({ ok: true, replay: true }));
    if (!decision.ok) throw new Error("Release decision failed.");
    await expect(
      db().auditLog.count({
        where: {
          action: "CATALOG_RELEASE_DECIDED",
          targetType: "PRODUCT_RELEASE_DECISION",
          targetId: decision.value.id,
          correlationId: decisionKey,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);

    const scheduledVersionId = randomUUID();
    const scheduled = await scheduleProductVersion(
      {
        productId: data().additionalProductId,
        sourceVersionId: data().additionalProductVersionId,
        netPriceRappen: 12_900,
        validFrom: new Date("2026-07-22T10:00:00.000Z"),
        validTo: null,
        isPublic: true,
        isSelfService: true,
        releaseDecisionId: decision.value.id,
        reasonCode: "P1_PRODUCT_VERSION_SCHEDULED",
        idempotencyKey: scheduledVersionId,
      },
      dependencies,
    );
    expect(scheduled).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ id: scheduledVersionId, status: "SCHEDULED" }),
      }),
    );
    await expect(
      db().productReleaseDecision.update({
        where: { id: decision.value.id },
        data: { rationale: "Unzulässige nachträgliche Änderung der Entscheidung." },
      }),
    ).rejects.toThrow();
    await expect(
      db().productVersion.create({
        data: {
          productId: data().additionalProductId,
          version: 99,
          status: "DRAFT",
          netPriceRappen: 12_900,
          currency: "CHF",
          durationDays: 30,
          isPublic: true,
          isSelfService: true,
          releaseDecisionId: decision.value.id,
          validFrom: new Date("2030-01-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();

    const wallNow = new Date();
    const expiredProduct = await db().product.create({
      data: {
        code: `expired-additional-${randomUUID()}`,
        name: "Expired decision fixture",
        type: "ADDITIONAL_JOB",
      },
    });
    const expiredDecision = await db().productReleaseDecision.create({
      data: {
        productId: expiredProduct.id,
        releaseTier: "P1",
        allowsPublic: true,
        allowsSelfService: true,
        reasonCode: "EXPIRED_RELEASE_DECISION",
        rationale: "Diese kontrollierte Testentscheidung ist bereits abgelaufen.",
        decidedByUserId: data().adminActor.userId,
        expiresAt: new Date(wallNow.getTime() - 86_400_000),
        idempotencyKey: `expired:${randomUUID()}`,
        createdAt: new Date(wallNow.getTime() - 2 * 86_400_000),
      },
    });
    const expiredVersion = await db().productVersion.create({
      data: {
        productId: expiredProduct.id,
        version: 1,
        status: "DRAFT",
        netPriceRappen: 12_900,
        currency: "CHF",
        durationDays: 30,
        isPublic: true,
        isSelfService: true,
        releaseDecisionId: expiredDecision.id,
        validFrom: CATALOG_FROM,
      },
    });
    await expect(
      db().productVersion.update({
        where: { id: expiredVersion.id },
        data: { status: "ACTIVE" },
      }),
    ).rejects.toThrow();

    const p2Product = await db().product.create({
      data: {
        code: `featured-test-${randomUUID()}`,
        name: "P2 fixture",
        type: "FEATURED_JOB",
      },
    });
    await expect(
      recordProductReleaseDecision(
        {
          productId: p2Product.id,
          allowsPublic: true,
          allowsSelfService: false,
          reasonCode: "P2_RELEASE_ATTEMPT",
          rationale: "Eine Entscheidung darf das fehlende Inventar nicht ersetzen.",
          idempotencyKey: randomUUID(),
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    const p2Version = await db().productVersion.create({
      data: {
        productId: p2Product.id,
        version: 1,
        status: "DRAFT",
        netPriceRappen: 29_900,
        currency: "CHF",
        durationDays: 14,
        isPublic: false,
        isSelfService: false,
        validFrom: CATALOG_FROM,
      },
    });
    await expect(
      db().productVersion.update({
        where: { id: p2Version.id },
        data: { status: "SCHEDULED" },
      }),
    ).rejects.toThrow();
    await expect(
      db().productVersion.update({
        where: { id: p2Version.id },
        data: { isPublic: true },
      }),
    ).rejects.toThrow();

    const successFee = await db().product.create({
      data: {
        code: `success-fee-test-${randomUUID()}`,
        name: "Success Fee disabled fixture",
        type: "SUCCESS_FEE",
      },
    });
    const successVersion = await db().productVersion.create({
      data: {
        productId: successFee.id,
        version: 1,
        status: "DRAFT",
        netPriceRappen: 0,
        currency: "CHF",
        isPublic: false,
        isSelfService: false,
        requiresLegalReview: true,
        validFrom: CATALOG_FROM,
      },
    });
    await expect(
      db().productVersion.update({
        where: { id: successVersion.id },
        data: { status: "ACTIVE" },
      }),
    ).rejects.toThrow();
  });
});

async function seedFixtures(database: DatabaseClient) {
  const admin = await database.user.create({
    data: {
      email: "p1-admin@example.ch",
      emailNormalized: "p1-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  const canton = await database.canton.create({
    data: { code: "ZH", name: "Zürich", slug: "zuerich", language: "DE", sortOrder: 1 },
  });
  const city = await database.city.create({
    data: { cantonId: canton.id, name: "Zürich", slug: "zuerich", sortOrder: 1 },
  });
  const category = await database.category.create({
    data: { name: "Engineering", slug: "engineering", sortOrder: 1 },
  });

  const free = await createPlan(database, {
    code: "FREE_BASIC",
    name: "Free Basic",
    isDefaultFree: true,
    isPublic: true,
    isSelfService: false,
    priceMode: "FIXED",
    netPriceRappen: 0,
    importAccess: false,
  });
  void free;
  const starter = await createPlan(database, {
    code: "STARTER",
    name: "Starter",
    isDefaultFree: false,
    isPublic: true,
    isSelfService: true,
    priceMode: "FIXED",
    netPriceRappen: 14_900,
    importAccess: false,
  });
  const pro = await createPlan(database, {
    code: "PRO",
    name: "Pro",
    isDefaultFree: false,
    isPublic: true,
    isSelfService: true,
    priceMode: "FIXED",
    netPriceRappen: 39_900,
    importAccess: false,
  });
  const business = await createPlan(database, {
    code: "BUSINESS",
    name: "Business",
    isDefaultFree: false,
    isPublic: true,
    isSelfService: false,
    priceMode: "FIXED",
    netPriceRappen: 89_900,
    importAccess: true,
  });
  const enterprise = await createPlan(database, {
    code: "ENTERPRISE_CONTRACT",
    name: "Enterprise Contract",
    isDefaultFree: false,
    isPublic: false,
    isSelfService: false,
    priceMode: "CONTRACT",
    netPriceRappen: null,
    importAccess: true,
  });
  const publicEnterpriseDraft = await database.planVersion.create({
    data: {
      planId: enterprise.planId,
      version: 2,
      status: "DRAFT",
      priceMode: "CONTRACT",
      billingInterval: "MONTHLY",
      termMonths: 12,
      netPriceRappen: null,
      monthlyEquivalentRappen: null,
      currency: "CHF",
      isPublic: true,
      isSelfService: false,
      validFrom: CATALOG_FROM,
      entitlements: { create: entitlementRows(true) },
    },
  });
  const publicEnterpriseVersion = await database.planVersion.update({
    where: { id: publicEnterpriseDraft.id },
    data: { status: "INACTIVE" },
  });

  const starterTenant = await createTenant(database, "starter", canton.id, city.id);
  const starterRecheckTenant = await createTenant(database, "starter-recheck", canton.id, city.id);
  const proTenant = await createTenant(database, "pro", canton.id, city.id);
  const businessTenant = await createTenant(database, "business", canton.id, city.id);
  const privateEnterpriseTenant = await createTenant(database, "enterprise-private", canton.id, city.id);
  const publicEnterpriseTenant = await createTenant(database, "enterprise-public", canton.id, city.id);
  await Promise.all([
    subscribe(database, starterTenant.companyId, starter.id, ADDITIONAL_NOW, 14_900),
    subscribe(database, starterRecheckTenant.companyId, starter.id, ADDITIONAL_NOW, 14_900),
    subscribe(database, proTenant.companyId, pro.id, ADDITIONAL_NOW, 39_900),
    subscribe(database, businessTenant.companyId, business.id, IMPORT_NOW, 89_900),
    subscribe(database, privateEnterpriseTenant.companyId, enterprise.id, IMPORT_NOW, 120_000),
    subscribe(database, publicEnterpriseTenant.companyId, publicEnterpriseVersion.id, IMPORT_NOW, 120_000),
  ]);

  const eligibleJobId = await createApprovedJob(database, {
    companyId: starterTenant.companyId,
    userId: starterTenant.userId,
    categoryId: category.id,
    cantonId: canton.id,
    cityId: city.id,
    suffix: "eligible",
    validThrough: new Date(ADDITIONAL_NOW.getTime() + 20 * 86_400_000),
  });
  const secondEligibleJobId = await createApprovedJob(database, {
    companyId: starterRecheckTenant.companyId,
    userId: starterRecheckTenant.userId,
    categoryId: category.id,
    cantonId: canton.id,
    cityId: city.id,
    suffix: "recheck",
    validThrough: new Date(ADDITIONAL_NOW.getTime() + 20 * 86_400_000),
  });
  const tooLongJobId = await createApprovedJob(database, {
    companyId: starterRecheckTenant.companyId,
    userId: starterRecheckTenant.userId,
    categoryId: category.id,
    cantonId: canton.id,
    cityId: city.id,
    suffix: "too-long",
    validThrough: new Date(ADDITIONAL_NOW.getTime() + 31 * 86_400_000),
  });
  const proJobId = await createApprovedJob(database, {
    companyId: proTenant.companyId,
    userId: proTenant.userId,
    categoryId: category.id,
    cantonId: canton.id,
    cityId: city.id,
    suffix: "pro",
    validThrough: new Date(ADDITIONAL_NOW.getTime() + 20 * 86_400_000),
  });

  const additional = await createReleasedProduct(database, admin.id, {
    code: "additional-job-30d",
    name: "Zusatzstelle 30 Tage",
    type: "ADDITIONAL_JOB",
    price: 12_900,
    durationDays: 30,
    isPublic: true,
    isSelfService: true,
  });
  const importSetup = await createReleasedProduct(database, admin.id, {
    code: "import-setup",
    name: "XML/JSON Import Setup",
    type: "IMPORT_SETUP",
    price: 75_000,
    durationDays: null,
    isPublic: false,
    isSelfService: false,
  });
  void importSetup;
  const source = await database.importSource.create({
    data: {
      name: "P1 controlled source",
      sourceReference: "p1-controlled-source",
      licenseReference: "documented-test-license",
      format: "XML",
      isActive: true,
    },
  });
  const businessApprovalId = await createApproval(database, admin.id, businessTenant.companyId, source.id, "business", new Date("2028-03-15T00:00:00.000Z"));
  const secondBusinessApprovalId = await createApproval(database, admin.id, businessTenant.companyId, source.id, "business-overlap", new Date("2028-03-15T00:00:00.000Z"));
  const privateEnterpriseApprovalId = await createApproval(database, admin.id, privateEnterpriseTenant.companyId, source.id, "enterprise-private", new Date("2028-03-15T00:00:00.000Z"));
  const publicEnterpriseApprovalId = await createApproval(database, admin.id, publicEnterpriseTenant.companyId, source.id, "enterprise-public", new Date("2028-03-15T00:00:00.000Z"));
  const expiredBusinessApprovalId = await createApproval(database, admin.id, businessTenant.companyId, source.id, "business-expired", new Date("2028-02-28T00:00:00.000Z"));

  const tax = await database.taxRateVersion.create({
    data: {
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_DEMO",
      rateBasisPoints: 810,
      validFrom: CATALOG_FROM,
      source: "P1 deterministic test",
      reviewStatus: "DRAFT",
    },
  });
  await database.taxRateVersion.update({
    where: { id: tax.id },
    data: {
      reviewStatus: "APPROVED",
      reviewedByUserId: admin.id,
      reviewedAt: CATALOG_FROM,
    },
  });

  return Object.freeze({
    adminActor: Object.freeze({
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    }),
    starterActor: starterTenant.actor,
    starterRecheckActor: starterRecheckTenant.actor,
    proActor: proTenant.actor,
    businessActor: businessTenant.actor,
    privateEnterpriseActor: privateEnterpriseTenant.actor,
    publicEnterpriseActor: publicEnterpriseTenant.actor,
    eligibleJobId,
    secondEligibleJobId,
    tooLongJobId,
    proJobId,
    additionalProductId: additional.productId,
    additionalProductVersionId: additional.versionId,
    importSourceId: source.id,
    businessApprovalId,
    secondBusinessApprovalId,
    privateEnterpriseApprovalId,
    publicEnterpriseApprovalId,
    expiredBusinessApprovalId,
  });
}

async function createTenant(
  database: DatabaseClient,
  suffix: string,
  cantonId: string,
  cityId: string,
) {
  const email = `p1-${suffix}@example.ch`;
  const user = await database.user.create({
    data: { email, emailNormalized: email, role: "EMPLOYER", status: "ACTIVE" },
  });
  const company = await database.company.create({
    data: {
      name: `P1 ${suffix} AG`,
      slug: `p1-${suffix}`,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Kontrollierte Testgesellschaft für Phase-12-P1-Verträge.",
      website: `https://p1-${suffix}.example.ch`,
      values: [],
      benefits: [],
      locations: {
        create: {
          cantonId,
          cityId,
          isPrimary: true,
          address: "Teststrasse 12",
          postalCode: "8000",
        },
      },
    },
  });
  await database.company.update({ where: { id: company.id }, data: { status: "ACTIVE" } });
  const membership = await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: CATALOG_FROM,
    },
  });
  await database.companyBillingProfile.create({
    data: {
      companyId: company.id,
      legalName: company.name,
      billingContactEmail: email,
      street: "Teststrasse 12",
      postalCode: "8000",
      city: "Zürich",
      countryCode: "CH",
    },
  });
  return Object.freeze({
    companyId: company.id,
    userId: user.id,
    actor: Object.freeze({
      userId: user.id,
      email,
      companyId: company.id,
      membershipId: membership.id,
      membershipRole: "OWNER" as const,
    }),
  });
}

async function createPlan(
  database: DatabaseClient,
  input: Readonly<{
    code: string;
    name: string;
    isDefaultFree: boolean;
    isPublic: boolean;
    isSelfService: boolean;
    priceMode: "FIXED" | "CONTRACT";
    netPriceRappen: number | null;
    importAccess: boolean;
  }>,
) {
  const plan = await database.plan.create({
    data: { code: input.code, name: input.name, isDefaultFree: input.isDefaultFree },
  });
  const draft = await database.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: input.priceMode,
      billingInterval: "MONTHLY",
      termMonths: input.priceMode === "CONTRACT" ? 12 : 1,
      netPriceRappen: input.netPriceRappen,
      monthlyEquivalentRappen: input.netPriceRappen,
      currency: "CHF",
      isPublic: input.isPublic,
      isSelfService: input.isSelfService,
      validFrom: CATALOG_FROM,
      entitlements: { create: entitlementRows(input.importAccess) },
    },
  });
  const version = await database.planVersion.update({
    where: { id: draft.id },
    data: { status: "ACTIVE" },
  });
  return Object.freeze({ id: version.id, planId: plan.id });
}

function entitlementRows(importAccess: boolean) {
  return [
    { key: "ACTIVE_JOB_LIMIT" as const, valueType: "INTEGER" as const, integerValue: 30 },
    { key: "SEAT_LIMIT" as const, valueType: "INTEGER" as const, integerValue: 15 },
    { key: "TALENT_RADAR_ACCESS" as const, valueType: "BOOLEAN" as const, booleanValue: true },
    { key: "TALENT_CONTACT_ALLOWANCE" as const, valueType: "INTEGER" as const, integerValue: 50 },
    { key: "JOB_BOOST_ALLOWANCE" as const, valueType: "INTEGER" as const, integerValue: 10 },
    { key: "ANALYTICS_LEVEL" as const, valueType: "ANALYTICS_LEVEL" as const, analyticsLevelValue: "PRO" as const },
    { key: "ENHANCED_COMPANY_PROFILE" as const, valueType: "BOOLEAN" as const, booleanValue: true },
    { key: "EMPLOYER_IMPORT_ACCESS" as const, valueType: "BOOLEAN" as const, booleanValue: importAccess },
  ];
}

function subscribe(
  database: DatabaseClient,
  companyId: string,
  planVersionId: string,
  at: Date,
  recurringNetRappen: number,
) {
  return database.employerSubscription.create({
    data: {
      companyId,
      planVersionId,
      status: "ACTIVE",
      currentPeriodStart: new Date(at.getTime() - 10 * 86_400_000),
      currentPeriodEnd: new Date(at.getTime() + 40 * 86_400_000),
      billingIntervalSnapshot: "MONTHLY",
      termMonthsSnapshot: 1,
      recurringNetRappenSnapshot: recurringNetRappen,
      monthlyEquivalentRappenSnapshot: recurringNetRappen,
      currencySnapshot: "CHF",
      activatedAt: new Date(at.getTime() - 10 * 86_400_000),
    },
  });
}

async function createApprovedJob(
  database: DatabaseClient,
  input: Readonly<{
    companyId: string;
    userId: string;
    categoryId: string;
    cantonId: string;
    cityId: string;
    suffix: string;
    validThrough: Date;
  }>,
) {
  const job = await database.job.create({
    data: {
      companyId: input.companyId,
      slug: `p1-job-${input.suffix}`,
      status: "DRAFT",
      createdByUserId: input.userId,
    },
  });
  const revision = await database.jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: `P1 Job ${input.suffix}`,
      description: "Deterministische P1 Zusatzstellen-Testbeschreibung.",
      tasks: ["Sichere Fulfillment-Abläufe betreiben."],
      requirements: ["PostgreSQL Transaktionen verstehen."],
      applicationProcessSteps: ["Bewerbung einreichen."],
      requiredDocumentKinds: ["NONE"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: input.categoryId,
      cantonId: input.cantonId,
      cityId: input.cityId,
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      validThrough: input.validThrough,
      responseTargetDays: 14,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.ch",
      authoredByUserId: input.userId,
      contentChecksum: Buffer.from(input.suffix).toString("hex").padEnd(64, "0").slice(0, 64),
      submittedAt: CATALOG_FROM,
      approvedAt: CATALOG_FROM,
    },
  });
  await database.job.update({
    where: { id: job.id },
    data: { status: "APPROVED", currentRevisionId: revision.id },
  });
  return job.id;
}

async function createReleasedProduct(
  database: DatabaseClient,
  adminUserId: string,
  input: Readonly<{
    code: string;
    name: string;
    type: "ADDITIONAL_JOB" | "IMPORT_SETUP";
    price: number;
    durationDays: number | null;
    isPublic: boolean;
    isSelfService: boolean;
  }>,
) {
  const product = await database.product.create({
    data: { code: input.code, name: input.name, type: input.type },
  });
  const decision = await database.productReleaseDecision.create({
    data: {
      productId: product.id,
      releaseTier: "P1",
      allowsPublic: input.isPublic,
      allowsSelfService: input.isSelfService,
      reasonCode: "P1_FULFILLMENT_VERIFIED",
      rationale: "Preis, Handler, Kontextprüfung und Betrieb sind im Integrationstest belegt.",
      decidedByUserId: adminUserId,
      expiresAt: RELEASE_EXPIRY,
      idempotencyKey: `fixture-release:${randomUUID()}`,
      createdAt: CATALOG_FROM,
    },
  });
  const draft = await database.productVersion.create({
    data: {
      productId: product.id,
      version: 1,
      status: "DRAFT",
      netPriceRappen: input.price,
      currency: "CHF",
      durationDays: input.durationDays,
      creditType: null,
      creditAmount: null,
      isPublic: input.isPublic,
      isSelfService: input.isSelfService,
      requiresLegalReview: false,
      releaseDecisionId: decision.id,
      validFrom: CATALOG_FROM,
    },
  });
  const active = await database.productVersion.update({
    where: { id: draft.id },
    data: { status: "ACTIVE" },
  });
  return Object.freeze({ productId: product.id, versionId: active.id });
}

async function createApproval(
  database: DatabaseClient,
  adminUserId: string,
  companyId: string,
  importSourceId: string,
  suffix: string,
  validUntil: Date,
) {
  const approval = await database.importSetupApproval.create({
    data: {
      companyId,
      importSourceId,
      sourceRightsEvidence: "Dokumentierte Quellrechte für den P1 Integrationstest.",
      mappingEvidence: "Geprüfte und versionierte Feldzuordnung für den Test.",
      approvedByUserId: adminUserId,
      approvalReason: "P1_IMPORT_SETUP_APPROVED",
      validUntil,
      status: "APPROVED",
      idempotencyKey: `p1-approval:${suffix}`,
      createdAt: CATALOG_FROM,
      updatedAt: CATALOG_FROM,
    },
  });
  return approval.id;
}
