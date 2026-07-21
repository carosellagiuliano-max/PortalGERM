import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const billing = vi.hoisted(() => ({
  getPrismaEffectiveEntitlements: vi.fn(),
}));

vi.mock("@/lib/billing/prisma-publish-quota", () => ({
  getPrismaEffectiveEntitlements: billing.getPrismaEffectiveEntitlements,
}));

import {
  EMPLOYER_ANALYTICS_QUERY_LIMITS,
  getEmployerAnalyticsData,
  type EmployerAnalyticsAccess,
} from "@/lib/employer/analytics";
import {
  EMPLOYER_DASHBOARD_QUERY_LIMITS,
  getEmployerDashboardData,
  type EmployerDashboardAccess,
} from "@/lib/employer/dashboard";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const ACCESS = {
  companyId: "10000000-0000-4000-8000-000000000001",
  membershipId: "10000000-0000-4000-8000-000000000002",
  membershipRole: "RECRUITER",
  userId: "10000000-0000-4000-8000-000000000003",
} as const satisfies EmployerDashboardAccess & EmployerAnalyticsAccess;

beforeEach(() => {
  vi.clearAllMocks();
  billing.getPrismaEffectiveEntitlements.mockResolvedValue({
    ok: false,
    error: { code: "MISSING_DEFAULT_FREE" },
  });
});

describe("employer dashboard and analytics query scopes", () => {
  it("stops before company-only, job, application or entitlement reads when the exact active membership is absent", async () => {
    const dashboard = databaseMock(null);
    const analytics = databaseMock(null);

    await expect(getEmployerDashboardData(ACCESS, dashboard.client, NOW)).resolves.toBeNull();
    await expect(getEmployerAnalyticsData(ACCESS, analytics.client, NOW)).resolves.toBeNull();

    for (const fixture of [dashboard, analytics]) {
      expect(fixture.spies.companyFindFirst).toHaveBeenCalledWith({
        where: {
          id: ACCESS.companyId,
          status: { in: ["DRAFT", "ACTIVE"] },
          memberships: { some: activeMembership() },
        },
        select: expect.any(Object),
      });
      expect(fixture.spies.jobCount).not.toHaveBeenCalled();
      expect(fixture.spies.jobFindMany).not.toHaveBeenCalled();
      expect(fixture.spies.applicationCount).not.toHaveBeenCalled();
      expect(fixture.spies.applicationFindMany).not.toHaveBeenCalled();
      expect(fixture.spies.analyticsFindMany).not.toHaveBeenCalled();
    }
    expect(billing.getPrismaEffectiveEntitlements).not.toHaveBeenCalled();
  });

  it("binds every Recruiter resource query to the current assignment and deterministic limits", async () => {
    const dashboard = databaseMock({ id: ACCESS.companyId, name: "Scope AG" });
    const analytics = databaseMock({ id: ACCESS.companyId, name: "Scope AG" });

    await expect(getEmployerDashboardData(ACCESS, dashboard.client, NOW)).resolves.not.toBeNull();
    await expect(getEmployerAnalyticsData(ACCESS, analytics.client, NOW)).resolves.not.toBeNull();

    const expectedJobScope = {
      companyId: ACCESS.companyId,
      company: expect.objectContaining({ memberships: { some: activeMembership() } }),
      assignments: { some: activeAssignment() },
    };
    expect(dashboard.spies.jobCount).toHaveBeenCalledWith({ where: expect.objectContaining(expectedJobScope) });
    expect(dashboard.spies.applicationCount).toHaveBeenCalledWith({ where: expect.objectContaining({ job: expect.objectContaining(expectedJobScope) }) });
    expect(dashboard.spies.applicationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { job: expect.objectContaining(expectedJobScope) },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: EMPLOYER_DASHBOARD_QUERY_LIMITS.responseApplications,
    }));
    expect(dashboard.spies.jobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining(expectedJobScope),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: EMPLOYER_DASHBOARD_QUERY_LIMITS.analyzedJobs,
    }));

    expect(analytics.spies.analyticsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: ACCESS.companyId, job: expect.objectContaining(expectedJobScope) }),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: EMPLOYER_ANALYTICS_QUERY_LIMITS.events,
    }));
    expect(analytics.spies.applicationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ job: expect.objectContaining(expectedJobScope) }),
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: EMPLOYER_ANALYTICS_QUERY_LIMITS.applications,
    }));
    expect(analytics.spies.jobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining(expectedJobScope),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: EMPLOYER_ANALYTICS_QUERY_LIMITS.jobs,
    }));
  });
});

function activeMembership() {
  return {
    id: ACCESS.membershipId,
    userId: ACCESS.userId,
    companyId: ACCESS.companyId,
    role: "RECRUITER",
    status: "ACTIVE",
    removedAt: null,
  };
}

function activeAssignment() {
  return {
    companyId: ACCESS.companyId,
    membershipId: ACCESS.membershipId,
    userId: ACCESS.userId,
    status: "ACTIVE",
    revokedAt: null,
    validFrom: { lte: NOW },
    OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
  };
}

function databaseMock(company: Readonly<{ id: string; name: string }> | null) {
  const spies = {
    companyFindFirst: vi.fn().mockResolvedValue(company),
    jobCount: vi.fn().mockResolvedValue(0),
    jobFindMany: vi.fn().mockResolvedValue([]),
    applicationCount: vi.fn().mockResolvedValue(0),
    applicationFindMany: vi.fn().mockResolvedValue([]),
    analyticsFindMany: vi.fn().mockResolvedValue([]),
    subscriptionFindFirst: vi.fn().mockResolvedValue(null),
  };
  const client = {
    company: { findFirst: spies.companyFindFirst },
    job: { count: spies.jobCount, findMany: spies.jobFindMany },
    application: { count: spies.applicationCount, findMany: spies.applicationFindMany },
    analyticsEvent: { findMany: spies.analyticsFindMany },
    employerSubscription: { findFirst: spies.subscriptionFindFirst },
  } as never;
  return { client, spies };
}
