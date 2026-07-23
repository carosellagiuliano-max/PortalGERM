// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import {
  getAuthorizedApplication,
  getAuthorizedInvoice,
  getAuthorizedJob,
  getAuthorizedRadarRequest,
} from "@/lib/security/authorized-repositories";
import {
  createCompanyAccessRepository,
  requireCompanyAccess,
  resolveCompanyAccess,
  type CompanyAccess,
} from "@/lib/security/company-access";
import { verifyCsrfOrigin } from "@/lib/security/csrf";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  SafeNotFoundError,
} from "@/lib/security/errors";
import { assertRole, requireRole } from "@/lib/security/require-role";
import {
  toCandidateApplicationDto,
  toEmployerApplicationDto,
} from "@/lib/security/safe-dto";
import {
  sanitizePlainText,
  stripUnsafeHtml,
} from "@/lib/security/sanitize";

const USER = {
  id: "user-1",
  email: "user@example.ch",
  role: "EMPLOYER" as const,
  name: "Ada",
  status: "ACTIVE" as const,
  emailVerifiedAt: null,
};
const ACCESS: CompanyAccess = {
  companyId: "company-a",
  userId: USER.id,
  membershipId: "membership-a",
  membershipRole: "OWNER",
  companyStatus: "ACTIVE",
};
type QueryInput = { where: Record<string, unknown>; select?: unknown };

describe("role and company capability policies", () => {
  it("distinguishes missing authentication from a missing global capability", () => {
    expect(() => assertRole(null, "ADMIN")).toThrow(
      AuthenticationRequiredError,
    );
    expect(() => assertRole(USER, "ADMIN")).toThrow(AuthorizationDeniedError);
    expect(assertRole(USER, ["EMPLOYER", "ADMIN"])).toBe(USER);
  });

  it("requires active membership and returns the same safe 404 for foreign or disallowed roles", async () => {
    const repository = { findActiveMembership: vi.fn(async () => ACCESS) };
    await expect(
      resolveCompanyAccess({ companyId: "company-a", user: USER }, repository),
    ).resolves.toEqual(ACCESS);
    await expect(
      resolveCompanyAccess(
        { companyId: "company-a", user: USER, allowedRoles: ["VIEWER"] },
        repository,
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    await expect(
      resolveCompanyAccess(
        { companyId: "company-b", user: USER },
        { findActiveMembership: vi.fn(async () => null) },
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
  });

  it("wires server role and Company access through the canonical repositories", async () => {
    const findFirst = vi.fn(async () => ({
      id: ACCESS.membershipId,
      companyId: ACCESS.companyId,
      userId: ACCESS.userId,
      role: ACCESS.membershipRole,
      company: { status: "ACTIVE" as const },
    }));
    const database = {
      companyMembership: { findFirst },
      subscriptionChangeSchedule: { findMany: vi.fn(async () => []) },
      employerSubscription: { findMany: vi.fn(async () => []) },
    } as never;
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(getDatabase).mockReturnValue(database);

    await expect(requireRole("EMPLOYER")).resolves.toBe(USER);
    await expect(requireCompanyAccess("company-a", ["OWNER"])).resolves.toEqual(
      ACCESS,
    );
    await expect(
      createCompanyAccessRepository(database).findActiveMembership({
        companyId: "company-a",
        userId: USER.id,
      }),
    ).resolves.toEqual(ACCESS);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: "company-a",
          userId: USER.id,
          status: "ACTIVE",
          company: { status: "ACTIVE" },
        },
      }),
    );
  });
});

describe("resource-specific authorized repositories", () => {
  it("scopes Job and Application in their first query, including recruiter assignment", async () => {
    const recruiterAccess = { ...ACCESS, membershipRole: "RECRUITER" as const };
    const jobFindFirst = vi.fn<(input: QueryInput) => Promise<{ id: string }>>(
      async () => ({ id: "job-a" }),
    );
    const applicationFindFirst = vi.fn<
      (input: QueryInput) => Promise<{ id: string }>
    >(async () => ({ id: "application-a" }));
    const database = {
      job: { findFirst: jobFindFirst },
      application: { findFirst: applicationFindFirst },
    } as never;
    const now = new Date("2026-07-19T00:00:00Z");
    await getAuthorizedJob(
      { jobId: "job-a", access: recruiterAccess, now },
      database,
    );
    await getAuthorizedApplication(
      { applicationId: "application-a", access: recruiterAccess, now },
      database,
    );
    expect(jobFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: "job-a",
      companyId: "company-a",
      assignments: {
        some: {
          membershipId: "membership-a",
          userId: "user-1",
          status: "ACTIVE",
        },
      },
    });
    expect(applicationFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: "application-a",
      job: {
        companyId: "company-a",
        company: {
          status: "ACTIVE",
          memberships: {
            some: {
              id: "membership-a",
              userId: "user-1",
              status: "ACTIVE",
              role: "RECRUITER",
            },
          },
        },
        assignments: {
          some: {
            membershipId: "membership-a",
            companyId: "company-a",
            userId: "user-1",
            role: { in: ["EDITOR", "PIPELINE"] },
            status: "ACTIVE",
            revokedAt: null,
          },
        },
      },
    });
  });

  it("allows only Owner/Admin or Recruiter EDITOR|PIPELINE to load Application identity", async () => {
    const now = new Date("2026-07-19T00:00:00Z");
    const application = { id: "application-a" };
    const ownerAdminFindFirst = vi.fn<
      (input: QueryInput) => Promise<{ id: string }>
    >(async () => application);
    const ownerAdminDatabase = {
      application: { findFirst: ownerAdminFindFirst },
    } as never;

    for (const membershipRole of ["OWNER", "ADMIN"] as const) {
      await expect(
        getAuthorizedApplication(
          {
            applicationId: application.id,
            access: { ...ACCESS, membershipRole },
            now,
          },
          ownerAdminDatabase,
        ),
      ).resolves.toEqual(application);
    }
    expect(ownerAdminFindFirst).toHaveBeenCalledTimes(2);
    for (const [query] of ownerAdminFindFirst.mock.calls) {
      expect(query.where).toMatchObject({
        id: application.id,
        job: {
          companyId: ACCESS.companyId,
          company: {
            status: "ACTIVE",
            memberships: {
              some: {
                id: ACCESS.membershipId,
                userId: ACCESS.userId,
                status: "ACTIVE",
                role: { in: ["OWNER", "ADMIN"] },
              },
            },
          },
        },
      });
    }

    const viewerFindFirst = vi.fn(async () => application);
    await expect(
      getAuthorizedApplication(
        {
          applicationId: application.id,
          access: { ...ACCESS, membershipRole: "VIEWER" },
          now,
        },
        { application: { findFirst: viewerFindFirst } } as never,
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    expect(viewerFindFirst).not.toHaveBeenCalled();

    for (const assignmentRole of ["EDITOR", "PIPELINE", "REVIEWER"] as const) {
      const recruiterFindFirst = vi.fn(
        async (query: QueryInput): Promise<{ id: string } | null> => {
          const assignment = (
            query.where.job as {
              assignments?: { some?: { role?: { in?: readonly string[] } } };
            }
          ).assignments?.some;
          return assignment?.role?.in?.includes(assignmentRole)
            ? application
            : null;
        },
      );
      const result = getAuthorizedApplication(
        {
          applicationId: application.id,
          access: { ...ACCESS, membershipRole: "RECRUITER" },
          now,
        },
        { application: { findFirst: recruiterFindFirst } } as never,
      );
      if (assignmentRole === "REVIEWER") {
        await expect(result).rejects.toBeInstanceOf(SafeNotFoundError);
      } else {
        await expect(result).resolves.toEqual(application);
      }
      expect(recruiterFindFirst).toHaveBeenCalledOnce();
    }
  });

  it("scopes invoice and Radar request by company and hides absent/foreign rows", async () => {
    const invoiceFindFirst = vi.fn<
      (input: QueryInput) => Promise<{ id: string }>
    >(async () => ({ id: "invoice-a" }));
    const requestFindFirst = vi.fn<(input: QueryInput) => Promise<null>>(
      async () => null,
    );
    const database = {
      invoice: { findFirst: invoiceFindFirst },
      employerContactRequest: { findFirst: requestFindFirst },
    } as never;
    await getAuthorizedInvoice(
      { invoiceId: "invoice-a", access: ACCESS },
      database,
    );
    expect(invoiceFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: "invoice-a",
      companyId: "company-a",
    });
    await expect(
      getAuthorizedRadarRequest(
        { requestId: "request-b", access: ACCESS },
        database,
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    expect(requestFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: "request-b",
      companyId: "company-a",
    });

    const viewerAccess = { ...ACCESS, membershipRole: "VIEWER" as const };
    await expect(
      getAuthorizedInvoice(
        { invoiceId: "invoice-a", access: viewerAccess },
        database,
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    await expect(
      getAuthorizedRadarRequest(
        { requestId: "request-a", access: viewerAccess },
        database,
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    expect(invoiceFindFirst).toHaveBeenCalledOnce();
    expect(requestFindFirst).toHaveBeenCalledOnce();
  });
});

describe("request and output safety", () => {
  it("strips markup, executable blocks and normalizes plain text", () => {
    expect(
      stripUnsafeHtml(
        " <p>Hello &amp; Grüezi</p><script>alert('PII')</script> ",
      ),
    ).toBe("Hello & Grüezi");
    expect(stripUnsafeHtml("&lt;safe text&gt;")).toBe("<safe text>");
    expect(stripUnsafeHtml("safe&#0;text&#x202e;")).toBe("safetext");
  });

  it("preserves angle brackets as literal plain text while removing unsafe controls", () => {
    expect(
      sanitizePlainText("  Beispiel <script>alert('inert')</script>\u202e  "),
    ).toBe("Beispiel <script>alert('inert')</script>");
  });

  it("allows safe methods and requires an exact mutation origin", () => {
    expect(
      verifyCsrfOrigin({ method: "GET", expectedOrigin: "https://example.ch" }),
    ).toEqual({ allowed: true });
    expect(
      verifyCsrfOrigin({
        method: "POST",
        expectedOrigin: "https://example.ch",
      }),
    ).toMatchObject({ allowed: false, reason: "MISSING_ORIGIN" });
    expect(
      verifyCsrfOrigin({
        method: "POST",
        originHeader: "https://evil.example",
        expectedOrigin: "https://example.ch",
      }),
    ).toMatchObject({ allowed: false, reason: "ORIGIN_MISMATCH" });
    expect(
      verifyCsrfOrigin({
        method: "POST",
        originHeader: "https://example.ch",
        expectedOrigin: "https://example.ch/path",
      }),
    ).toEqual({ allowed: true });
  });

  it("builds allowlisted Application DTOs without private notes or arbitrary input fields", () => {
    const candidate = toCandidateApplicationDto({
      id: "application-a",
      jobId: "job-a",
      status: "IN_REVIEW",
      submittedAt: new Date(0),
      updatedAt: new Date(1),
      rejectionReason: null,
      employerNotes: "private-canary",
    } as Parameters<typeof toCandidateApplicationDto>[0]);
    const employer = toEmployerApplicationDto({
      id: "application-a",
      jobId: "job-a",
      candidateProfileId: "candidate-a",
      status: "SUBMITTED",
      submittedAt: new Date(0),
      candidateDisplayName: "A. Example",
      candidatePrivateNote: "candidate-canary",
    } as Parameters<typeof toEmployerApplicationDto>[0]);
    expect(JSON.stringify(candidate)).not.toContain("private-canary");
    expect(JSON.stringify(employer)).not.toContain("candidate-canary");
  });
});
