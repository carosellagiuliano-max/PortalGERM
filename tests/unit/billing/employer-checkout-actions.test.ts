import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmployerContext: vi.fn(),
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  getDatabase: vi.fn(),
  createCheckoutOrder: vi.fn(),
  saveCompanyBillingProfile: vi.fn(),
  scheduleSubscriptionCancellation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: mocks.getEmployerContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/providers/email", () => ({ emailProvider: { send: vi.fn() } }));
vi.mock("@/lib/providers/payments", () => ({ paymentProvider: {} }));
vi.mock("@/lib/billing/orders", () => ({
  createCheckoutOrder: mocks.createCheckoutOrder,
}));
vi.mock("@/lib/billing/billing-profile", () => ({
  saveCompanyBillingProfile: mocks.saveCompanyBillingProfile,
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  scheduleSubscriptionCancellation: mocks.scheduleSubscriptionCancellation,
}));

import { cancelSubscriptionAction } from "@/app/employer/billing/actions";
import { startBillingCheckoutAction } from "@/app/employer/billing/checkout/actions";
import { saveBillingProfileAction } from "@/app/employer/billing/profile/actions";
import { INITIAL_BILLING_ACTION_STATE } from "@/lib/billing/employer-action-state";

const OWNER_CONTEXT = Object.freeze({
  user: Object.freeze({
    id: "10000000-0000-4000-8000-000000000001",
    email: "owner@example.test",
  }),
  current: Object.freeze({
    companyId: "20000000-0000-4000-8000-000000000001",
    membershipId: "30000000-0000-4000-8000-000000000001",
    membershipRole: "OWNER",
  }),
});

describe("employer billing action boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEmployerContext.mockResolvedValue(OWNER_CONTEXT);
    mocks.getAuthRequestContext.mockResolvedValue({ correlationId: "correlation-1" });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue({ marker: "database" });
  });

  it.each(["companyId", "priceRappen", "street"])(
    "rejects checkout authority field %s before invoking Billing",
    async (field) => {
      const form = checkoutForm("PRODUCT", "contact-pack-10");
      form.set(field, field === "priceRappen" ? "1" : "attacker-value");

      const state = await startBillingCheckoutAction(
        INITIAL_BILLING_ACTION_STATE,
        form,
      );

      expect(state.status).toBe("error");
      expect(mocks.createCheckoutOrder).not.toHaveBeenCalled();
    },
  );

  it("requires Owner for a plan change before invoking the checkout core", async () => {
    mocks.getEmployerContext.mockResolvedValue({
      ...OWNER_CONTEXT,
      current: { ...OWNER_CONTEXT.current, membershipRole: "ADMIN" },
    });

    const state = await startBillingCheckoutAction(
      INITIAL_BILLING_ACTION_STATE,
      checkoutForm("PLAN", "pro"),
    );

    expect(state.status).toBe("error");
    expect(state.message).toMatch(/Nur ein aktiver Firmeninhaber/u);
    expect(mocks.createCheckoutOrder).not.toHaveBeenCalled();
  });

  it("passes only intent fields to Billing for an Admin-eligible product", async () => {
    mocks.createCheckoutOrder.mockResolvedValue({
      ok: false,
      code: "PRODUCT_NOT_AVAILABLE",
    });

    await startBillingCheckoutAction(
      INITIAL_BILLING_ACTION_STATE,
      checkoutForm("PRODUCT", "contact-pack-10"),
    );

    expect(mocks.createCheckoutOrder).toHaveBeenCalledOnce();
    expect(mocks.createCheckoutOrder.mock.calls[0]?.[0]).toEqual({
      kind: "PRODUCT",
      productSlug: "contact-pack-10",
      quantity: 1,
      idempotencyKey: "checkout-test-key-0001",
    });
    expect(mocks.createCheckoutOrder.mock.calls[0]?.[0]).not.toHaveProperty("companyId");
    expect(mocks.createCheckoutOrder.mock.calls[0]?.[0]).not.toHaveProperty("priceRappen");
    expect(mocks.createCheckoutOrder.mock.calls[0]?.[0]).not.toHaveProperty("street");
  });

  it("passes only the reviewed membership selection for a downgrade quote", async () => {
    mocks.createCheckoutOrder.mockResolvedValue({ ok: false, code: "CONFLICT" });
    const form = checkoutForm("PLAN", "starter");
    form.set("retentionRequired", "yes");
    form.append("retainedMembershipIds", "40000000-0000-4000-8000-000000000001");

    await startBillingCheckoutAction(INITIAL_BILLING_ACTION_STATE, form);

    expect(mocks.createCheckoutOrder.mock.calls[0]?.[0]).toEqual({
      kind: "PLAN",
      planSlug: "starter",
      retainedMembershipIds: ["40000000-0000-4000-8000-000000000001"],
      idempotencyKey: "checkout-test-key-0001",
    });
  });

  it("accepts address fields only in the dedicated profile command and never accepts a tenant", async () => {
    mocks.saveCompanyBillingProfile.mockResolvedValue({
      ok: false,
      code: "WRITE_FAILED",
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      legalName: "Muster AG",
      billingContactEmail: "billing@example.test",
      street: "Bahnhofstrasse 1",
      postalCode: "8001",
      city: "Zürich",
      countryCode: "CH",
      uid: "",
      vatNumber: "",
      expectedVersion: "",
    })) form.set(key, value);

    await saveBillingProfileAction(INITIAL_BILLING_ACTION_STATE, form);

    expect(mocks.saveCompanyBillingProfile).toHaveBeenCalledOnce();
    expect(mocks.saveCompanyBillingProfile.mock.calls[0]?.[0]).not.toHaveProperty("companyId");
  });

  it("keeps cancellation Owner-only and derives the active subscription server-side", async () => {
    mocks.scheduleSubscriptionCancellation.mockResolvedValue({
      ok: true,
      value: {
        scheduleId: "50000000-0000-4000-8000-000000000001",
        subscriptionId: "60000000-0000-4000-8000-000000000001",
        effectiveAt: new Date("2026-08-21T10:00:00.000Z"),
      },
    });
    const form = new FormData();
    form.set("confirm", "yes");
    form.set("idempotencyKey", "cancel-test-key-0001");
    form.append(
      "retainedMembershipIds",
      "40000000-0000-4000-8000-000000000001",
    );

    const state = await cancelSubscriptionAction(
      INITIAL_BILLING_ACTION_STATE,
      form,
    );

    expect(state.status).toBe("success");
    expect(mocks.scheduleSubscriptionCancellation).toHaveBeenCalledOnce();
    expect(mocks.scheduleSubscriptionCancellation.mock.calls[0]?.[0]).toEqual({
      idempotencyKey: "cancel-test-key-0001",
      retainedMembershipIds: [
        "40000000-0000-4000-8000-000000000001",
      ],
    });
    expect(mocks.scheduleSubscriptionCancellation.mock.calls[0]?.[0]).not.toHaveProperty(
      "subscriptionId",
    );
    expect(mocks.scheduleSubscriptionCancellation.mock.calls[0]?.[0]).not.toHaveProperty(
      "companyId",
    );
  });
});

function checkoutForm(kind: "PLAN" | "PRODUCT", slug: string) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("slug", slug);
  form.set("quantity", "1");
  form.set("idempotencyKey", "checkout-test-key-0001");
  return form;
}
