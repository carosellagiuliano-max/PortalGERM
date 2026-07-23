// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  database: {
    credential: { findUnique: vi.fn() },
    privacyRequest: { findFirst: vi.fn() },
  },
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
vi.mock("@/lib/auth/password", () => ({ verifyPassword: vi.fn() }));
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
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import { INITIAL_CANDIDATE_PRIVACY_ACTION_STATE } from "@/app/candidate/privacy/action-state";
import { createCandidatePrivacyRequestAction } from "@/app/candidate/privacy/actions";
import { completeCandidatePrivacyChallengeAction } from "@/app/candidate/privacy/requests/[id]/verify/actions";

const USER_ID = "92000000-0000-4000-8000-000000000001";
const REQUEST_ID = "92000000-0000-4000-8000-000000000002";
const REQUEST = Object.freeze({
  correlationId: "92000000-0000-4000-8000-000000000003",
  sourceIp: "192.0.2.92",
});

describe("candidate privacy rate-limit denials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCandidatePage.mockResolvedValue({
      id: USER_ID,
      status: "ACTIVE",
    });
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue(mocks.environment);
    mocks.database.privacyRequest.findFirst.mockResolvedValue(null);
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "PRIVACY_REQUEST",
        scope: "USER",
      },
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
  });

  it("audits a denied privacy-request intake against the actor", async () => {
    const formData = new FormData();
    formData.set("type", "EXPORT");
    formData.set("idempotencyKey", "privacy-export-0001");

    const result = await createCandidatePrivacyRequestAction(
      INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
      formData,
    );

    expect(result).toMatchObject({
      status: "error",
      supportPath: "/candidate/support",
    });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "PRIVACY_REQUEST",
        scope: "USER",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_PRIVACY_REQUEST_CREATE",
        targetId: USER_ID,
        targetType: "USER",
      },
      expect.objectContaining({
        database: mocks.database,
        environment: mocks.environment,
        request: REQUEST,
      }),
    );
  });

  it("audits a denied identity challenge against the canonical request", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "PRIVACY_IDENTITY_CHALLENGE",
        scope: "USER",
      },
    });
    const formData = new FormData();
    formData.set("requestId", REQUEST_ID);
    formData.set("version", "0");
    formData.set("idempotencyKey", "privacy-verify-0001");
    formData.set("password", "not-persisted");

    const result = await completeCandidatePrivacyChallengeAction(
      {
        status: "idle",
        message: "",
        nextIdempotencyKey: "previous-key",
      },
      formData,
    );

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "PRIVACY_IDENTITY_CHALLENGE",
        scope: "USER",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_PRIVACY_IDENTITY_VERIFY",
        targetId: REQUEST_ID,
        targetType: "PRIVACY_REQUEST",
      },
      expect.objectContaining({
        database: mocks.database,
        environment: mocks.environment,
        request: REQUEST,
      }),
    );
    expect(mocks.database.credential.findUnique).not.toHaveBeenCalled();
  });
});
