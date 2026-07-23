// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  projectDueSubscriptionBoundaries: vi.fn(),
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
vi.mock("@/lib/billing/subscriptions", () => ({
  projectDueSubscriptionBoundaries: mocks.projectDueSubscriptionBoundaries,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/providers/email", () => ({ emailProvider: {} }));

import { INITIAL_ADMIN_ACTION_STATE } from "@/app/admin/action-state";
import { adminCommandAction } from "@/app/admin/actions";

const SERVER_NOW = new Date("2026-07-21T16:30:00.000Z");
const ADMIN = Object.freeze({
  id: "12b00000-0000-4000-8000-000000000001",
  email: "subscription-admin@example.ch",
  role: "ADMIN",
  status: "ACTIVE",
});
const REQUEST = Object.freeze({
  correlationId: "12b00000-0000-4000-8000-000000000002",
  expectedOrigin: "http://localhost:3000",
  origin: "http://localhost:3000",
  production: false,
  sourceIp: "127.0.0.1",
  userAgent: "subscription-project-action-test",
});

describe("Admin subscription boundary action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER_NOW);
    mocks.requireAdminPage.mockResolvedValue(ADMIN);
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.projectDueSubscriptionBoundaries.mockResolvedValue({
      ok: true,
      value: {
        appliedCancellationCount: 2,
        appliedDowngradeCount: 1,
        expiredSubscriptionCount: 3,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches an empty command with authenticated actor and trusted server context", async () => {
    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      projectorForm(),
    );

    expect(mocks.projectDueSubscriptionBoundaries).toHaveBeenCalledWith(
      {},
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
      message: "Projektion abgeschlossen: 2 Kündigung(en), 1 Downgrade(s), 3 natürliche Vertragsabläufe angewendet.",
    });
    for (const path of [
      "/admin/billing",
      "/employer/billing",
      "/employer/jobs",
      "/employer/team",
    ]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("forwards a forged clock only as untrusted input and shows its rejection", async () => {
    mocks.projectDueSubscriptionBoundaries.mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
    });
    const formData = projectorForm();
    formData.set("now", "2035-01-01T00:00:00.000Z");

    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      formData,
    );

    expect(mocks.projectDueSubscriptionBoundaries).toHaveBeenCalledWith(
      { now: "2035-01-01T00:00:00.000Z" },
      expect.objectContaining({ now: SERVER_NOW }),
    );
    expect(state).toMatchObject({ status: "error", code: "INVALID_INPUT" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not invoke Billing after the shared mutation-origin check fails", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const state = await adminCommandAction(
      INITIAL_ADMIN_ACTION_STATE,
      projectorForm(),
    );

    expect(state).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(mocks.projectDueSubscriptionBoundaries).not.toHaveBeenCalled();
  });
});

function projectorForm() {
  const formData = new FormData();
  formData.set("operation", "subscription-boundaries-project");
  return formData;
}
