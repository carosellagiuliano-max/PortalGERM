import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listAdminAuditEntries } from "@/lib/admin/audit-read";
import type { AdminDependencies } from "@/lib/admin/common";

describe("admin audit read boundary", () => {
  it("uses closed filters and a bounded redacted projection", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      auditLog: { findMany },
    } as unknown as AdminDependencies["database"];

    await expect(
      listAdminAuditEntries(
        {
          action: "USER_LOGIN",
          result: "SUCCEEDED",
          targetType: "USER",
          correlationId: "release-audit:123",
        },
        dependencies(database),
      ),
    ).resolves.toEqual({ entries: [], invalidFilter: false });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: {
          action: "USER_LOGIN",
          result: "SUCCEEDED",
          targetType: "USER",
          correlationId: "release-audit:123",
        },
        select: expect.not.objectContaining({
          metadata: expect.anything(),
          ipHash: expect.anything(),
          ipHashVersion: expect.anything(),
        }),
      }),
    );
  });

  it("fails closed before querying for invalid or unauthorized filters", async () => {
    const findMany = vi.fn();
    const database = {
      auditLog: { findMany },
    } as unknown as AdminDependencies["database"];

    await expect(
      listAdminAuditEntries(
        { action: "NOT_AN_AUDIT_ACTION", correlationId: "free text!" },
        dependencies(database),
      ),
    ).resolves.toEqual({ entries: [], invalidFilter: true });
    await expect(
      listAdminAuditEntries(
        {},
        dependencies(database, { role: "EMPLOYER" }),
      ),
    ).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

function dependencies(
  database: AdminDependencies["database"],
  actorOverride: Readonly<Partial<AdminDependencies["actor"]>> = {},
): AdminDependencies {
  return {
    actor: {
      userId: randomUUID(),
      email: "admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
      ...actorOverride,
    },
    correlationId: randomUUID(),
    database,
    now: new Date("2026-07-24T08:00:00.000Z"),
  };
}
