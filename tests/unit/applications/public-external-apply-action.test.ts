// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  getPublicJobBySlug: vi.fn(),
  trackAnalyticsEventV1: vi.fn(),
  createPrismaAnalyticsWriter: vi.fn(),
  redirect: vi.fn(),
  applyToJob: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicJobBySlug: mocks.getPublicJobBySlug,
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: () => ({ marker: "database" }),
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
    mocks.getPublicJobBySlug.mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000001",
      slug: "external-pflege-job",
      applicationContactKind: "APPLY_URL",
      applicationContactValue: "https://careers.example.test/apply",
      company: { id: "10000000-0000-4000-8000-000000000002" },
    });
    mocks.createPrismaAnalyticsWriter.mockReturnValue({ marker: "writer" });
    mocks.trackAnalyticsEventV1.mockResolvedValue({ recorded: true });
    mocks.redirect.mockImplementation((destination: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { destination });
    });
  });

  it("records only the allowlisted external click and never calls internal apply", async () => {
    const form = new FormData();
    form.set("action", "APPLY");
    form.set("jobSlug", "external-pflege-job");

    await expect(startPublicJobIntentAction(form)).rejects.toMatchObject({
      destination: "https://careers.example.test/apply",
    });
    expect(mocks.trackAnalyticsEventV1).toHaveBeenCalledOnce();
    expect(mocks.trackAnalyticsEventV1.mock.calls[0]?.[0]).toMatchObject({
      kind: "EXTERNAL_APPLY_CLICKED",
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
      productAnalyticsEnabled: false,
    });
    expect(mocks.applyToJob).not.toHaveBeenCalled();
  });
});
