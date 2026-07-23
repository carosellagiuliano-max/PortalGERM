import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type RequiredAuditInput,
  writeRequiredAudit,
} from "@/lib/audit/log";
import { createPrismaAuditPort } from "@/lib/audit/prisma-port";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import {
  AUDIT_ACTIONS_V1,
  type AuditActionV1,
} from "@/lib/domains/audit/audit-actions";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const RETAIN_UNTIL = new Date("2030-01-01T00:00:00.000Z");

describe("AUDIT_ACTIONS_V1 PostgreSQL persistence contract", () => {
  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase16_audit_action_matrix");
    database = createDatabaseClient(migrated.connectionString);
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect();
    await migrated?.dispose();
  });

  it("validates and persists every exact canonical action", async () => {
    const client = requiredDatabase();
    const auditPort = createPrismaAuditPort(client);

    for (const [index, action] of AUDIT_ACTIONS_V1.entries()) {
      await writeRequiredAudit(auditPort, {
        action,
        actorKind: "SYSTEM",
        capability: "AUDIT_MATRIX_VERIFY",
        correlationId: deterministicUuid(index, 1),
        metadata: metadataFor(action),
        reasonCode: "MATRIX_PERSISTENCE",
        result: "SUCCEEDED",
        retainUntil: RETAIN_UNTIL,
        targetId: deterministicUuid(index, 2),
        targetType: "SYSTEM_TASK",
      });
    }

    const rows = await client.auditLog.findMany({
      orderBy: { targetId: "asc" },
      select: {
        action: true,
        actorKind: true,
        actorUserId: true,
        capability: true,
        result: true,
      },
    });

    expect(rows).toHaveLength(AUDIT_ACTIONS_V1.length);
    expect(rows.map((row) => row.action)).toEqual([...AUDIT_ACTIONS_V1]);
    expect(
      rows.every(
        (row) =>
          row.actorKind === "SYSTEM" &&
          row.actorUserId === null &&
          row.capability === "AUDIT_MATRIX_VERIFY" &&
          row.result === "SUCCEEDED",
      ),
    ).toBe(true);
  });
});

function metadataFor(
  action: AuditActionV1,
): RequiredAuditInput["metadata"] {
  switch (action) {
    case "USER_REGISTERED":
      return { role: "CANDIDATE" };
    case "USER_LOGIN_FAILED":
      return { identifierHash: `v1:${"a".repeat(64)}` };
    case "COMPANY_CREATED_WITH_OWNER":
    case "COMPANY_CLAIM_REQUESTED":
      return { signalCodes: ["EMAIL_DOMAIN"] };
    case "CATALOG_VERSION_SCHEDULED":
      return { sourceVersionId: deterministicUuid(0, 3) };
    case "RATE_LIMITED":
      return { preset: "LOGIN", scope: "IP_EMAIL" };
    default:
      return {};
  }
}

function deterministicUuid(index: number, namespace: number) {
  const suffix = (namespace * 1_000 + index + 1).toString().padStart(12, "0");
  return `66000000-0000-4000-8000-${suffix}`;
}

function requiredDatabase() {
  if (database === undefined) {
    throw new Error("The audit matrix database is unavailable.");
  }
  return database;
}
