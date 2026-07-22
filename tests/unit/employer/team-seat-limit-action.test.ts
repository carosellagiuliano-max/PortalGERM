import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmployerContext: vi.fn(),
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  getServerEnvironment: vi.fn(),
  getDatabase: vi.fn(),
  findPlanVersions: vi.fn(),
  sendCompanyInvitation: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: mocks.getEmployerContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/employer/team", () => ({
  changeCompanyMemberRole: vi.fn(),
  removeCompanyMember: vi.fn(),
  resendCompanyInvitation: vi.fn(),
  revokeCompanyInvitation: vi.fn(),
  sendCompanyInvitation: mocks.sendCompanyInvitation,
}));
vi.mock("@/lib/providers/email", () => ({
  emailProvider: Object.freeze({ send: vi.fn() }),
}));

import { sendInvitationAction } from "@/app/employer/team/actions";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";

describe("team invitation seat-limit action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEmployerContext.mockResolvedValue({
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "owner@example.test",
      },
      current: {
        companyId: "20000000-0000-4000-8000-000000000001",
        membershipId: "30000000-0000-4000-8000-000000000001",
        membershipRole: "OWNER",
      },
    });
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: "40000000-0000-4000-8000-000000000001",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getServerEnvironment.mockReturnValue({});
    mocks.getDatabase.mockReturnValue({
      planVersion: { findMany: mocks.findPlanVersions },
      productVersion: { findMany: vi.fn() },
    });
    mocks.findPlanVersions.mockResolvedValue([
      {
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 24_900,
        currency: "CHF",
        plan: { code: "PRO", name: "Pro Team" },
      },
    ]);
  });

  it("returns the typed, allowlisted prompt without mutating the invitation", async () => {
    mocks.sendCompanyInvitation.mockResolvedValue({
      ok: false,
      code: "SEAT_LIMIT",
      suggestedPlanSlug: "pro",
    });
    const formData = new FormData();
    formData.set("email", "new.member@example.test");
    formData.set("role", "RECRUITER");

    const state = await sendInvitationAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      formData,
    );

    expect(state.status).toBe("error");
    expect(state.upgradePrompt).toMatchObject({
      reason: "SEAT_LIMIT_REACHED",
      description: expect.stringContaining("Pro Team für CHF 249.00"),
      cta: { href: "/employer/billing/checkout?plan=pro" },
    });
    expect(mocks.sendCompanyInvitation).toHaveBeenCalledOnce();
  });

  it("does not offer the Owner-only plan checkout to a company Admin", async () => {
    mocks.getEmployerContext.mockResolvedValue({
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "admin@example.test",
      },
      current: {
        companyId: "20000000-0000-4000-8000-000000000001",
        membershipId: "30000000-0000-4000-8000-000000000001",
        membershipRole: "ADMIN",
      },
    });
    mocks.sendCompanyInvitation.mockResolvedValue({
      ok: false,
      code: "SEAT_LIMIT",
      suggestedPlanSlug: "pro",
    });
    const formData = new FormData();
    formData.set("email", "new.member@example.test");
    formData.set("role", "RECRUITER");

    const state = await sendInvitationAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      formData,
    );

    expect(state.upgradePrompt?.cta).toEqual({
      href: "/pricing",
      label: "Pläne vergleichen",
    });
  });

  it("falls back to pricing when the effective Pro plan has no valid plan transition", async () => {
    mocks.sendCompanyInvitation.mockResolvedValue({
      ok: false,
      code: "SEAT_LIMIT",
    });
    const formData = new FormData();
    formData.set("email", "new.member@example.test");
    formData.set("role", "RECRUITER");

    const state = await sendInvitationAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      formData,
    );

    expect(state.upgradePrompt?.cta).toEqual({
      href: "/pricing",
      label: "Pläne vergleichen",
    });
    expect(mocks.findPlanVersions).not.toHaveBeenCalled();
  });
});
