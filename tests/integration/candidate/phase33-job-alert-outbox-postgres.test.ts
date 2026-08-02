import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createJobAlert,
  runJobAlertDigestDelivery,
  unsubscribeJobAlertWithToken,
} from "@/lib/candidate/job-alerts";
import { defaultJobAlertQuery } from "@/lib/candidate/job-alert-policy";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { activateSandboxHandler } from "@/lib/ops/operations-ledger";
import { scheduleActivatedWork } from "@/lib/ops/worker-scheduler";
import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
  type EmailDeliveryRequest,
} from "@/lib/providers/email/email-delivery-provider";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { activatePhase33SandboxEmailUseCases } from "@/tests/fixtures/phase33-provider-activation";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase33_job_alert_outbox");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = parseEnvironment(
    createValidEnvironment({
      DATABASE_URL: migrated.connectionString,
      EMAIL_PROVIDER_MODE: "local_mock",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      OPTIONAL_EMAIL: "true",
    }),
  );
  await activatePhase33SandboxEmailUseCases(
    database,
    environment,
    ["email.job-alert"],
    new Date("2026-08-02T08:00:00.123Z"),
  );
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 33 durable job-alert delivery", () => {
  it("atomically dedupes enqueue, retries delivery and reconstructs one usable unsubscribe link", async () => {
    const activatedAt = new Date("2026-08-01T08:00:00.000Z");
    const dueAt = new Date("2026-08-02T08:00:00.123Z");
    const user = await db().user.create({
      data: {
        email: "phase33-job-alert@example.test",
        emailNormalized: "phase33-job-alert@example.test",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "TEST",
        candidateProfile: { create: {} },
      },
      select: { id: true },
    });
    const alert = await createJobAlert(
      {
        active: true,
        deliveryConsentAccepted: true,
        frequency: "DAILY",
        query: defaultJobAlertQuery(),
      },
      {
        actorUserId: user.id,
        database: db(),
        now: activatedAt,
      },
    );
    await db().jobAlert.update({
      where: { id: alert.id },
      data: { nextDueAt: dueAt },
    });

    const concurrent = await Promise.all(
      Array.from({ length: 6 }, () =>
        runJobAlertDigestDelivery({
          alertId: alert.id,
          candidateUserId: user.id,
          database: db(),
          environment: env(),
          now: dueAt,
        }),
      ),
    );
    const completed = concurrent.flatMap((result) => result.completed);
    expect(completed).toHaveLength(1);
    const effect = completed[0]!;

    const [outbox, token, digestCount] = await Promise.all([
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: effect.outboxId },
      }),
      db().jobAlertUnsubscribeToken.findFirstOrThrow({
        where: { digestId: effect.digestId },
      }),
      db().jobAlertDigest.count({
        where: { id: effect.digestId },
      }),
    ]);
    expect(digestCount).toBe(1);
    expect(outbox).toMatchObject({
      purpose: "JOB_ALERT",
      status: "PENDING",
      templateKey: "job_alert_digest",
      payloadSchemaVersion: "job-alert-digest-v1",
      recipientUserId: user.id,
    });
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    const persistedBeforeDispatch = JSON.stringify({ outbox, token });
    expect(persistedBeforeDispatch).not.toContain("/alerts/unsubscribe/");

    const provider = new RetryOnceProvider();
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "phase33-job-alert-worker",
        batchSize: 1,
        clock: () => dueAt,
      }),
    ).resolves.toMatchObject({ claimed: 1, retried: 1, delivered: 0 });
    const firstUrl = String(provider.requests[0]?.templateData.unsubscribeUrl);
    expect(firstUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:3000\/alerts\/unsubscribe\/[A-Za-z0-9_-]{43}$/u,
    );
    const rawToken = firstUrl.split("/").at(-1)!;
    expect(
      JSON.stringify(await persistedEffect(effect.outboxId)),
    ).not.toContain(rawToken);

    const retryAt = new Date(dueAt.getTime() + 61_000);
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "phase33-job-alert-worker",
        batchSize: 1,
        clock: () => retryAt,
      }),
    ).resolves.toMatchObject({ claimed: 1, retried: 0, delivered: 1 });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.idempotencyKey).toBe(
      provider.requests[0]?.idempotencyKey,
    );
    expect(provider.requests[1]?.templateData.unsubscribeUrl).toBe(firstUrl);
    expect(
      await db().notificationDeliveryAttempt.findMany({
        where: { outboxId: effect.outboxId },
        orderBy: { attemptNumber: "asc" },
        select: { attemptNumber: true, outcome: true },
      }),
    ).toEqual([
      { attemptNumber: 1, outcome: "TRANSIENT_FAILURE" },
      { attemptNumber: 2, outcome: "ACCEPTED" },
    ]);

    await expect(
      unsubscribeJobAlertWithToken(rawToken, {
        database: db(),
        now: new Date(retryAt.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      db().jobAlert.findUniqueOrThrow({
        where: { id: alert.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "UNSUBSCRIBED" });

    const forbiddenMockAt = new Date(retryAt.getTime() + 2_000);
    await db().$transaction((transaction) =>
      enqueueNotification(transaction, {
        recipient: { userId: user.id },
        templateKey: "job_alert_digest_mock",
        payloadSchemaVersion: "legacy-job-alert-v1",
        payload: { alertName: "Legacy", jobCount: 1 },
        dedupeKey: `phase33-forbidden-job-alert-mock:${alert.id}`,
        createdAt: forbiddenMockAt,
        availableAt: forbiddenMockAt,
      }),
    );
    const requestCountBeforeForbiddenMock = provider.requests.length;
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: Object.freeze({
          ...env(),
          APP_ENV: "staging" as const,
          EMAIL_PROVIDER_MODE: "resend_live" as const,
        }),
        provider,
        workerId: "phase33-job-alert-worker",
        batchSize: 1,
        clock: () => forbiddenMockAt,
      }),
    ).resolves.toMatchObject({ claimed: 1, paused: 1, delivered: 0 });
    expect(provider.requests).toHaveLength(requestCountBeforeForbiddenMock);
  });

  it("rechecks the job-alert activation before every item and stops after an in-batch revocation", async () => {
    const now = new Date("2026-08-03T08:00:00.000Z");
    await activatePhase33SandboxEmailUseCases(
      db(),
      env(),
      ["email.job-alert"],
      now,
    );
    const user = await db().user.create({
      data: {
        email: "phase33-job-alert-revoked@example.test",
        emailNormalized: "phase33-job-alert-revoked@example.test",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "TEST",
        candidateProfile: { create: {} },
        notificationPreferences: {
          create: {
            purpose: "JOB_ALERT",
            channel: "EMAIL",
            enabled: true,
            version: 1,
            createdAt: now,
          },
        },
      },
      select: { id: true },
    });
    await db().$transaction(async (transaction) => {
      for (const index of [1, 2]) {
        await enqueueNotification(transaction, {
          recipient: { userId: user.id },
          templateKey: "job_alert_preview",
          payloadSchemaVersion: "job-alert-v1",
          payload: { alertName: `Widerruf ${index}`, jobCount: index },
          dedupeKey: `phase33-job-alert-revocation:${index}`,
          createdAt: now,
          availableAt: now,
        });
      }
    });
    const provider = new RevokeAfterFirstProvider(db(), now);
    const result = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "phase33-job-alert-revocation-worker",
      batchSize: 2,
      clock: () => now,
    });

    expect(result).toMatchObject({
      claimed: 2,
      delivered: 1,
      paused: 1,
    });
    expect(provider.requests).toHaveLength(1);
    const rows = await db().notificationOutbox.findMany({
      where: { dedupeKey: { startsWith: "phase33-job-alert-revocation:" } },
      orderBy: { dedupeKey: "asc" },
      select: {
        attemptCount: true,
        lastErrorCode: true,
        status: true,
        attempts: { select: { outcome: true } },
      },
    });
    expect(rows).toEqual([
      {
        attemptCount: 1,
        lastErrorCode: null,
        status: "DELIVERED",
        attempts: [{ outcome: "ACCEPTED" }],
      },
      {
        attemptCount: 0,
        lastErrorCode: "PROVIDER_ACTIVATION_REVOKED",
        status: "PAUSED",
        attempts: [],
      },
    ]);
  });

  it("schedules the shared dispatcher when only the job-alert purpose is active", async () => {
    const now = new Date("2026-08-04T08:00:00.000Z");
    const deploymentDigest = "phase33-job-alert-only-dispatch";
    const schedulerEnvironment = parseEnvironment(
      createValidEnvironment({
        DATABASE_URL: migrated?.connectionString,
        EMAIL_PROVIDER_MODE: "local_mock",
        NOTIFICATION_DISPATCH: "command",
        NOTIFICATION_OUTBOX_PRODUCERS: "true",
        OPTIONAL_EMAIL: "true",
        WORKER_RUNTIME: "sandbox_command",
      }),
    );
    await expect(
      db().providerActivation.count({
        where: {
          environment: schedulerEnvironment.APP_ENV,
          useCase: "email.transactional",
        },
      }),
    ).resolves.toBe(0);
    await activatePhase33SandboxEmailUseCases(
      db(),
      schedulerEnvironment,
      ["email.job-alert"],
      now,
    );
    await activateSandboxHandler(db(), {
      actorReference: "phase33-job-alert-scheduler",
      deploymentDigest,
      environment: schedulerEnvironment,
      evidenceDigest: "b".repeat(64),
      handlerKey: "notifications.dispatch",
      handlerVersion: "v1",
      now,
      reasonCode: "PHASE33_JOB_ALERT_ONLY",
      stepUpEvidenceDigest: "c".repeat(64),
    });

    const active = await scheduleActivatedWork({
      database: db(),
      deploymentDigest,
      environment: schedulerEnvironment,
      now,
    });
    expect(
      active.handlerStates.find(
        ({ handlerKey }) => handlerKey === "notifications.dispatch",
      ),
    ).toEqual({
      handlerKey: "notifications.dispatch",
      reason: "SCHEDULED",
      scheduled: 1,
    });

    await db().providerActivation.updateMany({
      where: {
        environment: schedulerEnvironment.APP_ENV,
        useCase: "email.job-alert",
        revokedAt: null,
      },
      data: {
        killSwitchEngaged: true,
        revokedAt: new Date(now.getTime() + 30_000),
        revokeReasonCode: "PHASE33_TEST_REVOKE",
      },
    });
    const inactive = await scheduleActivatedWork({
      database: db(),
      deploymentDigest,
      environment: schedulerEnvironment,
      now: new Date(now.getTime() + 60_000),
    });
    expect(
      inactive.handlerStates.find(
        ({ handlerKey }) => handlerKey === "notifications.dispatch",
      ),
    ).toEqual({
      handlerKey: "notifications.dispatch",
      reason: "PROVIDER_EMAIL_OUTBOX_NO_ACTIVE_PURPOSE",
      scheduled: 0,
    });
  });
});

class RetryOnceProvider implements EmailDeliveryProvider {
  readonly providerClass = "phase33-retry-once-v1";
  readonly requests: EmailDeliveryRequest[] = [];

  async deliver(input: EmailDeliveryRequest) {
    this.requests.push(structuredClone(input));
    if (this.requests.length === 1) {
      throw new EmailDeliveryFailure("TRANSIENT", "PHASE33_PROVIDER_503");
    }
    return Object.freeze({
      providerClass: this.providerClass,
      providerReceipt: "phase33-receipt-1",
      accepted: true as const,
    });
  }
}

class RevokeAfterFirstProvider implements EmailDeliveryProvider {
  readonly providerClass = "phase33-revoke-after-first-v1";
  readonly requests: EmailDeliveryRequest[] = [];

  constructor(
    private readonly database: DatabaseClient,
    private readonly now: Date,
  ) {}

  async deliver(input: EmailDeliveryRequest) {
    this.requests.push(structuredClone(input));
    if (this.requests.length === 1) {
      await this.database.providerActivation.updateMany({
        where: {
          environment: env().APP_ENV,
          useCase: "email.job-alert",
          revokedAt: null,
        },
        data: {
          killSwitchEngaged: true,
          revokedAt: this.now,
          revokeReasonCode: "PHASE33_TEST_REVOKE",
        },
      });
    }
    return Object.freeze({
      providerClass: this.providerClass,
      providerReceipt: `phase33-revocation-receipt-${this.requests.length}`,
      accepted: true as const,
    });
  }
}

async function persistedEffect(outboxId: string) {
  return Promise.all([
    db().notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } }),
    db().notificationDeliveryAttempt.findMany({ where: { outboxId } }),
  ]);
}

function db() {
  if (database === undefined) {
    throw new Error("Phase 33 job-alert database is unavailable.");
  }
  return database;
}

function env() {
  if (environment === undefined) {
    throw new Error("Phase 33 job-alert environment is unavailable.");
  }
  return environment;
}
