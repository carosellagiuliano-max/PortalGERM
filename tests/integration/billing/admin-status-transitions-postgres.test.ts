import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cancelAdminOrder,
  voidAdminInvoice,
} from "@/lib/billing/admin-status-transitions";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<
  ReturnType<typeof createMigratedTestDatabase>
>;

const NOW = new Date("2026-07-23T12:00:00.000Z");
const ADMIN_ID = "16100000-0000-4000-8000-000000000001";
const COMPANY_A_ID = "16100000-0000-4000-8000-000000000002";
const COMPANY_B_ID = "16100000-0000-4000-8000-000000000003";
const PRODUCT_ID = "16100000-0000-4000-8000-000000000004";
const PRODUCT_VERSION_ID = "16100000-0000-4000-8000-000000000005";
const TAX_RATE_ID = "16100000-0000-4000-8000-000000000006";
const IMPORT_PRODUCT_ID = "16100000-0000-4000-8000-000000000007";
const IMPORT_PRODUCT_VERSION_ID = "16100000-0000-4000-8000-000000000008";
const IMPORT_SOURCE_ID = "16100000-0000-4000-8000-000000000009";
const IMPORT_RELEASE_DECISION_ID = "16100000-0000-4000-8000-000000000010";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let invoiceSequence = 10_000;

function db() {
  if (database === undefined) {
    throw new Error("Admin status-transition test DB unavailable.");
  }
  return database;
}

function dependencies(
  now = NOW,
  actorUserId = ADMIN_ID,
) {
  return Object.freeze({
    actor: {
      userId: actorUserId,
      email: "phase16-billing-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

async function createOrder(
  companyId: string,
  status: "PENDING" | "FAILED" | "PAID" = "PENDING",
  provider: "MOCK" | "STRIPE" = "MOCK",
) {
  const id = randomUUID();
  const draft = await db().order.create({
    data: {
      id,
      companyId,
      createdByUserId: ADMIN_ID,
      status: "DRAFT",
      provider,
      clientIdempotencyKey: `phase16-order:${id}`,
      requestFingerprint: "a".repeat(64),
      billingLegalNameSnapshot: "Phase 16 Billing AG",
      billingContactEmailSnapshot: "billing@example.ch",
      billingStreetSnapshot: "Teststrasse 16",
      billingPostalCodeSnapshot: "8000",
      billingCitySnapshot: "Zürich",
      billingCountryCodeSnapshot: "CH",
      currency: "CHF",
      netTotalRappen: 10_000,
      vatTotalRappen: 810,
      totalRappen: 10_810,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      createdAt: NOW,
      updatedAt: NOW,
      lines: {
        create: {
          id: randomUUID(),
          productVersionId: PRODUCT_VERSION_ID,
          taxRateVersionId: TAX_RATE_ID,
          quantity: 1,
          unitNetRappen: 10_000,
          netRappen: 10_000,
          taxRateBasisPoints: 810,
          vatRappen: 810,
          totalRappen: 10_810,
          currency: "CHF",
          descriptionSnapshot: "Talent-Kontaktpaket 10",
          fulfillmentContext: "CONTACT_PACK",
          targetCreditType: "TALENT_CONTACT",
        },
      },
    },
    include: { lines: true },
  });
  const pending = await db().order.update({
    where: { id: draft.id },
    data: { status: "PENDING" },
    include: { lines: true },
  });
  if (status === "PENDING") return pending;
  return db().order.update({
    where: { id: pending.id },
    data:
      status === "PAID"
        ? { status: "PAID", paidAt: NOW }
        : { status: "FAILED", failedAt: NOW },
    include: { lines: true },
  });
}

async function createIssuedInvoice(companyId: string) {
  const order = await createOrder(companyId, "PAID");
  const id = randomUUID();
  invoiceSequence += 1;
  const invoice = await db().invoice.create({
    data: {
      id,
      orderId: order.id,
      companyId,
      number: `STH-2026-${invoiceSequence}`,
      status: "DRAFT",
      billingLegalNameSnapshot: order.billingLegalNameSnapshot,
      billingContactEmailSnapshot: order.billingContactEmailSnapshot,
      billingStreetSnapshot: order.billingStreetSnapshot,
      billingPostalCodeSnapshot: order.billingPostalCodeSnapshot,
      billingCitySnapshot: order.billingCitySnapshot,
      billingCountryCodeSnapshot: order.billingCountryCodeSnapshot,
      currency: order.currency,
      netTotalRappen: order.netTotalRappen,
      vatTotalRappen: order.vatTotalRappen,
      totalRappen: order.totalRappen,
      dueAt: new Date(NOW.getTime() + 30 * 86_400_000),
      createdAt: NOW,
      lines: {
        create: order.lines.map((line, index) => ({
          id: randomUUID(),
          orderLineId: line.id,
          sortOrder: index + 1,
          descriptionSnapshot: line.descriptionSnapshot,
          quantity: line.quantity,
          unitNetRappen: line.unitNetRappen,
          netRappen: line.netRappen,
          taxRateBasisPoints: line.taxRateBasisPoints,
          vatRappen: line.vatRappen,
          totalRappen: line.totalRappen,
          currency: line.currency,
        })),
      },
    },
  });
  return db().invoice.update({
    where: { id: invoice.id },
    data: { status: "ISSUED", issuedAt: NOW },
  });
}

async function createReservedImportOrder(companyId: string) {
  const [databaseClock] = await db().$queryRaw<Array<{ now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS "now"
  `;
  if (databaseClock === undefined) {
    throw new Error("Database clock unavailable for Import Setup fixture.");
  }
  const reservationExpiresAt = new Date(
    databaseClock.now.getTime() + 30 * 60_000,
  );
  const approvalValidUntil = new Date(
    databaseClock.now.getTime() + 24 * 60 * 60_000,
  );
  const approval = await db().importSetupApproval.create({
    data: {
      id: randomUUID(),
      companyId,
      importSourceId: IMPORT_SOURCE_ID,
      sourceRightsEvidence: "Licensed source rights reviewed for this Company.",
      mappingEvidence: "Mapping sample reviewed and accepted.",
      approvedByUserId: ADMIN_ID,
      approvalReason: "Controlled Phase 16 cancellation fixture.",
      validUntil: approvalValidUntil,
      status: "APPROVED",
      idempotencyKey: `phase16-import-approval:${randomUUID()}`,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  const orderId = randomUUID();
  const lineId = randomUUID();
  await db().order.create({
    data: {
      id: orderId,
      companyId,
      createdByUserId: ADMIN_ID,
      status: "DRAFT",
      provider: "MOCK",
      clientIdempotencyKey: `phase16-import-order:${orderId}`,
      requestFingerprint: "b".repeat(64),
      billingLegalNameSnapshot: "Phase 16 Import AG",
      billingContactEmailSnapshot: "import@example.ch",
      billingStreetSnapshot: "Importstrasse 16",
      billingPostalCodeSnapshot: "8000",
      billingCitySnapshot: "Zürich",
      billingCountryCodeSnapshot: "CH",
      currency: "CHF",
      netTotalRappen: 75_000,
      vatTotalRappen: 6_075,
      totalRappen: 81_075,
      expiresAt: reservationExpiresAt,
      createdAt: NOW,
      updatedAt: NOW,
      lines: {
        create: {
          id: lineId,
          productVersionId: IMPORT_PRODUCT_VERSION_ID,
          taxRateVersionId: TAX_RATE_ID,
          quantity: 1,
          unitNetRappen: 75_000,
          netRappen: 75_000,
          taxRateBasisPoints: 810,
          vatRappen: 6_075,
          totalRappen: 81_075,
          currency: "CHF",
          descriptionSnapshot: "Import-Setup",
          fulfillmentContext: "IMPORT_SETUP",
          targetImportSourceId: IMPORT_SOURCE_ID,
          targetImportSetupApprovalId: approval.id,
        },
      },
    },
  });
  await db().order.update({
    where: { id: orderId },
    data: { status: "PENDING" },
  });
  await db().importSetupApproval.update({
    where: { id: approval.id },
    data: { orderLineId: lineId },
  });
  return { orderId, approvalId: approval.id, lineId };
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase16_admin_billing_status_transitions",
  );
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await database.user.create({
    data: {
      id: ADMIN_ID,
      email: "phase16-billing-admin@example.ch",
      emailNormalized: "phase16-billing-admin@example.ch",
      role: "ADMIN",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await database.company.createMany({
    data: [
      {
        id: COMPANY_A_ID,
        name: "Phase 16 Billing A AG",
        slug: "phase16-billing-a",
        status: "DRAFT",
        dataProvenance: "TEST",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: COMPANY_B_ID,
        name: "Phase 16 Billing B AG",
        slug: "phase16-billing-b",
        status: "DRAFT",
        dataProvenance: "TEST",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });
  await database.product.create({
    data: {
      id: PRODUCT_ID,
      code: "phase16-contact-pack-10",
      name: "Phase 16 Contact Pack 10",
      type: "CONTACT_PACK",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await database.productVersion.create({
    data: {
      id: PRODUCT_VERSION_ID,
      productId: PRODUCT_ID,
      version: 1,
      status: "ACTIVE",
      netPriceRappen: 10_000,
      currency: "CHF",
      creditType: "TALENT_CONTACT",
      creditAmount: 10,
      isPublic: false,
      isSelfService: false,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: NOW,
    },
  });
  await database.product.create({
    data: {
      id: IMPORT_PRODUCT_ID,
      code: "phase16-import-setup",
      name: "Phase 16 Import Setup",
      type: "IMPORT_SETUP",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await database.productReleaseDecision.create({
    data: {
      id: IMPORT_RELEASE_DECISION_ID,
      productId: IMPORT_PRODUCT_ID,
      releaseTier: "P1",
      allowsPublic: false,
      allowsSelfService: false,
      reasonCode: "CONTROLLED_IMPORT_SETUP_RELEASE",
      rationale: "Restricted integration fixture for cancellation cleanup.",
      decidedByUserId: ADMIN_ID,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      idempotencyKey: `phase16-import-release:${randomUUID()}`,
      createdAt: NOW,
    },
  });
  await database.productVersion.create({
    data: {
      id: IMPORT_PRODUCT_VERSION_ID,
      productId: IMPORT_PRODUCT_ID,
      version: 1,
      status: "ACTIVE",
      netPriceRappen: 75_000,
      currency: "CHF",
      isPublic: false,
      isSelfService: false,
      releaseDecisionId: IMPORT_RELEASE_DECISION_ID,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: NOW,
    },
  });
  await database.importSource.create({
    data: {
      id: IMPORT_SOURCE_ID,
      name: "Phase 16 licensed source",
      sourceReference: "phase16://licensed-source",
      licenseReference: "phase16-test-license",
      provenance: "TEST",
      format: "JSON",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await database.taxRateVersion.create({
    data: {
      id: TAX_RATE_ID,
      jurisdiction: "CH",
      taxType: "VAT",
      rateBasisPoints: 810,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "Phase 16 status-transition test fixture",
      reviewStatus: "APPROVED",
      reviewedByUserId: ADMIN_ID,
      reviewedAt: NOW,
      createdAt: NOW,
    },
  });
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential(
  "Phase 16 Admin Order/Invoice status transitions",
  () => {
    it("cancels one tenant-scoped pending Order and replays with exact evidence", async () => {
      const order = await createOrder(COMPANY_A_ID);
      const idempotencyKey = randomUUID();
      const input = {
        orderId: order.id,
        companyId: COMPANY_A_ID,
        expectedStatus: "PENDING",
        reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
        idempotencyKey,
      } as const;

      await expect(cancelAdminOrder(input, dependencies())).resolves.toEqual({
        ok: true,
        value: {
          orderId: order.id,
          companyId: COMPANY_A_ID,
          status: "CANCELLED",
          cancelledAt: NOW,
        },
      });
      await expect(cancelAdminOrder(input, dependencies())).resolves.toEqual({
        ok: true,
        replay: true,
        value: {
          orderId: order.id,
          companyId: COMPANY_A_ID,
          status: "CANCELLED",
          cancelledAt: NOW,
        },
      });
      await expect(
        cancelAdminOrder(
          { ...input, reasonCode: "DUPLICATE_ORDER" },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });
      await expect(
        cancelAdminOrder(
          { ...input, idempotencyKey: randomUUID() },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });

      await expect(
        db().order.findUniqueOrThrow({
          where: { id: order.id },
          select: { status: true, cancelledAt: true },
        }),
      ).resolves.toEqual({ status: "CANCELLED", cancelledAt: NOW });
      await expect(
        db().paymentEvent.count({
          where: {
            orderId: order.id,
            kind: "CANCELLED",
            idempotencyKey: `admin-order-cancel:${idempotencyKey}`,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        db().auditLog.findMany({
          where: { targetId: order.id, action: "ORDER_CANCELLED" },
          select: {
            actorUserId: true,
            capability: true,
            companyId: true,
            correlationId: true,
            reasonCode: true,
            result: true,
            targetType: true,
          },
        }),
      ).resolves.toEqual([
        {
          actorUserId: ADMIN_ID,
          capability: "ADMIN_BILLING_MUTATE",
          companyId: COMPANY_A_ID,
          correlationId: idempotencyKey,
          reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
          result: "SUCCEEDED",
          targetType: "ORDER",
        },
      ]);
    });

    it("does not reveal or mutate an Order through the wrong Company scope and rejects stale state", async () => {
      const tenantOrder = await createOrder(COMPANY_A_ID);
      const wrongTenantKey = randomUUID();
      await expect(
        cancelAdminOrder(
          {
            orderId: tenantOrder.id,
            companyId: COMPANY_B_ID,
            expectedStatus: "PENDING",
            reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
            idempotencyKey: wrongTenantKey,
          },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
      await expect(
        db().order.findUniqueOrThrow({
          where: { id: tenantOrder.id },
          select: { status: true, cancelledAt: true },
        }),
      ).resolves.toEqual({ status: "PENDING", cancelledAt: null });
      await expect(
        db().auditLog.count({ where: { correlationId: wrongTenantKey } }),
      ).resolves.toBe(0);

      const failedOrder = await createOrder(COMPANY_A_ID, "FAILED");
      await expect(
        cancelAdminOrder(
          {
            orderId: failedOrder.id,
            companyId: COMPANY_A_ID,
            expectedStatus: "PENDING",
            reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
            idempotencyKey: randomUUID(),
          },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });

      const externalOrder = await createOrder(
        COMPANY_A_ID,
        "PENDING",
        "STRIPE",
      );
      await expect(
        cancelAdminOrder(
          {
            orderId: externalOrder.id,
            companyId: COMPANY_A_ID,
            expectedStatus: "PENDING",
            reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
            idempotencyKey: randomUUID(),
          },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    });

    it("rolls Order state and provider evidence back when the required audit cannot be written", async () => {
      const order = await createOrder(COMPANY_A_ID);
      const missingActorId = randomUUID();
      await expect(
        cancelAdminOrder(
          {
            orderId: order.id,
            companyId: COMPANY_A_ID,
            expectedStatus: "PENDING",
            reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
            idempotencyKey: randomUUID(),
          },
          dependencies(NOW, missingActorId),
        ),
      ).resolves.toEqual({ ok: false, code: "WRITE_FAILED" });
      await expect(
        db().order.findUniqueOrThrow({
          where: { id: order.id },
          select: { status: true, cancelledAt: true },
        }),
      ).resolves.toEqual({ status: "PENDING", cancelledAt: null });
      await expect(
        db().paymentEvent.count({
          where: { orderId: order.id, kind: "CANCELLED" },
        }),
      ).resolves.toBe(0);
    });

    it("atomically releases an Import Setup reservation when its pending Order is cancelled", async () => {
      const reserved = await createReservedImportOrder(COMPANY_A_ID);
      const idempotencyKey = randomUUID();

      await expect(
        cancelAdminOrder(
          {
            orderId: reserved.orderId,
            companyId: COMPANY_A_ID,
            expectedStatus: "PENDING",
            reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
            idempotencyKey,
          },
          dependencies(),
        ),
      ).resolves.toEqual({
        ok: true,
        value: {
          orderId: reserved.orderId,
          companyId: COMPANY_A_ID,
          status: "CANCELLED",
          cancelledAt: NOW,
        },
      });
      await expect(
        db().importSetupApproval.findUniqueOrThrow({
          where: { id: reserved.approvalId },
          select: { status: true, orderLineId: true },
        }),
      ).resolves.toEqual({ status: "APPROVED", orderLineId: null });
    });

    it("voids one tenant-scoped issued Invoice and replays with an exact target audit", async () => {
      const invoice = await createIssuedInvoice(COMPANY_A_ID);
      const idempotencyKey = randomUUID();
      const input = {
        invoiceId: invoice.id,
        companyId: COMPANY_A_ID,
        expectedStatus: "ISSUED",
        reasonCode: "DUPLICATE_INVOICE",
        idempotencyKey,
      } as const;

      await expect(voidAdminInvoice(input, dependencies())).resolves.toEqual({
        ok: true,
        value: {
          invoiceId: invoice.id,
          companyId: COMPANY_A_ID,
          status: "VOID",
          voidedAt: NOW,
        },
      });
      await expect(voidAdminInvoice(input, dependencies())).resolves.toEqual({
        ok: true,
        replay: true,
        value: {
          invoiceId: invoice.id,
          companyId: COMPANY_A_ID,
          status: "VOID",
          voidedAt: NOW,
        },
      });
      await expect(
        voidAdminInvoice(
          { ...input, reasonCode: "WRONG_BILLING_ADDRESS" },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });
      await expect(
        voidAdminInvoice(
          { ...input, idempotencyKey: randomUUID() },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });

      await expect(
        db().invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          select: { status: true, paidAt: true, voidedAt: true },
        }),
      ).resolves.toEqual({ status: "VOID", paidAt: null, voidedAt: NOW });
      await expect(
        db().auditLog.findMany({
          where: { targetId: invoice.id, action: "INVOICE_VOIDED" },
          select: {
            actorUserId: true,
            capability: true,
            companyId: true,
            correlationId: true,
            reasonCode: true,
            result: true,
            targetType: true,
          },
        }),
      ).resolves.toEqual([
        {
          actorUserId: ADMIN_ID,
          capability: "ADMIN_INVOICE_MUTATE",
          companyId: COMPANY_A_ID,
          correlationId: idempotencyKey,
          reasonCode: "DUPLICATE_INVOICE",
          result: "SUCCEEDED",
          targetType: "INVOICE",
        },
      ]);
    });

    it("does not reveal cross-tenant Invoices and rolls back when required audit fails", async () => {
      const invoice = await createIssuedInvoice(COMPANY_A_ID);
      const wrongTenantKey = randomUUID();
      await expect(
        voidAdminInvoice(
          {
            invoiceId: invoice.id,
            companyId: COMPANY_B_ID,
            expectedStatus: "ISSUED",
            reasonCode: "DUPLICATE_INVOICE",
            idempotencyKey: wrongTenantKey,
          },
          dependencies(),
        ),
      ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
      await expect(
        db().invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          select: { status: true, voidedAt: true },
        }),
      ).resolves.toEqual({ status: "ISSUED", voidedAt: null });

      const missingActorId = randomUUID();
      await expect(
        voidAdminInvoice(
          {
            invoiceId: invoice.id,
            companyId: COMPANY_A_ID,
            expectedStatus: "ISSUED",
            reasonCode: "DUPLICATE_INVOICE",
            idempotencyKey: randomUUID(),
          },
          dependencies(NOW, missingActorId),
        ),
      ).resolves.toEqual({ ok: false, code: "WRITE_FAILED" });
      await expect(
        db().invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          select: { status: true, voidedAt: true },
        }),
      ).resolves.toEqual({ status: "ISSUED", voidedAt: null });
    });
  },
);
