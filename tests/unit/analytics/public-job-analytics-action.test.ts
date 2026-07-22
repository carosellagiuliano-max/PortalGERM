// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyticsCreate: vi.fn(),
  getServerEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
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
          pseudonymousSessionId:
            "20000000-0000-4000-8000-000000000001",
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
});
