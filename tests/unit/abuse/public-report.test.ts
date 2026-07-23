// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createPrismaTransactionAuditPort: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  writeRequiredAudit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/audit/log", () => ({
  writeRequiredAudit: mocks.writeRequiredAudit,
}));
vi.mock("@/lib/audit/prisma-port", () => ({
  createPrismaTransactionAuditPort: mocks.createPrismaTransactionAuditPort,
}));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import { createPublicReport } from "@/lib/abuse/public-report";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const TARGET = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  targetType: "JOB" as const,
  companyId: "22222222-2222-4222-8222-222222222222",
});
const INPUT = Object.freeze({
  targetType: "JOB" as const,
  slug: "public-job",
  reasonCode: "MISLEADING" as const,
  description: "<p>Die veröffentlichten Angaben sind nachweislich falsch.</p>",
});

describe("public abuse report use case", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.createPrismaTransactionAuditPort.mockReturnValue({ marker: "audit-port" });
    mocks.recordRateLimitDenial.mockResolvedValue({ written: true, gated: false });
    mocks.writeRequiredAudit.mockResolvedValue(undefined);
  });

  it("rejects invalid input and target mismatches without consuming target quota", async () => {
    const database = databaseMock();

    await expect(
      createPublicReport({ ...INPUT, slug: "../private" }, TARGET, dependencies(database)),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      createPublicReport(
        { ...INPUT, description: `${INPUT.description}\u202e` },
        TARGET,
        dependencies(database),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      createPublicReport(INPUT, { ...TARGET, targetType: "COMPANY" }, dependencies(database)),
    ).resolves.toEqual({ ok: false, code: "TARGET_NOT_FOUND" });

    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(mocks.recordRateLimitDenial).not.toHaveBeenCalled();
  });

  it("applies the actor-or-IP per-target quota before opening a write transaction", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "ABUSE_INTAKE",
        scope: "ACTOR_OR_IP_TARGET",
      },
    });
    const database = databaseMock();

    const result = await createPublicReport(INPUT, TARGET, dependencies(database));

    expect(result).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "ABUSE_INTAKE",
      { targetId: TARGET.id },
      expect.any(Object),
      NOW,
      expect.objectContaining({ database }),
    );
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "ABUSE_INTAKE",
        scope: "ACTOR_OR_IP_TARGET",
      }),
      expect.objectContaining({
        targetId: TARGET.id,
      }),
      expect.objectContaining({
        database,
        now: NOW,
        request: expect.objectContaining({ sourceIp: "192.0.2.33" }),
      }),
    );
  });

  it("persists only sanitized intake fields, an immutable event and required audit", async () => {
    const database = databaseMock();

    const result = await createPublicReport(INPUT, TARGET, dependencies(database));

    expect(result).toEqual({ ok: true, reportId: "report-1" });
    expect(database.transaction.abuseReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "JOB",
        targetId: TARGET.id,
        reporterUserId: null,
        reasonCode: "MISLEADING",
        description: "Die veröffentlichten Angaben sind nachweislich falsch.",
        severity: "MEDIUM",
        status: "OPEN",
        dueAt: new Date("2026-07-23T12:00:00.000Z"),
        events: {
          create: expect.objectContaining({
            kind: "CREATED",
            reasonCode: "PUBLIC_INTAKE",
            correlationId: "33333333-3333-4333-8333-333333333333",
            createdAt: NOW,
          }),
        },
      }),
      select: { id: true },
    });
    expect(mocks.writeRequiredAudit).toHaveBeenCalledWith(
      { marker: "audit-port" },
      expect.objectContaining({
        action: "ABUSE_REPORT_SUBMITTED",
        actorKind: "ANONYMOUS",
        companyId: TARGET.companyId,
        targetId: "report-1",
      }),
      expect.objectContaining({ sourceIp: "192.0.2.33" }),
    );
  });

  it("maps transaction failures to a generic write error", async () => {
    const database = databaseMock();
    database.$transaction.mockRejectedValueOnce(new Error("private database detail"));

    await expect(
      createPublicReport(INPUT, TARGET, dependencies(database)),
    ).resolves.toEqual({ ok: false, code: "WRITE_FAILED" });
  });

  it("notifies every configured admin recipient without exposing report content", async () => {
    const database = databaseMock();
    const emailProvider = {
      send: vi.fn().mockResolvedValue({ accepted: true }),
    };

    await expect(
      createPublicReport(INPUT, TARGET, {
        ...dependencies(database),
        environment: {
          ABUSE_REPORT_ADMIN_EMAILS: [
            "security@example.test",
            "ops@example.test",
          ],
          secrets: { keyrings: { AUDIT_IP_HASH_KEYS: [] } },
        } as never,
        emailProvider: emailProvider as never,
      }),
    ).resolves.toEqual({ ok: true, reportId: "report-1" });

    expect(emailProvider.send).toHaveBeenCalledTimes(2);
    expect(emailProvider.send).toHaveBeenCalledWith({
      to: "security@example.test",
      templateKey: "abuse_report_received",
      subject: "Neue Missbrauchsmeldung eingegangen",
      data: {
        categoryLabel: "Irreführende Angaben",
        idempotencyKey: "abuse-report:report-1",
      },
    });
    expect(emailProvider.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: expect.anything() }),
      }),
    );
  });

  it("keeps the committed report successful when admin mail delivery fails", async () => {
    const database = databaseMock();
    const emailProvider = {
      send: vi.fn().mockRejectedValue(new Error("mail provider unavailable")),
    };

    await expect(
      createPublicReport(INPUT, TARGET, {
        ...dependencies(database),
        environment: {
          ABUSE_REPORT_ADMIN_EMAILS: ["security@example.test"],
          secrets: { keyrings: { AUDIT_IP_HASH_KEYS: [] } },
        } as never,
        emailProvider: emailProvider as never,
      }),
    ).resolves.toEqual({ ok: true, reportId: "report-1" });
  });
});

function dependencies(database: ReturnType<typeof databaseMock>) {
  return {
    database: database as never,
    environment: {
      secrets: { keyrings: { AUDIT_IP_HASH_KEYS: [] } },
    } as never,
    request: {
      correlationId: "33333333-3333-4333-8333-333333333333",
      sourceIp: "192.0.2.33",
    } as never,
    currentUser: null,
    now: NOW,
  };
}

function databaseMock() {
  const transaction = {
    abuseReport: {
      create: vi.fn().mockResolvedValue({ id: "report-1" }),
    },
  };
  return {
    transaction,
    $transaction: vi.fn(async (operation: (value: typeof transaction) => unknown) =>
      operation(transaction)),
  };
}
