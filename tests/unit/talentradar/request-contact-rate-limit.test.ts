// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  recordRateLimitDenial: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import { createRadarContactRateLimitPort } from "@/lib/talentradar/request-contact";

const USER_ID = "95000000-0000-4000-8000-000000000001";
const COMPANY_ID = "95000000-0000-4000-8000-000000000002";
const CANDIDATE_ID = "95000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-07-23T10:00:00.000Z");
const REQUEST = Object.freeze({
  correlationId: "95000000-0000-4000-8000-000000000004",
  sourceIp: "192.0.2.95",
});
const DATABASE = { marker: "database" };
const ENVIRONMENT = { marker: "environment" };

describe("Radar contact rate-limit adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "CONTACT_REQUEST",
        scope: "CANDIDATE",
      },
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
  });

  it("records the central denial against the canonical Radar profile", async () => {
    const port = createRadarContactRateLimitPort({
      database: DATABASE as never,
      environment: ENVIRONMENT as never,
      request: REQUEST,
    });

    await expect(
      port.consume({
        actorUserId: USER_ID,
        companyId: COMPANY_ID,
        candidateProfileId: CANDIDATE_ID,
        now: NOW,
      }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });

    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "CONTACT_REQUEST",
        scope: "CANDIDATE",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "EMPLOYER_TALENT_CONTACT_CREATE",
        companyId: COMPANY_ID,
        targetId: CANDIDATE_ID,
        targetType: "RADAR_PROFILE",
      },
      {
        database: DATABASE,
        environment: ENVIRONMENT,
        request: REQUEST,
        now: NOW,
      },
    );
  });
});
