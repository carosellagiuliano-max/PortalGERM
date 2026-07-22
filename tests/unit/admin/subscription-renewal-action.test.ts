// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminMockRenewSubscription: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  requireAdminPage: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/lib/billing/admin-renewal", () => ({
  adminMockRenewSubscription: mocks.adminMockRenewSubscription,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/providers/email", () => ({ emailProvider: {} }));

import {
  adminCommandAction,
  INITIAL_ADMIN_ACTION_STATE,
} from "@/app/admin/actions";

const SERVER_NOW = new Date("2026-08-01T10:00:00.000Z");
const ADMIN = Object.freeze({
  id: "12c00000-0000-4000-8000-000000000001",
  email: "renewal-admin@example.ch",
  role: "ADMIN",
  status: "ACTIVE",
});
const REQUEST = Object.freeze({
  correlationId: "12c00000-0000-4000-8000-000000000002",
  expectedOrigin: "http://localhost:3000",
  origin: "http://localhost:3000",
  production: false,
  sourceIp: "127.0.0.1",
  userAgent: "subscription-renewal-action-test",
});
const COMPANY_ID = "12c00000-0000-4000-8000-000000000003";
const SOURCE_ID = "12c00000-0000-4000-8000-000000000004";
const SUCCESSOR_ID = "12c00000-0000-4000-8000-000000000005";

describe("Admin mock-renewal action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER_NOW);
    mocks.requireAdminPage.mockResolvedValue(ADMIN);
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.adminMockRenewSubscription.mockResolvedValue({
      ok: true,
      value: {
        companyId: COMPANY_ID,
        sourceSubscriptionId: SOURCE_ID,
        subscriptionId: SUCCESSOR_ID,
        planVersionId: "12c00000-0000-4000-8000-000000000006",
        periodStart: SERVER_NOW,
        periodEnd: new Date("2026-09-01T10:00:00.000Z"),
        grantedTalentContacts: 5,
        grantedJobBoosts: 2,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("dispatches trusted server context and clearly reports no payment or invoice", async () => {
    const form = renewalForm();
    const state = await adminCommandAction(INITIAL_ADMIN_ACTION_STATE, form);

    expect(mocks.adminMockRenewSubscription).toHaveBeenCalledWith(
      {
        subscriptionId: SOURCE_ID,
        expectedPeriodEnd: SERVER_NOW.toISOString(),
        reasonCode: "ADMIN_MOCK_RENEWAL",
        idempotencyKey: SUCCESSOR_ID,
      },
      expect.objectContaining({
        actor: {
          userId: ADMIN.id,
          email: ADMIN.email,
          role: ADMIN.role,
          status: ADMIN.status,
        },
        correlationId: REQUEST.correlationId,
        database: mocks.database,
        now: SERVER_NOW,
      }),
    );
    expect(state).toEqual({
      status: "success",
      message:
        "Mock-Verlängerung wurde aktiviert. Es wurde keine Zahlung oder Rechnung erzeugt.",
    });
    for (const path of [
      `/admin/companies/${COMPANY_ID}`,
      "/employer/billing",
      "/employer/jobs",
      "/employer/team",
    ]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("does not call Billing when the shared mutation-origin guard fails", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      renewalForm(),
    );

    expect(state).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(mocks.adminMockRenewSubscription).not.toHaveBeenCalled();
  });
});

function renewalForm() {
  const form = new FormData();
  form.set("operation", "subscription-renew-mock");
  form.set("subscriptionId", SOURCE_ID);
  form.set("expectedPeriodEnd", SERVER_NOW.toISOString());
  form.set("reasonCode", "ADMIN_MOCK_RENEWAL");
  form.set("idempotencyKey", SUCCESSOR_ID);
  return form;
}
