import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cancelAdminOrder,
  voidAdminInvoice,
} from "@/lib/billing/admin-status-transitions";

const ADMIN_ID = "16000000-0000-4000-8000-000000000001";
const COMPANY_ID = "16000000-0000-4000-8000-000000000002";
const TARGET_ID = "16000000-0000-4000-8000-000000000003";
const IDEMPOTENCY_KEY = "16000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-07-23T12:00:00.000Z");

const noDatabaseAccess = new Proxy(
  {},
  {
    get() {
      throw new Error("database must not be accessed");
    },
  },
);

describe("Phase 16 Admin billing status-transition boundary", () => {
  it("denies Order cancellation before database access without the Admin capability", async () => {
    await expect(
      cancelAdminOrder(
        {
          orderId: TARGET_ID,
          companyId: COMPANY_ID,
          expectedStatus: "PENDING",
          reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        {
          actor: {
            userId: ADMIN_ID,
            email: "employer@example.ch",
            role: "EMPLOYER",
            status: "ACTIVE",
          },
          correlationId: IDEMPOTENCY_KEY,
          database: noDatabaseAccess as never,
          now: NOW,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("denies Invoice voiding before database access without the exact capability", async () => {
    await expect(
      voidAdminInvoice(
        {
          invoiceId: TARGET_ID,
          companyId: COMPANY_ID,
          expectedStatus: "ISSUED",
          reasonCode: "DUPLICATE_INVOICE",
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        {
          actor: {
            userId: ADMIN_ID,
            email: "suspended-admin@example.ch",
            role: "ADMIN",
            status: "SUSPENDED",
          },
          correlationId: IDEMPOTENCY_KEY,
          database: noDatabaseAccess as never,
          now: NOW,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects malformed, extra-field and stale-status contracts before database access", async () => {
    const dependencies = {
      actor: {
        userId: ADMIN_ID,
        email: "admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
      },
      correlationId: IDEMPOTENCY_KEY,
      database: noDatabaseAccess as never,
      now: NOW,
    } as const;

    await expect(
      cancelAdminOrder(
        {
          orderId: TARGET_ID,
          companyId: COMPANY_ID,
          expectedStatus: "PAID",
          reasonCode: "CUSTOMER_REQUESTED_CANCELLATION",
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      voidAdminInvoice(
        {
          invoiceId: TARGET_ID,
          companyId: COMPANY_ID,
          expectedStatus: "ISSUED",
          reasonCode: "not free text",
          idempotencyKey: IDEMPOTENCY_KEY,
          amountRappen: 1,
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("routes both commands from status-gated Admin detail forms", () => {
    const root = process.cwd();
    const actions = readFileSync(join(root, "app", "admin", "actions.ts"), "utf8");
    const orderPage = readFileSync(
      join(root, "app", "admin", "orders", "[id]", "page.tsx"),
      "utf8",
    );
    const invoicePage = readFileSync(
      join(root, "app", "admin", "invoices", "[id]", "page.tsx"),
      "utf8",
    );

    expect(actions).toContain(
      'operation === "order-cancel" ? await cancelAdminOrder',
    );
    expect(actions).toContain(
      'operation === "invoice-void" ? await voidAdminInvoice',
    );
    expect(orderPage).toContain('order.status === "PENDING"');
    expect(orderPage).toContain('operation="order-cancel"');
    expect(orderPage).toContain('expectedStatus: "PENDING"');
    expect(invoicePage).toContain('invoice.status === "ISSUED"');
    expect(invoicePage).toContain('operation="invoice-void"');
    expect(invoicePage).toContain('expectedStatus: "ISSUED"');
  });
});
