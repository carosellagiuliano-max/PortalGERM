import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import type { ServerEnvironment } from "@/lib/config/env-schema";
import { createInitialEmailVerification } from "@/lib/auth/email-verification-service";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import {
  enqueueNotification,
  NotificationOutboxInputError,
} from "@/lib/notifications/outbox";
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
import {
  PHASE20_NOW,
  createPhase20User,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";

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
          payload: { emailChangeId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}` },
          dedupeKey: `phase20-batch:${index}`,
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
    expect([first.status, second.status]).toEqual([
      "COMPLETED",
      "COMPLETED",
    ]);
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
        where: { dedupeKey: { startsWith: "phase20-batch:" }, status: "DELIVERED" },
      }),
    ).toBe(105);
    expect(
      await db().notificationDeliveryAttempt.count({
        where: { outbox: { dedupeKey: { startsWith: "phase20-batch:" } } },
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
      availableAt: PHASE20_NOW,
    };
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
    const persistedBeforeDispatch = await db().notificationOutbox.findFirstOrThrow({
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

    clock = new Date(PHASE20_NOW.getTime() + 60_001);
    const second = await dispatchNotificationBatch({
      database: db(),
      environment: env(),
      provider,
      workerId: "restart-worker",
      clock: () => clock,
    });
    expect(second).toMatchObject({ claimed: 1, delivered: 1 });
    persisted = await db().notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    expect(persisted.status).toBe("DELIVERED");
    expect(persisted.attempts.map(({ outcome }) => outcome)).toEqual([
      "TRANSIENT_FAILURE",
      "ACCEPTED",
    ]);
    expect(new Set(provider.keys)).toEqual(
      new Set([persisted.providerDedupeKey]),
    );
    expect(provider.effects.size).toBe(1);
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
    const bounced = await enqueue(
      bounceRecipient.id,
      "phase20-bounce",
      2,
    );

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
    poisonProvider.failuresByKey.get(keyFor(transient.id))?.push(
      new EmailDeliveryFailure("TRANSIENT", "PROVIDER_500"),
    );
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
    expect(await db().notificationSuppression.count()).toBe(1);

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
      value: { outboxId: poison.id, nextAttempt: 2 },
    });
    expect(
      await db().notificationOutbox.findUniqueOrThrow({
        where: { id: poison.id },
      }),
    ).toMatchObject({
      status: "RETRY",
      deadLetteredAt: null,
      maxAttempts: 2,
    });
    expect(
      await db().auditLog.count({
        where: {
          action: "NOTIFICATION_DELIVERY_REPLAYED",
          targetId: poison.id,
        },
      }),
    ).toBe(1);
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
  constructor(
    readonly failuresByKey: Map<string, EmailDeliveryFailure[]>,
  ) {
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
