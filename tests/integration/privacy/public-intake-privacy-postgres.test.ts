import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicReport } from "@/lib/abuse/public-report";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  lockPublicIntakePrivacyGate,
  resolvePublicIntakePrivacyGate,
  toPublicIntakePrivacyExpectedBinding,
} from "@/lib/privacy/public-intake-privacy-gate";
import type {
  PublicIntakePrivacyExpectedBinding,
  PublicIntakePrivacyPurpose,
} from "@/lib/privacy/public-intake-privacy-contract";
import { submitPublicEmployerLead } from "@/lib/sales/public-lead";
import type { LeadFormInput } from "@/lib/validation/billing";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-08-06T12:00:00.000Z");
const COMPANY_ID = "34070000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "34070000-0000-4000-8000-000000000002";
const REQUEST: AuthRequestContext = Object.freeze({
  correlationId: "34070000-0000-4000-8000-000000000003",
  expectedOrigin: "http://localhost:3000",
  origin: "http://localhost:3000",
  production: false,
  sourceIp: "198.51.100.34",
  userAgent: "Phase-34 public-intake privacy PostgreSQL test",
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase34_public_intake_privacy");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const base = parseEnvironment(
    createValidEnvironment({ DATABASE_URL: migrated.connectionString }),
  );
  environment = Object.freeze({
    ...base,
    APP_ENV: "preview" as const,
    LEGAL_PUBLICATION_PRIVACY: true,
  });
  await seedLegalPublication(database);
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-34 PostgreSQL public-intake privacy boundary", () => {
  it("persists exact published evidence and rejects legacy or mutable evidence", async () => {
    const leadBinding = await currentBinding("EMPLOYER_DEMO");
    const leadResult = await submitLead(
      client(),
      leadBinding,
      "phase34-published-lead",
    );
    expect(leadResult).toMatchObject({ ok: true });
    if (!leadResult.ok) throw new Error("Expected a bound employer Lead.");

    const intake = await client().salesLeadIntake.findUniqueOrThrow({
      where: { salesActivityId: leadResult.activityId },
    });
    expect(intake).toMatchObject({
      privacyEvidenceMode: "PUBLISHED_LEGAL",
      privacyLegalPublicationId: leadBinding.legalPublicationId,
      privacyPublicationHash: leadBinding.publicationHash,
      privacyPublicationVersion: leadBinding.publicationVersion,
      noticeVersion: leadBinding.noticeVersion,
      noticeHash: leadBinding.noticeHash,
    });
    await expect(
      client().salesLeadIntake.update({
        where: { id: intake.id },
        data: { privacyPublicationHash: "b".repeat(64) },
      }),
    ).rejects.toBeDefined();
    await expect(
      client().salesLeadIntake.create({
        data: {
          salesLeadId: leadResult.leadId,
          salesActivityId: leadResult.activityId,
          organizationName: "Ungebundene Phase 34 AG",
          contactName: "Direkter Datenbanktest",
          companySizeCode: "10_49",
          hiringNeedCode: "ONE_ROLE",
          interestCode: "GENERAL",
          message: "Eine neue ungebundene Anfrage muss PostgreSQL ablehnen.",
          noticeVersion: leadBinding.noticeVersion,
          noticeHash: leadBinding.noticeHash,
          slaPolicyVersion: "sales-lead-sla-v1",
          dueAt: new Date(NOW.getTime() + 86_400_000),
          retainUntil: new Date(NOW.getTime() + 365 * 86_400_000),
        },
      }),
    ).rejects.toBeDefined();

    const binding = await currentBinding("ABUSE_REPORT");
    const result = await submitReport(client(), binding);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected a bound abuse report.");

    const report = await client().abuseReport.findUniqueOrThrow({
      where: { id: result.reportId },
    });
    expect(report).toMatchObject({
      privacyEvidenceMode: "PUBLISHED_LEGAL",
      privacyLegalPublicationId: binding.legalPublicationId,
      privacyPublicationHash: binding.publicationHash,
      privacyPublicationVersion: binding.publicationVersion,
      privacyNoticeVersion: binding.noticeVersion,
      privacyNoticeHash: binding.noticeHash,
    });

    await expect(
      client().abuseReport.update({
        where: { id: result.reportId },
        data: { privacyNoticeHash: "b".repeat(64) },
      }),
    ).rejects.toBeDefined();
    await expect(
      client().abuseReport.create({
        data: {
          targetType: "COMPANY",
          targetId: COMPANY_ID,
          reasonCode: "LEGACY_INSERT_MUST_FAIL",
          description: "A new unbound report must be rejected by PostgreSQL.",
          dueAt: new Date(NOW.getTime() + 86_400_000),
        },
      }),
    ).rejects.toBeDefined();
  });

  it("holds the exact legal row lock until the intake transaction finishes", async () => {
    await client().legalPublication.update({
      where: { id: PUBLICATION_ID },
      data: { status: "CURRENT", revokedAt: null, revokeReasonCode: null },
    });
    const binding = await currentBinding("ABUSE_REPORT");
    const acquired = deferred<void>();
    const release = deferred<void>();

    const holder = client().$transaction(async (transaction) => {
      const decision = await lockPublicIntakePrivacyGate(
        transaction,
        binding,
        { environment: runtimeEnvironment(), now: NOW },
      );
      acquired.resolve();
      await release.promise;
      return decision;
    });
    await acquired.promise;

    let updateSettled = false;
    const rotation = client()
      .legalPublication.update({
        where: { id: PUBLICATION_ID },
        data: {
          status: "REVOKED",
          revokedAt: new Date(NOW.getTime() + 1_000),
          revokeReasonCode: "PHASE_34_CONCURRENT_ROTATION",
        },
      })
      .then(() => {
        updateSettled = true;
      });
    await delay(125);
    expect(updateSettled).toBe(false);

    release.resolve();
    await expect(holder).resolves.toMatchObject({ allowed: true });
    await rotation;
    expect(updateSettled).toBe(true);
    await client().legalPublication.update({
      where: { id: PUBLICATION_ID },
      data: { status: "CURRENT", revokedAt: null, revokeReasonCode: null },
    });
  });

  it("keeps Lead, rate-limit, audit, analytics, task, and outbox state unchanged when publication rotation wins the race", async () => {
    const binding = await currentBinding("EMPLOYER_DEMO");
    const before = await effectCounts();
    const rotatingDatabase = rotateBeforeTransaction(client());

    await expect(
      submitLead(
        rotatingDatabase,
        binding,
        "phase34-rotated-published-lead",
      ),
    ).resolves.toEqual({ ok: false, code: "PRIVACY_UNAVAILABLE" });
    expect(await effectCounts()).toEqual(before);

    await client().legalPublication.update({
      where: { id: PUBLICATION_ID },
      data: { status: "CURRENT", revokedAt: null, revokeReasonCode: null },
    });
  });

  it("returns a visible-safe denial with zero intake effects when rotation lands between preflight and lock", async () => {
    const binding = await currentBinding("ABUSE_REPORT");
    const before = await effectCounts();
    const rotatingDatabase = rotateBeforeTransaction(client());

    await expect(submitReport(rotatingDatabase, binding)).resolves.toEqual({
      ok: false,
      code: "PRIVACY_UNAVAILABLE",
    });
    await expect(
      resolvePublicIntakePrivacyGate("ABUSE_REPORT", {
        database: client(),
        environment: runtimeEnvironment(),
        now: NOW,
      }),
    ).resolves.toEqual({
      allowed: false,
      code: "PUBLICATION_UNAVAILABLE",
    });
    expect(await effectCounts()).toEqual(before);
  });
});

async function currentBinding(purpose: PublicIntakePrivacyPurpose) {
  const decision = await resolvePublicIntakePrivacyGate(purpose, {
    database: client(),
    environment: runtimeEnvironment(),
    now: NOW,
  });
  if (!decision.allowed) throw new Error(`Privacy gate denied: ${decision.code}`);
  return toPublicIntakePrivacyExpectedBinding(decision.binding);
}

function submitReport(
  targetDatabase: DatabaseClient,
  privacyBinding: PublicIntakePrivacyExpectedBinding,
) {
  return createPublicReport(
    {
      targetType: "COMPANY",
      slug: "phase34-intake-company",
      reasonCode: "MISLEADING",
      description:
        "Nachvollziehbare Phase-34-Meldung mit ausreichender sicherer Beschreibung.",
    },
    { id: COMPANY_ID, targetType: "COMPANY", companyId: COMPANY_ID },
    {
      database: targetDatabase,
      environment: runtimeEnvironment(),
      request: REQUEST,
      currentUser: null,
      now: NOW,
      privacyBinding,
    },
  );
}

function submitLead(
  targetDatabase: DatabaseClient,
  privacyBinding: PublicIntakePrivacyExpectedBinding,
  idempotencyKey: string,
) {
  return submitPublicEmployerLead(leadInput(idempotencyKey), {
    database: targetDatabase,
    environment: runtimeEnvironment(),
    request: REQUEST,
    now: NOW,
    privacyBinding,
  });
}

function leadInput(idempotencyKey: string): LeadFormInput {
  return Object.freeze({
    email: `${idempotencyKey}@example.test`,
    companyName: "Phase 34 Published Lead AG",
    contactName: "Mara Phase 34",
    companySizeCode: "10_49",
    hiringNeedCode: "ONE_ROLE",
    interestCode: "GENERAL",
    message: "Wir prüfen die publizierte Datenschutzbindung vollständig.",
    acceptedContactPurpose: "yes",
    idempotencyKey,
    websiteConfirmation: "",
  });
}

function rotateBeforeTransaction(target: DatabaseClient): DatabaseClient {
  let rotated = false;
  return new Proxy(target, {
    get(clientTarget, property) {
      if (property === "$transaction") {
        return async (
          operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
          options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
        ) => {
          if (!rotated) {
            rotated = true;
            await clientTarget.legalPublication.update({
              where: { id: PUBLICATION_ID },
              data: {
                status: "REVOKED",
                revokedAt: new Date(NOW.getTime() + 2_000),
                revokeReasonCode: "PHASE_34_PREFLIGHT_ROTATION",
              },
            });
          }
          return clientTarget.$transaction(operation, options);
        };
      }
      return Reflect.get(clientTarget, property, clientTarget);
    },
  }) as DatabaseClient;
}

async function effectCounts() {
  const [
    reports,
    reportEvents,
    leads,
    leadActivities,
    leadIntakes,
    tasks,
    buckets,
    audits,
    analytics,
    notifications,
  ] = await Promise.all([
    client().abuseReport.count(),
    client().abuseReportEvent.count(),
    client().salesLead.count(),
    client().salesActivity.count(),
    client().salesLeadIntake.count(),
    client().systemTask.count(),
    client().rateLimitBucket.count(),
    client().auditLog.count(),
    client().analyticsEvent.count(),
    client().notificationOutbox.count(),
  ]);
  return {
    reports,
    reportEvents,
    leads,
    leadActivities,
    leadIntakes,
    tasks,
    buckets,
    audits,
    analytics,
    notifications,
  };
}

async function seedLegalPublication(target: DatabaseClient) {
  const users = await Promise.all(
    ["author", "reviewer", "publisher"].map((role, index) =>
      target.user.create({
        data: {
          email: `phase34-intake-${role}@example.test`,
          emailNormalized: `phase34-intake-${role}@example.test`,
          role: "ADMIN",
          status: "ACTIVE",
          name: `Phase 34 ${role}`,
          dataProvenance: "TEST",
          createdAt: new Date(NOW.getTime() - (index + 4) * 60_000),
          updatedAt: new Date(NOW.getTime() - (index + 4) * 60_000),
        },
      }),
    ),
  );
  const [author, reviewer, publisher] = users;
  if (author === undefined || reviewer === undefined || publisher === undefined) {
    throw new Error("Legal actors could not be created.");
  }
  await target.company.create({
    data: {
      id: COMPANY_ID,
      name: "Phase 34 Intake Company AG",
      slug: "phase34-intake-company",
      status: "DRAFT",
      dataProvenance: "TEST",
    },
  });
  const content = "# Datenschutz\n\nVerifizierte Phase-34-Testpublikation.";
  const hash = createHash("sha256").update(content).digest("hex");
  const document = await target.legalDocument.create({
    data: {
      type: "PRIVACY",
      locale: "de-CH",
      slug: "privacy",
      title: "Datenschutz",
    },
  });
  const revision = await target.legalRevision.create({
    data: {
      legalDocumentId: document.id,
      revisionNumber: 1,
      status: "APPROVED",
      versionLabel: "2026.08.06",
      contentMarkdown: content,
      contentHash: hash,
      changeSummary: "Phase-34-Testpublikation",
      createdByUserId: author.id,
      reviewedByUserId: reviewer.id,
      reviewedAt: new Date(NOW.getTime() - 120_000),
      createdAt: new Date(NOW.getTime() - 180_000),
    },
  });
  await target.legalPublication.create({
    data: {
      id: PUBLICATION_ID,
      legalDocumentId: document.id,
      legalRevisionId: revision.id,
      status: "CURRENT",
      publicationHash: hash,
      publishedByUserId: publisher.id,
      effectiveAt: new Date(NOW.getTime() - 60_000),
      createdAt: new Date(NOW.getTime() - 60_000),
    },
  });
}

function client() {
  if (database === undefined) throw new Error("Database is unavailable.");
  return database;
}

function runtimeEnvironment() {
  if (environment === undefined) throw new Error("Environment is unavailable.");
  return environment;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}
