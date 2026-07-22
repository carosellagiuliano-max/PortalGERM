import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PHASE_12_BILLING_ADMIN_CAPABILITIES, hasAdminCapability } from "@/lib/admin/capabilities";
import { catalogRangesOverlap, grantAdminCredits, listAdminOrders, reverseCreditConsume } from "@/lib/billing/admin-billing";
import { projectDueCatalogVersions } from "@/lib/billing/catalog-lifecycle";
import { projectDueSubscriptionBoundaries } from "@/lib/billing/subscriptions";
import { ADMIN_NAVIGATION } from "@/components/admin/Sidebar";

const actor = { userId: "11000000-0000-4000-8000-000000000001", email: "admin@example.ch", role: "ADMIN", status: "ACTIVE" } as const;
const noDatabaseAccess = new Proxy({}, { get() { throw new Error("database must not be accessed"); } });

describe("Phase 12 Admin Billing authorization boundary", () => {
  it("names read, catalog, analytics, grant and exact reversal capabilities", () => {
    expect(PHASE_12_BILLING_ADMIN_CAPABILITIES).toEqual([
      "ADMIN_BILLING_READ", "ADMIN_BILLING_MUTATE", "ADMIN_CATALOG_READ", "ADMIN_CATALOG_MUTATE",
      "ADMIN_INVOICE_MUTATE", "ADMIN_ANALYTICS_READ", "ADMIN_CREDITS_GRANT", "ADMIN_CREDIT_REVERSE",
    ]);
    for (const capability of PHASE_12_BILLING_ADMIN_CAPABILITIES) {
      expect(hasAdminCapability(actor, capability)).toBe(true);
      expect(hasAdminCapability({ ...actor, role: "EMPLOYER" }, capability)).toBe(false);
      expect(hasAdminCapability({ ...actor, status: "SUSPENDED" }, capability)).toBe(false);
    }
  });

  it("fails closed before any database read for a non-admin", async () => {
    const dependencies = { actor: { ...actor, role: "EMPLOYER" }, correlationId: "22000000-0000-4000-8000-000000000001", database: noDatabaseAccess as never, now: new Date("2026-07-21T12:00:00.000Z") } as const;
    await expect(listAdminOrders(dependencies)).resolves.toBeNull();
    await expect(grantAdminCredits({ companyId: "33000000-0000-4000-8000-000000000001", creditType: "TALENT_CONTACT", amount: 10, validUntil: "2027-01-01T00:00:00.000Z", reasonCode: "CUSTOMER_SUCCESS_GRANT", idempotencyKey: "44000000-0000-4000-8000-000000000001" }, dependencies)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(reverseCreditConsume({ entryId: "55000000-0000-4000-8000-000000000001", reasonCode: "BUSINESS_STATE_RESTORED", idempotencyKey: "66000000-0000-4000-8000-000000000001" }, dependencies)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(projectDueCatalogVersions({}, dependencies)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(projectDueSubscriptionBoundaries({}, dependencies)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects any client-controlled catalog projector clock before database access", async () => {
    const dependencies = { actor, correlationId: "22000000-0000-4000-8000-000000000001", database: noDatabaseAccess as never, now: new Date("2026-07-21T12:00:00.000Z") } as const;
    await expect(projectDueCatalogVersions({ now: "2035-01-01T00:00:00.000Z" }, dependencies)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("accepts no client-controlled subscription projector scope or clock", async () => {
    const dependencies = { actor, correlationId: "22000000-0000-4000-8000-000000000001", database: noDatabaseAccess as never, now: new Date("2026-07-21T12:00:00.000Z") } as const;
    await expect(projectDueSubscriptionBoundaries({ now: "2035-01-01T00:00:00.000Z" }, dependencies)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(projectDueSubscriptionBoundaries({ scheduleId: "33000000-0000-4000-8000-000000000001" }, dependencies)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("rejects Admin grants beyond twelve clamped Zurich calendar months before a write", async () => {
    const dependencies = {
      actor,
      correlationId: "22000000-0000-4000-8000-000000000002",
      database: noDatabaseAccess as never,
      now: new Date("2026-07-21T12:00:00.000Z"),
    } as const;
    await expect(
      grantAdminCredits(
        {
          companyId: "33000000-0000-4000-8000-000000000001",
          creditType: "TALENT_CONTACT",
          amount: 10,
          validUntil: "2027-07-21T12:00:00.001Z",
          reasonCode: "CUSTOMER_SUCCESS_GRANT",
          idempotencyKey: "44000000-0000-4000-8000-000000000002",
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("exposes only working Phase 12 admin navigation destinations", () => {
    const root = process.cwd();
    for (const route of ["billing", "orders", "invoices", "plans", "products", "analytics"]) {
      expect(existsSync(join(root, "app", "admin", route))).toBe(true);
    }
    for (const route of ["billing", "plans", "products", "analytics"]) expect(ADMIN_NAVIGATION.some(({ href }) => href === `/admin/${route}`)).toBe(true);
  });

  it("exposes the same server-clock projector trigger on both catalog pages", () => {
    const root = process.cwd();
    const actions = readFileSync(join(root, "app", "admin", "actions.ts"), "utf8");
    const plans = readFileSync(join(root, "app", "admin", "plans", "page.tsx"), "utf8");
    const products = readFileSync(join(root, "app", "admin", "products", "page.tsx"), "utf8");
    expect(actions).toContain('operation === "catalog-project-due"');
    for (const page of [plans, products]) {
      expect(page).toContain('operation="catalog-project-due"');
      expect(page).toContain('label="Fällige Versionen aktivieren"');
      expect(page).toContain("aktuellen Serverzeit");
    }
  });

  it("exposes a server-clock subscription boundary trigger on the Billing page", () => {
    const root = process.cwd();
    const actions = readFileSync(join(root, "app", "admin", "actions.ts"), "utf8");
    const billing = readFileSync(join(root, "app", "admin", "billing", "page.tsx"), "utf8");
    expect(actions).toContain('operation === "subscription-boundaries-project"');
    expect(billing).toContain('operation="subscription-boundaries-project"');
    expect(billing).toContain('label="Fällige Vertragsgrenzen anwenden"');
    expect(billing).toContain("aktuellen Serverzeit");
  });

  it("uses half-open catalog ranges so exact successor boundaries are allowed", () => {
    const start = new Date("2026-08-01T00:00:00.000Z");
    const boundary = new Date("2026-09-01T00:00:00.000Z");
    const end = new Date("2026-10-01T00:00:00.000Z");
    expect(catalogRangesOverlap(start, boundary, boundary, end)).toBe(false);
    expect(catalogRangesOverlap(start, null, boundary, end)).toBe(true);
    expect(catalogRangesOverlap(start, end, new Date(boundary.getTime() - 1), null)).toBe(true);
  });
});
