import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { encryptNotificationRecipient } from "@/lib/notifications/delivery-material";
import {
  hashNotificationRecipient,
  hashNotificationRecipientCandidates,
} from "@/lib/notifications/outbox";
import { encryptNotificationProviderRequest } from "@/lib/notifications/provider-request-material";
import { notificationAttemptEvidenceRetainUntil } from "@/lib/notifications/retention";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  createWorkerRun,
  type ClaimedWorkItem,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import {
  ingestVerifiedResendDeliveryWebhook,
  projectPendingResendEventsForReceipt,
  RESEND_EVENT_PROJECTION_POLICY_V1,
  ResendEventInboxConflictError,
} from "@/lib/providers/email/resend-event-inbox";
import type { VerifiedResendDeliveryWebhook } from "@/lib/providers/email/resend-webhook";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type Database = ReturnType<typeof createDatabaseClient>;

const RECEIVED_AT = new Date("2026-08-01T12:00:00.000Z");
const DEPLOYMENT_DIGEST = "phase34-resend-event-worker";

describe.sequential("PostgreSQL Phase-33 Resend event inbox", () => {
  let migrated: MigratedDatabase;
  let database: Database;
  let environment: ServerEnvironment;
  let sendActivationId: string;
  let eventActivationId: string;
  let handlerActivation: Readonly<{ generation: number; id: string }>;

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase33_resend_inbox");
    database = createDatabaseClient(migrated.connectionString);
    await database.$connect();
    environment = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "ci",
        NODE_ENV: "production",
        DATABASE_URL: migrated.connectionString,
        TEST_DATABASE_URL:
          "postgresql://phase33:phase33@127.0.0.1:6543/phase33_test?schema=public",
        EMAIL_PROVIDER_MODE: "resend_contract",
        EMAIL_PROVIDER_CONTRACT_ENDPOINT:
          "http://provider-contract:8080/resend/emails",
        EMAIL_PROVIDER_API_KEY: "re_phase33_contract_key",
        EMAIL_FROM: "SwissTalentHub <notifications@example.ch>",
        NOTIFICATION_OUTBOX_PRODUCERS: "true",
        NOTIFICATION_DISPATCH: "command",
        NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(41)}`,
        NOTIFICATION_RECIPIENT_HASH_KEYS: `recipient-hash-v1:${keyMaterial(44)}`,
        RESEND_SECRET_VERSION: "phase33-email-contract-v1",
        RESEND_WEBHOOK_SECRET: "whsec_phase33_contract_webhook",
        RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-contract-v1",
        APP_BUILD_ID: DEPLOYMENT_DIGEST,
        WORKER_RUNTIME: "sandbox_command",
      }),
    );
    sendActivationId = await createActivation(
      "email.transactional",
      environment,
    );
    eventActivationId = await createActivation(
      "email.delivery-events",
      environment,
    );
    handlerActivation = await database.workerHandlerActivation.create({
      data: {
        environment: "ci",
        handlerKey: RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey,
        handlerVersion: RESEND_EVENT_PROJECTION_POLICY_V1.handlerVersion,
        payloadVersion: RESEND_EVENT_PROJECTION_POLICY_V1.payloadVersion,
        mode: "SANDBOX",
        configurationDigest: "b".repeat(64),
        deploymentDigest: DEPLOYMENT_DIGEST,
        owner: "Platform Engineering / Communications",
        runbookRef: "codex-plan/runbooks/worker-operations.md",
        sloRef: "codex-plan/34-verified-findings-production-hardening.md",
        evidenceDigest: "c".repeat(64),
        providerUseCase: "email.delivery-events",
        leaseMilliseconds: 15_000,
        heartbeatMilliseconds: 5_000,
        batchSize: 1,
        maxAttempts: RESEND_EVENT_PROJECTION_POLICY_V1.maximumAttempts,
        maxConcurrency: 1,
        killSwitchEngaged: false,
        effectiveAt: RECEIVED_AT,
      },
      select: { generation: true, id: true },
    });
  });

  afterAll(async () => {
    if (database !== undefined) await database.$disconnect();
    if (migrated !== undefined) await migrated.dispose();
  });

  afterEach(async () => {
    if (database === undefined || eventActivationId === undefined) return;
    await database.providerActivation.updateMany({
      where: { id: eventActivationId, revokedAt: null },
      data: { health: "HEALTHY", healthCheckedAt: RECEIVED_AT },
    });
  });

  it("projects a correlated hard bounce exactly once and accepts an exact retry", async () => {
    const address = "phase33-bounce@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase33Bounce01",
      "BOUNCED",
      "a",
      recipientHash,
      "email_phase33_bounce_receipt",
    );
    await bindAcceptedDelivery(
      address,
      recipientHash,
      verified.event.providerReceipt,
    );

    const first = await ingest(verified, RECEIVED_AT);
    const replay = await ingest(
      verified,
      new Date(RECEIVED_AT.getTime() + 5_000),
    );

    expect(first).toMatchObject({
      projectedSuppressions: 1,
      replay: false,
      status: "PROJECTED",
    });
    expect(replay).toMatchObject({
      inboxId: first.inboxId,
      projectedSuppressions: 0,
      replay: true,
      status: "PROJECTED",
    });
    expect(
      await database.notificationSuppression.findMany({
        where: { recipientHash, releasedAt: null },
        select: { reason: true, source: true },
      }),
    ).toEqual([{ reason: "HARD_BOUNCE", source: "resend-webhook-v1" }]);
  });

  it("queues an out-of-order webhook once, retries it, and projects it through the fenced worker", async () => {
    const address = "phase34-worker-recovery@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase34WorkerRecovery01",
      "BOUNCED",
      "5",
      recipientHash,
      "email_phase34_worker_recovery_receipt",
    );

    const first = await ingest(verified, RECEIVED_AT);
    const replay = await ingest(verified, new Date(RECEIVED_AT.getTime() + 1));
    expect(first).toMatchObject({
      projectedSuppressions: 0,
      queued: true,
      replay: false,
      status: "RECEIVED",
    });
    expect(replay).toMatchObject({
      inboxId: first.inboxId,
      queued: true,
      replay: true,
      status: "RECEIVED",
    });

    const queued = await database.workItem.findMany({
      where: {
        handlerKey: RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey,
        subjectId: first.inboxId,
      },
      select: {
        dedupeKey: true,
        effectKey: true,
        maxAttempts: true,
        payloadReference: true,
        status: true,
        subjectType: true,
      },
    });
    expect(queued).toEqual([
      {
        dedupeKey: `notifications.provider-event-project:v1:${first.inboxId}`,
        effectKey: `effect:notifications.provider-event-project:v1:${first.inboxId}`,
        maxAttempts: 8,
        payloadReference: { emailProviderEventInboxId: first.inboxId },
        status: "PENDING",
        subjectType: "EMAIL_PROVIDER_EVENT_INBOX",
      },
    ]);
    expect(JSON.stringify(queued)).not.toContain(address);
    expect(JSON.stringify(queued)).not.toContain(recipientHash);
    expect(JSON.stringify(queued)).not.toContain(
      verified.event.providerReceipt,
    );

    const firstAttemptAt = new Date(RECEIVED_AT.getTime() + 100);
    const firstAttempt = await executeProjectionAttempt(
      first.inboxId,
      "phase34-resend-retry-a",
      firstAttemptAt,
    );
    expect(firstAttempt.result.completion).toBe("RETRY");
    await expect(
      database.workItem.findUniqueOrThrow({
        where: { id: firstAttempt.claimed.id },
        select: {
          lastErrorCode: true,
          lastFailureClass: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      lastErrorCode: "EMAIL_PROVIDER_ATTEMPT_PENDING",
      lastFailureClass: "TRANSIENT",
      status: "RETRY",
    });
    await expect(
      database.notificationSuppression.count({
        where: { recipientHash },
      }),
    ).resolves.toBe(0);

    await bindAcceptedDelivery(
      address,
      recipientHash,
      verified.event.providerReceipt,
    );
    const retryAt = await database.workItem
      .findUniqueOrThrow({
        where: { id: firstAttempt.claimed.id },
        select: { availableAt: true },
      })
      .then(({ availableAt }) => new Date(availableAt.getTime() + 1));
    const recovered = await executeProjectionAttempt(
      first.inboxId,
      "phase34-resend-retry-b",
      retryAt,
    );

    expect(recovered.result.completion).toBe("COMPLETED");
    await expect(
      database.emailProviderEventInbox.findUniqueOrThrow({
        where: { id: first.inboxId },
        select: {
          recipientHashes: true,
          recipientHashesWipedAt: true,
          status: true,
        },
      }),
    ).resolves.toMatchObject({
      recipientHashes: [],
      recipientHashesWipedAt: expect.any(Date),
      status: "PROJECTED",
    });
    await expect(
      database.notificationSuppression.count({
        where: { recipientHash, releasedAt: null },
      }),
    ).resolves.toBe(1);
    await expect(
      database.workAttempt.findMany({
        where: { workItemId: firstAttempt.claimed.id },
        orderBy: { attemptNumber: "asc" },
        select: { failureClass: true, outcome: true },
      }),
    ).resolves.toEqual([
      { failureClass: "TRANSIENT", outcome: "RETRY_SCHEDULED" },
      { failureClass: null, outcome: "SUCCEEDED" },
    ]);
    await expect(
      database.workEffectReceipt.count({
        where: { workItemId: firstAttempt.claimed.id },
      }),
    ).resolves.toBe(1);
  });

  it("moves a permanently uncorrelated provider event to the existing DLQ without an effect", async () => {
    const address = "phase34-worker-poison@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase34WorkerPoison01",
      "BOUNCED",
      "6",
      recipientHash,
      "email_phase34_worker_poison_receipt",
    );
    const pending = await ingest(verified, RECEIVED_AT);
    let attemptAt = new Date(RECEIVED_AT.getTime() + 200);
    let workItemId: string | null = null;

    try {
      for (
        let attempt = 1;
        attempt <= RESEND_EVENT_PROJECTION_POLICY_V1.maximumAttempts;
        attempt += 1
      ) {
        const execution = await executeProjectionAttempt(
          pending.inboxId,
          `phase34-resend-poison-${attempt}`,
          attemptAt,
        );
        workItemId ??= execution.claimed.id;
        expect(execution.result.completion).toBe(
          attempt === RESEND_EVENT_PROJECTION_POLICY_V1.maximumAttempts
            ? "DEAD_LETTER"
            : "RETRY",
        );
        if (attempt < RESEND_EVENT_PROJECTION_POLICY_V1.maximumAttempts) {
          attemptAt = await database.workItem
            .findUniqueOrThrow({
              where: { id: execution.claimed.id },
              select: { availableAt: true },
            })
            .then(({ availableAt }) => new Date(availableAt.getTime() + 1));
        }
      }
    } finally {
      await database.providerActivation.update({
        where: { id: eventActivationId },
        data: { healthCheckedAt: RECEIVED_AT },
      });
    }

    expect(workItemId).not.toBeNull();
    await expect(
      database.workDeadLetter.findUniqueOrThrow({
        where: { workItemId: workItemId! },
        select: { failureClass: true, reasonCode: true, terminalAttempt: true },
      }),
    ).resolves.toEqual({
      failureClass: "TRANSIENT",
      reasonCode: "EMAIL_PROVIDER_ATTEMPT_PENDING",
      terminalAttempt: 8,
    });
    await expect(
      database.workEffectReceipt.count({ where: { workItemId: workItemId! } }),
    ).resolves.toBe(0);
    await expect(
      database.notificationSuppression.count({ where: { recipientHash } }),
    ).resolves.toBe(0);
    await expect(
      database.emailProviderEventInbox.findUniqueOrThrow({
        where: { id: pending.inboxId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "RECEIVED" });
  });

  it("rejects a cross-environment queue payload before any provider-event effect", async () => {
    const address = "phase34-cross-environment@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase34CrossEnvironment01",
      "BOUNCED",
      "7",
      recipientHash,
      "email_phase34_cross_environment_receipt",
    );
    const pending = await ingest(verified, RECEIVED_AT);
    const wrongEnvironment = Object.freeze({
      ...environment,
      APP_ENV: "preview" as const,
    });
    const denied = await executeProjectionAttempt(
      pending.inboxId,
      "phase34-resend-cross-environment",
      new Date(RECEIVED_AT.getTime() + 300),
      wrongEnvironment,
    );

    expect(denied.result.completion).toBe("DEAD_LETTER");
    await expect(
      database.workDeadLetter.findUniqueOrThrow({
        where: { workItemId: denied.claimed.id },
        select: { failureClass: true, reasonCode: true },
      }),
    ).resolves.toEqual({
      failureClass: "PERMANENT_VALIDATION",
      reasonCode: "EMAIL_PROVIDER_EVENT_BINDING_MISMATCH",
    });
    await expect(
      database.notificationSuppression.count({ where: { recipientHash } }),
    ).resolves.toBe(0);
    await expect(
      database.emailProviderEventInbox.findUniqueOrThrow({
        where: { id: pending.inboxId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "RECEIVED" });
  });

  it("keeps a verified out-of-order webhook pending until the exact delivery attempt is durable", async () => {
    const address = "phase33-ordering@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase33Ordering01",
      "BOUNCED",
      "b",
      recipientHash,
      "email_phase33_ordering_receipt",
    );
    const beforeAttempt = await ingest(verified, RECEIVED_AT);
    expect(beforeAttempt).toMatchObject({
      projectedSuppressions: 0,
      status: "RECEIVED",
    });
    expect(
      await database.notificationSuppression.count({
        where: { recipientHash },
      }),
    ).toBe(0);

    await bindAcceptedDelivery(
      address,
      recipientHash,
      verified.event.providerReceipt,
    );
    await database.$transaction((transaction) =>
      projectPendingResendEventsForReceipt(
        transaction,
        verified.event.providerReceipt,
        new Date(RECEIVED_AT.getTime() + 1_000),
      ),
    );
    expect(
      await database.emailProviderEventInbox.findUniqueOrThrow({
        where: { id: beforeAttempt.inboxId },
        select: { status: true },
      }),
    ).toEqual({ status: "PROJECTED" });
    expect(
      await database.notificationSuppression.count({
        where: { recipientHash, releasedAt: null },
      }),
    ).toBe(1);

    const terminalReplay = await executeProjectionAttempt(
      beforeAttempt.inboxId,
      "phase34-resend-terminal-noop",
      new Date(RECEIVED_AT.getTime() + 2_000),
    );
    expect(terminalReplay.result.completion).toBe("COMPLETED");
    await expect(
      database.notificationSuppression.count({
        where: { recipientHash, releasedAt: null },
      }),
    ).resolves.toBe(1);
    await expect(
      database.workEffectReceipt.count({
        where: { workItemId: terminalReplay.claimed.id },
      }),
    ).resolves.toBe(1);
  });

  it("never lets a foreign receipt or recipient create an application suppression", async () => {
    const address = "phase33-owned@example.ch";
    const ownedHash = hash(address);
    const foreignHash = hash("phase33-foreign@example.ch");
    const unknown = event(
      "msg_phase33Unknown01",
      "BOUNCED",
      "c",
      foreignHash,
      "email_phase33_unknown_receipt",
    );
    const pending = await ingest(unknown, RECEIVED_AT);
    expect(pending.status).toBe("RECEIVED");

    const mismatched = event(
      "msg_phase33Mismatch01",
      "BOUNCED",
      "d",
      foreignHash,
      "email_phase33_owned_receipt",
    );
    await bindAcceptedDelivery(
      address,
      ownedHash,
      mismatched.event.providerReceipt,
    );
    const ignored = await ingest(mismatched, RECEIVED_AT);
    expect(ignored.status).toBe("IGNORED");
    const rotatedDigest = "9".repeat(64);
    await expect(
      ingest(
        Object.freeze({
          ...mismatched,
          payloadDigest: rotatedDigest,
          payloadDigestCandidates: Object.freeze([rotatedDigest]),
        }),
        new Date(RECEIVED_AT.getTime() + 1_000),
      ),
    ).resolves.toMatchObject({
      inboxId: ignored.inboxId,
      projectedSuppressions: 0,
      replay: true,
      status: "IGNORED",
    });
    expect(
      await database.notificationSuppression.count({
        where: { recipientHash: { in: [ownedHash, foreignHash] } },
      }),
    ).toBe(0);
  });

  it("rejects a reused provider event id with different immutable evidence", async () => {
    const address = "phase33-conflict@example.ch";
    const recipientHash = hash(address);
    const original = event(
      "msg_phase33Conflict01",
      "DELIVERED",
      "e",
      recipientHash,
      "email_phase33_conflict_receipt",
    );
    await bindAcceptedDelivery(
      address,
      recipientHash,
      original.event.providerReceipt,
    );
    await ingest(original, RECEIVED_AT);
    await expect(
      ingest(
        event(
          "msg_phase33Conflict01",
          "DELIVERED",
          "f",
          recipientHash,
          "email_phase33_conflict_other_receipt",
        ),
        RECEIVED_AT,
      ),
    ).rejects.toBeInstanceOf(ResendEventInboxConflictError);
  });

  it("rechecks and locks the exact webhook activation inside the ingest transaction", async () => {
    const revokedActivationId = eventActivationId;
    await database.providerActivation.update({
      where: { id: revokedActivationId },
      data: {
        killSwitchEngaged: true,
        revokedAt: RECEIVED_AT,
        revokeReasonCode: "TEST_REVOKED_BEFORE_INGEST",
      },
    });
    const verified = event(
      "msg_phase33RevokedActivation01",
      "DELIVERED",
      "6",
      hash("phase33-revoked-activation@example.ch"),
      "email_phase33_revoked_activation_receipt",
    );

    try {
      await expect(
        ingestVerifiedResendDeliveryWebhook(
          {
            adapterKey: "resend_contract",
            environment: "ci",
            providerActivationId: revokedActivationId,
            receivedAt: RECEIVED_AT,
            verified,
          },
          database,
        ),
      ).rejects.toBeInstanceOf(ResendEventInboxConflictError);
      await expect(
        database.emailProviderEventInbox.count({
          where: { svixId: verified.eventId },
        }),
      ).resolves.toBe(0);
    } finally {
      eventActivationId = await createActivation(
        "email.delivery-events",
        environment,
      );
    }
  });

  it("keeps a RECEIVED replay bound to retained digest and recipient evidence", async () => {
    const recipientHash = hash("phase33-pending-replay@example.ch");
    const original = event(
      "msg_phase33PendingReplay01",
      "DELIVERED",
      "7",
      recipientHash,
      "email_phase33_pending_replay_receipt",
    );
    const first = await ingest(original, RECEIVED_AT);
    expect(first.status).toBe("RECEIVED");

    const rotatedDigest = "8".repeat(64);
    await expect(
      ingest(
        Object.freeze({
          ...original,
          payloadDigest: rotatedDigest,
          payloadDigestCandidates: Object.freeze([rotatedDigest]),
        }),
        new Date(RECEIVED_AT.getTime() + 1_000),
      ),
    ).rejects.toBeInstanceOf(ResendEventInboxConflictError);
    await expect(
      ingest(
        Object.freeze({
          ...original,
          payloadDigest: rotatedDigest,
          payloadDigestCandidates: Object.freeze([
            rotatedDigest,
            original.payloadDigest,
          ]),
          event: Object.freeze({
            ...original.event,
            recipientHashes: Object.freeze([
              hash("phase33-pending-foreign@example.ch"),
            ]),
          }),
        }),
        new Date(RECEIVED_AT.getTime() + 2_000),
      ),
    ).rejects.toBeInstanceOf(ResendEventInboxConflictError);
    await expect(
      ingest(
        Object.freeze({
          ...original,
          payloadDigest: rotatedDigest,
          payloadDigestCandidates: Object.freeze([
            rotatedDigest,
            original.payloadDigest,
          ]),
        }),
        new Date(RECEIVED_AT.getTime() + 3_000),
      ),
    ).resolves.toMatchObject({
      inboxId: first.inboxId,
      replay: true,
      status: "RECEIVED",
    });
  });

  it("does not resurrect a suppression from a bounce older than an explicit release", async () => {
    const address = "phase33-released@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase33Released01",
      "BOUNCED",
      "0",
      recipientHash,
      "email_phase33_released_receipt",
    );
    await bindAcceptedDelivery(
      address,
      recipientHash,
      verified.event.providerReceipt,
    );
    await database.notificationSuppression.create({
      data: {
        recipientHash,
        recipientHashKeyVersion:
          environment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS[0]!
            .version,
        reason: "HARD_BOUNCE",
        source: "operator-reviewed",
        createdAt: new Date("2026-08-01T11:58:00.000Z"),
        releasedAt: new Date("2026-08-01T11:59:30.000Z"),
      },
    });

    await expect(ingest(verified, RECEIVED_AT)).resolves.toMatchObject({
      projectedSuppressions: 0,
      status: "PROJECTED",
    });
    await expect(
      database.notificationSuppression.count({
        where: { recipientHash, releasedAt: null },
      }),
    ).resolves.toBe(0);
  });

  it("persists only the send-time suppression HMAC while retained candidates preserve rotation lookup", async () => {
    const address = "phase33-rotation@example.ch";
    const oldEnvironment = parseEnvironment(
      createValidEnvironment({
        NOTIFICATION_RECIPIENT_HASH_KEYS: `recipient-hash-v1:${keyMaterial(42)}`,
      }),
    );
    const rotatedEnvironment = parseEnvironment(
      createValidEnvironment({
        NOTIFICATION_RECIPIENT_HASH_KEYS:
          `recipient-hash-v2:${keyMaterial(43)},` +
          `recipient-hash-v1:${keyMaterial(42)}`,
      }),
    );
    const oldHash = hashNotificationRecipient(
      address,
      oldEnvironment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    );
    const rotatedHashes = hashNotificationRecipientCandidates(
      address,
      rotatedEnvironment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    );
    const verified = event(
      "msg_phase33Rotation01",
      "BOUNCED",
      "1",
      rotatedHashes,
      "email_phase33_rotation_receipt",
    );
    await bindAcceptedDelivery(
      address,
      oldHash,
      verified.event.providerReceipt,
      oldEnvironment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    );
    const projected = await ingest(verified, RECEIVED_AT);

    expect(projected.projectedSuppressions).toBe(1);
    expect(
      await database.notificationSuppression.findMany({
        where: { recipientHash: { in: [...rotatedHashes] }, releasedAt: null },
        select: { recipientHash: true },
      }),
    ).toEqual([{ recipientHash: oldHash }]);
  });

  it("projects after independent webhook rotation and accepts the same Svix event without replaying its effect", async () => {
    const address = "phase33-webhook-rotation@example.ch";
    const recipientHash = hash(address);
    const verified = event(
      "msg_phase33WebhookRotation01",
      "BOUNCED",
      "2",
      recipientHash,
      "email_phase33_webhook_rotation_receipt",
    );
    await bindAcceptedDelivery(
      address,
      recipientHash,
      verified.event.providerReceipt,
    );
    await rotateEventActivation(
      rotatedWebhookEnvironment(
        "phase33-webhook-rotated-v2",
        "whsec_phase33_contract_webhook_v2",
      ),
    );

    const first = await ingest(verified, RECEIVED_AT);
    expect(first).toMatchObject({
      projectedSuppressions: 1,
      replay: false,
      status: "PROJECTED",
    });
    await rotateEventActivation(
      rotatedWebhookEnvironment(
        "phase33-webhook-rotated-v3",
        "whsec_phase33_contract_webhook_v3",
      ),
    );
    const rotatedDigest = "3".repeat(64);
    const replay = await ingest(
      Object.freeze({
        ...verified,
        payloadDigest: rotatedDigest,
        payloadDigestCandidates: Object.freeze([rotatedDigest]),
      }),
      new Date(RECEIVED_AT.getTime() + 1_000),
    );
    expect(replay).toMatchObject({
      inboxId: first.inboxId,
      projectedSuppressions: 0,
      replay: true,
      status: "PROJECTED",
    });
    await expect(
      database.notificationSuppression.count({
        where: { recipientHash, releasedAt: null },
      }),
    ).resolves.toBe(1);

    const conflictingDigest = "4".repeat(64);
    await expect(
      ingest(
        Object.freeze({
          ...verified,
          payloadDigest: conflictingDigest,
          payloadDigestCandidates: Object.freeze([conflictingDigest]),
          event: Object.freeze({
            ...verified.event,
            occurredAt: new Date(verified.event.occurredAt.getTime() + 1_000),
          }),
        }),
        new Date(RECEIVED_AT.getTime() + 2_000),
      ),
    ).rejects.toBeInstanceOf(ResendEventInboxConflictError);
    await expect(
      database.emailProviderEventInbox.count({
        where: {
          adapterKey: "resend_contract",
          environment: "ci",
          svixId: verified.eventId,
        },
      }),
    ).resolves.toBe(1);
  });

  function hash(address: string) {
    return hashNotificationRecipient(
      address,
      environment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    );
  }

  async function createActivation(
    useCase: "email.transactional" | "email.delivery-events",
    activationEnvironment: ServerEnvironment,
  ) {
    const binding = emailProviderActivationBinding(
      activationEnvironment,
      useCase,
    );
    if (binding === null) throw new Error("TEST_EMAIL_BINDING_MISSING");
    const activation = await database.providerActivation.create({
      data: {
        environment: activationEnvironment.APP_ENV,
        useCase,
        adapterKey: binding.adapterKey,
        adapterVersion: binding.adapterVersion,
        mode: binding.expectedMode,
        configurationDigest: binding.expectedConfigurationDigest,
        secretVersionRef: binding.expectedSecretVersionRef,
        region: "local-test",
        dpaRef: "dpa:phase33:test",
        contractRef: "contract:phase33:test",
        approvalRef: "approval:phase33:test",
        evidenceDigest: "a".repeat(64),
        owner: "Phase 33 Test",
        runbookRef: "codex-plan/runbooks/provider-activation.md",
        health: "HEALTHY",
        healthCheckedAt: RECEIVED_AT,
        quotaUnits: 10_000,
        sustainableCapacity: 10_000,
        unitCostMicros: 0n,
        unitCostSource: "phase33-test-fixture",
        killSwitchEngaged: false,
        effectiveAt: RECEIVED_AT,
      },
      select: { id: true },
    });
    return activation.id;
  }

  async function rotateEventActivation(
    activationEnvironment: ServerEnvironment,
  ) {
    await database.providerActivation.update({
      where: { id: eventActivationId },
      data: {
        killSwitchEngaged: true,
        revokedAt: RECEIVED_AT,
        revokeReasonCode: "WEBHOOK_SECRET_ROTATED",
      },
    });
    eventActivationId = await createActivation(
      "email.delivery-events",
      activationEnvironment,
    );
  }

  function rotatedWebhookEnvironment(
    secretVersion: string,
    webhookSecret: string,
  ) {
    return parseEnvironment(
      createValidEnvironment({
        APP_ENV: "ci",
        NODE_ENV: "production",
        DATABASE_URL: migrated.connectionString,
        TEST_DATABASE_URL:
          "postgresql://phase33:phase33@127.0.0.1:6543/phase33_test?schema=public",
        EMAIL_PROVIDER_MODE: "resend_contract",
        EMAIL_PROVIDER_CONTRACT_ENDPOINT:
          "http://provider-contract:8080/resend/emails",
        EMAIL_PROVIDER_API_KEY: "re_phase33_contract_key",
        EMAIL_FROM: "SwissTalentHub <notifications@example.ch>",
        NOTIFICATION_OUTBOX_PRODUCERS: "true",
        NOTIFICATION_DISPATCH: "command",
        NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(41)}`,
        NOTIFICATION_RECIPIENT_HASH_KEYS: `recipient-hash-v1:${keyMaterial(44)}`,
        RESEND_SECRET_VERSION: "phase33-email-contract-v1",
        RESEND_WEBHOOK_SECRET: webhookSecret,
        RESEND_WEBHOOK_SECRET_VERSION: secretVersion,
      }),
    );
  }

  async function bindAcceptedDelivery(
    address: string,
    recipientHash: string,
    providerReceipt: string,
    recipientHashKeyring = environment.secrets.keyrings
      .NOTIFICATION_RECIPIENT_HASH_KEYS,
  ) {
    const keyring = environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS;
    const id = randomUUID();
    const recipientExpiresAt = new Date(
      RECEIVED_AT.getTime() + 23 * 60 * 60_000,
    );
    const recipient = encryptNotificationRecipient(address, keyring, {
      bindingVersion: "v2",
      dedupeKey: `phase33-resend:${id}`,
      outboxId: id,
      retentionUntil: recipientExpiresAt.toISOString(),
      templateKey: "login_email_changed_notice",
    });
    const request = encryptNotificationProviderRequest(
      {
        idempotencyKey: `notify:${id}`,
        subject: "Provider receipt correlation",
        templateData: {},
        templateKey: "login_email_changed_notice",
        text: "Bound delivery",
        timeoutMilliseconds: 10_000,
        to: address,
      },
      keyring,
      {
        outboxId: id,
        providerActivationId: sendActivationId,
        providerDedupeKey: `notify:${id}`,
        templateKey: "login_email_changed_notice",
      },
    );
    await database.notificationOutbox.create({
      data: {
        id,
        recipientAddressCiphertext: Buffer.from(recipient.ciphertext),
        recipientAddressNonce: Buffer.from(recipient.nonce),
        recipientAddressTag: Buffer.from(recipient.authTag),
        recipientAddressKeyVersion: recipient.keyVersion,
        recipientAddressBindingVersion: "v2",
        recipientAddressDigest: recipientHash,
        recipientAddressDigestKeyVersion: recipientHashKeyring[0]!.version,
        recipientAddressExpiresAt: recipientExpiresAt,
        purpose: "LOGIN_EMAIL_CHANGED_NOTICE",
        purposeClass: "MANDATORY",
        channel: "EMAIL",
        templateKey: "login_email_changed_notice",
        payloadSchemaVersion: "identity-v1",
        payload: {},
        dedupeKey: `phase33-resend:${id}`,
        providerDedupeKey: `notify:${id}`,
        providerRequestActivationId: sendActivationId,
        providerRequestCiphertext: Buffer.from(request.ciphertext),
        providerRequestCreatedAt: RECEIVED_AT,
        providerRequestDigest: request.digest,
        providerRequestKeyVersion: request.keyVersion,
        providerRequestNonce: Buffer.from(request.nonce),
        providerRequestTag: Buffer.from(request.authTag),
        status: "DELIVERED",
        availableAt: RECEIVED_AT,
        attemptCount: 1,
        maxAttempts: 5,
        deliveredAt: RECEIVED_AT,
        createdAt: RECEIVED_AT,
        updatedAt: RECEIVED_AT,
        attempts: {
          create: {
            attemptNumber: 1,
            leaseOwner: "phase33-email-test",
            leaseExpiresAt: new Date(RECEIVED_AT.getTime() + 60_000),
            providerClass: "resend-contract-v1",
            providerActivationId: sendActivationId,
            providerRequestDigest: request.digest,
            recipientHash,
            recipientHashKeyVersion: recipientHashKeyring[0]!.version,
            recipientEvidenceRetainUntil:
              notificationAttemptEvidenceRetainUntil(RECEIVED_AT),
            outcome: "ACCEPTED",
            providerReceipt,
            startedAt: RECEIVED_AT,
            completedAt: RECEIVED_AT,
            createdAt: RECEIVED_AT,
          },
        },
      },
    });
  }

  async function executeProjectionAttempt(
    inboxId: string,
    workerId: string,
    at: Date,
    runtimeEnvironment: ServerEnvironment = environment,
  ): Promise<
    Readonly<{
      claimed: ClaimedWorkItem;
      identity: WorkLeaseIdentity;
      result: Awaited<ReturnType<typeof executeRegisteredHandler>>;
    }>
  > {
    if (runtimeEnvironment.APP_ENV === environment.APP_ENV) {
      await database.providerActivation.update({
        where: { id: eventActivationId },
        data: { health: "HEALTHY", healthCheckedAt: at },
      });
    }
    const run = await createWorkerRun(database, {
      deploymentDigest: DEPLOYMENT_DIGEST,
      environment: "ci",
      now: at,
      runtimeVersion: "v1",
      workerId,
    });
    const [claimed] = await claimWorkBatch(database, {
      deploymentDigest: DEPLOYMENT_DIGEST,
      handlerKey: RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey,
      handlerVersion: RESEND_EVENT_PROJECTION_POLICY_V1.handlerVersion,
      now: at,
      payloadVersion: RESEND_EVENT_PROJECTION_POLICY_V1.payloadVersion,
      policy: {
        activationGeneration: handlerActivation.generation,
        activationId: handlerActivation.id,
        batchSize: 1,
        heartbeatMilliseconds: 5_000,
        leaseMilliseconds: 15_000,
      },
      workerId,
      workerRunId: run.id,
    });
    if (claimed === undefined || claimed.subjectId !== inboxId) {
      throw new Error("TEST_RESEND_EVENT_WORK_ITEM_NOT_CLAIMED");
    }
    const identity = Object.freeze({
      deploymentDigest: DEPLOYMENT_DIGEST,
      fencingToken: claimed.fencingToken,
      workerId,
      workerRunId: run.id,
      workItemId: claimed.id,
    });
    const result = await executeRegisteredHandler(claimed, {
      database,
      environment: runtimeEnvironment,
      identity,
      heartbeatMilliseconds: 5_000,
      leaseMilliseconds: 15_000,
      now: () => new Date(at.getTime() + 100),
    });
    return Object.freeze({ claimed, identity, result });
  }

  function ingest(verified: VerifiedResendDeliveryWebhook, receivedAt: Date) {
    return ingestVerifiedResendDeliveryWebhook(
      {
        adapterKey: "resend_contract",
        environment: "ci",
        providerActivationId: eventActivationId,
        receivedAt,
        verified,
      },
      database,
    );
  }
});

function event(
  eventId: string,
  kind: "BOUNCED" | "SUPPRESSED" | "DELIVERED",
  digestSeed: string,
  recipientHash: string | readonly string[],
  providerReceipt: string,
): VerifiedResendDeliveryWebhook {
  return Object.freeze({
    eventId,
    payloadDigest: digestSeed.padEnd(64, digestSeed).slice(0, 64),
    payloadDigestCandidates: Object.freeze([
      digestSeed.padEnd(64, digestSeed).slice(0, 64),
    ]),
    event: Object.freeze({
      kind,
      providerReceipt,
      occurredAt: new Date("2026-08-01T11:59:00.000Z"),
      recipientHashes: Object.freeze(
        typeof recipientHash === "string"
          ? [recipientHash]
          : [...recipientHash],
      ),
    }),
  });
}
