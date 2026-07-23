// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  database: { marker: "database" },
  deleteJobAlert: vi.fn(),
  environment: { marker: "environment" },
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  requireCandidatePage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireCandidatePage: mocks.requireCandidatePage,
}));
vi.mock("@/lib/candidate/job-alerts", () => ({
  JobAlertActionError: class JobAlertActionError extends Error {},
  createJobAlert: vi.fn(),
  deleteJobAlert: mocks.deleteJobAlert,
  grantJobAlertDeliveryConsent: vi.fn(),
  pauseJobAlert: vi.fn(),
  resumeJobAlert: vi.fn(),
  revokeJobAlertDeliveryConsentGlobally: vi.fn(),
  runJobAlertDigestMock: vi.fn(),
  updateJobAlert: vi.fn(),
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import {
  deleteJobAlertAction,
  INITIAL_JOB_ALERT_ACTION_STATE,
} from "@/app/candidate/alerts/actions";

const USER_ID = "91000000-0000-4000-8000-000000000001";
const REQUEST = Object.freeze({
  correlationId: "91000000-0000-4000-8000-000000000002",
  sourceIp: "192.0.2.91",
});

describe("candidate alert rate-limit denial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCandidatePage.mockResolvedValue({ id: USER_ID });
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue(mocks.environment);
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "JOB_ALERT_MUTATION",
        scope: "USER",
      },
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
  });

  it("records the central denial before returning the friendly state", async () => {
    const result = await deleteJobAlertAction(
      "91000000-0000-4000-8000-000000000003",
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("Zu viele Jobabo-Aktionen"),
    });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "JOB_ALERT_MUTATION",
        scope: "USER",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_JOB_ALERT_MUTATE",
        targetId: USER_ID,
        targetType: "USER",
      },
      {
        database: mocks.database,
        environment: mocks.environment,
        request: REQUEST,
        now: expect.any(Date),
      },
    );
    expect(mocks.deleteJobAlert).not.toHaveBeenCalled();
  });
});
