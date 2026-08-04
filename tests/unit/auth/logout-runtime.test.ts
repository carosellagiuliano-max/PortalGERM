// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  cookieDelete: vi.fn(),
  getServerEnvironment: vi.fn(),
  sessionRevoke: vi.fn(),
  sessionFind: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "A".repeat(43) }),
    delete: mocks.cookieDelete,
  })),
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: vi.fn(async () => ({
    correlationId: "06000000-0000-4000-8000-000000000098",
    expectedOrigin: "https://phase06.test",
    origin: "https://phase06.test",
    production: true,
    sourceIp: "192.0.2.98",
    userAgent: "phase06-unit",
  })),
  isValidAuthMutationOrigin: vi.fn(() => true),
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/audit/log", () => ({
  writeBestEffortAudit: mocks.audit,
}));
vi.mock("@/lib/audit/prisma-port", () => ({
  createPrismaAuditPort: vi.fn(() => ({})),
}));
vi.mock("@/lib/db/client", () => ({
  getDatabase: vi.fn(() => ({
    $transaction: async (
      operation: (transaction: unknown) => Promise<unknown>,
    ) =>
      operation({
        session: {
          findFirst: mocks.sessionFind,
          updateMany: mocks.sessionRevoke,
        },
      }),
  })),
}));

import { logoutCurrentSession } from "@/lib/auth/logout-runtime";

describe("logout session invalidation", () => {
  beforeEach(() => {
    mocks.audit.mockReset().mockResolvedValue({
      written: false,
      code: "AUDIT_WRITE_FAILED",
    });
    mocks.cookieDelete.mockReset();
    mocks.getServerEnvironment.mockReset().mockReturnValue({
      secrets: { keyrings: { AUDIT_IP_HASH_KEYS: [] } },
    });
    mocks.sessionRevoke.mockReset().mockResolvedValue({ count: 1 });
    mocks.sessionFind.mockReset().mockResolvedValue({
      id: "06000000-0000-4000-8000-000000000097",
      userId: "06000000-0000-4000-8000-000000000096",
    });
  });

  it("keeps the DB session revoked even when the best-effort audit sink fails", async () => {
    await expect(logoutCurrentSession()).resolves.toBeUndefined();

    expect(mocks.sessionRevoke).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.sessionRevoke.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.audit.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.cookieDelete).toHaveBeenCalledWith("session");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("company_context");
  });

  it("revokes and clears the session even when audit configuration cannot load", async () => {
    mocks.getServerEnvironment.mockImplementation(() => {
      throw new Error("AUDIT_CONFIGURATION_UNAVAILABLE");
    });

    await expect(logoutCurrentSession()).resolves.toBeUndefined();

    expect(mocks.sessionRevoke).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith("session");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("company_context");
  });
});
