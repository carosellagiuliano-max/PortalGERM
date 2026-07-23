import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  approveTaxRateVersion,
  recordSystemTaskOutcome,
} from "@/lib/admin/system-governance";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { orchestrateDemoSeed } from "@/prisma/seed/orchestrator";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-23T12:00:00.000Z");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let adminUserId = "";
let companyId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase16_system_governance");
  database = createDatabaseClient(migrated.connectionString);
  await orchestrateDemoSeed(database);
  adminUserId = (
    await database.user.findFirstOrThrow({
      where: { role: "ADMIN", status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
  companyId = (
    await database.company.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 16 system-governance audit commands on PostgreSQL", () => {
  it("records one idempotent SystemTask outcome and exact atomic audit row", async () => {
    const client = db();
    const task = await client.systemTask.create({
      data: {
        id: randomUUID(),
        companyId,
        kind: "SALES_FOLLOW_UP",
        reasonCode: "PHASE16_FOLLOW_UP",
        ownerUserId: adminUserId,
        dueAt: new Date(NOW.getTime() + 86_400_000),
        status: "ASSIGNED",
        idempotencyKey: `phase16-system-task:${randomUUID()}`,
        createdAt: NOW,
        updatedAt: NOW,
      },
      select: { id: true },
    });
    const idempotencyKey = randomUUID();
    const input = {
      taskId: task.id,
      expectedStatus: "ASSIGNED",
      status: "DONE",
      outcomeCode: "FOLLOW_UP_COMPLETED",
      idempotencyKey,
    } as const;

    await expect(
      recordSystemTaskOutcome(input, dependencies()),
    ).resolves.toEqual({
      ok: true,
      value: {
        taskId: task.id,
        status: "DONE",
        outcomeCode: "FOLLOW_UP_COMPLETED",
      },
    });
    await expect(
      recordSystemTaskOutcome(input, dependencies()),
    ).resolves.toMatchObject({ ok: true, replay: true });
    await expect(
      recordSystemTaskOutcome(
        { ...input, idempotencyKey: randomUUID() },
        dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    await expect(
      client.systemTask.findUniqueOrThrow({
        where: { id: task.id },
        select: { status: true, outcomeCode: true, updatedAt: true },
      }),
    ).resolves.toEqual({
      status: "DONE",
      outcomeCode: "FOLLOW_UP_COMPLETED",
      updatedAt: NOW,
    });
    await expect(
      client.auditLog.findMany({
        where: {
          action: "SYSTEM_TASK_OUTCOME_RECORDED",
          targetId: task.id,
        },
        select: {
          actorKind: true,
          actorUserId: true,
          capability: true,
          companyId: true,
          correlationId: true,
          metadata: true,
          reasonCode: true,
          result: true,
          targetType: true,
        },
      }),
    ).resolves.toEqual([
      {
        actorKind: "USER",
        actorUserId: adminUserId,
        capability: "ADMIN_SYSTEM_TASK_MANAGE",
        companyId,
        correlationId: idempotencyKey,
        metadata: null,
        reasonCode: "FOLLOW_UP_COMPLETED",
        result: "SUCCEEDED",
        targetType: "SYSTEM_TASK",
      },
    ]);
  });

  it("approves a non-overlapping draft TaxRateVersion once and rejects overlap", async () => {
    const client = db();
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const jurisdiction = `P16-${suffix}`;
    const taxType = "VAT_PHASE16";
    const validFrom = new Date("2036-01-01T00:00:00.000Z");
    const validTo = new Date("2037-01-01T00:00:00.000Z");
    const draft = await client.taxRateVersion.create({
      data: {
        id: randomUUID(),
        jurisdiction,
        taxType,
        rateBasisPoints: 825,
        validFrom,
        validTo,
        source: "Phase 16 controlled finance review fixture",
        reviewStatus: "DRAFT",
        createdAt: NOW,
      },
      select: { id: true },
    });
    const idempotencyKey = randomUUID();
    const input = {
      taxRateVersionId: draft.id,
      expectedReviewStatus: "DRAFT",
      reasonCode: "FINANCE_REVIEW_COMPLETED",
      idempotencyKey,
    } as const;

    await expect(
      approveTaxRateVersion(input, dependencies()),
    ).resolves.toEqual({
      ok: true,
      value: {
        taxRateVersionId: draft.id,
        reviewStatus: "APPROVED",
        reviewedAt: NOW,
      },
    });
    await expect(
      approveTaxRateVersion(input, dependencies()),
    ).resolves.toMatchObject({ ok: true, replay: true });

    await expect(
      client.taxRateVersion.findUniqueOrThrow({
        where: { id: draft.id },
        select: {
          reviewStatus: true,
          reviewedByUserId: true,
          reviewedAt: true,
        },
      }),
    ).resolves.toEqual({
      reviewStatus: "APPROVED",
      reviewedByUserId: adminUserId,
      reviewedAt: NOW,
    });
    await expect(
      client.auditLog.findMany({
        where: { action: "TAX_RATE_APPROVED", targetId: draft.id },
        select: {
          actorKind: true,
          actorUserId: true,
          capability: true,
          companyId: true,
          correlationId: true,
          metadata: true,
          reasonCode: true,
          result: true,
          targetType: true,
        },
      }),
    ).resolves.toEqual([
      {
        actorKind: "USER",
        actorUserId: adminUserId,
        capability: "ADMIN_CATALOG_MUTATE",
        companyId: null,
        correlationId: idempotencyKey,
        metadata: null,
        reasonCode: "FINANCE_REVIEW_COMPLETED",
        result: "SUCCEEDED",
        targetType: "TAX_RATE_VERSION",
      },
    ]);

    const overlapping = await client.taxRateVersion.create({
      data: {
        id: randomUUID(),
        jurisdiction,
        taxType,
        rateBasisPoints: 830,
        validFrom: new Date("2036-06-01T00:00:00.000Z"),
        validTo: new Date("2037-06-01T00:00:00.000Z"),
        source: "Phase 16 overlapping review fixture",
        reviewStatus: "DRAFT",
        createdAt: NOW,
      },
      select: { id: true },
    });
    await expect(
      approveTaxRateVersion(
        {
          taxRateVersionId: overlapping.id,
          expectedReviewStatus: "DRAFT",
          reasonCode: "FINANCE_REVIEW_COMPLETED",
          idempotencyKey: randomUUID(),
        },
        dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      client.taxRateVersion.findUniqueOrThrow({
        where: { id: overlapping.id },
        select: {
          reviewStatus: true,
          reviewedByUserId: true,
          reviewedAt: true,
        },
      }),
    ).resolves.toEqual({
      reviewStatus: "DRAFT",
      reviewedByUserId: null,
      reviewedAt: null,
    });
    await expect(
      client.auditLog.count({
        where: { action: "TAX_RATE_APPROVED", targetId: overlapping.id },
      }),
    ).resolves.toBe(0);
  });
});

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Phase 16 system-governance database unavailable.");
  }
  return database;
}

function dependencies() {
  return Object.freeze({
    actor: {
      userId: adminUserId,
      email: "admin@demo.ch",
      role: "ADMIN",
      status: "ACTIVE",
    },
    correlationId: randomUUID(),
    database: db(),
    now: NOW,
  });
}
