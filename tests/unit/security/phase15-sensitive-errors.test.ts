// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRequestContext: vi.fn(),
  getCompanyOrder: vi.fn(),
  getRequesterSupportCase: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("SAFE_NOT_FOUND");
  }),
  requireAuthenticatedPage: vi.fn(),
  requireEmployerBillingPage: vi.fn(),
  unsubscribeJobAlertWithToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/admin/support-request-form", () => ({
  SupportReplyForm: () => null,
}));
vi.mock("@/components/billing/mock-payment-form", () => ({
  MockPaymentForm: () => null,
}));
vi.mock("@/lib/admin/support", () => ({
  getRequesterSupportCase: mocks.getRequesterSupportCase,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireAuthenticatedPage: mocks.requireAuthenticatedPage,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/billing/employer-page-access", () => ({
  requireEmployerBillingPage: mocks.requireEmployerBillingPage,
}));
vi.mock("@/lib/billing/employer-read-model", () => ({
  getCompanyOrder: mocks.getCompanyOrder,
}));
vi.mock("@/lib/candidate/job-alerts", () => ({
  unsubscribeJobAlertWithToken: mocks.unsubscribeJobAlertWithToken,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: () => ({}) }));

import { unsubscribeJobAlertAction } from "@/app/alerts/unsubscribe/[token]/actions";
import MockCheckoutPage from "@/app/mock/checkout/[orderId]/page";
import SupportCasePage from "@/app/support/[id]/page";

const USER = Object.freeze({
  id: "15000000-0000-4000-8000-000000000401",
  status: "ACTIVE",
});
const COMPANY_ID = "15000000-0000-4000-8000-000000000402";

describe("Phase-15 sensitive-route safe failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedPage.mockResolvedValue(USER);
    mocks.requireEmployerBillingPage.mockResolvedValue({
      context: { companyId: COMPANY_ID, membershipRole: "OWNER" },
    });
    mocks.getAuthRequestContext.mockResolvedValue({});
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
  });

  it("returns the same generic support 404 without echoing a case id", async () => {
    const caseIds = [
      "15000000-0000-4000-8000-000000000410",
      "case-secret-canary-outside-owner-scope",
    ];
    mocks.getRequesterSupportCase.mockResolvedValue(null);

    const failures = await Promise.allSettled(
      caseIds.map((id) =>
        SupportCasePage({ params: Promise.resolve({ id }) }),
      ),
    );

    expect(failures.map(failureMessage)).toEqual([
      "SAFE_NOT_FOUND",
      "SAFE_NOT_FOUND",
    ]);
    expect(JSON.stringify(failures)).not.toContain(caseIds[0]);
    expect(JSON.stringify(failures)).not.toContain(caseIds[1]);
  });

  it("uses one generic checkout 404 for malformed and inaccessible orders", async () => {
    const malformed = "order-secret-canary-malformed";
    const inaccessible = "15000000-0000-4000-8000-000000000420";
    mocks.getCompanyOrder.mockResolvedValue(null);

    const failures = await Promise.allSettled([
      MockCheckoutPage({ params: Promise.resolve({ orderId: malformed }) }),
      MockCheckoutPage({ params: Promise.resolve({ orderId: inaccessible }) }),
    ]);

    expect(failures.map(failureMessage)).toEqual([
      "SAFE_NOT_FOUND",
      "SAFE_NOT_FOUND",
    ]);
    const serialized = JSON.stringify(failures);
    expect(serialized).not.toContain(malformed);
    expect(serialized).not.toContain(inaccessible);
  });

  it("makes invalid, expired and failed unsubscribe tokens indistinguishable", async () => {
    const invalidToken = "unsubscribe-secret-canary-invalid";
    const failedToken = "unsubscribe-secret-canary-provider-failed";
    const formData = new FormData();
    mocks.unsubscribeJobAlertWithToken.mockResolvedValueOnce({
      ok: false,
      code: "INVALID_TOKEN",
    });
    mocks.unsubscribeJobAlertWithToken.mockRejectedValueOnce(
      new Error(failedToken),
    );

    const invalid = await unsubscribeJobAlertAction(
      invalidToken,
      { status: "idle", message: "" },
      formData,
    );
    const failed = await unsubscribeJobAlertAction(
      failedToken,
      { status: "idle", message: "" },
      formData,
    );

    expect(invalid).toEqual(failed);
    expect(invalid.status).toBe("complete");
    expect(JSON.stringify(invalid)).not.toContain(invalidToken);
    expect(JSON.stringify(failed)).not.toContain(failedToken);
  });
});

function failureMessage(result: PromiseSettledResult<unknown>): string {
  if (result.status === "fulfilled") return "UNEXPECTED_SUCCESS";
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}
