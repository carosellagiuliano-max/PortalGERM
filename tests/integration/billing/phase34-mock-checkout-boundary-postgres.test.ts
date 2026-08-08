import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const runtime = vi.hoisted(() => ({
  environment: {
    APP_ENV: "preview" as "ci" | "preview" | "staging" | "production",
    PAYMENT_PROVIDER_MODE: "disabled" as
      | "disabled"
      | "stripe_contract",
    PRIVILEGED_STEP_UP_MODE: "disabled",
    TRUST_RISK_MODE: "observe",
  },
  getEmployerContext: vi.fn(),
  getCurrentAuthContext: vi.fn(),
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: runtime.redirect }));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => runtime.environment,
}));
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: runtime.getEmployerContext,
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentAuthContext: runtime.getCurrentAuthContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: runtime.getAuthRequestContext,
  isValidAuthMutationOrigin: runtime.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: () => client(),
}));
vi.mock("@/lib/providers/email", () => ({ emailProvider: {} }));
vi.mock("@/lib/providers/payments", () => ({ paymentProvider: {} }));

import { startBillingCheckoutAction } from "@/app/employer/billing/checkout/actions";
import { confirmMockPaymentAction } from "@/app/mock/checkout/[orderId]/actions";
import { INITIAL_BILLING_ACTION_STATE } from "@/lib/billing/employer-action-state";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client() {
  if (database === undefined) throw new Error("Phase-34 billing DB unavailable.");
  return database;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase34_mock_checkout_boundary");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  runtime.environment.APP_ENV = "preview";
  runtime.environment.PAYMENT_PROVIDER_MODE = "disabled";
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-34 legacy mock checkout runtime boundary", () => {
  it.each(["preview", "staging", "production"] as const)(
    "denies create and confirmation entry points with zero persisted billing effect in %s",
    async (APP_ENV) => {
      runtime.environment.APP_ENV = APP_ENV;
      const before = await billingCounts();

      const createState = await startBillingCheckoutAction(
        INITIAL_BILLING_ACTION_STATE,
        checkoutForm(),
      );
      const confirmState = await confirmMockPaymentAction(
        INITIAL_BILLING_ACTION_STATE,
        confirmationForm(),
      );

      expect(createState.status).toBe("error");
      expect(confirmState).toEqual({
        status: "error",
        message: "Dieser Zahlungsvorgang ist nicht verfügbar.",
      });
      expect(runtime.getEmployerContext).not.toHaveBeenCalled();
      expect(runtime.getCurrentAuthContext).not.toHaveBeenCalled();
      expect(runtime.redirect).not.toHaveBeenCalled();
      await expect(billingCounts()).resolves.toEqual(before);
    },
  );

  it("does not reinterpret the isolated Stripe contract runtime as mock-capable", async () => {
    runtime.environment.APP_ENV = "ci";
    runtime.environment.PAYMENT_PROVIDER_MODE = "stripe_contract";
    const before = await billingCounts();

    await startBillingCheckoutAction(
      INITIAL_BILLING_ACTION_STATE,
      checkoutForm(),
    );

    expect(runtime.getEmployerContext).not.toHaveBeenCalled();
    expect(runtime.redirect).not.toHaveBeenCalled();
    await expect(billingCounts()).resolves.toEqual(before);
  });
});

function checkoutForm() {
  const form = new FormData();
  form.set("kind", "PLAN");
  form.set("slug", "pro");
  form.set("quantity", "1");
  form.set("idempotencyKey", "phase34-preview-denial");
  return form;
}

function confirmationForm() {
  const form = new FormData();
  form.set("orderId", "34000000-0000-4000-8000-000000000001");
  form.set("idempotencyKey", "phase34-preview-confirm-denial");
  return form;
}

async function billingCounts() {
  const rows = await client().$queryRaw<
    Array<{
      orders: bigint;
      invoices: bigint;
      payment_events: bigint;
      subscriptions: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "Order") AS orders,
      (SELECT COUNT(*) FROM "Invoice") AS invoices,
      (SELECT COUNT(*) FROM "PaymentEvent") AS payment_events,
      (SELECT COUNT(*) FROM "EmployerSubscription") AS subscriptions
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Billing count query returned no row.");
  return {
    orders: Number(row.orders),
    invoices: Number(row.invoices),
    paymentEvents: Number(row.payment_events),
    subscriptions: Number(row.subscriptions),
  };
}
