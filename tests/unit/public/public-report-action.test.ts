// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createPublicReport: vi.fn(),
  getAuthRequestContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  getPublicCompanyCardBySlug: vi.fn(),
  getPublicJobBySlug: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/abuse/public-report", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/abuse/public-report")>();
  return { ...original, createPublicReport: mocks.createPublicReport };
});
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/companies/public-read-model", () => ({
  getPublicCompanyCardBySlug: mocks.getPublicCompanyCardBySlug,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicJobBySlug: mocks.getPublicJobBySlug,
}));

import { submitPublicReportAction } from "@/app/(public)/actions";

describe("public report action", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: "77777777-7777-4777-8777-777777777777",
      sourceIp: "192.0.2.7",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue({ marker: "database" });
    mocks.getServerEnvironment.mockReturnValue({ marker: "environment" });
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.createPublicReport.mockResolvedValue({ ok: true, reportId: "report-1" });
  });

  it("rejects malformed fields before authentication, rate limiting or target lookup", async () => {
    const formData = validReportForm();
    formData.set("slug", "../private-job");

    const result = await submitPublicReportAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.getPublicJobBySlug).not.toHaveBeenCalled();
    expect(mocks.getPublicCompanyCardBySlug).not.toHaveBeenCalled();
  });

  it("rate-limits valid-looking requests before resolving an attacker-controlled slug", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: { action: "RATE_LIMITED", preset: "ABUSE_INTAKE_PRECHECK", scope: "IP" },
    });

    const result = await submitPublicReportAction(
      { status: "idle", message: "" },
      validReportForm(),
    );

    expect(result.message).toMatch(/Zu viele Meldungen/u);
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "ABUSE_INTAKE_PRECHECK",
      {},
      expect.any(Object),
      expect.any(Date),
      expect.objectContaining({
        database: { marker: "database" },
        environment: { marker: "environment" },
      }),
    );
    expect(mocks.getPublicJobBySlug).not.toHaveBeenCalled();
    expect(mocks.createPublicReport).not.toHaveBeenCalled();
  });

  it("resolves a target only after the precheck and forwards the canonical id", async () => {
    mocks.getPublicJobBySlug.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      company: { id: "22222222-2222-4222-8222-222222222222" },
    });

    const result = await submitPublicReportAction(
      { status: "idle", message: "" },
      validReportForm(),
    );

    expect(result).toEqual({
      status: "success",
      message: "Danke. Deine Meldung wurde sicher erfasst und wird geprüft.",
    });
    expect(mocks.getPublicJobBySlug).toHaveBeenCalledWith("public-job");
    expect(mocks.createPublicReport).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "JOB", slug: "public-job" }),
      {
        id: "11111111-1111-4111-8111-111111111111",
        targetType: "JOB",
        companyId: "22222222-2222-4222-8222-222222222222",
      },
      expect.objectContaining({ currentUser: null, now: expect.any(Date) }),
    );
  });
});

function validReportForm(): FormData {
  const formData = new FormData();
  formData.set("targetType", "JOB");
  formData.set("slug", "public-job");
  formData.set("reasonCode", "MISLEADING");
  formData.set(
    "description",
    "Die veröffentlichten Angaben stimmen so nachweislich nicht.",
  );
  return formData;
}
