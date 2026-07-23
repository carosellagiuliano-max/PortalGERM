import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  approveTaxRateVersion,
  recordSystemTaskOutcome,
} from "@/lib/admin/system-governance";
import type { AdminDependencies } from "@/lib/admin/common";

const ACTIVE_ADMIN = Object.freeze({
  userId: "11000000-0000-4000-8000-000000000001",
  email: "admin@example.test",
  role: "ADMIN",
  status: "ACTIVE",
});

describe("admin system-governance command boundaries", () => {
  it("rejects malformed task outcomes before touching persistence", async () => {
    const database = {
      $transaction: vi.fn(),
    } as unknown as AdminDependencies["database"];

    await expect(
      recordSystemTaskOutcome(
        {
          taskId: randomUUID(),
          expectedStatus: "DONE",
          status: "OPEN",
          outcomeCode: "contains private free text",
          idempotencyKey: randomUUID(),
        },
        dependencies(database),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("requires an active Platform Admin for task outcomes", async () => {
    const database = {
      $transaction: vi.fn(),
    } as unknown as AdminDependencies["database"];

    await expect(
      recordSystemTaskOutcome(
        {
          taskId: randomUUID(),
          expectedStatus: "ASSIGNED",
          status: "DONE",
          outcomeCode: "FOLLOW_UP_COMPLETED",
          idempotencyKey: randomUUID(),
        },
        dependencies(database, { role: "EMPLOYER" }),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("requires strict, capability-gated tax approval input", async () => {
    const database = {
      $transaction: vi.fn(),
    } as unknown as AdminDependencies["database"];
    const input = {
      taxRateVersionId: randomUUID(),
      expectedReviewStatus: "DRAFT",
      reasonCode: "FINANCE_REVIEW_COMPLETED",
      idempotencyKey: randomUUID(),
    } as const;

    await expect(
      approveTaxRateVersion(
        { ...input, unreviewedPayload: "must-not-pass" },
        dependencies(database),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      approveTaxRateVersion(
        input,
        dependencies(database, { status: "SUSPENDED" }),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});

function dependencies(
  database: AdminDependencies["database"],
  actorOverride: Readonly<Partial<AdminDependencies["actor"]>> = {},
): AdminDependencies {
  return Object.freeze({
    actor: Object.freeze({ ...ACTIVE_ADMIN, ...actorOverride }),
    correlationId: randomUUID(),
    database,
    now: new Date("2026-07-23T12:00:00.000Z"),
  });
}
