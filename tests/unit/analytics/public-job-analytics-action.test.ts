// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyticsCreate: vi.fn(),
  getServerEnvironment: vi.fn(),
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  rateLimit: vi.fn(),
  searchLearningRecord: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/auth/signed-intent", () => ({
  JOB_INTENT_ACTIONS_V1: ["SAVE", "APPLY"],
  buildJobIntentNextPath: vi.fn(),
  signJobIntent: vi.fn(),
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: () => ({
    analyticsEvent: { create: mocks.analyticsCreate },
    job: { findUnique: vi.fn() },
  }),
}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicJobBySlug: vi.fn(),
}));
vi.mock("@/lib/search/learning", () => ({
  recordSearchLearningObservation: mocks.searchLearningRecord,
}));

import { recordPublicJobAnalyticsAction } from "@/app/(public)/jobs/actions";

const INPUT = Object.freeze({
  kind: "SEARCH_RESULTS_VIEWED" as const,
  eventId: "10000000-0000-4000-8000-000000000001",
  analyticsSessionId: "20000000-0000-4000-8000-000000000001",
  resultCountBucket: "10-24" as const,
  sort: "relevance" as const,
  cantonCode: "ZH",
  categorySlug: "engineering-technik",
});

describe("public search analytics producer provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyticsCreate.mockResolvedValue({});
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: "40000000-0000-4000-8000-000000000001",
      expectedOrigin: "https://example.test",
      origin: "https://example.test",
      production: true,
      sourceIp: "192.0.2.10",
      userAgent: "vitest",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.rateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.searchLearningRecord.mockResolvedValue({
      recorded: true,
      aggregateId: "30000000-0000-4000-8000-000000000001",
      observationCount: 1,
      actionable: false,
    });
  });

  it.each([
    ["local", "DEMO"],
    ["preview", "DEMO"],
    ["ci", "TEST"],
  ] as const)(
    "persists the anonymous %s runtime row with %s provenance",
    async (appEnvironment, expectedProvenance) => {
      mocks.getServerEnvironment.mockReturnValue({ APP_ENV: appEnvironment });

      await recordPublicJobAnalyticsAction(INPUT);

      expect(mocks.analyticsCreate).toHaveBeenCalledOnce();
      expect(mocks.analyticsCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          producer: "public-job-view",
          dedupeKey:
            "SEARCH_RESULTS_VIEWED:10000000-0000-4000-8000-000000000001",
          kind: "SEARCH_RESULTS_VIEWED",
          purpose: "PRODUCT_ANALYTICS",
          pseudonymousActorId: null,
          pseudonymousSessionId: "20000000-0000-4000-8000-000000000001",
          companyId: null,
          jobId: null,
          actorProvenanceSnapshot: expectedProvenance,
          companyProvenanceSnapshot: null,
          jobProvenanceSnapshot: null,
          properties: {
            surface: "JOB_SEARCH",
            locale: "de-CH",
            resultCountBucket: "10-24",
            sort: "relevance",
            cantonCode: "ZH",
            categorySlug: "engineering-technik",
          },
        }),
      });
    },
  );

  it.each(["staging", "production"] as const)(
    "does not persist anonymous product analytics in %s",
    async (appEnvironment) => {
      mocks.getServerEnvironment.mockReturnValue({ APP_ENV: appEnvironment });

      await recordPublicJobAnalyticsAction(INPUT);

      expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    },
  );

  it("collects a zero-result query through the gated privacy-safe learning path", async () => {
    mocks.getServerEnvironment.mockReturnValue({
      APP_ENV: "production",
      SEARCH_LEARNING_COLLECTION: true,
      secrets: {
        searchLearningHash: {
          withValue: (consumer: (value: string) => unknown) =>
            consumer("purpose-separated-search-learning-secret"),
        },
      },
    });

    await recordPublicJobAnalyticsAction({
      ...INPUT,
      resultCountBucket: "0",
      searchQuery: "unbekannter fachbegriff",
      searchFilters: {
        canton: "zuerich",
        category: "pflege",
        sort: "relevance",
      },
    });

    expect(mocks.searchLearningRecord).toHaveBeenCalledOnce();
    expect(mocks.searchLearningRecord).toHaveBeenCalledWith(
      {
        query: "unbekannter fachbegriff",
        contributorId: expect.stringMatching(
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/u,
        ),
        locale: "de-CH",
        resultBucket: "0",
        filters: {
          canton: "zuerich",
          category: "pflege",
          sort: "relevance",
        },
      },
      expect.objectContaining({
        digestSecret: "purpose-separated-search-learning-secret",
      }),
    );
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "SEARCH_LEARNING",
      {},
      expect.objectContaining({ sourceIp: "192.0.2.10" }),
      expect.any(Date),
      expect.objectContaining({
        environment: expect.objectContaining({
          SEARCH_LEARNING_COLLECTION: true,
        }),
      }),
    );
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
  });

  it("drops cross-origin and rate-limited search-learning writes", async () => {
    mocks.getServerEnvironment.mockReturnValue({
      APP_ENV: "production",
      SEARCH_LEARNING_COLLECTION: true,
      secrets: {
        searchLearningHash: {
          withValue: (consumer: (value: string) => unknown) =>
            consumer("purpose-separated-search-learning-secret"),
        },
      },
    });
    const input = {
      ...INPUT,
      resultCountBucket: "0" as const,
      searchQuery: "unbekannter fachbegriff",
    };

    mocks.isValidAuthMutationOrigin.mockReturnValue(false);
    await recordPublicJobAnalyticsAction(input);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.searchLearningRecord).not.toHaveBeenCalled();

    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: { action: "RATE_LIMITED", preset: "SEARCH_LEARNING", scope: "IP" },
    });
    await recordPublicJobAnalyticsAction(input);
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
    expect(mocks.searchLearningRecord).not.toHaveBeenCalled();
  });
});
