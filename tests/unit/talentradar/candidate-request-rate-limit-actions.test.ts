// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptContactRequest: vi.fn(),
  consumeRequestRateLimit: vi.fn(),
  database: { marker: "database" },
  environment: { marker: "environment" },
  getAuthRequestContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  recordRateLimitDenial: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));
vi.mock("@/lib/talentradar/contact-requests", () => ({
  acceptContactRequest: mocks.acceptContactRequest,
  declineContactRequest: vi.fn(),
}));
vi.mock("@/lib/talentradar/reveal", () => ({
  buildCandidateRevealPreview: vi.fn(),
  grantRevealFields: vi.fn(),
  revokeIdentityReveal: vi.fn(),
}));

import { acceptCandidateRadarRequestAction } from "@/app/candidate/talent-radar/requests/actions";

const USER_ID = "93000000-0000-4000-8000-000000000001";
const CONTACT_REQUEST_ID = "93000000-0000-4000-8000-000000000002";
const REQUEST = Object.freeze({
  correlationId: "93000000-0000-4000-8000-000000000003",
  sourceIp: "192.0.2.93",
});

describe("candidate Radar request rate-limit denial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      id: USER_ID,
      role: "CANDIDATE",
    });
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
        preset: "APPLICATION_CANDIDATE_MUTATION",
        scope: "USER",
      },
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
  });

  it("audits the denial against the contact request before the command", async () => {
    const formData = new FormData();
    formData.set("requestId", CONTACT_REQUEST_ID);
    formData.set("idempotencyKey", "radar-accept-0001");
    formData.set("confirmed", "true");

    const result = await acceptCandidateRadarRequestAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("Zu viele Aktionen"),
    });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "APPLICATION_CANDIDATE_MUTATION",
        scope: "USER",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_TALENT_RADAR_REQUEST_MUTATE",
        targetId: CONTACT_REQUEST_ID,
        targetType: "CONTACT_REQUEST",
      },
      {
        database: mocks.database,
        environment: mocks.environment,
        request: REQUEST,
        now: expect.any(Date),
      },
    );
    expect(mocks.acceptContactRequest).not.toHaveBeenCalled();
  });
});
