// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  getCurrentUser: vi.fn(),
  getPublicJobBySlug: vi.fn(),
  findJob: vi.fn(),
  trackAnalyticsEventV1: vi.fn(),
  createPrismaAnalyticsWriter: vi.fn(),
  signJobIntent: vi.fn(),
  buildJobIntentNextPath: vi.fn(),
  redirect: vi.fn(),
  applyToJob: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/auth/signed-intent", () => ({
  JOB_INTENT_ACTIONS_V1: ["SAVE", "APPLY"],
  signJobIntent: mocks.signJobIntent,
  buildJobIntentNextPath: mocks.buildJobIntentNextPath,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => ({
    APP_ENV: "local",
    secrets: { session: { marker: "session-key" } },
  }),
}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicJobBySlug: mocks.getPublicJobBySlug,
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: () => ({
    marker: "database",
    job: { findUnique: mocks.findJob },
  }),
}));
vi.mock("@/lib/analytics/track", () => ({
  trackAnalyticsEventV1: mocks.trackAnalyticsEventV1,
  createPrismaAnalyticsWriter: mocks.createPrismaAnalyticsWriter,
}));
vi.mock("@/lib/applications/service", () => ({ applyToJob: mocks.applyToJob }));

import { startPublicJobIntentAction } from "@/app/(public)/jobs/actions";

describe("external apply CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthRequestContext.mockResolvedValue({ correlationId: "request" });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getPublicJobBySlug.mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000001",
      slug: "external-pflege-job",
      applicationContactKind: "APPLY_URL",
      applicationContactValue: "https://careers.example.test/apply",
      company: { id: "10000000-0000-4000-8000-000000000002" },
    });
    mocks.createPrismaAnalyticsWriter.mockReturnValue({ marker: "writer" });
    mocks.trackAnalyticsEventV1.mockResolvedValue({ recorded: true });
    mocks.findJob.mockResolvedValue({
      companyId: "10000000-0000-4000-8000-000000000002",
      dataProvenance: "LIVE",
      company: { dataProvenance: "LIVE" },
    });
    mocks.signJobIntent.mockReturnValue("signed.intent");
    mocks.buildJobIntentNextPath.mockReturnValue(
      "/jobs/internal-pflege-job?intent=signed.intent",
    );
    mocks.redirect.mockImplementation((destination: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
    });
  });

  it("records only the allowlisted external click and never calls internal apply", async () => {
    const form = new FormData();
    form.set("action", "APPLY");
    form.set("jobSlug", "external-pflege-job");
    form.set(
      "analyticsSessionId",
      "20000000-0000-4000-8000-000000000001",
    );

    await expect(startPublicJobIntentAction(form)).rejects.toMatchObject({
      destination: "https://careers.example.test/apply",
    });
    expect(mocks.trackAnalyticsEventV1).toHaveBeenCalledOnce();
    expect(mocks.trackAnalyticsEventV1.mock.calls[0]?.[0]).toMatchObject({
      kind: "EXTERNAL_APPLY_CLICKED",
      pseudonymousSessionId: "20000000-0000-4000-8000-000000000001",
      companyId: "10000000-0000-4000-8000-000000000002",
      jobId: "10000000-0000-4000-8000-000000000001",
      properties: {
        surface: "JOB_DETAIL",
        intent: "APPLY",
        destinationKind: "EXTERNAL_HTTP_URL",
      },
    });
    expect(mocks.trackAnalyticsEventV1.mock.calls[0]?.[0]).not.toHaveProperty(
      "destinationUrl",
    );
    expect(mocks.trackAnalyticsEventV1.mock.calls[0]?.[1]).toMatchObject({
      producer: "public-job-action",
      productAnalyticsEnabled: true,
      provenance: { company: "LIVE", job: "LIVE" },
    });
    expect(mocks.applyToJob).not.toHaveBeenCalled();
  });

  it("records the Apply intent before an anonymous candidate is redirected to Login", async () => {
    mocks.getPublicJobBySlug.mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000001",
      slug: "internal-pflege-job",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.test",
      company: { id: "10000000-0000-4000-8000-000000000002" },
    });
    const form = new FormData();
    form.set("action", "APPLY");
    form.set("jobSlug", "internal-pflege-job");
    form.set(
      "analyticsSessionId",
      "20000000-0000-4000-8000-000000000001",
    );

    await expect(startPublicJobIntentAction(form)).rejects.toMatchObject({
      destination:
        "/login?next=%2Fjobs%2Finternal-pflege-job%3Fintent%3Dsigned.intent",
    });

    expect(mocks.signJobIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "APPLY",
        jobSlug: "internal-pflege-job",
        analyticsSessionId: "20000000-0000-4000-8000-000000000001",
      }),
      { marker: "session-key" },
    );
    expect(mocks.trackAnalyticsEventV1).toHaveBeenCalledOnce();
    expect(mocks.trackAnalyticsEventV1.mock.calls[0]?.[0]).toMatchObject({
      kind: "APPLY_INTENT_STARTED",
      pseudonymousSessionId: "20000000-0000-4000-8000-000000000001",
      companyId: "10000000-0000-4000-8000-000000000002",
      jobId: "10000000-0000-4000-8000-000000000001",
    });
    expect(
      mocks.trackAnalyticsEventV1.mock.calls[0]?.[0].producerEventId,
    ).toMatch(/^APPLY_INTENT_STARTED:[a-f0-9]{32}$/u);
    expect(mocks.getCurrentUser).toHaveBeenCalledOnce();
  });
});
