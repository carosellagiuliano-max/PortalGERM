import { Buffer } from "node:buffer";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicReport } from "@/lib/abuse/public-report";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { parseEnvironment, type ServerEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockEmailProvider } from "@/lib/providers/email/mock-email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const DAY = 86_400_000;
const COMPANY_ID = "07100000-0000-4000-8000-000000000001";
const CORRELATION_ID = "07100000-0000-4000-8000-000000000002";
const LIMITED_COMPANY_ID = "07100000-0000-4000-8000-000000000003";
const SOURCE_IP = "203.0.113.42";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase-07 abuse-report client is unavailable.");
  }
  return database;
}

function runtimeEnvironment(): ServerEnvironment {
  if (environment === undefined) {
    throw new Error("The Phase-07 abuse-report runtime is unavailable.");
  }
  return environment;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase07_public_abuse_report");
  database = createDatabaseClient(migrated.connectionString);
  environment = buildEnvironment(migrated.connectionString);
  await database.company.create({
    data: {
      id: COMPANY_ID,
      name: "Reportable Company AG",
      slug: "reportable-company-ag",
      values: ["Fairness"],
      benefits: ["Flexibilität"],
      status: "DRAFT",
      dataProvenance: "LIVE",
    },
  });
  await database.company.create({
    data: {
      id: LIMITED_COMPANY_ID,
      name: "Rate Limited Company AG",
      slug: "rate-limited-company-ag",
      values: ["Fairness"],
      benefits: ["Flexibilität"],
      status: "DRAFT",
      dataProvenance: "LIVE",
    },
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

beforeEach(async () => {
  await client().rateLimitBucket.deleteMany();
});

describe.sequential("Phase-07 PostgreSQL public abuse-report intake", () => {
  it("persists the sanitized report, CREATED event, required audit and target limit atomically", async () => {
    const emailProvider = new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
    );
    const result = await createPublicReport(
      {
        targetType: "COMPANY",
        slug: "reportable-company-ag",
        reasonCode: "SCAM_OR_FRAUD",
        description:
          "<script>danger()</script><b>Belegter Betrugsverdacht mit nachvollziehbaren Angaben.</b>",
      },
      { id: COMPANY_ID, targetType: "COMPANY", companyId: COMPANY_ID },
      {
        database: client(),
        environment: runtimeEnvironment(),
        request: requestContext(CORRELATION_ID),
        currentUser: null,
        emailProvider,
        now: NOW,
      },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected a persisted public report.");

    const report = await client().abuseReport.findUnique({
      where: { id: result.reportId },
      include: { events: true },
    });
    expect(report).toMatchObject({
      targetType: "COMPANY",
      targetId: COMPANY_ID,
      reporterUserId: null,
      reasonCode: "SCAM_OR_FRAUD",
      description: "Belegter Betrugsverdacht mit nachvollziehbaren Angaben.",
      severity: "HIGH",
      status: "OPEN",
    });
    expect(report?.dueAt).toEqual(new Date(NOW.getTime() + DAY));
    expect(report?.events).toEqual([
      expect.objectContaining({
        kind: "CREATED",
        actorUserId: null,
        reasonCode: "PUBLIC_INTAKE",
        correlationId: CORRELATION_ID,
        createdAt: NOW,
      }),
    ]);

    const audit = await client().auditLog.findFirst({
      where: {
        action: "ABUSE_REPORT_SUBMITTED",
        targetType: "ABUSE_REPORT",
        targetId: result.reportId,
      },
    });
    expect(audit).toMatchObject({
      actorKind: "ANONYMOUS",
      actorUserId: null,
      capability: "PUBLIC_ABUSE_REPORT_SUBMIT",
      companyId: COMPANY_ID,
      correlationId: CORRELATION_ID,
      result: "SUCCEEDED",
      reasonCode: "PUBLIC_INTAKE",
      ipHashVersion: "v1",
    });
    expect(audit?.ipHash).toMatch(/^v1:[a-f0-9]{64}$/u);
    expect(audit?.retainUntil).toEqual(new Date(NOW.getTime() + 365 * DAY));
    const email = await client().emailLog.findFirstOrThrow({
      where: {
        recipient: "abuse-admin@example.test",
        templateKey: "abuse_report_received",
      },
      select: {
        purpose: true,
        status: true,
        payload: true,
      },
    });
    expect(email).toMatchObject({
      purpose: "abuse_report_received",
      status: "MOCK_RECORDED",
    });
    expect(JSON.stringify(email.payload)).toContain("Betrug oder Täuschung");
    expect(JSON.stringify(email.payload)).not.toContain(
      "Belegter Betrugsverdacht",
    );

    const buckets = await client().rateLimitBucket.findMany();
    expect(buckets).toEqual([
      expect.objectContaining({
        namespace: "v1:ABUSE_INTAKE:ACTOR_OR_IP_TARGET",
        count: 1,
        windowStart: NOW,
      }),
    ]);
  });

  it("limits one IP per target without letting it exhaust the target for everyone", async () => {
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(
        await createPublicReport(
          {
            targetType: "COMPANY",
            slug: "rate-limited-company-ag",
            reasonCode: "MISLEADING",
            description: `Nachvollziehbare öffentliche Meldung Nummer ${index + 1} mit Details.`,
          },
          {
            id: LIMITED_COMPANY_ID,
            targetType: "COMPANY",
            companyId: LIMITED_COMPANY_ID,
          },
          {
            database: client(),
            environment: runtimeEnvironment(),
            request: requestContext(
              `07100000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
            ),
            currentUser: null,
            now: NOW,
          },
        ),
      );
    }

    expect(results.slice(0, 3).every((result) => result.ok)).toBe(true);
    expect(results[3]).toEqual({ ok: false, code: "RATE_LIMITED" });
    await expect(client().auditLog.findFirst({
      where: { action: "RATE_LIMITED", targetId: LIMITED_COMPANY_ID },
      orderBy: { createdAt: "desc" },
      select: { result: true, metadata: true, targetType: true },
    })).resolves.toEqual({ result: "DENIED", metadata: { preset: "ABUSE_INTAKE", scope: "ACTOR_OR_IP_TARGET" }, targetType: "COMPANY" });
    const independentReporter = await createPublicReport(
      {
        targetType: "COMPANY",
        slug: "rate-limited-company-ag",
        reasonCode: "MISLEADING",
        description: "Unabhängige öffentliche Meldung mit nachvollziehbaren Details.",
      },
      {
        id: LIMITED_COMPANY_ID,
        targetType: "COMPANY",
        companyId: LIMITED_COMPANY_ID,
      },
      {
        database: client(),
        environment: runtimeEnvironment(),
        request: requestContext(
          "07100000-0000-4000-8000-000000000099",
          "198.51.100.77",
        ),
        currentUser: null,
        now: NOW,
      },
    );
    expect(independentReporter.ok).toBe(true);
    await expect(
      client().abuseReport.count({ where: { targetId: LIMITED_COMPANY_ID } }),
    ).resolves.toBe(4);
    await expect(
      client().abuseReportEvent.count({
        where: { abuseReport: { targetId: LIMITED_COMPANY_ID } },
      }),
    ).resolves.toBe(4);
    await expect(
      client().auditLog.count({
        where: {
          action: "ABUSE_REPORT_SUBMITTED",
          companyId: LIMITED_COMPANY_ID,
        },
      }),
    ).resolves.toBe(4);
    const buckets = await client().rateLimitBucket.findMany({
      where: { namespace: "v1:ABUSE_INTAKE:ACTOR_OR_IP_TARGET" },
      orderBy: { count: "desc" },
    });
    expect(buckets.map((bucket) => bucket.count)).toEqual([3, 1]);
  });
});

function requestContext(
  correlationId: string,
  sourceIp = SOURCE_IP,
): AuthRequestContext {
  return Object.freeze({
    correlationId,
    expectedOrigin: "http://localhost:3000",
    origin: "http://localhost:3000",
    production: false,
    sourceIp,
    userAgent: "Phase-07 PostgreSQL integration test",
  });
}

function buildEnvironment(connectionString: string): ServerEnvironment {
  return parseEnvironment({
    APP_ENV: "local",
    NODE_ENV: "test",
    DATABASE_URL: connectionString,
    APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub Integration",
    SESSION_SECRET: secret(11),
    AUDIT_IP_HASH_KEYS: `v1:${secret(12)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret(13)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret(14)}`,
    REVEAL_CONFIRMATION_KEYS: `v1:${secret(15)}`,
    PII_REVEAL_KEYS: `v1:${secret(16)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    ABUSE_REPORT_ADMIN_EMAILS: "abuse-admin@example.test",
    LOG_LEVEL: "error",
  });
}

function secret(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64");
}
