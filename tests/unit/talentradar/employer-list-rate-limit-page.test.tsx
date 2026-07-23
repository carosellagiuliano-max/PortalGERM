// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  database: {
    company: { findUnique: vi.fn() },
    skill: { findMany: vi.fn() },
  },
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getEmployerContext: vi.fn(),
  getPrismaEffectiveEntitlements: vi.fn(),
  getServerEnvironment: vi.fn(),
  listRadarCandidates: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  requireEmployerCompanyContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/components/employer/TalentRadar/CandidateCard", () => ({
  CandidateCard: () => null,
}));
vi.mock("@/components/employer/TalentRadar/FilterBar", () => ({
  FilterBar: () => null,
}));
vi.mock("@/components/employer/TalentRadar/LockedPreview", () => ({
  LockedPreview: () => null,
}));
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: mocks.getEmployerContext,
}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  createPostgresRadarDistinctFilterBudget: vi.fn(() => ({
    consume: vi.fn(),
  })),
}));
vi.mock("@/lib/billing/prisma-publish-quota", () => ({
  getPrismaEffectiveEntitlements: mocks.getPrismaEffectiveEntitlements,
}));
vi.mock("@/lib/billing/upgrade-prompt", () => ({
  buildCatalogUpgradePrompt: vi.fn(),
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/employer/context", () => ({
  requireEmployerCompanyContext: mocks.requireEmployerCompanyContext,
}));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));
vi.mock("@/lib/talentradar/eligibility", () => ({
  toRadarEligibilityEnvironment: vi.fn(() => "production"),
}));
vi.mock("@/lib/talentradar/list-candidates", () => ({
  createPrismaRadarCandidateListRepository: vi.fn(() => ({})),
  listRadarCandidates: mocks.listRadarCandidates,
}));
vi.mock("@/lib/talentradar/request-contact", () => ({
  signRadarContactSearchSessionProof: vi.fn(),
}));

import EmployerTalentRadarPage from "@/app/employer/talent-radar/page";

const USER_ID = "94000000-0000-4000-8000-000000000001";
const COMPANY_ID = "94000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "94000000-0000-4000-8000-000000000003";
const REQUEST = Object.freeze({
  correlationId: "94000000-0000-4000-8000-000000000004",
  sourceIp: "192.0.2.94",
});
const secretKey = Object.freeze({
  withValue<TResult>(consumer: (value: string) => TResult): TResult {
    return consumer(Buffer.alloc(32, 94).toString("base64"));
  },
});
const ENVIRONMENT = Object.freeze({
  APP_ENV: "production",
  secrets: {
    session: secretKey,
    keyrings: {
      RADAR_OPAQUE_LOOKUP_KEYS: [{ version: "v1", key: secretKey }],
      RADAR_OPAQUE_ENCRYPTION_KEYS: [{ version: "v1", key: secretKey }],
    },
  },
});

describe("employer Radar list rate-limit denial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmployerCompanyContext.mockResolvedValue({
      companyId: COMPANY_ID,
      membershipId: MEMBERSHIP_ID,
      membershipRole: "ADMIN",
    });
    mocks.getEmployerContext.mockResolvedValue({
      current: { companyId: COMPANY_ID },
      user: { id: USER_ID },
    });
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue(ENVIRONMENT);
    mocks.database.company.findUnique.mockResolvedValue({
      status: "ACTIVE",
      verificationRequests: [{ id: "verified" }],
    });
    mocks.database.skill.findMany.mockResolvedValue([]);
    mocks.getPrismaEffectiveEntitlements.mockResolvedValue({
      ok: true,
      value: { rights: { TALENT_RADAR_ACCESS: true } },
    });
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "RADAR_LIST",
        scope: "MEMBERSHIP",
      },
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
    mocks.listRadarCandidates.mockImplementation(
      async (
        _input: unknown,
        dependencies: {
          membershipRateLimit: {
            consume(input: {
              membershipId: string;
              now: Date;
            }): Promise<
              | { allowed: true }
              | { allowed: false; retryAfterSeconds: number }
            >;
          };
        },
      ) => {
        const decision = await dependencies.membershipRateLimit.consume({
          membershipId: MEMBERSHIP_ID,
          now: new Date("2026-07-23T10:00:00.000Z"),
        });
        return decision.allowed
          ? { status: "INVALID_FILTER" }
          : {
              status: "LIMIT",
              retryAfterSeconds: decision.retryAfterSeconds,
            };
      },
    );
  });

  it("records the denied membership search against its company", async () => {
    await EmployerTalentRadarPage({ searchParams: Promise.resolve({}) });

    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "RADAR_LIST",
        scope: "MEMBERSHIP",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "EMPLOYER_TALENT_RADAR_LIST",
        companyId: COMPANY_ID,
        targetId: COMPANY_ID,
        targetType: "COMPANY",
      },
      {
        database: mocks.database,
        environment: ENVIRONMENT,
        request: REQUEST,
        now: new Date("2026-07-23T10:00:00.000Z"),
      },
    );
  });
});
