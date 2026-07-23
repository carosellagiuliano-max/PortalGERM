import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AUDIT_IP_HASH_RETENTION_MILLISECONDS } from "@/lib/audit/log";
import { runAuditIpRetention } from "@/lib/audit/maintenance";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const IDS = [
  "65000000-0000-4000-8000-000000000001",
  "65000000-0000-4000-8000-000000000002",
  "65000000-0000-4000-8000-000000000003",
] as const;
const CLI_ROW_ID = "65000000-0000-4000-8000-000000000004";

describe("AuditLog IP hash retention", () => {
  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase16_audit_ip_retention");
    database = createDatabaseClient(migrated.connectionString);
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect();
    await migrated?.dispose();
  });

  it("uses the database clock so positive app skew cannot abort the mixed-age batch", async () => {
    const now = await databaseNow();
    const createdAt = [
      new Date(
        now.getTime() - AUDIT_IP_HASH_RETENTION_MILLISECONDS - 86_400_000,
      ),
      new Date(
        now.getTime() - AUDIT_IP_HASH_RETENTION_MILLISECONDS - 3_600_000,
      ),
      new Date(
        now.getTime() - AUDIT_IP_HASH_RETENTION_MILLISECONDS + 86_400_000,
      ),
    ];
    const hash = `v1:${"a".repeat(64)}`;

    await requiredDatabase().auditLog.createMany({
      data: IDS.map((id, index) => ({
        id,
        actorKind: "SYSTEM",
        capability: "SECURITY_RETENTION_TEST",
        action: "MAINTENANCE_PROJECTION_SYNCED",
        targetType: "SYSTEM_TASK",
        targetId: id,
        result: "SUCCEEDED",
        reasonCode: "RETENTION_BOUNDARY",
        correlationId: `phase16-retention-${index}`,
        ipHash: hash,
        ipHashVersion: "v1",
        retainUntil: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: createdAt[index],
      })),
    });

    // With the old application cutoff, a clock one year ahead selected even the
    // young row; PostgreSQL then rejected that row and rolled back the whole
    // updateMany. Faking only JavaScript's Date proves it is no longer consulted.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(
      new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
    );
    try {
      await expect(runAuditIpRetention(requiredDatabase())).resolves.toEqual({
        nullifiedCount: 2,
      });
    } finally {
      vi.useRealTimers();
    }

    const rows = await requiredDatabase().auditLog.findMany({
      where: { id: { in: [...IDS] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, ipHash: true, ipHashVersion: true },
    });
    expect(rows).toEqual([
      { id: IDS[0], ipHash: null, ipHashVersion: null },
      { id: IDS[1], ipHash: null, ipHashVersion: null },
      { id: IDS[2], ipHash: hash, ipHashVersion: "v1" },
    ]);

    await expect(runAuditIpRetention(requiredDatabase())).resolves.toEqual({
      nullifiedCount: 0,
    });

    await expect(
      requiredDatabase().auditLog.update({
        where: { id: IDS[0] },
        data: { reasonCode: "RETENTION_TAMPER" },
      }),
    ).rejects.toThrow(/append-only/u);
    await expect(
      requiredDatabase().auditLog.update({
        where: { id: IDS[2] },
        data: { ipHash: null, ipHashVersion: null },
      }),
    ).rejects.toThrow(/append-only/u);
    await expect(
      requiredDatabase().auditLog.delete({ where: { id: IDS[0] } }),
    ).rejects.toThrow(/append-only/u);
  });

  it("runs through the real CLI entry point against an isolated database", async () => {
    const hash = `v1:${"b".repeat(64)}`;
    const now = await databaseNow();
    await requiredDatabase().auditLog.create({
      data: {
        id: CLI_ROW_ID,
        actorKind: "SYSTEM",
        capability: "SECURITY_RETENTION_TEST",
        action: "MAINTENANCE_PROJECTION_SYNCED",
        targetType: "SYSTEM_TASK",
        targetId: CLI_ROW_ID,
        result: "SUCCEEDED",
        reasonCode: "CLI_RETENTION_BOUNDARY",
        correlationId: "phase16-retention-cli",
        ipHash: hash,
        ipHashVersion: "v1",
        retainUntil: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: new Date(
          now.getTime() - AUDIT_IP_HASH_RETENTION_MILLISECONDS - 1_000,
        ),
      },
    });

    const result = await runMaintenanceCli(requiredMigrated().connectionString);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("audit_ip_retention.completed");
    expect(result.output).not.toContain(requiredMigrated().connectionString);
    await expect(
      requiredDatabase().auditLog.findUniqueOrThrow({
        where: { id: CLI_ROW_ID },
        select: { ipHash: true, ipHashVersion: true },
      }),
    ).resolves.toEqual({ ipHash: null, ipHashVersion: null });
  });
});

function requiredDatabase() {
  if (database === undefined) {
    throw new Error("The audit retention database is unavailable.");
  }
  return database;
}

function requiredMigrated() {
  if (migrated === undefined) {
    throw new Error("The migrated audit database is unavailable.");
  }
  return migrated;
}

async function databaseNow() {
  const rows = await requiredDatabase().$queryRaw<Array<{ now: Date }>>`
    SELECT statement_timestamp() AS "now"
  `;
  const now = rows[0]?.now;
  if (now === undefined) {
    throw new Error("PostgreSQL did not return its statement clock.");
  }
  return now;
}

function runMaintenanceCli(databaseUrl: string) {
  return new Promise<Readonly<{ exitCode: number; output: string }>>(
    (resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve(process.cwd(), "scripts/security-maintenance.ts"),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            APP_ENV: "local",
            NODE_ENV: "test",
            DATABASE_URL: databaseUrl,
            TEST_DATABASE_URL: "",
            APP_URL: "http://127.0.0.1:3000",
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolveResult({ exitCode: exitCode ?? 1, output });
      });
    },
  );
}
