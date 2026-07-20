import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_CANDIDATE_JOB_ALERTS,
  createJobAlert,
  deleteJobAlert,
  getCandidateJobAlertPageData,
  grantJobAlertDeliveryConsent,
  pauseJobAlert,
  resumeJobAlert,
  revokeJobAlertDeliveryConsentGlobally,
  runJobAlertDigestMock,
  unsubscribeJobAlertWithToken,
  updateJobAlert,
} from "@/lib/candidate/job-alerts";
import {
  firstJobAlertDueAt,
  nextJobAlertDueAt,
  type JobAlertCommand,
} from "@/lib/candidate/job-alert-policy";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { LocalMockMailboxCaptureInput } from "@/lib/providers/email/local-mock-mailbox-core";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DATES = Object.freeze({
  activation: new Date("2026-07-17T12:00:00.000Z"),
  firstRun: new Date("2026-07-19T12:00:00.000Z"),
  secondRun: new Date("2026-07-20T12:00:00.000Z"),
  expiresAt: new Date("2026-08-20T12:00:00.000Z"),
});

const IDS = Object.freeze({
  candidateUser: randomUUID(),
  candidateProfile: randomUUID(),
  otherCandidateUser: randomUUID(),
  otherCandidateProfile: randomUUID(),
  employerUser: randomUUID(),
  company: randomUUID(),
  companyLocation: randomUUID(),
  companyMembership: randomUUID(),
  verification: randomUUID(),
  canton: randomUUID(),
  city: randomUUID(),
  category: randomUUID(),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let mainAlertId = "";
const captures: LocalMockMailboxCaptureInput[] = [];

function client() {
  if (database === undefined)
    throw new Error("Job-alert test database not initialized.");
  return database;
}

function pool(): Pool {
  if (migrated === undefined)
    throw new Error("Job-alert test pool not initialized.");
  return migrated.pool;
}

const query = Object.freeze({
  keyword: "Pflege",
  cantonId: IDS.canton,
  cityId: IDS.city,
  radiusKm: 0,
  categoryId: IDS.category,
  workloadMin: 40,
  workloadMax: 100,
  salaryTransparentOnly: true,
  remotePreference: "ANY" as const,
});

function command(overrides: Partial<JobAlertCommand> = {}): JobAlertCommand {
  return {
    active: true,
    deliveryConsentAccepted: true,
    frequency: "DAILY",
    query,
    ...overrides,
  };
}

const mailbox = Object.freeze({
  validate: vi.fn<(input: LocalMockMailboxCaptureInput) => void>(),
  capture: vi.fn<(input: LocalMockMailboxCaptureInput) => void>((input) => {
    captures.push(input);
  }),
});

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase09_job_alerts");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await seedBase(pool());
  for (let index = 0; index < 22; index += 1) {
    await insertPublishedJob(pool(), {
      index,
      publishedAt: new Date(
        DATES.activation.getTime() + (index + 1) * 60 * 60 * 1_000,
      ),
      status: "PUBLISHED",
    });
  }
  await insertPublishedJob(pool(), {
    index: 22,
    publishedAt: new Date(DATES.activation.getTime() + 30 * 60 * 1_000),
    status: "PAUSED",
  });
  await insertPublishedJob(pool(), {
    index: 23,
    publishedAt: new Date(DATES.firstRun.getTime() + 60 * 60 * 1_000),
    status: "PUBLISHED",
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("PostgreSQL Phase-09 job-alert contract", () => {
  it("creates with separate consent and records one capped digest under concurrent runs", async () => {
    const correlationId = randomUUID();
    const created = await createJobAlert(command(), {
      actorUserId: IDS.candidateUser,
      correlationId,
      now: DATES.activation,
      database: client(),
    });
    mainAlertId = created.id;

    const [
      alert,
      consentEvents,
      consentAudits,
      createdEvents,
      activationEvents,
    ] = await Promise.all([
      client().jobAlert.findUniqueOrThrow({ where: { id: mainAlertId } }),
      client().userConsentEvent.findMany({
        where: { userId: IDS.candidateUser, kind: "JOB_ALERT_DELIVERY" },
      }),
      client().auditLog.findMany({
        where: {
          actorUserId: IDS.candidateUser,
          action: "USER_CONSENT_CHANGED",
          capability: "JOB_ALERT_DELIVERY_CONSENT",
        },
      }),
      client().jobAlertEvent.findMany({
        where: { jobAlertId: mainAlertId, kind: "CREATED" },
      }),
      client().analyticsEvent.findMany({
        where: {
          producer: "candidate-job-alert",
          dedupeKey: `JOB_ALERT_ACTIVATED:${mainAlertId}`,
        },
      }),
    ]);
    expect(alert.status).toBe("ACTIVE");
    expect(consentEvents).toHaveLength(1);
    expect(consentEvents[0]).toMatchObject({
      granted: true,
      noticeVersion: "job-alert-delivery-v1",
    });
    expect(consentAudits).toHaveLength(1);
    expect(consentAudits[0]).toMatchObject({
      actorKind: "USER",
      actorUserId: IDS.candidateUser,
      correlationId,
      reasonCode: "JOB_ALERT_DELIVERY_GRANTED",
      result: "SUCCEEDED",
      targetId: IDS.candidateUser,
      targetType: "USER",
    });
    expect(consentAudits[0]?.retainUntil).toEqual(
      new Date(DATES.activation.getTime() + 400 * 86_400_000),
    );
    expect(createdEvents).toHaveLength(1);
    expect(activationEvents).toHaveLength(1);
    expect(activationEvents[0]).toMatchObject({
      actorProvenanceSnapshot: "LIVE",
      dedupeKey: `JOB_ALERT_ACTIVATED:${mainAlertId}`,
      kind: "JOB_ALERT_ACTIVATED",
      occurredAt: DATES.activation,
      producer: "candidate-job-alert",
      properties: {
        alertFrequency: "DAILY",
        onboardingRuleVersion: "candidate-onboarding-v1",
      },
      purpose: "ESSENTIAL_OPERATIONAL",
      schemaVersion: "1",
    });

    const runs = await Promise.all(
      Array.from({ length: 8 }, () =>
        runJobAlertDigestMock({
          alertId: mainAlertId,
          appUrl: "http://127.0.0.1:3000",
          candidateUserId: IDS.candidateUser,
          database: client(),
          environment: "non-production",
          mailbox,
          now: DATES.firstRun,
        }),
      ),
    );
    expect(runs.flatMap((run) => run.completed)).toHaveLength(1);
    expect(runs.flatMap((run) => run.completed)[0]?.itemCount).toBe(20);

    const [digests, items, logs, events, tokens, updated] = await Promise.all([
      client().jobAlertDigest.findMany({ where: { jobAlertId: mainAlertId } }),
      client().jobAlertDigestItem.findMany({
        where: { jobAlertId: mainAlertId },
      }),
      client().emailLog.findMany({
        where: { recipient: "phase09-alert-candidate@example.test" },
      }),
      client().jobAlertEvent.findMany({
        where: { jobAlertId: mainAlertId, kind: "DIGEST_MOCK_RECORDED" },
      }),
      client().jobAlertUnsubscribeToken.findMany({
        where: { jobAlertId: mainAlertId },
      }),
      client().jobAlert.findUniqueOrThrow({ where: { id: mainAlertId } }),
    ]);
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({
      itemCount: 20,
      policyVersion: "job-alert-policy-v1",
      windowEnd: DATES.firstRun,
    });
    expect(items).toHaveLength(20);
    expect(new Set(items.map(({ jobId }) => jobId))).toHaveLength(20);
    expect(logs).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(updated.lastSuccessfulCutoffAt).toEqual(DATES.firstRun);
    expect(captures).toHaveLength(1);
    const persisted = JSON.stringify(logs);
    expect(persisted).not.toContain(captures[0]?.actionUrl);
    expect(persisted).not.toMatch(/\/alerts\/unsubscribe\//u);
  });

  it("records a paused alert exactly once on its first resume", async () => {
    const createdAt = new Date(DATES.activation.getTime() + 10_000);
    const firstResumeAt = new Date(DATES.activation.getTime() + 11_000);
    const paused = await createJobAlert(
      command({ active: false, deliveryConsentAccepted: false }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: createdAt,
      },
    );
    const activationWhere = {
      producer: "candidate-job-alert",
      dedupeKey: `JOB_ALERT_ACTIVATED:${paused.id}`,
    } as const;

    await expect(
      client().analyticsEvent.count({ where: activationWhere }),
    ).resolves.toBe(0);
    await resumeJobAlert(paused.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: firstResumeAt,
    });

    const firstActivation = await client().analyticsEvent.findMany({
      where: activationWhere,
    });
    expect(firstActivation).toHaveLength(1);
    expect(firstActivation[0]).toMatchObject({
      actorProvenanceSnapshot: "LIVE",
      occurredAt: firstResumeAt,
      properties: {
        alertFrequency: "DAILY",
        onboardingRuleVersion: "candidate-onboarding-v1",
      },
      purpose: "ESSENTIAL_OPERATIONAL",
    });

    await pauseJobAlert(paused.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.activation.getTime() + 12_000),
    });
    await resumeJobAlert(paused.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.activation.getTime() + 13_000),
    });

    const afterReplay = await client().analyticsEvent.findMany({
      where: activationWhere,
    });
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0]?.id).toBe(firstActivation[0]?.id);
    expect(afterReplay[0]?.occurredAt).toEqual(firstResumeAt);
  });

  it("uses the same first-activation key for the update active toggle", async () => {
    const createdAt = new Date(DATES.activation.getTime() + 20_000);
    const firstActivationAt = new Date(DATES.activation.getTime() + 21_000);
    const paused = await createJobAlert(
      command({ active: false, deliveryConsentAccepted: false }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: createdAt,
      },
    );
    const activationWhere = {
      producer: "candidate-job-alert",
      dedupeKey: `JOB_ALERT_ACTIVATED:${paused.id}`,
    } as const;

    await updateJobAlert(
      paused.id,
      command({
        active: true,
        deliveryConsentAccepted: false,
        frequency: "WEEKLY",
      }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: firstActivationAt,
      },
    );
    await expect(
      client().analyticsEvent.findMany({ where: activationWhere }),
    ).resolves.toMatchObject([
      {
        actorProvenanceSnapshot: "LIVE",
        occurredAt: firstActivationAt,
        properties: {
          alertFrequency: "WEEKLY",
          onboardingRuleVersion: "candidate-onboarding-v1",
        },
        purpose: "ESSENTIAL_OPERATIONAL",
      },
    ]);

    await pauseJobAlert(paused.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.activation.getTime() + 22_000),
    });
    await updateJobAlert(
      paused.id,
      command({
        active: true,
        deliveryConsentAccepted: false,
        frequency: "DAILY",
      }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: new Date(DATES.activation.getTime() + 23_000),
      },
    );

    const afterReplay = await client().analyticsEvent.findMany({
      where: activationWhere,
    });
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0]).toMatchObject({
      occurredAt: firstActivationAt,
      properties: { alertFrequency: "WEEKLY" },
    });
  });

  it("rolls back consent and alert creation when the required audit write fails", async () => {
    await pool().query(
      [
        "CREATE OR REPLACE FUNCTION phase09_reject_alert_consent_audit() RETURNS trigger AS $$",
        "BEGIN",
        "  IF NEW.\"action\" = 'USER_CONSENT_CHANGED' AND NEW.\"capability\" = 'JOB_ALERT_DELIVERY_CONSENT' THEN",
        "    RAISE EXCEPTION 'injected required audit failure';",
        "  END IF;",
        "  RETURN NEW;",
        "END;",
        "$$ LANGUAGE plpgsql;",
        "CREATE TRIGGER phase09_reject_alert_consent_audit_trigger",
        'BEFORE INSERT ON "AuditLog"',
        "FOR EACH ROW EXECUTE FUNCTION phase09_reject_alert_consent_audit();",
      ].join("\n"),
    );
    try {
      await expect(
        createJobAlert(command(), {
          actorUserId: IDS.otherCandidateUser,
          correlationId: randomUUID(),
          now: DATES.activation,
          database: client(),
        }),
      ).rejects.toThrow("Required audit write failed for USER_CONSENT_CHANGED");
      const [alerts, consents, audits] = await Promise.all([
        client().jobAlert.count({
          where: { candidateProfileId: IDS.otherCandidateProfile },
        }),
        client().userConsentEvent.count({
          where: {
            userId: IDS.otherCandidateUser,
            kind: "JOB_ALERT_DELIVERY",
          },
        }),
        client().auditLog.count({
          where: {
            actorUserId: IDS.otherCandidateUser,
            action: "USER_CONSENT_CHANGED",
          },
        }),
      ]);
      expect({ alerts, consents, audits }).toEqual({
        alerts: 0,
        consents: 0,
        audits: 0,
      });
    } finally {
      await pool().query(
        [
          'DROP TRIGGER IF EXISTS phase09_reject_alert_consent_audit_trigger ON "AuditLog";',
          "DROP FUNCTION IF EXISTS phase09_reject_alert_consent_audit();",
        ].join("\n"),
      );
    }
  });

  it("does not activate delivery from a same-version consent with the wrong notice hash", async () => {
    await client().userConsentEvent.create({
      data: {
        userId: IDS.otherCandidateUser,
        kind: "JOB_ALERT_DELIVERY",
        granted: true,
        purpose: "Job alert delivery",
        noticeVersion: "job-alert-delivery-v1",
        noticeHash: "0".repeat(64),
        actorUserId: IDS.otherCandidateUser,
        effectiveAt: DATES.activation,
        createdAt: DATES.activation,
      },
    });
    await expect(
      createJobAlert(command({ deliveryConsentAccepted: false }), {
        actorUserId: IDS.otherCandidateUser,
        database: client(),
        now: new Date(DATES.activation.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(
      client().jobAlert.count({
        where: { candidateProfileId: IDS.otherCandidateProfile },
      }),
    ).resolves.toBe(0);
  });

  it("orders same-timestamp delivery consent changes by their persisted recording revision", async () => {
    const sameAt = new Date("2026-07-18T12:00:00.000Z");
    const user = await client().user.create({
      data: {
        email: "phase09-alert-same-time@example.test",
        emailNormalized: "phase09-alert-same-time@example.test",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
    });
    await client().candidateProfile.create({ data: { userId: user.id } });

    await grantJobAlertDeliveryConsent({
      actorUserId: user.id,
      correlationId: randomUUID(),
      database: client(),
      now: sameAt,
    });
    await revokeJobAlertDeliveryConsentGlobally({
      actorUserId: user.id,
      correlationId: randomUUID(),
      database: client(),
      now: sameAt,
    });

    const revokedEvents = await client().userConsentEvent.findMany({
      where: {
        userId: user.id,
        kind: "JOB_ALERT_DELIVERY",
        effectiveAt: sameAt,
      },
      orderBy: { createdAt: "asc" },
      select: { granted: true, effectiveAt: true, createdAt: true },
    });
    expect(revokedEvents.map(({ granted }) => granted)).toEqual([true, false]);
    expect(revokedEvents[1]!.createdAt.getTime()).toBeGreaterThan(
      revokedEvents[0]!.createdAt.getTime(),
    );
    expect(
      revokedEvents.every(
        ({ effectiveAt }) => effectiveAt.getTime() === sameAt.getTime(),
      ),
    ).toBe(true);
    await expect(
      createJobAlert(command({ deliveryConsentAccepted: false }), {
        actorUserId: user.id,
        database: client(),
        now: sameAt,
      }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });

    await grantJobAlertDeliveryConsent({
      actorUserId: user.id,
      correlationId: randomUUID(),
      database: client(),
      now: sameAt,
    });
    const regrantedEvents = await client().userConsentEvent.findMany({
      where: {
        userId: user.id,
        kind: "JOB_ALERT_DELIVERY",
        effectiveAt: sameAt,
      },
      orderBy: { createdAt: "asc" },
      select: { granted: true, effectiveAt: true, createdAt: true },
    });
    expect(regrantedEvents.map(({ granted }) => granted)).toEqual([
      true,
      false,
      true,
    ]);
    expect(regrantedEvents[2]!.createdAt.getTime()).toBeGreaterThan(
      regrantedEvents[1]!.createdAt.getTime(),
    );
    expect(
      regrantedEvents.every(
        ({ effectiveAt }) => effectiveAt.getTime() === sameAt.getTime(),
      ),
    ).toBe(true);
    await expect(
      createJobAlert(command({ deliveryConsentAccepted: false }), {
        actorUserId: user.id,
        database: client(),
        now: sameAt,
      }),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("uses the next half-open window, excludes repeats and accepts an older valid token", async () => {
    const second = await runJobAlertDigestMock({
      alertId: mainAlertId,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: DATES.secondRun,
    });
    expect(second.completed).toHaveLength(1);
    expect(second.completed[0]?.itemCount).toBe(1);

    const [digests, items, tokens] = await Promise.all([
      client().jobAlertDigest.findMany({
        where: { jobAlertId: mainAlertId },
        orderBy: { windowEnd: "asc" },
      }),
      client().jobAlertDigestItem.findMany({
        where: { jobAlertId: mainAlertId },
      }),
      client().jobAlertUnsubscribeToken.findMany({
        where: { jobAlertId: mainAlertId },
        orderBy: { issuedAt: "asc" },
      }),
    ]);
    expect(digests).toHaveLength(2);
    expect(digests[1]).toMatchObject({
      windowStart: DATES.firstRun,
      windowEnd: DATES.secondRun,
      itemCount: 1,
    });
    expect(items).toHaveLength(21);
    expect(new Set(items.map(({ jobId }) => jobId))).toHaveLength(21);
    expect(tokens).toHaveLength(2);

    const isolatedAlert = await createJobAlert(
      command({ deliveryConsentAccepted: false }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: DATES.secondRun,
      },
    );
    const firstHistoricalToken = captures[0]?.actionUrl.split("/").at(-1);
    expect(firstHistoricalToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const firstResult = await unsubscribeJobAlertWithToken(
      firstHistoricalToken ?? "",
      {
        database: client(),
        now: new Date(DATES.secondRun.getTime() + 1_000),
      },
    );
    const reusedResult = await unsubscribeJobAlertWithToken(
      firstHistoricalToken ?? "",
      {
        database: client(),
        now: new Date(DATES.secondRun.getTime() + 2_000),
      },
    );
    const invalidResult = await unsubscribeJobAlertWithToken(
      "not-a-valid-token",
      {
        database: client(),
        now: new Date(DATES.secondRun.getTime() + 2_000),
      },
    );
    expect(reusedResult).toEqual(firstResult);
    expect(invalidResult).toEqual(firstResult);

    const [
      afterAlert,
      isolatedAfterUnsubscribe,
      afterTokens,
      unsubscribeEvents,
      latestConsent,
    ] = await Promise.all([
      client().jobAlert.findUniqueOrThrow({ where: { id: mainAlertId } }),
      client().jobAlert.findUniqueOrThrow({ where: { id: isolatedAlert.id } }),
      client().jobAlertUnsubscribeToken.findMany({
        where: { jobAlertId: mainAlertId },
      }),
      client().jobAlertEvent.findMany({
        where: { jobAlertId: mainAlertId, kind: "UNSUBSCRIBED" },
      }),
      client().userConsentEvent.findFirst({
        where: { userId: IDS.candidateUser, kind: "JOB_ALERT_DELIVERY" },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    expect(afterAlert.status).toBe("UNSUBSCRIBED");
    expect(isolatedAfterUnsubscribe.status).toBe("ACTIVE");
    expect(afterTokens.every(({ usedAt }) => usedAt !== null)).toBe(true);
    expect(unsubscribeEvents).toHaveLength(1);
    expect(latestConsent?.granted).toBe(true);
  });

  it("enforces ownership and global revoke/regrant semantics without auto-resume", async () => {
    await expect(
      pauseJobAlert(mainAlertId, {
        actorUserId: IDS.otherCandidateUser,
        database: client(),
        now: DATES.secondRun,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await resumeJobAlert(mainAlertId, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: DATES.secondRun,
    });
    await updateJobAlert(
      mainAlertId,
      command({
        frequency: "WEEKLY",
        deliveryConsentAccepted: false,
        query: { ...query, keyword: "Pflege Zürich" },
      }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: new Date(DATES.secondRun.getTime() + 3_000),
      },
    );
    const revoked = await revokeJobAlertDeliveryConsentGlobally({
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.secondRun.getTime() + 4_000),
    });
    expect(revoked.pausedAlertCount).toBeGreaterThanOrEqual(1);
    expect(
      (
        await client().jobAlert.findUniqueOrThrow({
          where: { id: mainAlertId },
        })
      ).status,
    ).toBe("PAUSED");

    await grantJobAlertDeliveryConsent({
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.secondRun.getTime() + 5_000),
    });
    expect(
      (
        await client().jobAlert.findUniqueOrThrow({
          where: { id: mainAlertId },
        })
      ).status,
    ).toBe("PAUSED");
    await resumeJobAlert(mainAlertId, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.secondRun.getTime() + 6_000),
    });
    expect(
      (
        await client().jobAlert.findUniqueOrThrow({
          where: { id: mainAlertId },
        })
      ).status,
    ).toBe("ACTIVE");
  });

  it("persists an empty due digest and advances the schedule exactly once", async () => {
    const createdAt = new Date(DATES.secondRun.getTime() + 7_000);
    const runAt = new Date(DATES.secondRun.getTime() + 8_000);
    const created = await createJobAlert(
      command({
        deliveryConsentAccepted: false,
        query: { ...query, keyword: "NoMatchingJobPhrase" },
      }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: createdAt,
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: { nextDueAt: runAt },
    });
    const emailCountBefore = await client().emailLog.count({
      where: { recipient: "phase09-alert-candidate@example.test" },
    });

    const result = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: runAt,
    });

    expect(result.completed).toEqual([
      expect.objectContaining({ alertId: created.id, itemCount: 0 }),
    ]);
    const [digest, itemCount, tokenCount, eventCount, emailCountAfter, alert] =
      await Promise.all([
        client().jobAlertDigest.findFirstOrThrow({
          where: { jobAlertId: created.id },
        }),
        client().jobAlertDigestItem.count({
          where: { jobAlertId: created.id },
        }),
        client().jobAlertUnsubscribeToken.count({
          where: { jobAlertId: created.id },
        }),
        client().jobAlertEvent.count({
          where: { jobAlertId: created.id, kind: "DIGEST_MOCK_RECORDED" },
        }),
        client().emailLog.count({
          where: { recipient: "phase09-alert-candidate@example.test" },
        }),
        client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
      ]);
    expect(digest.itemCount).toBe(0);
    expect(itemCount).toBe(0);
    expect(tokenCount).toBe(1);
    expect(eventCount).toBe(1);
    expect(emailCountAfter).toBe(emailCountBefore + 1);
    expect(alert.lastSuccessfulCutoffAt).toEqual(runAt);
    expect(alert.nextDueAt.getTime()).toBeGreaterThan(runAt.getTime());
  });

  it("creates no digest or EmailLog for a paused alert", async () => {
    const createdAt = new Date(DATES.secondRun.getTime() + 9_000);
    const created = await createJobAlert(
      command({ active: false, deliveryConsentAccepted: false }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: createdAt,
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: { nextDueAt: createdAt },
    });
    const emailCountBefore = await client().emailLog.count();

    const result = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: new Date(createdAt.getTime() + 1_000),
    });

    expect(result.completed).toHaveLength(0);
    await expect(
      Promise.all([
        client().jobAlertDigest.count({ where: { jobAlertId: created.id } }),
        client().emailLog.count(),
      ]),
    ).resolves.toEqual([0, emailCountBefore]);
  });

  it("creates no delivery for an active but unconsented alert", async () => {
    const created = await createJobAlert(
      command({ active: false, deliveryConsentAccepted: false }),
      {
        actorUserId: IDS.otherCandidateUser,
        database: client(),
        now: DATES.activation,
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: { status: "ACTIVE", nextDueAt: DATES.firstRun },
    });
    const result = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.otherCandidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: DATES.secondRun,
    });
    expect(result.completed).toHaveLength(0);
    await expect(
      client().emailLog.count({
        where: { recipient: "phase09-alert-other@example.test" },
      }),
    ).resolves.toBe(0);
  });

  it("rolls back digest, email, event and schedule on provider failure, then retries once", async () => {
    const created = await createJobAlert(
      command({ deliveryConsentAccepted: true }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: DATES.activation,
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: { nextDueAt: DATES.firstRun },
    });
    const before = await client().jobAlert.findUniqueOrThrow({
      where: { id: created.id },
    });
    await expect(
      runJobAlertDigestMock({
        alertId: created.id,
        appUrl: "http://127.0.0.1:3000",
        candidateUserId: IDS.candidateUser,
        createEmailProvider: () => ({
          send: async () => {
            throw new Error("injected mock provider failure");
          },
        }),
        database: client(),
        environment: "non-production",
        mailbox,
        now: DATES.firstRun,
      }),
    ).rejects.toThrow("injected mock provider failure");

    const [afterFailure, digestCount, digestEventCount, tokenCount] =
      await Promise.all([
        client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
        client().jobAlertDigest.count({ where: { jobAlertId: created.id } }),
        client().jobAlertEvent.count({
          where: { jobAlertId: created.id, kind: "DIGEST_MOCK_RECORDED" },
        }),
        client().jobAlertUnsubscribeToken.count({
          where: { jobAlertId: created.id },
        }),
      ]);
    expect(afterFailure.nextDueAt).toEqual(before.nextDueAt);
    expect(afterFailure.lastSuccessfulCutoffAt).toBeNull();
    expect(digestCount).toBe(0);
    expect(digestEventCount).toBe(0);
    expect(tokenCount).toBe(0);

    const captureCountBeforeRetry = captures.length;
    const retry = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: DATES.firstRun,
    });
    expect(retry.completed).toHaveLength(1);
    const retryToken = captures[captureCountBeforeRetry]?.actionUrl
      .split("/")
      .at(-1);
    expect(retryToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await client().jobAlertUnsubscribeToken.updateMany({
      where: { jobAlertId: created.id },
      data: { expiresAt: DATES.secondRun },
    });
    await unsubscribeJobAlertWithToken(retryToken ?? "", {
      database: client(),
      now: DATES.secondRun,
    });
    expect(
      (await client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }))
        .status,
    ).toBe("ACTIVE");
    await deleteJobAlert(created.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: DATES.secondRun,
    });
    await deleteJobAlert(created.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.secondRun.getTime() + 1_000),
    });
    await expect(
      client().jobAlertEvent.count({
        where: { jobAlertId: created.id, kind: "DELETED" },
      }),
    ).resolves.toBe(1);
  });

  it("preserves a failed capture as a retryable digest and rotates to a usable token", async () => {
    const created = await createJobAlert(
      command({ deliveryConsentAccepted: true }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: DATES.activation,
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: { nextDueAt: DATES.firstRun },
    });
    const failingMailbox = Object.freeze({
      validate: vi.fn<(input: LocalMockMailboxCaptureInput) => void>(),
      capture: vi.fn<(input: LocalMockMailboxCaptureInput) => void>(() => {
        throw new Error("injected mailbox capture failure");
      }),
    });
    const emailsBefore = await client().emailLog.findMany({
      where: {
        recipient: "phase09-alert-candidate@example.test",
        purpose: "job_alert_digest_mock",
      },
      select: { id: true },
    });

    await expect(
      runJobAlertDigestMock({
        alertId: created.id,
        appUrl: "http://127.0.0.1:3000",
        candidateUserId: IDS.candidateUser,
        database: client(),
        environment: "non-production",
        mailbox: failingMailbox,
        now: DATES.firstRun,
      }),
    ).rejects.toThrow("injected mailbox capture failure");
    const [afterFailure, digestsAfterFailure, tokenCount, emailsAfterFailure] =
      await Promise.all([
        client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
        client().jobAlertDigest.findMany({ where: { jobAlertId: created.id } }),
        client().jobAlertUnsubscribeToken.count({
          where: { jobAlertId: created.id },
        }),
        client().emailLog.findMany({
          where: {
            recipient: "phase09-alert-candidate@example.test",
            purpose: "job_alert_digest_mock",
          },
          select: { id: true, providerReference: true },
        }),
      ]);
    expect(afterFailure.lastSuccessfulCutoffAt).toBeNull();
    expect(afterFailure.nextDueAt).toEqual(DATES.firstRun);
    expect({ digestCount: digestsAfterFailure.length, tokenCount }).toEqual({
      digestCount: 1,
      tokenCount: 0,
    });
    expect(emailsAfterFailure).toHaveLength(emailsBefore.length + 1);
    const existingEmailIds = new Set(emailsBefore.map((email) => email.id));
    const failedCaptureEmail = emailsAfterFailure.find(
      (email) => !existingEmailIds.has(email.id),
    );
    expect(failedCaptureEmail).toBeDefined();
    const failedDigest = digestsAfterFailure[0];
    if (failedCaptureEmail === undefined || failedDigest === undefined) {
      throw new Error("Missing durable retry state after capture failure.");
    }
    expect(failedDigest).toMatchObject({
      alertNameSnapshot: "Pflege",
      recipientEmailSnapshot: "phase09-alert-candidate@example.test",
    });
    await expect(
      client().jobAlertEvent.count({
        where: {
          jobAlertId: created.id,
          kind: "UPDATED",
          reasonCode: "DIGEST_CAPTURE_COMPENSATED",
        },
      }),
    ).resolves.toBe(1);

    const editedAt = new Date(DATES.firstRun.getTime() + 1_000);
    await updateJobAlert(
      created.id,
      command({
        frequency: "WEEKLY",
        query: { ...query, keyword: "Informatik" },
      }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: editedAt,
      },
    );
    await expect(
      client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({
      frequency: "WEEKLY",
      nextDueAt: DATES.firstRun,
    });
    await pauseJobAlert(created.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.firstRun.getTime() + 1_100),
    });
    await resumeJobAlert(created.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(DATES.firstRun.getTime() + 1_200),
    });
    await expect(
      client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({
      frequency: "WEEKLY",
      nextDueAt: DATES.firstRun,
      status: "ACTIVE",
    });

    const captureCountBeforeRetry = captures.length;
    const retry = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: new Date(DATES.firstRun.getTime() + 2_000),
    });
    expect(retry.completed).toHaveLength(1);
    const retryCapture = captures[captureCountBeforeRetry];
    expect(retryCapture).toMatchObject({
      to: "phase09-alert-candidate@example.test",
    });
    expect(retryCapture?.body).toContain("Pflege");
    expect(retryCapture?.body).not.toContain("Informatik");
    const retryToken = retryCapture?.actionUrl.split("/").at(-1);
    expect(retryToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const [
      digestAfterRetry,
      emailAfterRetry,
      tokenCountAfterRetry,
      alertAfterRetry,
    ] = await Promise.all([
      client().jobAlertDigest.findUniqueOrThrow({
        where: { id: failedDigest.id },
      }),
      client().emailLog.findUniqueOrThrow({
        where: { id: failedCaptureEmail.id },
        select: { id: true, providerReference: true },
      }),
      client().jobAlertUnsubscribeToken.count({
        where: { jobAlertId: created.id },
      }),
      client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
    ]);
    expect(digestAfterRetry.id).toBe(failedDigest.id);
    expect(emailAfterRetry).toEqual(failedCaptureEmail);
    expect(tokenCountAfterRetry).toBe(1);
    expect(alertAfterRetry.nextDueAt).toEqual(
      nextJobAlertDueAt(new Date(DATES.firstRun.getTime() + 2_000), "WEEKLY"),
    );
  });

  it("merges capture compensation with a concurrent frequency edit", async () => {
    const created = await createJobAlert(command(), {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: DATES.activation,
    });
    await client().jobAlert.update({
      where: { id: created.id },
      data: { nextDueAt: DATES.firstRun },
    });
    const editedAt = new Date(DATES.firstRun.getTime() + 1_000);
    const failingMailbox = Object.freeze({
      validate: vi.fn<(input: LocalMockMailboxCaptureInput) => void>(),
      capture: vi.fn(
        async (_input: LocalMockMailboxCaptureInput): Promise<void> => {
          await updateJobAlert(created.id, command({ frequency: "WEEKLY" }), {
            actorUserId: IDS.candidateUser,
            database: client(),
            now: editedAt,
          });
          throw new Error("injected concurrent capture failure");
        },
      ),
    });

    await expect(
      runJobAlertDigestMock({
        alertId: created.id,
        appUrl: "http://127.0.0.1:3000",
        candidateUserId: IDS.candidateUser,
        database: client(),
        environment: "non-production",
        mailbox: failingMailbox,
        now: DATES.firstRun,
      }),
    ).rejects.toThrow("injected concurrent capture failure");

    const [afterFailure, digests, tokenCount, compensationEvents] =
      await Promise.all([
        client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
        client().jobAlertDigest.findMany({ where: { jobAlertId: created.id } }),
        client().jobAlertUnsubscribeToken.count({
          where: { jobAlertId: created.id },
        }),
        client().jobAlertEvent.count({
          where: {
            jobAlertId: created.id,
            kind: "UPDATED",
            reasonCode: "DIGEST_CAPTURE_COMPENSATED",
          },
        }),
      ]);
    expect(afterFailure).toMatchObject({
      frequency: "WEEKLY",
      lastSuccessfulCutoffAt: null,
      nextDueAt: firstJobAlertDueAt(editedAt, "WEEKLY"),
      status: "ACTIVE",
      updatedAt: editedAt,
    });
    expect(digests).toHaveLength(1);
    expect({ compensationEvents, tokenCount }).toEqual({
      compensationEvents: 1,
      tokenCount: 0,
    });

    const retryAt = afterFailure.nextDueAt;
    const retry = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: retryAt,
    });
    expect(retry.completed).toEqual([
      expect.objectContaining({ digestId: digests[0]?.id }),
    ]);
    const afterRetry = await client().jobAlert.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(afterRetry.lastSuccessfulCutoffAt).toEqual(digests[0]?.windowEnd);
    expect(afterRetry.nextDueAt).toEqual(nextJobAlertDueAt(retryAt, "WEEKLY"));
    await deleteJobAlert(created.id, {
      actorUserId: IDS.candidateUser,
      database: client(),
      now: new Date(retryAt.getTime() + 1_000),
    });
  });

  it("does not deliver alerts for a suspended candidate user", async () => {
    const created = await createJobAlert(
      command({ deliveryConsentAccepted: true }),
      {
        actorUserId: IDS.otherCandidateUser,
        database: client(),
        now: DATES.activation,
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: { nextDueAt: DATES.firstRun },
    });
    await client().user.update({
      where: { id: IDS.otherCandidateUser },
      data: { status: "SUSPENDED" },
    });
    try {
      const result = await runJobAlertDigestMock({
        alertId: created.id,
        appUrl: "http://127.0.0.1:3000",
        candidateUserId: IDS.otherCandidateUser,
        database: client(),
        environment: "non-production",
        mailbox,
        now: DATES.firstRun,
      });
      expect(result.completed).toHaveLength(0);
      await expect(
        Promise.all([
          client().jobAlertDigest.count({ where: { jobAlertId: created.id } }),
          client().jobAlertUnsubscribeToken.count({
            where: { jobAlertId: created.id },
          }),
          client().emailLog.count({
            where: { recipient: "phase09-alert-other@example.test" },
          }),
        ]),
      ).resolves.toEqual([0, 0, 0]);
    } finally {
      await client().user.update({
        where: { id: IDS.otherCandidateUser },
        data: { status: "ACTIVE" },
      });
    }
  });

  it("finds an eligible job after more than 1,000 newer ineligible candidates", async () => {
    const eligibleJobId = await insertDeepDigestScanCandidates(pool(), 1_001);
    const created = await createJobAlert(
      command({
        deliveryConsentAccepted: false,
        query: { ...query, keyword: "NeedleScan" },
      }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: DATES.activation,
      },
    );

    const result = await runJobAlertDigestMock({
      alertId: created.id,
      appUrl: "http://127.0.0.1:3000",
      candidateUserId: IDS.candidateUser,
      database: client(),
      environment: "non-production",
      mailbox,
      now: DATES.firstRun,
    });

    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]?.itemCount).toBe(1);
    await expect(
      client().jobAlertDigestItem.findMany({
        where: { jobAlertId: created.id },
        select: { jobId: true },
      }),
    ).resolves.toEqual([{ jobId: eligibleJobId }]);
  });

  it("resolves legacy taxonomy filters for editing without broadening them", async () => {
    const created = await createJobAlert(
      command({ active: false, deliveryConsentAccepted: false }),
      {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: new Date(DATES.secondRun.getTime() + 18_000),
      },
    );
    await client().jobAlert.update({
      where: { id: created.id },
      data: {
        query: { category: "phase09-alert-pflege", canton: "ZH", page: 1 },
      },
    });

    const page = await getCandidateJobAlertPageData(
      IDS.candidateUser,
      client(),
      new Date(DATES.secondRun.getTime() + 19_000),
    );
    const legacy = page.alerts.find((alert) => alert.id === created.id);
    expect(legacy).toMatchObject({
      filterRequiresRepair: false,
      legacyLabel: "phase09-alert-pflege · ZH",
      query: {
        categoryId: IDS.category,
        cantonId: IDS.canton,
      },
    });
  });

  it("pauses malformed and unresolved legacy filters without broadening delivery", async () => {
    const emailCountBefore = await client().emailLog.count();
    const storedQueries = [
      { malformed: true },
      { category: "missing-controlled-category", canton: "ZH" },
    ] as const;
    for (const [index, storedQuery] of storedQueries.entries()) {
      const created = await createJobAlert(
        command({ active: false, deliveryConsentAccepted: false }),
        {
          actorUserId: IDS.candidateUser,
          database: client(),
          now: new Date(DATES.secondRun.getTime() + (20 + index) * 1_000),
        },
      );
      await client().jobAlert.update({
        where: { id: created.id },
        data: {
          query: storedQuery,
          status: "ACTIVE",
          nextDueAt: DATES.secondRun,
        },
      });

      const result = await runJobAlertDigestMock({
        alertId: created.id,
        appUrl: "http://127.0.0.1:3000",
        candidateUserId: IDS.candidateUser,
        database: client(),
        environment: "non-production",
        mailbox,
        now: new Date(DATES.secondRun.getTime() + (30 + index) * 1_000),
      });

      expect(result.completed).toHaveLength(0);
      expect(result.skipped).toBe(1);
      const [alert, pauseEvents, digests] = await Promise.all([
        client().jobAlert.findUniqueOrThrow({ where: { id: created.id } }),
        client().jobAlertEvent.findMany({
          where: {
            jobAlertId: created.id,
            kind: "PAUSED",
            reasonCode: "INVALID_STORED_QUERY_REQUIRES_REPAIR",
          },
        }),
        client().jobAlertDigest.count({ where: { jobAlertId: created.id } }),
      ]);
      expect(alert.status).toBe("PAUSED");
      expect(pauseEvents).toHaveLength(1);
      expect(digests).toBe(0);
      const page = await getCandidateJobAlertPageData(
        IDS.candidateUser,
        client(),
        new Date(DATES.secondRun.getTime() + (40 + index) * 1_000),
      );
      expect(
        page.alerts.find((candidate) => candidate.id === created.id),
      ).toMatchObject({ filterRequiresRepair: true, status: "PAUSED" });
    }
    await expect(client().emailLog.count()).resolves.toBe(emailCountBefore);
  });

  it("bounds the candidate alert collection and rejects a fifty-first live alert", async () => {
    const existingCount = await client().jobAlert.count({
      where: {
        candidateProfileId: IDS.candidateProfile,
        status: { not: "DELETED" },
      },
    });
    expect(existingCount).toBeLessThan(MAX_CANDIDATE_JOB_ALERTS);
    await client().jobAlert.createMany({
      data: Array.from(
        { length: MAX_CANDIDATE_JOB_ALERTS - existingCount },
        (_, index) => ({
          candidateProfileId: IDS.candidateProfile,
          query: { ...query, keyword: `Bounded alert ${index}` },
          frequency: "DAILY" as const,
          status: "PAUSED" as const,
          nextDueAt: new Date(DATES.secondRun.getTime() + (index + 1) * 1_000),
          createdAt: new Date(DATES.secondRun.getTime() + (index + 1) * 1_000),
          updatedAt: new Date(DATES.secondRun.getTime() + (index + 1) * 1_000),
        }),
      ),
    });

    const page = await getCandidateJobAlertPageData(
      IDS.candidateUser,
      client(),
      new Date(DATES.secondRun.getTime() + 60_000),
    );
    expect(page.alerts).toHaveLength(MAX_CANDIDATE_JOB_ALERTS);
    await expect(
      createJobAlert(command({ deliveryConsentAccepted: false }), {
        actorUserId: IDS.candidateUser,
        database: client(),
        now: new Date(DATES.secondRun.getTime() + 61_000),
      }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    await expect(
      client().jobAlert.count({
        where: {
          candidateProfileId: IDS.candidateProfile,
          status: { not: "DELETED" },
        },
      }),
    ).resolves.toBe(MAX_CANDIDATE_JOB_ALERTS);
  });
});

async function seedBase(target: Pool) {
  await target.query(
    [
      'INSERT INTO "User" ("id", "email", "emailNormalized", "role", "status", "dataProvenance", "updatedAt")',
      "VALUES",
      "($1, $2, $2, 'CANDIDATE', 'ACTIVE', 'LIVE', $7),",
      "($3, $4, $4, 'CANDIDATE', 'ACTIVE', 'LIVE', $7),",
      "($5, $6, $6, 'EMPLOYER', 'ACTIVE', 'LIVE', $7)",
    ].join("\n"),
    [
      IDS.candidateUser,
      "phase09-alert-candidate@example.test",
      IDS.otherCandidateUser,
      "phase09-alert-other@example.test",
      IDS.employerUser,
      "phase09-alert-employer@example.test",
      DATES.activation,
    ],
  );
  await target.query(
    [
      'INSERT INTO "Canton" ("id", "code", "name", "slug", "language", "updatedAt")',
      "VALUES ($1, 'ZH', 'Zürich', 'phase09-alert-zuerich', 'DE', $2)",
    ].join("\n"),
    [IDS.canton, DATES.activation],
  );
  await target.query(
    [
      'INSERT INTO "City" ("id", "cantonId", "name", "slug", "latitude", "longitude", "updatedAt")',
      "VALUES ($1, $2, 'Zürich', 'phase09-alert-zuerich', 47.3769, 8.5417, $3)",
    ].join("\n"),
    [IDS.city, IDS.canton, DATES.activation],
  );
  await target.query(
    [
      'INSERT INTO "Category" ("id", "name", "slug", "isActive", "updatedAt")',
      "VALUES ($1, 'Pflege', 'phase09-alert-pflege', true, $2)",
    ].join("\n"),
    [IDS.category, DATES.activation],
  );
  await target.query(
    [
      'INSERT INTO "CandidateProfile" ("id", "userId", "cantonId", "firstName", "lastName", "updatedAt")',
      "VALUES ($1, $2, $5, 'Mara', 'Muster', $6), ($3, $4, $5, 'Noah', 'Neben', $6)",
    ].join("\n"),
    [
      IDS.candidateProfile,
      IDS.candidateUser,
      IDS.otherCandidateProfile,
      IDS.otherCandidateUser,
      IDS.canton,
      DATES.activation,
    ],
  );
  await target.query(
    [
      'INSERT INTO "Company" ("id", "name", "slug", "industry", "size", "website", "about", "values", "benefits", "status", "dataProvenance", "updatedAt")',
      "VALUES ($1, 'Pflege Contract AG', 'phase09-alert-company', 'Gesundheit', '51-200',",
      "'https://example.test', 'Fiktive Integrationsfirma.', ARRAY['Fairness'], ARRAY['Flexibilität'], 'DRAFT', 'LIVE', $2)",
    ].join("\n"),
    [IDS.company, DATES.activation],
  );
  await target.query(
    [
      'INSERT INTO "CompanyLocation" ("id", "companyId", "cantonId", "cityId", "address", "postalCode", "isPrimary", "updatedAt")',
      "VALUES ($1, $2, $3, $4, 'Teststrasse 1', '8000', true, $5)",
    ].join("\n"),
    [IDS.companyLocation, IDS.company, IDS.canton, IDS.city, DATES.activation],
  );
  await target.query(
    [
      'INSERT INTO "CompanyMembership" ("id", "companyId", "userId", "role", "status", "updatedAt")',
      "VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4)",
    ].join("\n"),
    [IDS.companyMembership, IDS.company, IDS.employerUser, DATES.activation],
  );
  await target.query(
    'UPDATE "Company" SET "status" = \'ACTIVE\', "updatedAt" = $2 WHERE "id" = $1',
    [IDS.company, DATES.activation],
  );
  await target.query(
    [
      'INSERT INTO "CompanyVerificationRequest" ("id", "companyId", "requestedByUserId", "status", "evidenceMetadata", "updatedAt")',
      "VALUES ($1, $2, $3, 'VERIFIED', '{\"fixture\":true}'::jsonb, $4)",
    ].join("\n"),
    [IDS.verification, IDS.company, IDS.employerUser, DATES.activation],
  );
}

async function insertPublishedJob(
  target: Pool,
  input: Readonly<{
    index: number;
    publishedAt: Date;
    status: "PUBLISHED" | "PAUSED";
  }>,
) {
  const jobId = randomUUID();
  const revisionId = randomUUID();
  const slug = `phase09-alert-job-${String(input.index).padStart(2, "0")}`;
  const checksum = createHash("sha256").update(slug).digest("hex");
  await target.query(
    [
      'INSERT INTO "Job" ("id", "companyId", "slug", "status", "origin", "sourceReference", "dataProvenance", "createdByUserId", "createdAt", "updatedAt")',
      "VALUES ($1, $2, $3, 'DRAFT', 'MANUAL', $4, 'LIVE', $5, $6, $6)",
    ].join("\n"),
    [
      jobId,
      IDS.company,
      slug,
      `integration:${slug}`,
      IDS.employerUser,
      DATES.activation,
    ],
  );
  await target.query(
    [
      'INSERT INTO "JobRevision" (',
      '"id", "jobId", "revisionNumber", "title", "description", "tasks", "requirements", "applicationProcessSteps",',
      '"requiredDocumentKinds", "jobType", "remoteType", "categoryId", "cantonId", "cityId", "locationLabel",',
      '"workloadMin", "workloadMax", "salaryPeriod", "salaryMin", "salaryMax", "startByArrangement", "validThrough",',
      '"responseTargetDays", "applicationEffort", "applicationContactKind", "applicationContactValue", "authoredByUserId",',
      '"contentChecksum", "submittedAt", "approvedAt", "createdAt")',
      "VALUES ($1, $2, 1, $3, $4, ARRAY['Pflege'], ARRAY['Diplom'], ARRAY['Bewerbung'],",
      "ARRAY['CV']::\"RequiredDocumentKind\"[], 'PERMANENT', 'HYBRID', $5, $6, $7, 'Zürich',",
      "60, 100, 'YEARLY', 90000, 110000, true, $8, 7, 'SIMPLE', 'EMAIL', 'jobs@example.test', $9,",
      "$10, $11, $12, $11)",
    ].join("\n"),
    [
      revisionId,
      jobId,
      `Pflegefachperson ${input.index}`,
      "Eine vollständige fiktive Pflege-Stellenbeschreibung für den Jobabo-Vertrag.",
      IDS.category,
      IDS.canton,
      IDS.city,
      DATES.expiresAt,
      IDS.employerUser,
      checksum,
      new Date(input.publishedAt.getTime() - 60 * 60 * 1_000),
      input.publishedAt,
    ],
  );
  await target.query(
    [
      'UPDATE "Job" SET "status" = $3::"JobStatus", "currentRevisionId" = $2, "publishedRevisionId" = $2,',
      '"publishedAt" = $4, "expiresAt" = $5, "publishedCategoryId" = $6, "publishedCantonId" = $7,',
      '"publishedCityId" = $8, "publishedSalaryPeriod" = \'YEARLY\', "publishedSalaryMin" = 90000,',
      '"publishedSalaryMax" = 110000, "updatedAt" = $4 WHERE "id" = $1',
    ].join("\n"),
    [
      jobId,
      revisionId,
      input.status,
      input.publishedAt,
      DATES.expiresAt,
      IDS.category,
      IDS.canton,
      IDS.city,
    ],
  );
}

async function insertDeepDigestScanCandidates(
  target: Pool,
  ineligibleCount: number,
) {
  const eligibleJobId = uuidFromMd5("phase09-alert-deep-scan-job-0");
  await target.query(
    [
      'INSERT INTO "Job" ("id", "companyId", "slug", "status", "origin", "sourceReference", "dataProvenance", "createdByUserId", "createdAt", "updatedAt")',
      "SELECT md5('phase09-alert-deep-scan-job-' || series)::uuid, $1,",
      "  'phase09-alert-deep-scan-' || series, 'DRAFT', 'MANUAL',",
      "  'integration:phase09-alert-deep-scan:' || series, 'LIVE', $2, $3, $3",
      "FROM generate_series(0, $4::integer) AS series",
    ].join("\n"),
    [IDS.company, IDS.employerUser, DATES.activation, ineligibleCount],
  );
  await target.query(
    [
      'INSERT INTO "JobRevision" (',
      '"id", "jobId", "revisionNumber", "title", "description", "tasks", "requirements", "applicationProcessSteps",',
      '"requiredDocumentKinds", "jobType", "remoteType", "categoryId", "cantonId", "cityId", "locationLabel",',
      '"workloadMin", "workloadMax", "salaryPeriod", "salaryMin", "salaryMax", "startByArrangement", "validThrough",',
      '"responseTargetDays", "applicationEffort", "applicationContactKind", "applicationContactValue", "authoredByUserId",',
      '"contentChecksum", "submittedAt", "approvedAt", "createdAt")',
      "SELECT md5('phase09-alert-deep-scan-revision-' || series)::uuid,",
      "  md5('phase09-alert-deep-scan-job-' || series)::uuid, 1,",
      "  'NeedleScan Pflegefachperson ' || series,",
      "  'Eine vollständige fiktive Pflege-Stellenbeschreibung für den tiefen Jobabo-Scan.',",
      "  ARRAY['Pflege'], ARRAY['Diplom'], ARRAY['Bewerbung'], ARRAY['CV']::\"RequiredDocumentKind\"[],",
      "  'PERMANENT', 'HYBRID', $1, $2, $3, 'Zürich', 60, 100, 'YEARLY', 90000, 110000, true, $4,",
      "  7, 'SIMPLE', 'EMAIL', 'jobs@example.test', $5,",
      "  md5('phase09-alert-deep-scan-checksum-' || series) || md5('phase09-alert-deep-scan-checksum-2-' || series),",
      "  CASE WHEN series = 0 THEN $6::timestamptz + interval '29 minutes' ELSE $6::timestamptz + interval '59 minutes' + series * interval '1 millisecond' END,",
      "  CASE WHEN series = 0 THEN $6::timestamptz + interval '30 minutes' ELSE $6::timestamptz + interval '1 hour' + series * interval '1 millisecond' END,",
      "  $6::timestamptz",
      "FROM generate_series(0, $7::integer) AS series",
    ].join("\n"),
    [
      IDS.category,
      IDS.canton,
      IDS.city,
      DATES.expiresAt,
      IDS.employerUser,
      DATES.activation,
      ineligibleCount,
    ],
  );
  await target.query(
    [
      'UPDATE "Job" AS job SET',
      '  "status" = CASE WHEN series = 0 THEN \'PUBLISHED\'::"JobStatus" ELSE \'PAUSED\'::"JobStatus" END,',
      "  \"currentRevisionId\" = md5('phase09-alert-deep-scan-revision-' || series)::uuid,",
      "  \"publishedRevisionId\" = md5('phase09-alert-deep-scan-revision-' || series)::uuid,",
      "  \"publishedAt\" = CASE WHEN series = 0 THEN $1::timestamptz + interval '30 minutes' ELSE $1::timestamptz + interval '1 hour' + series * interval '1 millisecond' END,",
      '  "expiresAt" = $2, "publishedCategoryId" = $3, "publishedCantonId" = $4, "publishedCityId" = $5,',
      '  "publishedSalaryPeriod" = \'YEARLY\', "publishedSalaryMin" = 90000, "publishedSalaryMax" = 110000,',
      '  "updatedAt" = $1',
      "FROM generate_series(0, $6::integer) AS series",
      "WHERE job.\"id\" = md5('phase09-alert-deep-scan-job-' || series)::uuid",
    ].join("\n"),
    [
      DATES.activation,
      DATES.expiresAt,
      IDS.category,
      IDS.canton,
      IDS.city,
      ineligibleCount,
    ],
  );
  return eligibleJobId;
}

function uuidFromMd5(value: string) {
  const digest = createHash("md5").update(value).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20),
  ].join("-");
}
