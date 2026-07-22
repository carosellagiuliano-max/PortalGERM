import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmployerContext: vi.fn(),
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  getDatabase: vi.fn(),
  findPlanVersions: vi.fn(),
  findProductVersions: vi.fn(),
  reactivateEmployerJob: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: mocks.getEmployerContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/employer/jobs", () => ({
  closeEmployerJob: vi.fn(),
  createEmployerJobRevisionFromPaused: vi.fn(),
  createEmployerJobRevisionFromRejected: vi.fn(),
  duplicateEmployerJob: vi.fn(),
  employerJobAiSuggestionSchema: { safeParse: vi.fn() },
  getEmployerJobAiSuggestion: vi.fn(),
  pauseAndCreateEmployerJobRevision: vi.fn(),
  pauseEmployerJob: vi.fn(),
  reactivateEmployerJob: mocks.reactivateEmployerJob,
  runEmployerJobReportingCheck: vi.fn(),
  saveEmployerJobStep: vi.fn(),
  submitEmployerJobForReview: vi.fn(),
}));
vi.mock("@/lib/providers/ai", () => ({ aiProvider: {} }));
vi.mock("@/lib/providers/jobroom", () => ({ jobroomProvider: {} }));

import { reactivateEmployerJobAction } from "@/app/employer/jobs/[id]/actions";
import { INITIAL_EMPLOYER_JOB_FORM_STATE } from "@/lib/employer/job-contracts";

describe("employer job-limit action", () => {
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
    mocks.getDatabase.mockReturnValue({
      planVersion: { findMany: mocks.findPlanVersions },
      productVersion: { findMany: mocks.findProductVersions },
    });
    mocks.findPlanVersions.mockResolvedValue([
      {
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 34_900,
        currency: "CHF",
        plan: { code: "PRO", name: "Pro" },
      },
    ]);
    mocks.findProductVersions.mockResolvedValue([
      {
        netPriceRappen: 12_900,
        currency: "CHF",
        product: {
          code: "additional-job-30d",
          name: "Zusätzliche Stelle für 30 Tage",
        },
      },
    ]);
  });

  it("returns the server-built upgrade prompt for a typed quota failure", async () => {
    mocks.reactivateEmployerJob.mockResolvedValue({
      ok: false,
      code: "QUOTA_EXCEEDED",
      quotaReason: "ACTIVE_JOB_LIMIT_REACHED",
      suggestedPlanSlug: "pro",
    });
    const formData = new FormData();
    formData.set("jobId", "50000000-0000-4000-8000-000000000001");
    formData.set("expectedJobVersion", "2");
    formData.set("expectedRevisionVersion", "3");
    formData.set("idempotencyKey", "reactivate-job-limit");

    const state = await reactivateEmployerJobAction(
      INITIAL_EMPLOYER_JOB_FORM_STATE,
      formData,
    );

    expect(state).toMatchObject({
      status: "error",
      upgradePrompt: {
        reason: "ACTIVE_JOB_LIMIT_REACHED",
        cta: { href: "/employer/billing/checkout?plan=pro" },
      },
    });
    expect(mocks.reactivateEmployerJob).toHaveBeenCalledOnce();
  });

  it("keeps a Recruiter quota prompt outside the protected Billing routes", async () => {
    mocks.getEmployerContext.mockResolvedValue({
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "recruiter@example.test",
      },
      current: {
        companyId: "20000000-0000-4000-8000-000000000001",
        membershipId: "30000000-0000-4000-8000-000000000001",
        membershipRole: "RECRUITER",
      },
    });
    mocks.reactivateEmployerJob.mockResolvedValue({
      ok: false,
      code: "QUOTA_EXCEEDED",
      quotaReason: "ACTIVE_JOB_LIMIT_REACHED",
      suggestedPlanSlug: "pro",
    });
    const formData = new FormData();
    formData.set("jobId", "50000000-0000-4000-8000-000000000001");
    formData.set("expectedJobVersion", "2");
    formData.set("expectedRevisionVersion", "3");
    formData.set("idempotencyKey", "reactivate-job-limit-recruiter");

    const state = await reactivateEmployerJobAction(
      INITIAL_EMPLOYER_JOB_FORM_STATE,
      formData,
    );

    expect(state.upgradePrompt?.cta).toEqual({
      href: "/pricing",
      label: "Pläne vergleichen",
    });
  });
});
