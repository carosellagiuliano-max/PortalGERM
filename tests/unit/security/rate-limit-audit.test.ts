import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  consumeRequestRateLimit,
  createPrismaAuditPort,
  writeBestEffortAudit,
} = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createPrismaAuditPort: vi.fn(() => ({ auditLog: {} })),
  writeBestEffortAudit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit,
}));
vi.mock("@/lib/audit/prisma-port", () => ({ createPrismaAuditPort }));
vi.mock("@/lib/audit/log", () => ({ writeBestEffortAudit }));

import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

const NOW = new Date("2026-07-23T08:00:00.000Z");
const REQUEST = {
  correlationId: "64000000-0000-4000-8000-000000000001",
  sourceIp: "192.0.2.44",
};
const TARGET = {
  actorKind: "USER" as const,
  actorUserId: "64000000-0000-4000-8000-000000000002",
  capability: "CANDIDATE_APPLICATION_SUBMIT",
  targetId: "64000000-0000-4000-8000-000000000002",
  targetType: "USER" as const,
};
const DEPENDENCIES = {
  database: { name: "database" },
  environment: {
    secrets: { keyrings: { AUDIT_IP_HASH_KEYS: [{ version: "v1" }] } },
  },
  request: REQUEST,
  now: NOW,
} as never;

describe("recordRateLimitDenial", () => {
  beforeEach(() => {
    consumeRequestRateLimit.mockReset();
    createPrismaAuditPort.mockClear();
    writeBestEffortAudit.mockReset();
  });

  it("writes one redacted denial when the low-volume audit gate allows it", async () => {
    consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    writeBestEffortAudit.mockResolvedValue({ written: true });

    await expect(
      recordRateLimitDenial(
        { preset: "APPLICATION_SUBMIT", scope: "USER" },
        TARGET,
        DEPENDENCIES,
      ),
    ).resolves.toEqual({ written: true, gated: false });

    expect(consumeRequestRateLimit).toHaveBeenCalledWith(
      "SECURITY_DENIAL_AUDIT",
      { actorId: TARGET.actorUserId },
      REQUEST,
      NOW,
      expect.any(Object),
    );
    expect(writeBestEffortAudit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: "RATE_LIMITED",
        actorKind: "USER",
        actorUserId: TARGET.actorUserId,
        metadata: { preset: "APPLICATION_SUBMIT", scope: "USER" },
        reasonCode: "RATE_LIMITED",
        result: "DENIED",
        targetId: TARGET.targetId,
        targetType: "USER",
      }),
      undefined,
      expect.objectContaining({ sourceIp: REQUEST.sourceIp }),
    );
  });

  it("does not amplify AuditLog after the denial-audit gate is exhausted", async () => {
    consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 3_600,
      audit: {
        action: "RATE_LIMITED",
        preset: "SECURITY_DENIAL_AUDIT",
        scope: "ACTOR_OR_IP",
      },
    });

    await expect(
      recordRateLimitDenial(
        { preset: "LOGIN", scope: "IP" },
        TARGET,
        DEPENDENCIES,
      ),
    ).resolves.toEqual({ written: false, gated: true });
    expect(writeBestEffortAudit).not.toHaveBeenCalled();
  });

  it("never replaces the primary denial when the secondary gate fails", async () => {
    consumeRequestRateLimit.mockRejectedValue(
      new Error("secondary rate store unavailable"),
    );

    await expect(
      recordRateLimitDenial(
        { preset: "LOGIN", scope: "IP" },
        TARGET,
        DEPENDENCIES,
      ),
    ).resolves.toEqual({ written: false, gated: false });
    expect(writeBestEffortAudit).not.toHaveBeenCalled();
  });

  it("never replaces the primary denial when the audit writer fails", async () => {
    consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    writeBestEffortAudit.mockRejectedValue(
      new Error("audit persistence unavailable"),
    );

    await expect(
      recordRateLimitDenial(
        { preset: "APPLICATION_SUBMIT", scope: "USER" },
        TARGET,
        DEPENDENCIES,
      ),
    ).resolves.toEqual({ written: false, gated: false });
  });
});
