// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeCompany: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  requireAdminPage: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/lib/admin/companies", () => ({
  approveCompanyClaim: vi.fn(),
  closeCompany: mocks.closeCompany,
  reactivateCompany: vi.fn(),
  rejectCompanyClaim: vi.fn(),
  rejectCompanyVerification: vi.fn(),
  requestCompanyClaimEvidence: vi.fn(),
  requestCompanyVerificationEvidence: vi.fn(),
  revokeCompanyVerification: vi.fn(),
  suspendCompany: vi.fn(),
  verifyCompany: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/providers/email", () => ({ emailProvider: {} }));

import { INITIAL_ADMIN_ACTION_STATE } from "@/app/admin/action-state";
import { adminCommandAction } from "@/app/admin/actions";

const NOW = new Date("2026-08-06T18:00:00.000Z");
const ADMIN = Object.freeze({
  id: "34c00000-0000-4000-8000-000000000011",
  email: "company-closure-admin@example.test",
  role: "ADMIN",
  status: "ACTIVE",
  capabilities: ["ADMIN_COMPANY_MODERATE"] as const,
});
const REQUEST = Object.freeze({
  correlationId: "34c00000-0000-4000-8000-000000000012",
  expectedOrigin: "http://localhost:3000",
  origin: "http://localhost:3000",
  production: false,
  sourceIp: "127.0.0.1",
  userAgent: "company-close-action-test",
});

describe("admin company closure entry point", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.closeCompany.mockReset();
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.requireAdminPage.mockResolvedValue(ADMIN);
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
  });

  it("dispatches the confirmed closure and returns an honest retained-data result", async () => {
    mocks.closeCompany.mockResolvedValue({
      ok: true,
      value: {
        companyId: "34c00000-0000-4000-8000-000000000021",
        status: "CLOSED",
        pausedJobs: 1,
      },
    });

    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      closureForm(),
    );

    expect(mocks.closeCompany).toHaveBeenCalledWith(
      {
        companyId: "34c00000-0000-4000-8000-000000000021",
        expectedStatus: "SUSPENDED",
        reasonCode: "COMPANY_OFFBOARDING_COMPLETED",
        confirmationCode: "FIRMA_SCHLIESSEN",
        idempotencyKey: "34c00000-0000-4000-8000-000000000022",
      },
      expect.objectContaining({
        actor: {
          userId: ADMIN.id,
          email: ADMIN.email,
          role: ADMIN.role,
          status: ADMIN.status,
          capabilities: ADMIN.capabilities,
        },
        correlationId: REQUEST.correlationId,
        database: mocks.database,
        now: NOW,
      }),
    );
    expect(state).toEqual({
      status: "success",
      message:
        "Die Firma wurde geschlossen. Daten und Auditverlauf bleiben erhalten.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });

  it("surfaces the paid-subscription denial without claiming a closure", async () => {
    mocks.closeCompany.mockResolvedValue({
      ok: false,
      code: "ACTIVE_SUBSCRIPTION",
    });

    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      closureForm(),
    );

    expect(state).toEqual({
      status: "error",
      code: "ACTIVE_SUBSCRIPTION",
      message:
        "Die Firma hat noch ein laufendes bezahltes Abo. Beende oder kläre es zuerst im Billing; es wurden keine Daten geändert.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not reach the closure service after a failed mutation-origin check", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      closureForm(),
    );

    expect(state).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(mocks.closeCompany).not.toHaveBeenCalled();
  });
});

function closureForm() {
  const form = new FormData();
  form.set("operation", "company-close");
  form.set("companyId", "34c00000-0000-4000-8000-000000000021");
  form.set("expectedStatus", "SUSPENDED");
  form.set("reasonCode", "COMPANY_OFFBOARDING_COMPLETED");
  form.set("confirmationCode", "FIRMA_SCHLIESSEN");
  form.set("idempotencyKey", "34c00000-0000-4000-8000-000000000022");
  return form;
}
