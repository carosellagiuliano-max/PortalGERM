import { describe, expect, it, vi } from "vitest";

import { AUDIT_ACTIONS_V1 } from "@/lib/domains/audit/audit-actions";
import {
  AuditActorKind,
  AuditResult,
  AuditTargetType,
} from "@/lib/generated/prisma/enums";
import {
  AUDIT_IP_HASH_RETENTION_MILLISECONDS,
  AUDIT_ACTOR_KINDS_V1,
  AUDIT_METADATA_SCHEMAS_V1,
  AUDIT_RESULTS_V1,
  AUDIT_TARGET_TYPES_V1,
  AuditInputValidationError,
  RequiredAuditWriteError,
  buildAuditPersistenceRecord,
  hashAuditSourceIp,
  nullifyExpiredAuditIpHashes,
  writeBestEffortAudit,
  writeRequiredAudit,
  type AuditPersistenceRecord,
  type AuditWritePort,
  type RequiredAuditInput,
} from "@/lib/audit/log";
import type { KeyringEntry } from "@/lib/config/env-schema";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";
const correlationId = "44444444-4444-4444-8444-444444444444";

const BASE_INPUT = Object.freeze({
  action: "JOB_APPROVED",
  actorKind: "USER",
  actorUserId,
  capability: "JOB_REVIEW",
  companyId,
  correlationId,
  result: "SUCCEEDED",
  retainUntil: new Date("2042-01-01T00:00:00.000Z"),
  targetId,
  targetType: "JOB",
} satisfies RequiredAuditInput);

describe("audit log contract", () => {
  it("keeps actions as one 122-member source and other enums Prisma-synchronized", () => {
    expect(Object.keys(AUDIT_METADATA_SCHEMAS_V1)).toEqual([
      ...AUDIT_ACTIONS_V1,
    ]);
    expect(Object.keys(AUDIT_METADATA_SCHEMAS_V1)).toHaveLength(122);
    expect(AUDIT_ACTOR_KINDS_V1).toEqual(Object.values(AuditActorKind));
    expect(AUDIT_RESULTS_V1).toEqual(Object.values(AuditResult));
    expect(AUDIT_TARGET_TYPES_V1).toEqual(Object.values(AuditTargetType));
  });

  it("writes required audit evidence through the supplied transaction port", async () => {
    const row = { id: "audit-row" };
    const create = vi.fn(async () => row);
    const port: AuditWritePort<typeof row> = { auditLog: { create } };

    await expect(writeRequiredAudit(port, BASE_INPUT)).resolves.toBe(row);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: {
        ...BASE_INPUT,
        actorUserId,
        companyId,
        ipHash: null,
        ipHashVersion: null,
        metadata: null,
        reasonCode: null,
      },
    });
  });

  it("rejects every caller-supplied IP or precomputed hash", () => {
    for (const unsafe of [
      "192.0.2.10",
      "audit-v1:192.0.2.10",
      `audit-2040-01:${"a".repeat(64)}`,
      `audit-v1:${"g".repeat(64)}`,
      "plain-unsalted-sha",
    ]) {
      const bypassAttempt = {
        ...BASE_INPUT,
        ipHash: unsafe,
      } as unknown as RequiredAuditInput;
      expect(() =>
        buildAuditPersistenceRecord(bypassAttempt),
      ).toThrow(AuditInputValidationError);
    }
  });

  it("uses only the first active AUDIT_IP_HASH_KEYS writer version", () => {
    const keyring = [
      {
        version: "audit-2040-02",
        key: {
          withValue: <T>(consumer: (value: string) => T) =>
            consumer("first-secret"),
        },
      },
      {
        version: "audit-2040-01",
        key: {
          withValue: <T>(consumer: (value: string) => T) =>
            consumer("old-secret"),
        },
      },
    ] as unknown as readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];

    const hash = hashAuditSourceIp("2001:db8::1", keyring);
    expect(hash).toMatch(/^audit-2040-02:[a-f0-9]{64}$/u);
    expect(
      buildAuditPersistenceRecord(BASE_INPUT, {
        sourceIp: "2001:0db8:0:0:0:0:0:1",
        keyring,
      }),
    ).toMatchObject({ ipHash: hash, ipHashVersion: "audit-2040-02" });
    expect(() => hashAuditSourceIp("192.0.2.1", [])).toThrow("active writer");
  });

  it("allows only the redacted RATE_LIMITED preset/scope metadata", () => {
    expect(
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        action: "RATE_LIMITED",
        metadata: { preset: "LOGIN", scope: "IP_EMAIL" },
      }),
    ).toMatchObject({ metadata: { preset: "LOGIN", scope: "IP_EMAIL" } });
    expect(
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        action: "RATE_LIMITED",
        metadata: { preset: "RADAR_LIST", scope: "COMPANY" },
      }),
    ).toMatchObject({ metadata: { preset: "RADAR_LIST", scope: "COMPANY" } });
    expect(() =>
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        action: "RATE_LIMITED",
        metadata: { preset: "LOGIN", scope: "IP", email: "pii@example.ch" },
      }),
    ).toThrow(AuditInputValidationError);
  });

  it("nullifies event IP hashes at the exact 30-day boundary", async () => {
    const now = new Date("2040-03-31T12:00:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 7 }));

    await expect(
      nullifyExpiredAuditIpHashes({ auditLog: { updateMany } }, { now }),
    ).resolves.toBe(7);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        ipHash: { not: null },
        createdAt: {
          lte: new Date(now.getTime() - AUDIT_IP_HASH_RETENTION_MILLISECONDS),
        },
      },
      data: { ipHash: null, ipHashVersion: null },
    });
  });

  it("fails closed on non-allowlisted metadata and top-level properties", () => {
    const piiCanary = "candidate-secret-message-canary";
    expect(() =>
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        metadata: { message: piiCanary },
      }),
    ).toThrow(AuditInputValidationError);

    const inputWithExtra = {
      ...BASE_INPUT,
      rawRequest: piiCanary,
    } as RequiredAuditInput;
    expect(() => buildAuditPersistenceRecord(inputWithExtra)).toThrow(
      AuditInputValidationError,
    );

    try {
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        metadata: { message: piiCanary },
      });
      expect.unreachable("metadata must be rejected");
    } catch (error) {
      expect(String(error)).not.toContain(piiCanary);
      expect(JSON.stringify(error)).not.toContain(piiCanary);
    }
  });

  it("enforces actor-kind identity consistency", () => {
    expect(() =>
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        actorKind: "USER",
        actorUserId: null,
      }),
    ).toThrow(AuditInputValidationError);
    expect(() =>
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        actorKind: "SYSTEM",
        actorUserId,
      }),
    ).toThrow(AuditInputValidationError);
    expect(
      buildAuditPersistenceRecord({
        ...BASE_INPUT,
        actorKind: "ANONYMOUS",
        actorUserId: null,
      }),
    ).toMatchObject({ actorKind: "ANONYMOUS", actorUserId: null });
  });

  it("turns a required persistence failure into a redacted fatal error", async () => {
    const sensitiveCause = "database-secret-message-canary";
    const port: AuditWritePort = {
      auditLog: {
        create: vi.fn(async () => {
          throw new Error(sensitiveCause);
        }),
      },
    };

    try {
      await writeRequiredAudit(port, BASE_INPUT);
      expect.unreachable("required audit failure must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(RequiredAuditWriteError);
      expect(String(error)).not.toContain(sensitiveCause);
      expect(JSON.stringify(error)).not.toContain(sensitiveCause);
    }
  });

  it("keeps best-effort failures redacted and non-throwing", async () => {
    const failures: unknown[] = [];
    const port: AuditWritePort = {
      auditLog: {
        create: vi.fn(async () => {
          throw new Error("telemetry-private-canary");
        }),
      },
    };

    await expect(
      writeBestEffortAudit(port, BASE_INPUT, (failure) => {
        failures.push(failure);
        throw new Error("failure callback must also be isolated");
      }),
    ).resolves.toEqual({ written: false, code: "AUDIT_WRITE_FAILED" });
    expect(failures).toEqual([
      {
        action: "JOB_APPROVED",
        code: "AUDIT_WRITE_FAILED",
        correlationId,
      },
    ]);
    expect(JSON.stringify(failures)).not.toContain("telemetry-private-canary");
  });

  it("does not call the port when best-effort input validation fails", async () => {
    const create = vi.fn(
      async (_input: { data: AuditPersistenceRecord }) => ({}),
    );
    const failure = vi.fn();
    const invalid = {
      ...BASE_INPUT,
      metadata: { cv: "cv-content-canary" },
    };

    await expect(
      writeBestEffortAudit({ auditLog: { create } }, invalid, failure),
    ).resolves.toEqual({
      written: false,
      code: "AUDIT_VALIDATION_FAILED",
    });
    expect(create).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith({
      action: "JOB_APPROVED",
      code: "AUDIT_VALIDATION_FAILED",
      correlationId,
    });
    expect(JSON.stringify(failure.mock.calls)).not.toContain(
      "cv-content-canary",
    );
  });
});
