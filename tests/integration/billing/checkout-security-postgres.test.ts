import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deactivateProductVersion } from "@/lib/billing/admin-billing";
import { saveCompanyBillingProfile } from "@/lib/billing/billing-profile";
import type { BillingDependencies } from "@/lib/billing/contracts";
import {
  getCompanyInvoice,
} from "@/lib/billing/employer-read-model";
import {
  confirmMockPayment,
  createCheckoutOrder,
} from "@/lib/billing/orders";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { MockEmailProvider } from "@/lib/providers/email";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import {
  MockPaymentProvider,
  type PaymentProvider,
} from "@/lib/providers/payments";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type BillingActor = BillingDependencies["actor"];

type BillingProfileSeed = Readonly<{
  legalName: string;
  billingContactEmail: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: "CH";
  uid: string | null;
  vatNumber: string | null;
}>;

type ActorFixture = Readonly<{
  actor: BillingActor;
  profile: BillingProfileSeed | null;
}>;

type CheckoutSecurityFixtures = Readonly<{
  authorization: ActorFixture;
  catalogAdminId: string;
  catalogRace: ActorFixture;
  concurrent: ActorFixture;
  foreign: ActorFixture;
  incompleteProfile: ActorFixture;
  missingProfile: ActorFixture;
  radarLoss: ActorFixture;
  radarSubscriptionId: string;
  revokedActor: BillingActor;
  snapshot: ActorFixture;
  starterRadarGrant: ActorFixture;
  staleActor: BillingActor;
}>;

const NOW = new Date("2026-07-21T10:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T10:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T10:00:00.000Z");

const immutableOrderSelect = {
  billingLegalNameSnapshot: true,
  billingContactEmailSnapshot: true,
  billingStreetSnapshot: true,
  billingPostalCodeSnapshot: true,
  billingCitySnapshot: true,
  billingCountryCodeSnapshot: true,
  billingUidSnapshot: true,
  billingVatNumberSnapshot: true,
  currency: true,
  netTotalRappen: true,
  vatTotalRappen: true,
  totalRappen: true,
  lines: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      descriptionSnapshot: true,
      quantity: true,
      unitNetRappen: true,
      netRappen: true,
      taxRateBasisPoints: true,
      vatRappen: true,
      totalRappen: true,
      currency: true,
    },
  },
  invoice: {
    select: {
      billingLegalNameSnapshot: true,
      billingContactEmailSnapshot: true,
      billingStreetSnapshot: true,
      billingPostalCodeSnapshot: true,
      billingCitySnapshot: true,
      billingCountryCodeSnapshot: true,
      billingUidSnapshot: true,
      billingVatNumberSnapshot: true,
      currency: true,
      netTotalRappen: true,
      vatTotalRappen: true,
      totalRappen: true,
      lines: {
        orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
        select: {
          descriptionSnapshot: true,
          quantity: true,
          unitNetRappen: true,
          netRappen: true,
          taxRateBasisPoints: true,
          vatRappen: true,
          totalRappen: true,
          currency: true,
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

const billingProfileSelect = {
  legalName: true,
  billingContactEmail: true,
  street: true,
  postalCode: true,
  city: true,
  countryCode: true,
  uid: true,
  vatNumber: true,
  version: true,
} as const;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtures: CheckoutSecurityFixtures | undefined;

function client() {
  if (database === undefined) {
    throw new Error("Checkout security test DB unavailable.");
  }
  return database;
}

function data() {
  if (fixtures === undefined) {
    throw new Error("Checkout security fixtures unavailable.");
  }
  return fixtures;
}

function dependencies(
  actor: BillingActor,
  paymentProvider: PaymentProvider = new MockPaymentProvider(),
): BillingDependencies {
  return Object.freeze({
    actor,
    correlationId: randomUUID(),
    database: client(),
    paymentProvider,
    emailProvider: new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    ),
    now: NOW,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_checkout_security");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  fixtures = await seedCheckoutSecurityFixtures(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 checkout authorization and transaction security", () => {
  it("rejects foreign, stale-role and removed Membership actors before provider confirmation", async () => {
    const orderId = await createStarterOrder(
      data().authorization.actor,
      "phase12-security-authorization-order",
    );
    const observed = createObservedPaymentProvider();
    const attempts = [
      {
        actor: data().foreign.actor,
        idempotencyKey: "phase12-security-confirm-foreign",
      },
      {
        actor: data().staleActor,
        idempotencyKey: "phase12-security-confirm-stale",
      },
      {
        actor: data().revokedActor,
        idempotencyKey: "phase12-security-confirm-removed",
      },
    ] as const;

    for (const attempt of attempts) {
      await expect(
        confirmMockPayment(
          {
            orderId,
            idempotencyKey: attempt.idempotencyKey,
          },
          dependencies(attempt.actor, observed.paymentProvider),
        ),
      ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    }

    expect(observed.confirmPayment).not.toHaveBeenCalled();
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          status: true,
          paidAt: true,
          providerReference: true,
          invoice: { select: { id: true } },
          paymentEvents: {
            orderBy: { createdAt: "asc" },
            select: { kind: true },
          },
        },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      paidAt: null,
      providerReference: null,
      invoice: null,
      paymentEvents: [{ kind: "CHECKOUT_CREATED" }],
    });
  });

  it("never confirms a non-Mock Order through the local Mock payment command", async () => {
    const orderId = await createPendingStripeOrder(
      data().authorization.actor,
      "phase12-security-stripe-order",
    );
    const observed = createObservedPaymentProvider();

    await expect(
      confirmMockPayment(
        {
          orderId,
          idempotencyKey: "phase12-security-stripe-confirm",
        },
        dependencies(data().authorization.actor, observed.paymentProvider),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    expect(observed.confirmPayment).not.toHaveBeenCalled();
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          provider: true,
          status: true,
          paidAt: true,
          providerReference: true,
          invoice: { select: { id: true } },
          subscription: { select: { id: true } },
          paymentEvents: {
            orderBy: { createdAt: "asc" },
            select: { kind: true, provider: true },
          },
        },
      }),
    ).resolves.toEqual({
      provider: "STRIPE",
      status: "PENDING",
      paidAt: null,
      providerReference: null,
      invoice: null,
      subscription: null,
      paymentEvents: [{ kind: "CHECKOUT_CREATED", provider: "STRIPE" }],
    });
  });

  it("rolls back every local payment effect when Radar access disappears after preauthorization", async () => {
    const orderId = await createContactPackOrder(
      data().radarLoss.actor,
      "phase12-security-radar-loss-order",
    );
    const orderBefore = await client().order.findUniqueOrThrow({
      where: { id: orderId },
      select: { lines: { select: { id: true } } },
    });
    const orderLineId = orderBefore.lines[0]?.id;
    if (orderLineId === undefined) {
      throw new Error("Radar-loss OrderLine unavailable.");
    }
    const auditCountBefore = await client().auditLog.count({
      where: { companyId: data().radarLoss.actor.companyId },
    });
    const observed = createObservedPaymentProvider(async () => {
      await client().employerSubscription.update({
        where: { id: data().radarSubscriptionId },
        data: { status: "EXPIRED", endedAt: NOW },
      });
    });

    await expect(
      confirmMockPayment(
        {
          orderId,
          idempotencyKey: "phase12-security-radar-loss-confirm",
        },
        dependencies(data().radarLoss.actor, observed.paymentProvider),
      ),
    ).resolves.toEqual({ ok: false, code: "TALENT_RADAR_REQUIRED" });

    expect(observed.confirmPayment).toHaveBeenCalledTimes(1);
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          status: true,
          paidAt: true,
          providerReference: true,
        },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      paidAt: null,
      providerReference: null,
    });
    await expect(
      client().paymentEvent.count({
        where: { orderId, kind: "PAID" },
      }),
    ).resolves.toBe(0);
    await expect(
      client().invoice.count({ where: { orderId } }),
    ).resolves.toBe(0);
    await expect(
      client().creditLedgerEntry.count({
        where: { sourceOrderLineId: orderLineId },
      }),
    ).resolves.toBe(0);
    await expect(
      client().auditLog.count({
        where: { companyId: data().radarLoss.actor.companyId },
      }),
    ).resolves.toBe(auditCountBefore);
    await expect(
      client().auditLog.count({
        where: {
          companyId: data().radarLoss.actor.companyId,
          action: {
            in: [
              "ORDER_PAID",
              "INVOICE_ISSUED",
              "INVOICE_PAID",
              "CREDITS_GRANTED",
            ],
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      client().emailLog.count({
        where: { recipient: data().radarLoss.actor.email },
      }),
    ).resolves.toBe(0);
    await expect(
      client().notification.count({
        where: { recipientUserId: data().radarLoss.actor.userId },
      }),
    ).resolves.toBe(0);
    await expect(
      client().analyticsEvent.groupBy({
        by: ["kind"],
        where: {
          companyId: data().radarLoss.actor.companyId,
          kind: { in: ["CHECKOUT_STARTED", "CHECKOUT_COMPLETED"] },
        },
        _count: { _all: true },
        orderBy: { kind: "asc" },
      }),
    ).resolves.toEqual([
      { kind: "CHECKOUT_STARTED", _count: { _all: 1 } },
    ]);
  });

  it("serializes two parallel confirmations into one paid event, invoice and fulfillment", async () => {
    const actor = data().concurrent.actor;
    const orderId = await createStarterOrder(
      actor,
      "phase12-security-concurrent-order",
    );
    const deps = dependencies(actor);
    await expect(
      createCheckoutOrder(
        {
          kind: "PLAN",
          planSlug: "starter",
          idempotencyKey: "phase12-security-concurrent-order",
        },
        deps,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        replay: true,
        value: expect.objectContaining({ orderId, status: "PENDING" }),
      }),
    );
    const input = {
      orderId,
      idempotencyKey: "phase12-security-concurrent-confirm",
    } as const;

    const results = await Promise.all([
      confirmMockPayment(input, deps),
      confirmMockPayment(input, deps),
    ]);

    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(
      results.filter((result) => result.ok && result.replay === true),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.ok && result.replay !== true),
    ).toHaveLength(1);
    for (const result of results) {
      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          value: expect.objectContaining({
            orderId,
            invoiceId: expect.any(String),
            subscriptionId: expect.any(String),
            emailsRecorded: true,
          }),
        }),
      );
    }

    const order = await client().order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        invoice: { include: { lines: true } },
        paymentEvents: true,
        subscription: { include: { events: true } },
      },
    });
    expect(order.status).toBe("PAID");
    expect(
      order.paymentEvents.filter((event) => event.kind === "PAID"),
    ).toHaveLength(1);
    expect(order.invoice?.lines).toHaveLength(1);
    expect(order.subscription?.events).toEqual([
      expect.objectContaining({ kind: "ACTIVATED" }),
    ]);
    await expect(
      client().invoice.count({ where: { orderId } }),
    ).resolves.toBe(1);
    await expect(
      client().employerSubscription.count({
        where: { sourceOrderId: orderId },
      }),
    ).resolves.toBe(1);

    const emailLogs = await client().emailLog.findMany({
      where: { recipient: actor.email },
      orderBy: { templateKey: "asc" },
      select: { templateKey: true },
    });
    expect(emailLogs).toEqual([
      { templateKey: "invoice_issued" },
      { templateKey: "payment_received" },
      { templateKey: "subscription_activated" },
    ]);
    const notifications = await client().notification.findMany({
      where: { recipientUserId: actor.userId },
      select: { kind: true },
    });
    expect(notifications.map((notification) => notification.kind).sort()).toEqual(
      ["INVOICE_ISSUED", "ORDER_PAID", "SUBSCRIPTION_CHANGED"],
    );
    const checkoutEvents = await client().analyticsEvent.findMany({
      where: {
        companyId: actor.companyId,
        kind: { in: ["CHECKOUT_STARTED", "CHECKOUT_COMPLETED"] },
      },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
      select: {
        producer: true,
        dedupeKey: true,
        kind: true,
        schemaVersion: true,
        purpose: true,
        occurredAt: true,
        pseudonymousActorId: true,
        pseudonymousSessionId: true,
        companyId: true,
        jobId: true,
        actorProvenanceSnapshot: true,
        companyProvenanceSnapshot: true,
        jobProvenanceSnapshot: true,
        properties: true,
      },
    });
    expect(checkoutEvents).toHaveLength(2);
    expect(checkoutEvents.map((event) => event.kind).sort()).toEqual([
      "CHECKOUT_COMPLETED",
      "CHECKOUT_STARTED",
    ]);
    expect(new Set(checkoutEvents.map((event) => event.dedupeKey)).size).toBe(2);
    expect(new Set(checkoutEvents.map((event) => event.pseudonymousSessionId))).toEqual(
      new Set([checkoutEvents[0]?.pseudonymousSessionId]),
    );
    for (const event of checkoutEvents) {
      expect(event).toEqual(
        expect.objectContaining({
          producer: "billing-checkout",
          schemaVersion: "1",
          purpose: "ESSENTIAL_OPERATIONAL",
          occurredAt: NOW,
          companyId: actor.companyId,
          jobId: null,
          actorProvenanceSnapshot: "LIVE",
          companyProvenanceSnapshot: "LIVE",
          jobProvenanceSnapshot: null,
          properties: { planSlug: "starter", amountRappen: 14_900 },
        }),
      );
      expect(event.pseudonymousActorId).toMatch(/^billing-actor-[0-9a-f]{32}$/u);
      expect(event.pseudonymousActorId).not.toBe(actor.userId);
      expect(event.pseudonymousSessionId).toMatch(/^billing-order-[0-9a-f]{32}$/u);
      expect(event.pseudonymousSessionId).not.toBe(orderId);
    }
  });

  it("creates zero Orders when the BillingProfile is missing", async () => {
    await expectProfileRequiredWithoutOrder(
      data().missingProfile.actor,
      "phase12-security-profile-missing",
    );
  });

  it("creates zero Orders when the BillingProfile is incomplete", async () => {
    await expectProfileRequiredWithoutOrder(
      data().incompleteProfile.actor,
      "phase12-security-profile-incomplete",
    );
  });

  it("creates zero Orders for Starter even when an active grant adds Radar access", async () => {
    const actor = data().starterRadarGrant.actor;
    const observed = createObservedPaymentProvider();

    await expect(
      client().order.count({ where: { companyId: actor.companyId } }),
    ).resolves.toBe(0);
    await expect(
      createCheckoutOrder(
        {
          kind: "PRODUCT",
          productSlug: "contact-pack-10",
          quantity: 1,
          idempotencyKey: "phase12-security-starter-radar-contact-pack",
        },
        dependencies(actor, observed.paymentProvider),
      ),
    ).resolves.toEqual({ ok: false, code: "TALENT_RADAR_REQUIRED" });
    await expect(
      client().order.count({ where: { companyId: actor.companyId } }),
    ).resolves.toBe(0);
    expect(observed.createCheckout).not.toHaveBeenCalled();
    await expect(
      client().analyticsEvent.count({
        where: {
          companyId: actor.companyId,
          kind: { in: ["CHECKOUT_STARTED", "CHECKOUT_COMPLETED"] },
        },
      }),
    ).resolves.toBe(0);
  });

  it("rechecks ProductVersion effectiveness after provider preauthorization", async () => {
    const orderId = await createContactPackOrder(
      data().catalogRace.actor,
      "phase12-security-catalog-race-order",
    );
    const line = await client().orderLine.findFirstOrThrow({
      where: { orderId },
      select: { productVersionId: true },
    });
    if (line.productVersionId === null) {
      throw new Error("Catalog-race ProductVersion unavailable.");
    }
    const observed = createObservedPaymentProvider(async () => {
      await expect(
        deactivateProductVersion(
          {
            versionId: line.productVersionId,
            reasonCode: "CHECKOUT_CATALOG_RACE_TEST",
            idempotencyKey: randomUUID(),
          },
          {
            actor: {
              userId: data().catalogAdminId,
              email: "phase12-security-tax-reviewer@example.ch",
              role: "ADMIN",
              status: "ACTIVE",
            },
            correlationId: randomUUID(),
            database: client(),
            now: NOW,
          },
        ),
      ).resolves.toEqual(expect.objectContaining({ ok: true }));
    });

    await expect(
      confirmMockPayment(
        {
          orderId,
          idempotencyKey: "phase12-security-catalog-race-confirm",
        },
        dependencies(data().catalogRace.actor, observed.paymentProvider),
      ),
    ).resolves.toEqual({ ok: false, code: "PRODUCT_NOT_AVAILABLE" });
    expect(observed.confirmPayment).toHaveBeenCalledTimes(1);
    await expect(
      client().order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          status: true,
          paidAt: true,
          invoice: { select: { id: true } },
          paymentEvents: { where: { kind: "PAID" }, select: { id: true } },
        },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      paidAt: null,
      invoice: null,
      paymentEvents: [],
    });
  });

  it("keeps paid Order and Invoice snapshots immutable and scopes Invoice reads", async () => {
    const actor = data().snapshot.actor;
    const profile = requireCompleteProfile(data().snapshot);
    const orderId = await createStarterOrder(
      actor,
      "phase12-security-snapshot-order",
    );
    const confirmed = await confirmMockPayment(
      {
        orderId,
        idempotencyKey: "phase12-security-snapshot-confirm",
      },
      dependencies(actor),
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          invoiceId: expect.any(String),
        }),
      }),
    );
    if (!confirmed.ok) {
      throw new Error("Snapshot checkout confirmation unexpectedly failed.");
    }

    const immutableBefore = await client().order.findUniqueOrThrow({
      where: { id: orderId },
      select: immutableOrderSelect,
    });
    expect(immutableBefore).toEqual(
      expect.objectContaining({
        billingLegalNameSnapshot: profile.legalName,
        billingContactEmailSnapshot: profile.billingContactEmail,
        billingStreetSnapshot: profile.street,
        billingPostalCodeSnapshot: profile.postalCode,
        billingCitySnapshot: profile.city,
        billingCountryCodeSnapshot: profile.countryCode,
        billingUidSnapshot: profile.uid,
        billingVatNumberSnapshot: profile.vatNumber,
        invoice: expect.objectContaining({
          billingLegalNameSnapshot: profile.legalName,
          billingContactEmailSnapshot: profile.billingContactEmail,
          billingStreetSnapshot: profile.street,
          billingPostalCodeSnapshot: profile.postalCode,
          billingCitySnapshot: profile.city,
          billingCountryCodeSnapshot: profile.countryCode,
          billingUidSnapshot: profile.uid,
          billingVatNumberSnapshot: profile.vatNumber,
        }),
      }),
    );
    const currentProfile = await client().companyBillingProfile.findUniqueOrThrow({
      where: { companyId: actor.companyId },
      select: { version: true },
    });

    await expect(
      saveCompanyBillingProfile(
        {
          legalName: "Neue Rechnungsadresse AG",
          billingContactEmail: "neue-rechnung@example.ch",
          street: "Neuweg 99",
          postalCode: "3000",
          city: "Bern",
          countryCode: "CH",
          uid: "CHE-999.999.999",
          vatNumber: "CHE-999.999.999 MWST",
          expectedVersion: currentProfile.version,
        },
        {
          actor,
          correlationId: randomUUID(),
          database: client(),
          now: NOW,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          legalName: "Neue Rechnungsadresse AG",
          version: currentProfile.version + 1,
        }),
      }),
    );

    const immutableAfter = await client().order.findUniqueOrThrow({
      where: { id: orderId },
      select: immutableOrderSelect,
    });
    expect(immutableAfter).toEqual(immutableBefore);

    const ownInvoice = await getCompanyInvoice(
      client(),
      actor.companyId,
      confirmed.value.invoiceId,
      NOW,
    );
    const foreignInvoice = await getCompanyInvoice(
      client(),
      data().foreign.actor.companyId,
      confirmed.value.invoiceId,
      NOW,
    );
    const nonexistentInvoice = await getCompanyInvoice(
      client(),
      actor.companyId,
      randomUUID(),
      NOW,
    );
    expect(ownInvoice).toEqual(
      expect.objectContaining({
        id: confirmed.value.invoiceId,
        companyId: actor.companyId,
      }),
    );
    expect(foreignInvoice).toBeNull();
    expect(nonexistentInvoice).toBeNull();
    expect(foreignInvoice).toEqual(nonexistentInvoice);
  });

  it("fails closed when a Membership context targets another Company's BillingProfile", async () => {
    const targetCompanyId = data().foreign.actor.companyId;
    const profileBefore = await client().companyBillingProfile.findUniqueOrThrow({
      where: { companyId: targetCompanyId },
      select: billingProfileSelect,
    });
    const auditCountBefore = await client().auditLog.count({
      where: {
        companyId: targetCompanyId,
        action: "BILLING_PROFILE_UPDATED",
      },
    });
    const forgedActor = Object.freeze({
      ...data().authorization.actor,
      companyId: targetCompanyId,
    });

    await expect(
      saveCompanyBillingProfile(
        {
          legalName: "Angreifer Profil AG",
          billingContactEmail: "angreifer@example.ch",
          street: "Fremdweg 1",
          postalCode: "4000",
          city: "Basel",
          countryCode: "CH",
          expectedVersion: profileBefore.version,
        },
        {
          actor: forgedActor,
          correlationId: randomUUID(),
          database: client(),
          now: NOW,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    await expect(
      client().companyBillingProfile.findUniqueOrThrow({
        where: { companyId: targetCompanyId },
        select: billingProfileSelect,
      }),
    ).resolves.toEqual(profileBefore);
    await expect(
      client().auditLog.count({
        where: {
          companyId: targetCompanyId,
          action: "BILLING_PROFILE_UPDATED",
        },
      }),
    ).resolves.toBe(auditCountBefore);
  });
});

async function createStarterOrder(
  actor: BillingActor,
  idempotencyKey: string,
) {
  const checkout = await createCheckoutOrder(
    {
      kind: "PLAN",
      planSlug: "starter",
      idempotencyKey,
    },
    dependencies(actor),
  );
  expect(checkout).toEqual(
    expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        status: "PENDING",
        orderId: expect.any(String),
      }),
    }),
  );
  if (!checkout.ok) {
    throw new Error("Starter checkout unexpectedly failed.");
  }
  return checkout.value.orderId;
}

async function createPendingStripeOrder(
  actor: BillingActor,
  idempotencyKey: string,
) {
  const sourceOrderId = await createStarterOrder(
    actor,
    `${idempotencyKey}-source`,
  );
  const source = await client().order.findUniqueOrThrow({
    where: { id: sourceOrderId },
    include: {
      lines: {
        include: { subscriptionSnapshot: true },
      },
    },
  });
  const sourceLine = source.lines[0];
  const snapshot = sourceLine?.subscriptionSnapshot;
  if (sourceLine === undefined || snapshot === null || snapshot === undefined) {
    throw new Error("Starter source snapshot unavailable for Stripe fixture.");
  }
  const orderId = randomUUID();
  const orderLineId = randomUUID();

  await client().$transaction(async (transaction) => {
    await transaction.order.create({
      data: {
        id: orderId,
        companyId: source.companyId,
        createdByUserId: source.createdByUserId,
        status: "DRAFT",
        provider: "STRIPE",
        clientIdempotencyKey: idempotencyKey,
        providerIdempotencyKey: `stripe:${idempotencyKey}`,
        requestFingerprint: orderId.replaceAll("-", "").repeat(2),
        billingLegalNameSnapshot: source.billingLegalNameSnapshot,
        billingContactEmailSnapshot: source.billingContactEmailSnapshot,
        billingStreetSnapshot: source.billingStreetSnapshot,
        billingPostalCodeSnapshot: source.billingPostalCodeSnapshot,
        billingCitySnapshot: source.billingCitySnapshot,
        billingCountryCodeSnapshot: source.billingCountryCodeSnapshot,
        billingUidSnapshot: source.billingUidSnapshot,
        billingVatNumberSnapshot: source.billingVatNumberSnapshot,
        currency: source.currency,
        netTotalRappen: source.netTotalRappen,
        vatTotalRappen: source.vatTotalRappen,
        totalRappen: source.totalRappen,
        expiresAt: source.expiresAt,
        lines: {
          create: {
            id: orderLineId,
            planVersionId: sourceLine.planVersionId,
            productVersionId: sourceLine.productVersionId,
            taxRateVersionId: sourceLine.taxRateVersionId,
            quantity: sourceLine.quantity,
            unitNetRappen: sourceLine.unitNetRappen,
            netRappen: sourceLine.netRappen,
            taxRateBasisPoints: sourceLine.taxRateBasisPoints,
            vatRappen: sourceLine.vatRappen,
            totalRappen: sourceLine.totalRappen,
            currency: sourceLine.currency,
            descriptionSnapshot: sourceLine.descriptionSnapshot,
            fulfillmentContext: sourceLine.fulfillmentContext,
            targetJobId: sourceLine.targetJobId,
            targetImportSourceId: sourceLine.targetImportSourceId,
            targetImportSetupApprovalId:
              sourceLine.targetImportSetupApprovalId,
            targetCreditType: sourceLine.targetCreditType,
            subscriptionSnapshot: {
              create: {
                policyVersion: snapshot.policyVersion,
                changeKind: snapshot.changeKind,
                sourceSubscriptionId: snapshot.sourceSubscriptionId,
                sourcePeriodStart: snapshot.sourcePeriodStart,
                sourcePeriodEnd: snapshot.sourcePeriodEnd,
                fulfillmentPeriodStart: snapshot.fulfillmentPeriodStart,
                fulfillmentPeriodEnd: snapshot.fulfillmentPeriodEnd,
                sourceRecurringNetRappen: snapshot.sourceRecurringNetRappen,
                targetRecurringNetRappen: snapshot.targetRecurringNetRappen,
                prorationNumeratorSeconds: snapshot.prorationNumeratorSeconds,
                prorationDenominatorSeconds:
                  snapshot.prorationDenominatorSeconds,
                quotedNetRappen: snapshot.quotedNetRappen,
                activeJobLimitSnapshot: snapshot.activeJobLimitSnapshot,
                seatLimitSnapshot: snapshot.seatLimitSnapshot,
                talentContactAllowanceSnapshot:
                  snapshot.talentContactAllowanceSnapshot,
                jobBoostAllowanceSnapshot: snapshot.jobBoostAllowanceSnapshot,
                retainedMembershipIds: snapshot.retainedMembershipIds,
                retainedDefaultOwnerId: snapshot.retainedDefaultOwnerId,
              },
            },
          },
        },
      },
    });
    await transaction.order.update({
      where: { id: orderId },
      data: { status: "PENDING" },
    });
    await transaction.paymentEvent.create({
      data: {
        orderId,
        provider: "STRIPE",
        kind: "CHECKOUT_CREATED",
        idempotencyKey: `checkout:${orderId}`,
        payload: {
          schemaVersion: "1",
          mock: false,
          externalChargeClaimed: false,
        },
      },
    });
  });

  return orderId;
}

async function createContactPackOrder(
  actor: BillingActor,
  idempotencyKey: string,
) {
  const checkout = await createCheckoutOrder(
    {
      kind: "PRODUCT",
      productSlug: "contact-pack-10",
      quantity: 1,
      idempotencyKey,
    },
    dependencies(actor),
  );
  expect(checkout).toEqual(
    expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        status: "PENDING",
        orderId: expect.any(String),
      }),
    }),
  );
  if (!checkout.ok) {
    throw new Error("Contact-Pack checkout unexpectedly failed.");
  }
  return checkout.value.orderId;
}

async function expectProfileRequiredWithoutOrder(
  actor: BillingActor,
  idempotencyKey: string,
) {
  const observed = createObservedPaymentProvider();
  await expect(
    client().order.count({ where: { companyId: actor.companyId } }),
  ).resolves.toBe(0);
  await expect(
    createCheckoutOrder(
      {
        kind: "PLAN",
        planSlug: "starter",
        idempotencyKey,
      },
      dependencies(actor, observed.paymentProvider),
    ),
  ).resolves.toEqual({ ok: false, code: "PROFILE_REQUIRED" });
  await expect(
    client().order.count({ where: { companyId: actor.companyId } }),
  ).resolves.toBe(0);
  expect(observed.createCheckout).not.toHaveBeenCalled();
  expect(observed.confirmPayment).not.toHaveBeenCalled();
}

function createObservedPaymentProvider(
  onConfirm?: () => Promise<void>,
) {
  const delegate = new MockPaymentProvider();
  const createCheckout = vi.fn(
    (input: Parameters<PaymentProvider["createCheckout"]>[0]) =>
      delegate.createCheckout(input),
  );
  const confirmPayment = vi.fn(
    async (input: Parameters<PaymentProvider["confirmPayment"]>[0]) => {
      await onConfirm?.();
      return delegate.confirmPayment(input);
    },
  );
  const cancel = vi.fn(
    (input: Parameters<PaymentProvider["cancel"]>[0]) =>
      delegate.cancel(input),
  );
  const paymentProvider: PaymentProvider = Object.freeze({
    createCheckout,
    confirmPayment,
    cancel,
  });
  return Object.freeze({
    paymentProvider,
    createCheckout,
    confirmPayment,
  });
}

function requireCompleteProfile(fixture: ActorFixture) {
  if (fixture.profile === null) {
    throw new Error("Complete BillingProfile fixture unavailable.");
  }
  return fixture.profile;
}

async function seedCheckoutSecurityFixtures(
  db: DatabaseClient,
): Promise<CheckoutSecurityFixtures> {
  const reviewer = await db.user.create({
    data: {
      email: "phase12-security-tax-reviewer@example.ch",
      emailNormalized: "phase12-security-tax-reviewer@example.ch",
      role: "ADMIN",
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

  const authorization = await createActorFixture(
    db,
    "authorization",
    canton.id,
    city.id,
    "COMPLETE",
  );
  const foreign = await createActorFixture(
    db,
    "foreign",
    canton.id,
    city.id,
    "COMPLETE",
  );
  const radarLoss = await createActorFixture(
    db,
    "radar-loss",
    canton.id,
    city.id,
    "COMPLETE",
  );
  const concurrent = await createActorFixture(
    db,
    "concurrent",
    canton.id,
    city.id,
    "COMPLETE",
  );
  const catalogRace = await createActorFixture(
    db,
    "catalog-race",
    canton.id,
    city.id,
    "COMPLETE",
  );
  const missingProfile = await createActorFixture(
    db,
    "missing-profile",
    canton.id,
    city.id,
    "MISSING",
  );
  const incompleteProfile = await createActorFixture(
    db,
    "incomplete-profile",
    canton.id,
    city.id,
    "INCOMPLETE",
  );
  const snapshot = await createActorFixture(
    db,
    "snapshot",
    canton.id,
    city.id,
    "COMPLETE",
  );
  const starterRadarGrant = await createActorFixture(
    db,
    "starter-radar-grant",
    canton.id,
    city.id,
    "COMPLETE",
  );

  const staleUser = await createEmployerUser(db, "stale-membership");
  const staleMembership = await db.companyMembership.create({
    data: {
      companyId: authorization.actor.companyId,
      userId: staleUser.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-02T00:00:00.000Z"),
    },
  });
  await db.companyMembership.update({
    where: { id: staleMembership.id },
    data: { role: "ADMIN" },
  });
  const staleActor = Object.freeze({
    userId: staleUser.id,
    email: staleUser.email,
    companyId: authorization.actor.companyId,
    membershipId: staleMembership.id,
    membershipRole: "OWNER" as const,
  });

  const revokedUser = await createEmployerUser(db, "removed-membership");
  const revokedMembership = await db.companyMembership.create({
    data: {
      companyId: authorization.actor.companyId,
      userId: revokedUser.id,
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-03T00:00:00.000Z"),
    },
  });
  await db.companyMembership.update({
    where: { id: revokedMembership.id },
    data: {
      status: "REMOVED",
      removedAt: new Date("2026-07-21T09:59:00.000Z"),
    },
  });
  const revokedActor = Object.freeze({
    userId: revokedUser.id,
    email: revokedUser.email,
    companyId: authorization.actor.companyId,
    membershipId: revokedMembership.id,
    membershipRole: "ADMIN" as const,
  });

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
    seatLimit: 2,
    talentRadarAccess: false,
    contactAllowance: 0,
    boostAllowance: 0,
  });
  const pro = await createPlanVersion(db, {
    code: "PRO",
    name: "Pro",
    isDefaultFree: false,
    netPriceRappen: 39_900,
    activeJobLimit: 10,
    seatLimit: 5,
    talentRadarAccess: true,
    contactAllowance: 10,
    boostAllowance: 3,
  });
  const radarSubscription = await db.employerSubscription.create({
    data: {
      companyId: radarLoss.actor.companyId,
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
  await db.employerSubscription.create({
    data: {
      companyId: catalogRace.actor.companyId,
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
  await db.employerSubscription.create({
    data: {
      companyId: starterRadarGrant.actor.companyId,
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
  await db.entitlementGrant.create({
    data: {
      companyId: starterRadarGrant.actor.companyId,
      key: "TALENT_RADAR_ACCESS",
      valueType: "BOOLEAN",
      booleanValue: true,
      reasonCode: "PHASE12_RADAR_GRANT_TEST",
      grantedByUserId: reviewer.id,
      validFrom: PERIOD_START,
      validTo: PERIOD_END,
      idempotencyKey: "phase12-security-starter-radar-grant",
    },
  });
  await createContactPack(db);
  await createTaxRate(db, reviewer.id);

  return Object.freeze({
    authorization,
    catalogAdminId: reviewer.id,
    catalogRace,
    concurrent,
    foreign,
    incompleteProfile,
    missingProfile,
    radarLoss,
    radarSubscriptionId: radarSubscription.id,
    revokedActor,
    snapshot,
    starterRadarGrant,
    staleActor,
  });
}

async function createActorFixture(
  db: DatabaseClient,
  suffix: string,
  cantonId: string,
  cityId: string,
  profileMode: "COMPLETE" | "INCOMPLETE" | "MISSING",
): Promise<ActorFixture> {
  const user = await createEmployerUser(db, suffix);
  const company = await createCompany(db, suffix, cantonId, cityId);
  const membership = await db.companyMembership.create({
    data: {
      companyId: company.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
  const completeProfile: BillingProfileSeed = Object.freeze({
    legalName: "Phase 12 " + suffix + " AG",
    billingContactEmail: user.email,
    street: "Originalstrasse 12",
    postalCode: "8000",
    city: "Zürich",
    countryCode: "CH",
    uid: "CHE-123.456.789",
    vatNumber: "CHE-123.456.789 MWST",
  });
  if (profileMode !== "MISSING") {
    await db.companyBillingProfile.create({
      data:
        profileMode === "COMPLETE"
          ? { companyId: company.id, ...completeProfile }
          : {
              companyId: company.id,
              legalName: "X",
              billingContactEmail: "invalid-email",
              street: "X",
              postalCode: "80",
              city: "Z",
              countryCode: "CH",
            },
    });
  }
  return Object.freeze({
    actor: Object.freeze({
      userId: user.id,
      email: user.email,
      companyId: company.id,
      membershipId: membership.id,
      membershipRole: "OWNER" as const,
    }),
    profile: profileMode === "COMPLETE" ? completeProfile : null,
  });
}

function createEmployerUser(db: DatabaseClient, suffix: string) {
  const email = "phase12-security-" + suffix + "@example.ch";
  return db.user.create({
    data: {
      email,
      emailNormalized: email,
      role: "EMPLOYER",
      status: "ACTIVE",
    },
  });
}

async function createCompany(
  db: DatabaseClient,
  suffix: string,
  cantonId: string,
  cityId: string,
) {
  const company = await db.company.create({
    data: {
      name: "Phase 12 Security " + suffix + " AG",
      slug: "phase12-security-" + suffix,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Deterministische Checkout-Sicherheits-Testfirma.",
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
      address: "Originalstrasse 12",
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
