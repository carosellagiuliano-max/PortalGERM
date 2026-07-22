import { Buffer } from "node:buffer";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const emailMocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/providers/email", () => ({
  emailProvider: Object.freeze({ send: emailMocks.send }),
}));

import type { AuthRequestContext } from "@/lib/auth/request-context";
import { parseEnvironment, type ServerEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { MockEmailProvider } from "@/lib/providers/email/mock-email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import {
  SALES_LEAD_INTAKE_POLICY_V1,
  SALES_LEAD_NOTICE_HASH_V1,
  salesLeadAnalyticsKeyV1,
  salesLeadDueAtV1,
  salesLeadRetainUntilV1,
} from "@/lib/sales/lead-policy";
import { submitPublicEmployerLead } from "@/lib/sales/public-lead";
import type { LeadFormInput } from "@/lib/validation/billing";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-20T08:15:30.456Z");
const SOURCE_IP = "203.0.113.88";
const COMPANY_NAME = "Erlaubte Firmenname AG";
const CONTACT_CANARY = "Kontaktperson-Pii-Canary";
const EMAIL_CANARY = "phase08-pii-canary@example.test";
const PHONE_CANARY = "+41441234567";
const MESSAGE_CANARY =
  "Nachrichten-Pii-Canary: Wir suchen drei Fachpersonen für unser Team.";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;
let proPlanVersionId: string | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase-08 Sales Lead database is unavailable.");
  }
  return database;
}

function runtimeEnvironment(): ServerEnvironment {
  if (environment === undefined) {
    throw new Error("The Phase-08 Sales Lead environment is unavailable.");
  }
  return environment;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase08_public_sales_lead");
  database = createDatabaseClient(migrated.connectionString);
  environment = buildEnvironment(migrated.connectionString);
  await database.$connect();
  const proPlan = await database.plan.create({
    data: {
      code: "PRO",
      name: "Pro",
    },
    select: { id: true },
  });
  const proVersion = await database.planVersion.create({
    data: {
      planId: proPlan.id,
      version: 1,
      status: "ACTIVE",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 39_900,
      monthlyEquivalentRappen: 39_900,
      currency: "CHF",
      isPublic: true,
      isSelfService: true,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
    select: { id: true },
  });
  proPlanVersionId = proVersion.id;
});

afterAll(async () => {
  emailMocks.send.mockReset();
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  proPlanVersionId = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

beforeEach(async () => {
  if (migrated === undefined) {
    throw new Error("The isolated Phase-08 database is unavailable.");
  }
  // AuditLog, AnalyticsEvent and SalesActivity are deliberately append-only.
  // TRUNCATE is confined to this freshly-created disposable test database and
  // gives every case exact, independent cardinality assertions.
  await migrated.pool.query(`
    TRUNCATE TABLE
      "SalesLeadIntake",
      "AnalyticsEvent",
      "EmailLog",
      "AuditLog",
      "SystemTask",
      "SalesActivity",
      "SalesLead"
    CASCADE
  `);

  const provider = new MockEmailProvider(
    new PrismaEmailLogRepository(client()),
  );
  emailMocks.send.mockReset();
  emailMocks.send.mockImplementation(
    (input: Parameters<EmailProvider["send"]>[0]) => provider.send(input),
  );
});

describe.sequential("Phase-08 PostgreSQL public employer Lead intake", () => {
  it("persists one complete, privacy-bounded intake and every required operational effect", async () => {
    const input = leadInput("phase08-normal-intake-0001");
    const result = await submit(input, requestContext(correlationId(1)));

    expect(result).toMatchObject({ ok: true, duplicate: false });
    if (!result.ok) throw new Error("Expected a successful public Lead intake.");

    const [lead, intake] = await Promise.all([
      client().salesLead.findUnique({
        where: { id: result.leadId },
        include: { activities: true },
      }),
      client().salesLeadIntake.findUnique({
        where: { salesActivityId: result.activityId },
      }),
    ]);
    expect(lead).toMatchObject({
      companyId: null,
      emailNormalized: EMAIL_CANARY,
      organizationNormalized: COMPANY_NAME.toLocaleLowerCase("de-CH"),
      organizationName: COMPANY_NAME,
      contactName: CONTACT_CANARY,
      phoneNormalized: PHONE_CANARY,
      companySizeCode: "50_249",
      hiringNeedCode: "TWO_TO_FIVE",
      interestCode: "GENERAL",
      callbackWindowCode: "AFTERNOON",
      purpose: "EMPLOYER_DEMO",
      consentSource: SALES_LEAD_INTAKE_POLICY_V1.consentSource,
      message: MESSAGE_CANARY,
      noticeVersion: SALES_LEAD_INTAKE_POLICY_V1.notice.version,
      noticeHash: SALES_LEAD_NOTICE_HASH_V1,
      slaPolicyVersion: SALES_LEAD_INTAKE_POLICY_V1.sla.version,
      interestedPlanVersionId: null,
      status: "NEW",
      ownerUserId: null,
    });
    expect(lead?.dueAt).toEqual(salesLeadDueAtV1(NOW));
    expect(lead?.nextAt).toEqual(salesLeadDueAtV1(NOW));
    expect(lead?.retainUntil).toEqual(salesLeadRetainUntilV1(NOW));
    expect(lead?.activities).toEqual([
      expect.objectContaining({
        id: result.activityId,
        kind: "INTAKE_RECEIVED",
        actorUserId: null,
        safeNote: null,
        outcomeCode: "PUBLIC_INTAKE",
        idempotencyKey: input.idempotencyKey,
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        correlationId: correlationId(1),
        createdAt: NOW,
      }),
    ]);
    expect(intake).toMatchObject({
      salesLeadId: result.leadId,
      salesActivityId: result.activityId,
      organizationName: COMPANY_NAME,
      contactName: CONTACT_CANARY,
      phoneNormalized: PHONE_CANARY,
      companySizeCode: "50_249",
      hiringNeedCode: "TWO_TO_FIVE",
      interestCode: "GENERAL",
      callbackWindowCode: "AFTERNOON",
      message: MESSAGE_CANARY,
      noticeVersion: SALES_LEAD_INTAKE_POLICY_V1.notice.version,
      noticeHash: SALES_LEAD_NOTICE_HASH_V1,
      slaPolicyVersion: SALES_LEAD_INTAKE_POLICY_V1.sla.version,
      dueAt: salesLeadDueAtV1(NOW),
      retainUntil: salesLeadRetainUntilV1(NOW),
      interestedPlanVersionId: null,
      createdAt: NOW,
    });
    if (intake === null) throw new Error("Expected a persisted Lead intake.");

    const [task, audit, email, analytics] = await Promise.all([
      client().systemTask.findFirst({
        where: { evidenceReference: `sales-lead-intake:${intake.id}` },
      }),
      client().auditLog.findFirst({
        where: { action: "LEAD_SUBMITTED", targetId: result.leadId },
      }),
      client().emailLog.findFirst({
        where: { templateKey: "demo_request_received" },
      }),
      client().analyticsEvent.findFirst({
        where: {
          producer: "employer-demo",
          dedupeKey: `LEAD_SUBMITTED:${result.activityId}`,
        },
      }),
    ]);

    expect(task).toMatchObject({
      kind: "SALES_FOLLOW_UP",
      reasonCode: "PUBLIC_EMPLOYER_LEAD_INTAKE",
      evidenceReference: `sales-lead-intake:${intake.id}`,
      dueAt: salesLeadDueAtV1(NOW),
      status: "OPEN",
      idempotencyKey:
        `SALES_FOLLOW_UP:${intake.id}:${SALES_LEAD_INTAKE_POLICY_V1.sla.version}`,
    });
    expect(audit).toMatchObject({
      actorUserId: null,
      actorKind: "ANONYMOUS",
      capability: "PUBLIC_EMPLOYER_DEMO_SUBMIT",
      action: "LEAD_SUBMITTED",
      targetType: "SALES_LEAD",
      targetId: result.leadId,
      companyId: null,
      result: "SUCCEEDED",
      reasonCode: "PUBLIC_INTAKE",
      correlationId: correlationId(1),
      metadata: null,
      ipHashVersion: "v1",
      retainUntil: salesLeadRetainUntilV1(NOW),
    });
    expect(audit?.ipHash).toMatch(/^v1:[a-f0-9]{64}$/u);
    expect(audit?.ipHash).not.toContain(SOURCE_IP);
    expect(email).toMatchObject({
      recipient: SALES_LEAD_INTAKE_POLICY_V1.notificationRecipient,
      purpose: "demo_request_received",
      templateKey: "demo_request_received",
      status: "MOCK_RECORDED",
      errorCode: null,
    });
    expect(email?.payload).toMatchObject({
      schemaVersion: "1",
      deliveryStatus: "mock_recorded",
      externalDeliveryClaimed: false,
      subject: "Neue Demo-Anfrage eingegangen",
    });
    expect(analytics).toMatchObject({
      kind: "LEAD_SUBMITTED",
      schemaVersion: "1",
      purpose: "ESSENTIAL_OPERATIONAL",
      pseudonymousActorId: null,
      pseudonymousSessionId: salesLeadAnalyticsKeyV1(result.leadId),
      companyId: null,
      jobId: null,
      actorProvenanceSnapshot: "DEMO",
      companyProvenanceSnapshot: null,
      jobProvenanceSnapshot: null,
      properties: { leadPurpose: "EMPLOYER_DEMO" },
    });
    expect(analytics?.occurredAt).toEqual(NOW);

    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 1,
      analytics: 1,
    });

    const nonLeadRecords = JSON.stringify({
      activity: lead?.activities[0],
      task,
      audit,
      analytics,
    });
    for (const canary of [
      COMPANY_NAME,
      CONTACT_CANARY,
      EMAIL_CANARY,
      PHONE_CANARY,
      MESSAGE_CANARY,
      SOURCE_IP,
    ]) {
      expect(nonLeadRecords).not.toContain(canary);
      expect(JSON.stringify(email)).not.toContain(canary);
    }
  });

  it("dedupes a sequential retry with the same operation key exactly once", async () => {
    const input = leadInput("phase08-sequential-retry-0001");
    const first = await submit(input, requestContext(correlationId(10)));
    const retry = await submit(input, requestContext(correlationId(11)));

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    if (!first.ok || !retry.ok) throw new Error("Expected idempotent Lead results.");
    expect(retry.leadId).toBe(first.leadId);
    expect(retry.activityId).toBe(first.activityId);
    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 1,
      analytics: 1,
    });
  });

  it("serializes parallel retries with the same operation key exactly once", async () => {
    const input = leadInput("phase08-parallel-retry-0001");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        submit(input, requestContext(correlationId(20 + index))),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const successful = results.filter(
      (result): result is Extract<typeof result, { ok: true }> => result.ok,
    );
    expect(new Set(successful.map(({ leadId }) => leadId))).toHaveLength(1);
    expect(new Set(successful.map(({ activityId }) => activityId))).toHaveLength(1);
    expect(successful.filter(({ duplicate }) => !duplicate)).toHaveLength(1);
    expect(successful.filter(({ duplicate }) => duplicate)).toHaveLength(7);
    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 1,
      analytics: 1,
    });
  });

  it("keeps the canonical Lead immutable while each new intake gets its own effects", async () => {
    const firstInput = leadInput("phase08-canonical-lead-0001");
    const secondInput: LeadFormInput = {
      ...firstInput,
      idempotencyKey: "phase08-canonical-lead-0002",
      companyName: "Folgeanfrage Beispiel AG",
      contactName: "Aktualisierte Kontaktperson",
      phone: "+41311234567",
      companySizeCode: "250_999",
      hiringNeedCode: "SIX_TO_TWENTY",
      message:
        "Eine aktualisierte und weiterhin ausreichend lange Personalbedarfsanfrage.",
      callbackWindowCode: "MORNING",
    };
    const followUpAt = new Date(NOW.getTime() + DAY_MILLISECONDS);
    const first = await submit(firstInput, requestContext(correlationId(30)));
    expect(first).toMatchObject({ ok: true, duplicate: false });
    if (!first.ok) throw new Error("Expected the first canonical Lead result.");
    const canonicalBefore = await client().salesLead.findUniqueOrThrow({
      where: { id: first.leadId },
    });

    const second = await submit(
      secondInput,
      requestContext(correlationId(31)),
      followUpAt,
    );
    const oldKeyRetry = await submit(
      firstInput,
      requestContext(correlationId(32)),
      new Date(NOW.getTime() + 2 * DAY_MILLISECONDS),
    );

    expect(second).toMatchObject({ ok: true, duplicate: false });
    expect(oldKeyRetry).toMatchObject({ ok: true, duplicate: true });
    if (!second.ok || !oldKeyRetry.ok) {
      throw new Error("Expected canonical Lead follow-up results.");
    }
    expect(second.leadId).toBe(first.leadId);
    expect(second.activityId).not.toBe(first.activityId);
    expect(oldKeyRetry).toMatchObject({
      leadId: first.leadId,
      activityId: first.activityId,
    });

    const [canonicalAfter, intakes, activities, tasks, audits, analytics] =
      await Promise.all([
        client().salesLead.findUniqueOrThrow({ where: { id: first.leadId } }),
        client().salesLeadIntake.findMany({
          where: { salesLeadId: first.leadId },
          orderBy: { createdAt: "asc" },
        }),
        client().salesActivity.findMany({
          where: { salesLeadId: first.leadId },
          orderBy: { createdAt: "asc" },
        }),
        client().systemTask.findMany({ orderBy: { dueAt: "asc" } }),
        client().auditLog.findMany({
          where: { action: "LEAD_SUBMITTED", targetId: first.leadId },
        }),
        client().analyticsEvent.findMany({
          where: { kind: "LEAD_SUBMITTED" },
          orderBy: { occurredAt: "asc" },
        }),
      ]);

    expect(canonicalAfter).toMatchObject({
      organizationName: firstInput.companyName,
      contactName: firstInput.contactName,
      phoneNormalized: firstInput.phone,
      companySizeCode: firstInput.companySizeCode,
      hiringNeedCode: firstInput.hiringNeedCode,
      interestCode: firstInput.interestCode,
      message: firstInput.message,
      callbackWindowCode: firstInput.callbackWindowCode,
      interestedPlanVersionId: null,
      dueAt: salesLeadDueAtV1(NOW),
      nextAt: salesLeadDueAtV1(NOW),
      retainUntil: salesLeadRetainUntilV1(NOW),
      updatedAt: canonicalBefore.updatedAt,
    });
    expect(intakes).toHaveLength(2);
    expect(intakes[0]).toMatchObject({
      salesActivityId: first.activityId,
      organizationName: firstInput.companyName,
      contactName: firstInput.contactName,
      phoneNormalized: firstInput.phone,
      companySizeCode: firstInput.companySizeCode,
      hiringNeedCode: firstInput.hiringNeedCode,
      message: firstInput.message,
      callbackWindowCode: firstInput.callbackWindowCode,
      dueAt: salesLeadDueAtV1(NOW),
      retainUntil: salesLeadRetainUntilV1(NOW),
      createdAt: NOW,
    });
    expect(intakes[1]).toMatchObject({
      salesActivityId: second.activityId,
      organizationName: secondInput.companyName,
      contactName: secondInput.contactName,
      phoneNormalized: secondInput.phone,
      companySizeCode: secondInput.companySizeCode,
      hiringNeedCode: secondInput.hiringNeedCode,
      message: secondInput.message,
      callbackWindowCode: secondInput.callbackWindowCode,
      dueAt: salesLeadDueAtV1(followUpAt),
      retainUntil: salesLeadRetainUntilV1(followUpAt),
      createdAt: followUpAt,
    });
    expect(activities.map(({ id }) => id)).toEqual([
      first.activityId,
      second.activityId,
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map(({ evidenceReference }) => evidenceReference).sort()).toEqual(
      intakes.map(({ id }) => `sales-lead-intake:${id}`).sort(),
    );
    expect(tasks.every(({ reasonCode }) =>
      reasonCode === "PUBLIC_EMPLOYER_LEAD_INTAKE"
    )).toBe(true);
    expect(tasks.map(({ dueAt }) => dueAt)).toEqual([
      salesLeadDueAtV1(NOW),
      salesLeadDueAtV1(followUpAt),
    ]);
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map(({ correlationId }) => correlationId))).toEqual(
      new Set([correlationId(30), correlationId(31)]),
    );
    expect(analytics.map(({ dedupeKey }) => dedupeKey)).toEqual([
      `LEAD_SUBMITTED:${first.activityId}`,
      `LEAD_SUBMITTED:${second.activityId}`,
    ]);
    expect(analytics.map(({ occurredAt }) => occurredAt)).toEqual([
      NOW,
      followUpAt,
    ]);
    expect(new Set(analytics.map(({ pseudonymousSessionId }) =>
      pseudonymousSessionId
    ))).toEqual(new Set([salesLeadAnalyticsKeyV1(first.leadId)]));
    expect(emailMocks.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { idempotencyKey: first.activityId } }),
    );
    expect(emailMocks.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { idempotencyKey: second.activityId } }),
    );
    expect(emailMocks.send).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ data: { idempotencyKey: first.activityId } }),
    );
    await expectExactCounts({
      leads: 1,
      intakes: 2,
      activities: 2,
      tasks: 2,
      audits: 2,
      emails: 2,
      analytics: 2,
    });
  });

  it("snapshots the active PRO PlanVersion foreign key on Lead and intake", async () => {
    if (proPlanVersionId === undefined) {
      throw new Error("The Phase-08 PRO PlanVersion fixture is unavailable.");
    }
    const input: LeadFormInput = {
      ...leadInput("phase08-pro-plan-version-0001"),
      interestCode: "PRO",
    };

    const result = await submit(input, requestContext(correlationId(35)));

    expect(result).toMatchObject({ ok: true, duplicate: false });
    if (!result.ok) throw new Error("Expected a successful PRO Lead intake.");
    const [lead, intake] = await Promise.all([
      client().salesLead.findUniqueOrThrow({ where: { id: result.leadId } }),
      client().salesLeadIntake.findUniqueOrThrow({
        where: { salesActivityId: result.activityId },
      }),
    ]);
    expect(lead).toMatchObject({
      purpose: "SALES_CONTACT",
      interestCode: "PRO",
      interestedPlanVersionId: proPlanVersionId,
    });
    expect(intake).toMatchObject({
      interestCode: "PRO",
      interestedPlanVersionId: proPlanVersionId,
    });
    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 1,
      analytics: 1,
    });
  });

  it("commits intake effects on transient mail failure and heals one mail on retry", async () => {
    const input = leadInput("phase08-mail-recovery-0001");
    emailMocks.send.mockRejectedValueOnce(
      new Error("Transient mock mail failure"),
    );

    const first = await submit(input, requestContext(correlationId(36)));

    expect(first).toEqual({ ok: false, code: "NOTIFICATION_FAILED" });
    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 0,
      analytics: 1,
    });
    const [lead, activity] = await Promise.all([
      client().salesLead.findFirstOrThrow(),
      client().salesActivity.findFirstOrThrow(),
    ]);

    const retry = await submit(input, requestContext(correlationId(37)));

    expect(retry).toMatchObject({
      ok: true,
      duplicate: true,
      leadId: lead.id,
      activityId: activity.id,
    });
    expect(emailMocks.send).toHaveBeenCalledTimes(2);
    expect(emailMocks.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { idempotencyKey: activity.id } }),
    );
    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 1,
      analytics: 1,
    });
  });

  it("rejects a changed payload for a reused idempotency key without partial writes", async () => {
    const input = leadInput("phase08-idempotency-conflict-0001");
    const first = await submit(input, requestContext(correlationId(40)));
    const conflict = await submit(
      {
        ...input,
        message:
          "Dies ist eine andere, ausreichend lange Anfrage unter demselben Schlüssel.",
      },
      requestContext(correlationId(41)),
    );

    expect(first).toMatchObject({ ok: true });
    expect(conflict).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    await expectExactCounts({
      leads: 1,
      intakes: 1,
      activities: 1,
      tasks: 1,
      audits: 1,
      emails: 1,
      analytics: 1,
    });
    const persisted = await client().salesLead.findFirst();
    expect(persisted?.message).toBe(input.message);
  });
});

const DAY_MILLISECONDS = 86_400_000;

function leadInput(idempotencyKey: string): LeadFormInput {
  return Object.freeze({
    email: EMAIL_CANARY,
    companyName: COMPANY_NAME,
    contactName: CONTACT_CANARY,
    phone: PHONE_CANARY,
    companySizeCode: "50_249",
    hiringNeedCode: "TWO_TO_FIVE",
    interestCode: "GENERAL",
    message: MESSAGE_CANARY,
    callbackWindowCode: "AFTERNOON",
    acceptedContactPurpose: "yes",
    idempotencyKey,
    websiteConfirmation: "",
  });
}

async function submit(
  input: LeadFormInput,
  request: AuthRequestContext,
  now = NOW,
) {
  return submitPublicEmployerLead(input, {
    database: client(),
    environment: runtimeEnvironment(),
    request,
    now,
  });
}

function requestContext(correlationIdValue: string): AuthRequestContext {
  return Object.freeze({
    correlationId: correlationIdValue,
    expectedOrigin: "http://localhost:3000",
    origin: "http://localhost:3000",
    production: false,
    sourceIp: SOURCE_IP,
    userAgent: "Phase-08 PostgreSQL integration test",
  });
}

function correlationId(index: number) {
  return `08200000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function expectExactCounts(expected: Readonly<{
  leads: number;
  intakes: number;
  activities: number;
  tasks: number;
  audits: number;
  emails: number;
  analytics: number;
}>) {
  await expect(client().salesLead.count()).resolves.toBe(expected.leads);
  await expect(client().salesLeadIntake.count()).resolves.toBe(expected.intakes);
  await expect(client().salesActivity.count()).resolves.toBe(expected.activities);
  await expect(client().systemTask.count()).resolves.toBe(expected.tasks);
  await expect(client().auditLog.count({ where: { action: "LEAD_SUBMITTED" } })).resolves.toBe(expected.audits);
  await expect(client().emailLog.count({ where: { templateKey: "demo_request_received" } })).resolves.toBe(expected.emails);
  await expect(client().analyticsEvent.count({ where: { kind: "LEAD_SUBMITTED" } })).resolves.toBe(expected.analytics);
}

function buildEnvironment(connectionString: string): ServerEnvironment {
  return parseEnvironment({
    APP_ENV: "local",
    NODE_ENV: "test",
    DATABASE_URL: connectionString,
    APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub Integration",
    SESSION_SECRET: secret(21),
    AUDIT_IP_HASH_KEYS: `v1:${secret(22)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret(23)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret(24)}`,
    REVEAL_CONFIRMATION_KEYS: `v1:${secret(25)}`,
    PII_REVEAL_KEYS: `v1:${secret(26)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    LOG_LEVEL: "error",
  });
}

function secret(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64");
}
