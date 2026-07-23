// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));

import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import {
  AuthorizationDeniedError,
  SafeNotFoundError,
} from "@/lib/security/errors";
import { requireRole } from "@/lib/security/require-role";
import { requireCompanyAccess } from "@/lib/security/company-access";

const EMPLOYER: CurrentUser = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  email: "employer@example.test",
  role: "EMPLOYER",
  name: "Employer",
  status: "ACTIVE",
  emailVerifiedAt: null,
});

const CANDIDATE: CurrentUser = Object.freeze({
  ...EMPLOYER,
  id: "22222222-2222-4222-8222-222222222222",
  email: "candidate@example.test",
  role: "CANDIDATE",
  name: "Candidate",
});

const ADMIN: CurrentUser = Object.freeze({
  ...EMPLOYER,
  id: "33333333-3333-4333-8333-333333333333",
  email: "admin@example.test",
  role: "ADMIN",
  name: "Admin",
});

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canonical route access wrappers", () => {
  it("denies a Candidate at the ADMIN role wrapper and permits an Admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(CANDIDATE);
    await expect(requireRole("ADMIN")).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );

    vi.mocked(getCurrentUser).mockResolvedValueOnce(ADMIN);
    await expect(requireRole("ADMIN")).resolves.toBe(ADMIN);
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("hides company A from a user whose only active Membership is in company B", async () => {
    const findFirst = vi.fn(async (input: {
      where: Readonly<{ companyId: string; userId: string }>;
    }) =>
      input.where.companyId === COMPANY_B
        ? membership(COMPANY_B, "OWNER")
        : null,
    );
    vi.mocked(getCurrentUser).mockResolvedValue(EMPLOYER);
    vi.mocked(getDatabase).mockReturnValue(databaseWith(findFirst));

    await expect(
      requireCompanyAccess(COMPANY_A, ["OWNER"]),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    await expect(
      requireCompanyAccess(COMPANY_B, ["OWNER"]),
    ).resolves.toMatchObject({
      companyId: COMPANY_B,
      userId: EMPLOYER.id,
      membershipRole: "OWNER",
    });
    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_A,
          userId: EMPLOYER.id,
          status: "ACTIVE",
          company: { status: "ACTIVE" },
        }),
      }),
    );
  });

  it("uses the same safe denial when an active Membership lacks the required company role", async () => {
    const findFirst = vi.fn(async () => membership(COMPANY_A, "VIEWER"));
    vi.mocked(getCurrentUser).mockResolvedValue(EMPLOYER);
    vi.mocked(getDatabase).mockReturnValue(databaseWith(findFirst));

    await expect(
      requireCompanyAccess(COMPANY_A, ["OWNER", "ADMIN"]),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("guards every Admin page locally before parallel App Router rendering can load data", () => {
    const adminRoot = join(process.cwd(), "app", "admin");
    const pagePaths = collectPagePaths(adminRoot);

    expect(pagePaths.length).toBeGreaterThan(0);
    for (const path of pagePaths) {
      expect(
        readFileSync(path, "utf8"),
        `${path} must call requireAdminPage() inside the page boundary`,
      ).toMatch(/\brequireAdminPage\s*\(/u);
    }
  });
});

function membership(
  companyId: string,
  role: "OWNER" | "VIEWER",
) {
  return {
    id: `${companyId.slice(0, 8)}-0000-4000-8000-000000000001`,
    companyId,
    userId: EMPLOYER.id,
    role,
    company: { status: "ACTIVE" as const },
  };
}

function databaseWith(findFirst: ReturnType<typeof vi.fn>) {
  return {
    companyMembership: { findFirst },
    subscriptionChangeSchedule: { findMany: vi.fn(async () => []) },
    employerSubscription: { findMany: vi.fn(async () => []) },
  } as never;
}

function collectPagePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectPagePaths(path);
    return entry.isFile() && entry.name === "page.tsx" ? [path] : [];
  });
}
