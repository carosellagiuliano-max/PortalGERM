import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ServerEnvironment } from "@/lib/config/env-schema";
import { createInitialEmailVerification } from "@/lib/auth/email-verification-service";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import {
  enqueueNotification,
  hashNotificationRecipient,
  NotificationOutboxInputError,
} from "@/lib/notifications/outbox";
import {
  destroyedNotificationRecipientMaterial,
  maintainNotificationPrivacyRetention,
} from "@/lib/notifications/retention";
import {
  PHASE20_SANDBOX_REPLAY_CONFIRMATION,
  replayDeadLetterNotification,
} from "@/lib/notifications/replay";
import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
  type EmailDeliveryRequest,
} from "@/lib/providers/email/email-delivery-provider";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { keyMaterial } from "@/tests/fixtures/environment";
import {
  PHASE20_NOW,
  createPhase20User,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";
import { activatePhase33SandboxEmailUseCases } from "@/tests/fixtures/phase33-provider-activation";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: Migrated | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase20_notification_delivery");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = phase20Environment(migrated.connectionString, {
    EMAIL_PROVIDER_MODE: "local_mock",
    NOTIFICATION_DISPATCH: "command",
    OPTIONAL_EMAIL: "true",
    DELIVERY_REPLAY: "true",
  });
  await activatePhase33SandboxEmailUseCases(
    database,
    environment,
    ["email.transactional"],
    PHASE20_NOW,
  );
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await migrated?.dispose();
});

describe.sequential("Phase 20 durable notification dispatch", () => {
  it("claims at most 100 rows and delivers every dedupe effect exactly once", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-batch@example.test",
      verified: true,
    });
    await db().$transaction(async (transaction) => {
      for (let index = 0; index < 105; index += 1) {
        await enqueueNotification(transaction, {
          recipient: { userId: recipient.id },
          templateKey: "login_email_changed_notice",
          payloadSchemaVersion: "identity-v1",
          payload: {
            emailChangeId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          },
          dedupeKey: `phase20-batch:${index}`,
          createdAt: PHASE20_NOW,
          availableAt: PHASE20_NOW,
        });
      }
    });
    const provider = new RecordingProvider();
    const [first, second] = await Promise.all([
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "phase20-worker-a",
        batchSize: 100,
        clock: () => PHASE20_NOW,
      }),
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "phase20-worker-b",
        batchSize: 100,
        clock: () => PHASE20_NOW,
      }),
    ]);
    expect([first.status, second.status]).toEqual(["COMPLETED", "COMPLETED"]);
    expect(first.claimed + second.claimed).toBe(105);
    expect(first.delivered + second.delivered).toBe(105);
    expect(Math.max(first.claimed, second.claimed)).toBeLessThanOrEqual(100);
    expect(first.retried + second.retried).toBe(0);
    expect(first.suppressed + second.suppressed).toBe(0);
    expect(first.deadLettered + second.deadLettered).toBe(0);
    expect(first.paused + second.paused).toBe(0);
    expect(provider.effects.size).toBe(105);
    expect(
      await db().notificationOutbox.count({
        where: {
          dedupeKey: { startsWith: "phase20-batch:" },
          status: "DELIVERED",
        },
      }),
    ).toBe(105);
    expect(
      await db().notificationDeliveryAttempt.count({
        where: { outbox: { dedupeKey: { startsWith: "phase20-batch:" } } },
      }),
    ).toBe(105);
    expect(
      await db().notificationOutbox.count({
        where: {
          dedupeKey: { startsWith: "phase20-batch:" },
          providerRequestCiphertext: null,
          providerRequestDestroyedAt: { not: null },
        },
      }),
    ).toBe(105);
  });

  it("rejects oversized, URL-bearing and secret-shaped payloads before writing", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-validation@example.test",
      verified: true,
    });
    const before = await db().notificationOutbox.count();
    const base = {
      recipient: { userId: recipient.id },
      templateKey: "login_email_changed_notice" as const,
      payloadSchemaVersion: "identity-v1",
      createdAt: PHASE20_NOW,
      availableAt: PHASE20_NOW,
    };
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, {
          ...base,
          createdAt: new Date(Number.NaN),
          dedupeKey: "phase33-validation:created-at",
          payload: {
            emailChangeId: "20000000-0000-4000-8000-000000000046",
          },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NotificationOutboxInputError>>({
        code: "CREATED_AT_INVALID",
      }),
    );
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, {
          ...base,
          dedupeKey: "phase20-validation:oversized",
          payload: Object.fromEntries(
            Array.from({ length: 20 }, (_, index) => [
              `field${index}`,
              "a".repeat(2_048),
            ]),
          ),
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NotificationOutboxInputError>>({
        code: "PAYLOAD_TOO_LARGE",
      }),
    );
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, {
          ...base,
          dedupeKey: "phase20-validation:url",
          payload: { destination: "https://example.test/private" },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NotificationOutboxInputError>>({
        code: "PAYLOAD_SECRET_OR_URL",
      }),
    );
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, {
          ...base,
          dedupeKey: "phase20-validation:secret",
          payload: { bearerCredential: "redacted" },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NotificationOutboxInputError>>({
        code: "PAYLOAD_KEY_FORBIDDEN:bearerCredential",
      }),
    );
    expect(await db().notificationOutbox.count()).toBe(before);
  });

  it("deduplicates an explicit recipient only when its keyed identity matches", async () => {
    const keyring = env().secrets.keyrings.NOTIFICATION_DELIVERY_KEYS;
    const hashKeyring = env().secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS;
    const recipientExpiresAt = new Date(
      PHASE20_NOW.getTime() + 23 * 60 * 60_000,
    );
    const input = {
      recipient: {
        address: "outbox-dedupe-address-a@example.test",
        hashKeyring,
        keyring,
        retentionUntil: recipientExpiresAt,
      },
      templateKey: "privacy_request_changed" as const,
      payloadSchemaVersion: "privacy-request-v1",
      payload: {
        requestId: "20000000-0000-4000-8000-000000000044",
        statusLabel: "Abgeschlossen",
      },
      dedupeKey: "phase33-address-dedupe",
      createdAt: PHASE20_NOW,
      availableAt: PHASE20_NOW,
    };
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, {
          ...input,
          dedupeKey: "phase33-address-unbounded-retention",
          recipient: {
            ...input.recipient,
            retentionUntil: new Date("9999-12-31T23:59:59.000Z"),
          },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NotificationOutboxInputError>>({
        code: "RECIPIENT_RETENTION_INVALID",
      }),
    );
    const first = await db().$transaction((transaction) =>
      enqueueNotification(transaction, input),
    );
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: first.id },
        select: { createdAt: true },
      }),
    ).resolves.toEqual({ createdAt: PHASE20_NOW });
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, input),
      ),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      db().$transaction((transaction) =>
        enqueueNotification(transaction, {
          ...input,
          recipient: {
            address: "outbox-dedupe-address-b@example.test",
            hashKeyring,
            keyring,
            retentionUntil: input.recipient.retentionUntil,
          },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NotificationOutboxInputError>>({
        code: "DEDUPE_CONFLICT",
      }),
    );
    await db().notificationOutbox.update({
      where: { id: first.id },
      data: {
        status: "SUPPRESSED",
        suppressedAt: PHASE20_NOW,
        ...destroyedNotificationRecipientMaterial(PHASE20_NOW),
      },
    });
  });

  it("never wipes an expired explicit recipient under a live lease and suppresses it after lease expiry", async () => {
    const keyring = env().secrets.keyrings.NOTIFICATION_DELIVERY_KEYS;
    const hashKeyring = env().secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS;
    const insertedAt = new Date();
    const recipientExpiresAt = new Date(insertedAt.getTime() + 60_000);
    const enqueued = await db().$transaction((transaction) =>
      enqueueNotification(transaction, {
        recipient: {
          address: "outbox-retention-lease@example.test",
          hashKeyring,
          keyring,
          retentionUntil: recipientExpiresAt,
        },
        templateKey: "privacy_request_changed",
        payloadSchemaVersion: "privacy-request-v1",
        payload: {
          requestId: "20000000-0000-4000-8000-000000000045",
          statusLabel: "Abgeschlossen",
        },
        dedupeKey: "phase33-address-retention-lease",
        createdAt: insertedAt,
        availableAt: insertedAt,
      }),
    );
    const leaseExpiresAt = new Date(insertedAt.getTime() + 120_000);
    await db().notificationOutbox.update({
      where: { id: enqueued.id },
      data: {
        status: "LEASED",
        leaseOwner: "retention-race-worker",
        leaseExpiresAt,
      },
    });

    const whileLeased = await maintainNotificationPrivacyRetention(
      db(),
      new Date(insertedAt.getTime() + 90_000),
    );
    expect(whileLeased.suppressedRecipients).toBe(0);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: enqueued.id },
        select: {
          recipientAddressCiphertext: true,
          recipientAddressDestroyedAt: true,
          status: true,
        },
      }),
    ).resolves.toMatchObject({
      recipientAddressCiphertext: expect.any(Uint8Array),
      recipientAddressDestroyedAt: null,
      status: "LEASED",
    });

    const reclaimedAt = new Date(leaseExpiresAt.getTime() + 1);
    const reclaimed = await maintainNotificationPrivacyRetention(
      db(),
      reclaimedAt,
    );
    expect(reclaimed.suppressedRecipients).toBe(1);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: enqueued.id },
        select: {
          lastErrorCode: true,
          leaseExpiresAt: true,
          leaseOwner: true,
          recipientAddressCiphertext: true,
          recipientAddressDestroyedAt: true,
          status: true,
          suppressedAt: true,
        },
      }),
    ).resolves.toEqual({
      lastErrorCode: "RECIPIENT_MATERIAL_RETENTION_EXPIRED",
      leaseExpiresAt: null,
      leaseOwner: null,
      recipientAddressCiphertext: null,
      recipientAddressDestroyedAt: reclaimedAt,
      status: "SUPPRESSED",
      suppressedAt: reclaimedAt,
    });
  });

  it("rehydrates a single-use verification link after producer state is gone", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-rehydration@example.test",
      verified: false,
    });
    const issued = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: recipient.id,
        emailNormalized: recipient.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(40).correlationId,
        environment: env(),
      }),
    );
    const persistedBeforeDispatch =
      await db().notificationOutbox.findFirstOrThrow({
        where: { recipientUserId: recipient.id },
        include: { attempts: true },
      });
    expect(JSON.stringify(persistedBeforeDispatch)).not.toContain(
      issued.rawToken,
    );

    const provider = new RecordingProvider();
    const result = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "rehydration-worker",
      clock: () => PHASE20_NOW,
    });
    expect(result).toMatchObject({ claimed: 1, delivered: 1 });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.text).toContain(issued.rawToken);
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: persistedBeforeDispatch.id },
      }),
    ).toMatchObject({ status: "DELIVERED", attemptCount: 1 });
  });

  it("pauses without provider I/O when verification-token key authority changed", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-verification-key-rotation@example.test",
      verified: false,
    });
    const issued = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: recipient.id,
        emailNormalized: recipient.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(42).correlationId,
        environment: env(),
      }),
    );
    const rotatedSessionEnvironment = phase20Environment(
      migrated!.connectionString,
      {
        EMAIL_PROVIDER_MODE: "local_mock",
        NOTIFICATION_DISPATCH: "command",
        OPTIONAL_EMAIL: "true",
        DELIVERY_REPLAY: "true",
        SESSION_SECRET: keyMaterial(99),
      },
    );
    const provider = new RecordingProvider();

    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: rotatedSessionEnvironment,
        provider,
        workerId: "verification-key-rotation-worker",
        clock: () => PHASE20_NOW,
      }),
    ).resolves.toMatchObject({ claimed: 1, paused: 1 });
    expect(provider.requests).toHaveLength(0);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: issued.outboxId },
        select: { status: true, lastErrorCode: true },
      }),
    ).resolves.toEqual({
      status: "PAUSED",
      lastErrorCode: "CHALLENGE_TOKEN_BINDING_MISMATCH",
    });
  });

  it("suppresses a frozen retry after its verification challenge is superseded", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-verification-superseded@example.test",
      verified: false,
    });
    const issued = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: recipient.id,
        emailNormalized: recipient.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(43).correlationId,
        environment: env(),
      }),
    );
    const provider = new RecordingProvider([
      new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"),
    ]);
    let clock = PHASE20_NOW;
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "verification-superseded-worker-a",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, retried: 1 });
    await db().emailVerificationChallenge.update({
      where: { id: issued.challengeId },
      data: { supersededAt: new Date(PHASE20_NOW.getTime() + 30_000) },
    });

    clock = new Date(PHASE20_NOW.getTime() + 60_001);
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "verification-superseded-worker-b",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, suppressed: 1 });
    expect(provider.requests).toHaveLength(1);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: issued.outboxId },
        select: {
          status: true,
          lastErrorCode: true,
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
        },
      }),
    ).resolves.toEqual({
      status: "SUPPRESSED",
      lastErrorCode: "CHALLENGE_TERMINAL",
      providerRequestCiphertext: null,
      providerRequestDestroyedAt: clock,
    });
  });

  it("takes over an expired lease, retries transient failure, and preserves one provider key", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-retry@example.test",
      verified: true,
    });
    const outbox = await enqueue(recipient.id, "phase20-retry", 3);
    await db().notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "LEASED",
        leaseOwner: "crashed-worker",
        leaseExpiresAt: new Date(PHASE20_NOW.getTime() - 1),
      },
    });
    const provider = new RecordingProvider([
      new EmailDeliveryFailure("TRANSIENT", "PROVIDER_500"),
    ]);
    let clock = PHASE20_NOW;
    const first = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "takeover-worker",
      clock: () => clock,
    });
    expect(first).toMatchObject({ claimed: 1, retried: 1 });
    let persisted = await db().notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
      include: { attempts: true },
    });
    expect(persisted).toMatchObject({
      status: "RETRY",
      attemptCount: 1,
      lastErrorCode: "PROVIDER_500",
    });
    expect(persisted.attempts).toHaveLength(1);
    const firstProviderRequest = structuredClone(provider.requests[0]);
    clock = new Date(PHASE20_NOW.getTime() + 60_001);
    const second = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "restart-worker",
      clock: () => clock,
    });
    persisted = await db().notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    expect(
      second,
      JSON.stringify({
        second,
        status: persisted.status,
        error: persisted.lastErrorCode,
        attempts: persisted.attempts.map(({ outcome }) => outcome),
      }),
    ).toMatchObject({ claimed: 1, delivered: 1 });
    expect(persisted.status).toBe("DELIVERED");
    expect(persisted.attempts.map(({ outcome }) => outcome)).toEqual([
      "TRANSIENT_FAILURE",
      "ACCEPTED",
    ]);
    expect(new Set(provider.keys)).toEqual(
      new Set([persisted.providerDedupeKey]),
    );
    expect(provider.effects.size).toBe(1);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]).toEqual(firstProviderRequest);
    expect(provider.requests[1]?.to).toBe("outbox-retry@example.test");
  });

  it("suppresses a frozen retry when the user recipient address changed", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-recipient-change@example.test",
      verified: true,
    });
    const outbox = await enqueue(recipient.id, "phase33-recipient-change", 3);
    const provider = new RecordingProvider([
      new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"),
    ]);
    let clock = PHASE20_NOW;
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "recipient-change-worker-a",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, retried: 1 });
    await db().user.update({
      where: { id: recipient.id },
      data: {
        email: "outbox-recipient-changed@example.test",
        emailNormalized: "outbox-recipient-changed@example.test",
      },
    });

    clock = new Date(PHASE20_NOW.getTime() + 60_001);
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "recipient-change-worker-b",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, suppressed: 1 });
    expect(provider.requests).toHaveLength(1);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: {
          status: true,
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "SUPPRESSED",
      providerRequestCiphertext: null,
      providerRequestDestroyedAt: clock,
    });
  });

  it("pauses an ambiguous retry before the provider idempotency window expires", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-stale-ambiguous@example.test",
      verified: true,
    });
    const outbox = await enqueue(recipient.id, "phase33-stale-ambiguous", 3);
    const provider = new RecordingProvider([
      new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"),
    ]);
    let clock = PHASE20_NOW;
    const first = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "stale-ambiguous-worker-a",
      clock: () => clock,
    });
    expect(first).toMatchObject({ claimed: 1, retried: 1 });
    expect(provider.requests).toHaveLength(1);

    clock = new Date(PHASE20_NOW.getTime() + 24 * 60 * 60_000);
    const second = await maintainNotificationPrivacyRetention(db(), clock);
    expect(second).toMatchObject({ pausedRequests: 1 });
    expect(provider.requests).toHaveLength(1);
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: { status: true, lastErrorCode: true },
      }),
    ).toEqual({
      status: "PAUSED",
      lastErrorCode: "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
    });
  });

  it("never dead-letters an unknown provider outcome on the final attempt", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-final-ambiguous@example.test",
      verified: true,
    });
    const outbox = await enqueue(recipient.id, "phase33-final-ambiguous", 1);
    const provider = new RecordingProvider([
      new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"),
    ]);

    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "final-ambiguous-worker",
        clock: () => PHASE20_NOW,
      }),
    ).resolves.toMatchObject({
      claimed: 1,
      deadLettered: 0,
      paused: 1,
    });
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: {
          lastErrorCode: true,
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
          status: true,
        },
      }),
    ).resolves.toMatchObject({
      lastErrorCode: "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
      providerRequestCiphertext: expect.any(Uint8Array),
      providerRequestDestroyedAt: null,
      status: "PAUSED",
    });
    await expect(
      db().notificationDeliveryAttempt.findFirstOrThrow({
        where: { outboxId: outbox.id },
        select: { outcome: true },
      }),
    ).resolves.toEqual({ outcome: "TIMED_OUT" });

    const retentionSweepAt = new Date(
      PHASE20_NOW.getTime() + 24 * 60 * 60_000,
    );
    await maintainNotificationPrivacyRetention(db(), retentionSweepAt);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: {
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
        },
      }),
    ).resolves.toEqual({
      providerRequestCiphertext: null,
      providerRequestDestroyedAt: retentionSweepAt,
    });
  });

  it("wipes and pauses a snapshot left before the first attempt receipt commit", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-attempt-commit-crash@example.test",
      verified: true,
    });
    const outbox = await enqueue(
      recipient.id,
      "phase33-attempt-commit-crash",
      3,
    );
    const provider = new RecordingProvider();
    await db().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_phase33_notification_attempt()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected attempt commit crash';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_phase33_notification_attempt_trigger
      BEFORE INSERT ON "NotificationDeliveryAttempt"
      FOR EACH ROW EXECUTE FUNCTION reject_phase33_notification_attempt();
    `);
    try {
      await expect(
        dispatchNotificationBatch({
          database: db(),
          environment: env(),
          provider,
          workerId: "attempt-commit-crash-worker-a",
          clock: () => PHASE20_NOW,
        }),
      ).rejects.toThrow();
    } finally {
      await db().$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS reject_phase33_notification_attempt_trigger
          ON "NotificationDeliveryAttempt";
        DROP FUNCTION IF EXISTS reject_phase33_notification_attempt();
      `);
    }
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: {
          attemptCount: true,
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
        },
      }),
    ).resolves.toMatchObject({
      attemptCount: 0,
      providerRequestCiphertext: expect.any(Uint8Array),
      providerRequestDestroyedAt: null,
    });

    const afterProviderTtl = new Date(PHASE20_NOW.getTime() + 24 * 60 * 60_000);
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "attempt-commit-crash-worker-b",
        clock: () => afterProviderTtl,
      }),
    ).resolves.toMatchObject({ claimed: 0, paused: 1 });
    expect(provider.requests).toHaveLength(1);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: {
          status: true,
          attemptCount: true,
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
        },
      }),
    ).resolves.toEqual({
      status: "PAUSED",
      attemptCount: 0,
      providerRequestCiphertext: null,
      providerRequestDestroyedAt: afterProviderTtl,
    });
  });

  it("treats unknown hydration infrastructure failures as bounded transient retries", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-hydration-retry@example.test",
      verified: false,
    });
    const issued = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: recipient.id,
        emailNormalized: recipient.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(41).correlationId,
        environment: env(),
      }),
    );
    const hydration = vi
      .spyOn(db().emailVerificationChallenge, "findUnique")
      .mockRejectedValueOnce(new Error("temporary hydration database outage"));
    const provider = new RecordingProvider();
    let clock = PHASE20_NOW;
    try {
      const first = await dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "hydration-retry-worker-a",
        clock: () => clock,
      });
      expect(first).toMatchObject({ claimed: 1, retried: 1 });
      expect(provider.requests).toHaveLength(0);
      expect(
        await db().notificationOutbox.findUniqueOrThrow({
          where: { id: issued.outboxId },
        }),
      ).toMatchObject({
        status: "RETRY",
        attemptCount: 1,
        lastErrorCode: "DISPATCH_INFRASTRUCTURE_FAILURE",
      });

      clock = new Date(PHASE20_NOW.getTime() + 60_001);
      const second = await dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "hydration-retry-worker-b",
        clock: () => clock,
      });
      expect(second).toMatchObject({ claimed: 1, delivered: 1 });
      expect(provider.effects.size).toBe(1);
      expect(
        await db().notificationDeliveryAttempt.findMany({
          where: { outboxId: issued.outboxId },
          orderBy: { attemptNumber: "asc" },
          select: { outcome: true },
        }),
      ).toEqual([{ outcome: "TRANSIENT_FAILURE" }, { outcome: "ACCEPTED" }]);
    } finally {
      hydration.mockRestore();
    }
  });

  it("honours suppressions written by a retained HMAC key after rotation", async () => {
    const oldEnvironment = phase20Environment(migrated!.connectionString, {
      EMAIL_PROVIDER_MODE: "local_mock",
      NOTIFICATION_DISPATCH: "command",
      OPTIONAL_EMAIL: "true",
      DELIVERY_REPLAY: "true",
      NOTIFICATION_RECIPIENT_HASH_KEYS: `recipient-hash-v1:${keyMaterial(51)}`,
    });
    const rotatedEnvironment = phase20Environment(migrated!.connectionString, {
      EMAIL_PROVIDER_MODE: "local_mock",
      NOTIFICATION_DISPATCH: "command",
      OPTIONAL_EMAIL: "true",
      DELIVERY_REPLAY: "true",
      NOTIFICATION_RECIPIENT_HASH_KEYS:
        `recipient-hash-v2:${keyMaterial(52)},` +
        `recipient-hash-v1:${keyMaterial(51)}`,
    });
    await activatePhase33SandboxEmailUseCases(
      db(),
      rotatedEnvironment,
      ["email.transactional"],
      PHASE20_NOW,
    );
    const recipient = await createPhase20User(db(), {
      email: "outbox-rotated-suppression@example.test",
      verified: true,
    });
    const oldHash = hashNotificationRecipient(
      recipient.emailNormalized,
      oldEnvironment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    );
    await db().notificationSuppression.create({
      data: {
        recipientHash: oldHash,
        recipientHashKeyVersion:
          oldEnvironment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS[0]!
            .version,
        reason: "HARD_BOUNCE",
        source: "rotation-test",
        createdAt: PHASE20_NOW,
      },
    });
    const outbox = await enqueue(
      recipient.id,
      "phase20-rotated-suppression",
      3,
    );
    const provider = new RecordingProvider();

    const result = await dispatchNotificationBatch({
      database: db(),
      environment: rotatedEnvironment,
      provider,
      workerId: "rotated-suppression-worker",
      clock: () => PHASE20_NOW,
    });

    expect(result).toMatchObject({ claimed: 1, suppressed: 1 });
    expect(provider.requests).toHaveLength(0);
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      }),
    ).toMatchObject({ status: "SUPPRESSED", attemptCount: 1 });
  });

  it("deduplicates recovery after provider acceptance but before local completion", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-accepted-crash@example.test",
      verified: true,
    });
    const outbox = await enqueue(recipient.id, "phase20-provider-crash", 3);
    const row = await db().notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    const provider = new RecordingProvider();
    provider.acceptedEffect(row.providerDedupeKey);
    await db().notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "LEASED",
        leaseOwner: "accepted-then-crashed",
        leaseExpiresAt: new Date(PHASE20_NOW.getTime() - 1),
      },
    });
    const result = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "crash-recovery",
      clock: () => PHASE20_NOW,
    });
    expect(result).toMatchObject({ delivered: 1 });
    expect(provider.effects.size).toBe(1);
    expect(provider.keys).toEqual([row.providerDedupeKey]);
  });

  it("bounds poison/transient failures in DLQ, suppresses hard bounces, and permits only audited local replay", async () => {
    const poisonRecipient = await createPhase20User(db(), {
      email: "outbox-poison@example.test",
      verified: true,
    });
    const transientRecipient = await createPhase20User(db(), {
      email: "outbox-transient@example.test",
      verified: true,
    });
    const bounceRecipient = await createPhase20User(db(), {
      email: "outbox-bounce@example.test",
      verified: true,
    });
    const poison = await enqueue(poisonRecipient.id, "phase20-poison", 2);
    const transient = await enqueue(
      transientRecipient.id,
      "phase20-transient-dlq",
      2,
    );
    const bounced = await enqueue(bounceRecipient.id, "phase20-bounce", 2);

    const terminalRows = await db().notificationOutbox.findMany({
      where: { id: { in: [poison.id, transient.id, bounced.id] } },
      select: { id: true, providerDedupeKey: true },
    });
    const keyFor = (id: string) =>
      terminalRows.find((row) => row.id === id)?.providerDedupeKey ??
      (() => {
        throw new Error("Phase 20 terminal provider key unavailable.");
      })();
    const poisonProvider = new MappedFailureProvider(
      new Map([
        [
          keyFor(poison.id),
          [new EmailDeliveryFailure("PERMANENT", "PAYLOAD_REJECTED")],
        ],
        [
          keyFor(transient.id),
          [new EmailDeliveryFailure("TRANSIENT", "PROVIDER_429")],
        ],
        [
          keyFor(bounced.id),
          [new EmailDeliveryFailure("BOUNCE", "HARD_BOUNCE")],
        ],
      ]),
    );
    let clock = PHASE20_NOW;
    const first = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider: poisonProvider,
      workerId: "terminal-worker-a",
      batchSize: 3,
      clock: () => clock,
    });
    expect(first).toMatchObject({
      claimed: 3,
      retried: 1,
      suppressed: 1,
      deadLettered: 1,
    });
    clock = new Date(PHASE20_NOW.getTime() + 60_001);
    poisonProvider.failuresByKey
      .get(keyFor(transient.id))
      ?.push(new EmailDeliveryFailure("TRANSIENT", "PROVIDER_500"));
    const second = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider: poisonProvider,
      workerId: "terminal-worker-b",
      clock: () => clock,
    });
    expect(second).toMatchObject({ claimed: 1, deadLettered: 1 });
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: transient.id },
      }),
    ).toMatchObject({ status: "DEAD_LETTER", attemptCount: 2 });
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: poison.id },
      }),
    ).toMatchObject({ status: "DEAD_LETTER", attemptCount: 1 });
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: bounced.id },
      }),
    ).toMatchObject({ status: "SUPPRESSED", attemptCount: 1 });
    expect(
      await db().notificationSuppression.count({
        where: { source: poisonProvider.providerClass, releasedAt: null },
      }),
    ).toBe(1);

    const admin = await db().user.create({
      data: {
        email: "phase20-replay-admin@example.test",
        emailNormalized: "phase20-replay-admin@example.test",
        role: "ADMIN",
        dataProvenance: "TEST",
        emailVerifiedAt: PHASE20_NOW,
        identityAssurance: "VERIFIED_EMAIL",
      },
      select: { id: true },
    });
    const auditBefore = await db().auditLog.count();
    await expect(
      replayDeadLetterNotification(
        {
          outboxId: "not-read-before-authorization",
          reasonCode: "PHASE20_RECOVERY",
          sandboxConfirmation: PHASE20_SANDBOX_REPLAY_CONFIRMATION,
        },
        {
          actor: {
            userId: admin.id,
            email: "support@example.test",
            role: "SUPPORT",
            status: "ACTIVE",
          },
          correlationId: "20000000-0000-4000-8000-000000000300",
          database: db(),
          environment: env(),
          now: clock,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await db().auditLog.count()).toBe(auditBefore);

    const replay = await replayDeadLetterNotification(
      {
        outboxId: poison.id,
        reasonCode: "PHASE20_RECOVERY",
        sandboxConfirmation: PHASE20_SANDBOX_REPLAY_CONFIRMATION,
      },
      {
        actor: {
          userId: admin.id,
          email: "phase20-replay-admin@example.test",
          role: "ADMIN",
          status: "ACTIVE",
          capabilities: ["ADMIN_SYSTEM_TASK_MANAGE"] as const,
        },
        correlationId: "20000000-0000-4000-8000-000000000301",
        database: db(),
        environment: env(),
        now: clock,
      },
    );
    expect(replay).toMatchObject({
      ok: true,
      value: {
        predecessorOutboxId: poison.id,
        nextAttempt: 1,
      },
    });
    if (!replay.ok) throw new Error("Expected sandbox replay successor.");
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: poison.id },
      }),
    ).toMatchObject({
      status: "DEAD_LETTER",
      providerRequestCiphertext: null,
    });
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: replay.value.outboxId },
      }),
    ).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
      providerRequestActivationId: null,
    });
    expect(
      await db().auditLog.count({
        where: {
          action: "NOTIFICATION_DELIVERY_REPLAYED",
          targetId: poison.id,
        },
      }),
    ).toBe(1);

    const replayProvider = new RecordingProvider();
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider: replayProvider,
        workerId: "replay-successor-worker",
        batchSize: 1,
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: replay.value.outboxId },
        select: { status: true, attemptCount: true },
      }),
    ).resolves.toEqual({ status: "DELIVERED", attemptCount: 1 });
  });

  it("moves a frozen request across an activation change to one non-reclaimable reconciliation pause", async () => {
    const recipient = await createPhase20User(db(), {
      email: "outbox-activation-change@example.test",
      verified: true,
    });
    const outbox = await enqueue(recipient.id, "phase33-activation-change", 3);
    const provider = new RecordingProvider([
      new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN"),
    ]);
    let clock = PHASE20_NOW;
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "activation-change-worker-a",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, retried: 1 });
    await activatePhase33SandboxEmailUseCases(
      db(),
      env(),
      ["email.transactional"],
      new Date(PHASE20_NOW.getTime() + 30_000),
    );

    clock = new Date(PHASE20_NOW.getTime() + 60_001);
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "activation-change-worker-b",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 1, paused: 1 });
    expect(provider.requests).toHaveLength(1);
    await expect(
      db().notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: {
          status: true,
          lastErrorCode: true,
          providerRequestCiphertext: true,
          providerRequestDestroyedAt: true,
        },
      }),
    ).resolves.toEqual({
      status: "PAUSED",
      lastErrorCode:
        "FROZEN_REQUEST_ACTIVATION_CHANGED_RECONCILIATION_REQUIRED",
      providerRequestCiphertext: null,
      providerRequestDestroyedAt: clock,
    });

    clock = new Date(PHASE20_NOW.getTime() + 120_001);
    await expect(
      dispatchNotificationBatch({
        database: db(),
        environment: env(),
        provider,
        workerId: "activation-change-worker-c",
        clock: () => clock,
      }),
    ).resolves.toMatchObject({ claimed: 0, paused: 0 });
  });
});

class RecordingProvider implements EmailDeliveryProvider {
  readonly providerClass = "phase20-recording-provider-v1";
  readonly effects = new Map<string, string>();
  readonly keys: string[] = [];
  readonly requests: EmailDeliveryRequest[] = [];

  constructor(readonly failures: EmailDeliveryFailure[] = []) {}

  acceptedEffect(idempotencyKey: string) {
    this.effects.set(idempotencyKey, `receipt:${this.effects.size + 1}`);
  }

  async deliver(input: EmailDeliveryRequest) {
    this.keys.push(input.idempotencyKey);
    this.requests.push(structuredClone(input));
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    if (!this.effects.has(input.idempotencyKey)) {
      this.acceptedEffect(input.idempotencyKey);
    }
    return Object.freeze({
      providerClass: this.providerClass,
      providerReceipt: this.effects.get(input.idempotencyKey)!,
      accepted: true as const,
    });
  }
}

class MappedFailureProvider extends RecordingProvider {
  constructor(readonly failuresByKey: Map<string, EmailDeliveryFailure[]>) {
    super();
  }

  override async deliver(input: EmailDeliveryRequest) {
    const failure = this.failuresByKey.get(input.idempotencyKey)?.shift();
    if (failure !== undefined) {
      this.keys.push(input.idempotencyKey);
      throw failure;
    }
    return super.deliver(input);
  }
}

async function enqueue(
  recipientUserId: string,
  dedupeKey: string,
  maxAttempts: number,
) {
  return db().$transaction((transaction) =>
    enqueueNotification(transaction, {
      recipient: { userId: recipientUserId },
      templateKey: "login_email_changed_notice",
      payloadSchemaVersion: "identity-v1",
      payload: { emailChangeId: "20000000-0000-4000-8000-000000000001" },
      dedupeKey,
      createdAt: PHASE20_NOW,
      availableAt: PHASE20_NOW,
      maxAttempts,
    }),
  );
}

function db() {
  if (database === undefined) throw new Error("Phase 20 database unavailable.");
  return database;
}

function env() {
  if (environment === undefined) {
    throw new Error("Phase 20 environment unavailable.");
  }
  return environment;
}
