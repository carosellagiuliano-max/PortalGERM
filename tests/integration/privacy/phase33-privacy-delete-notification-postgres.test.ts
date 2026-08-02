import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { decryptNotificationRecipient } from "@/lib/notifications/delivery-material";
import { maintainNotificationPrivacyRetention } from "@/lib/notifications/retention";
import { runPrivacyExecutionV2 } from "@/lib/privacy/execution-v2";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import {
  createMemoryDocumentStore,
  createPhase22Harness,
  PHASE22_NOW,
  privacyExecutionCommand,
  seedActiveInventory,
  seedPhase22Actors,
  seedPrivacyRequest,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase33_privacy_delete_notification");
  actors = await seedPhase22Actors(harness.client, "phase33-delete-notice");
  const legal = await seedPublishedPrivacyNotice(
    harness.client,
    actors,
    "phase33-delete-notice",
  );
  await seedActiveInventory(harness.client, "phase33-delete-notice", [
    "postgres-primary",
  ]);
  await seedProcessingApproval(harness.client, legal.publication.id, {
    processorKey: "postgres-primary",
    scope: "PRIVACY_ERASURE",
    suffix: "phase33-delete-notice",
  });
}, 600_000);

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-33 privacy erasure notification durability", () => {
  it("persists failure delivery and stages encrypted success before account anonymization", async () => {
    const { client, users } = requireFixture();
    const originalEmail = users.requester.email;
    await client.candidateProfile.create({
      data: {
        firstName: "Phase 33 delete",
        publicDisplayName: "Phase 33 delete candidate",
        userId: users.requester.id,
      },
    });
    const request = await seedPrivacyRequest(client, users, "DELETE");
    const command = privacyExecutionCommand(request.id, users);
    const keyrings = parseEnvironment(createValidEnvironment()).secrets
      .keyrings;
    const dependencies = {
      cohortAllowed: true,
      correctionEnabled: false,
      database: client,
      documentStore: createMemoryDocumentStore(),
      erasureEnabled: true,
      notificationDeliveryKeyring: keyrings.NOTIFICATION_DELIVERY_KEYS,
      notificationRecipientHashKeyring:
        keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
      now: PHASE22_NOW,
      processingMode: "sandbox_command" as const,
    };

    const failed = await runPrivacyExecutionV2(command, {
      ...dependencies,
      injectProcessorFailure: (processorKey, attempt) =>
        processorKey === "postgres-primary" && attempt === 1
          ? "RETRYABLE"
          : null,
    });
    expect(failed).toMatchObject({ ok: false, code: "RETRY_REQUIRED" });
    if (failed.ok || failed.executionId === undefined) {
      throw new Error("Expected a resumable erasure failure.");
    }
    await expect(
      client.user.findUniqueOrThrow({ where: { id: users.requester.id } }),
    ).resolves.toMatchObject({ email: originalEmail, status: "ACTIVE" });
    await expect(
      client.notificationOutbox.findFirstOrThrow({
        where: {
          dedupeKey: `privacy-execution:${failed.executionId}:postgres-primary:retry:email`,
        },
        select: {
          recipientAddressCiphertext: true,
          recipientUserId: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      recipientAddressCiphertext: null,
      recipientUserId: users.requester.id,
      status: "PENDING",
    });

    await maintainNotificationPrivacyRetention(
      client,
      new Date(PHASE22_NOW.getTime() + 24 * 60 * 60_000),
    );
    await expect(
      client.notificationOutbox.count({
        where: {
          dedupeKey: { startsWith: `privacy-execution:${failed.executionId}:` },
          recipientAddressCiphertext: { not: null },
          recipientAddressDestroyedAt: null,
        },
      }),
    ).resolves.toBe(0);

    const resumed = await runPrivacyExecutionV2(command, dependencies);
    expect(resumed).toMatchObject({
      executionId: failed.executionId,
      ok: true,
      replay: true,
      status: "COMPLETED",
    });
    const account = await client.user.findUniqueOrThrow({
      where: { id: users.requester.id },
    });
    expect(account.status).toBe("SUSPENDED");
    expect(account.email).not.toBe(originalEmail);

    const [success, supersededRetry, unusedFailure] = await Promise.all([
      client.notificationOutbox.findUniqueOrThrow({
        where: {
          dedupeKey: `privacy-execution:${failed.executionId}:completed-email`,
        },
      }),
      client.notificationOutbox.findUniqueOrThrow({
        where: {
          dedupeKey: `privacy-execution:${failed.executionId}:postgres-primary:retry:email`,
        },
      }),
      client.notificationOutbox.findUniqueOrThrow({
        where: {
          dedupeKey: `privacy-execution:${failed.executionId}:erasure-retry-email`,
        },
      }),
    ]);
    expect(success).toMatchObject({
      availableAt: PHASE22_NOW,
      recipientUserId: null,
      status: "PENDING",
    });
    expect(success.recipientAddressCiphertext).not.toBeNull();
    expect(success.recipientAddressNonce).not.toBeNull();
    expect(success.recipientAddressTag).not.toBeNull();
    expect(success.recipientAddressKeyVersion).not.toBeNull();
    expect(
      decryptNotificationRecipient(
        {
          authTag: Uint8Array.from(success.recipientAddressTag!),
          ciphertext: Uint8Array.from(success.recipientAddressCiphertext!),
          keyVersion: success.recipientAddressKeyVersion!,
          nonce: Uint8Array.from(success.recipientAddressNonce!),
        },
        keyrings.NOTIFICATION_DELIVERY_KEYS,
        {
          bindingVersion: "v2",
          dedupeKey: success.dedupeKey,
          outboxId: success.id,
          retentionUntil: success.recipientAddressExpiresAt!.toISOString(),
          templateKey: success.templateKey,
        },
      ),
    ).toBe(originalEmail);
    expect(unusedFailure).toMatchObject({
      recipientUserId: null,
      status: "SUPPRESSED",
      suppressedAt: PHASE22_NOW,
    });
    expect(unusedFailure).toMatchObject({
      recipientAddressCiphertext: null,
      recipientAddressDigest: null,
      recipientAddressDestroyedAt: PHASE22_NOW,
    });
    expect(supersededRetry).toMatchObject({
      status: "SUPPRESSED",
      suppressedAt: PHASE22_NOW,
    });
    await expect(
      client.notificationOutbox.count({
        where: {
          dedupeKey: {
            in: [
              `privacy-execution:${failed.executionId}:completed-email`,
              `privacy-execution:${failed.executionId}:erasure-retry-email`,
            ],
          },
        },
      }),
    ).resolves.toBe(2);
  }, 120_000);

  it("recovers each staged-erasure crash boundary exactly once without persisting plaintext recipient PII", async () => {
    const { client } = requireFixture();
    const users = await seedPhase22Actors(client, "phase33-delete-crash-chain");
    const originalEmail = users.requester.email;
    await client.candidateProfile.create({
      data: {
        firstName: "Crash boundary PII",
        lastName: "Must disappear",
        publicDisplayName: "Crash boundary candidate",
        phone: "+41 79 000 00 00",
        userId: users.requester.id,
      },
    });
    const request = await seedPrivacyRequest(client, users, "DELETE");
    const command = privacyExecutionCommand(request.id, users);
    const keyrings = parseEnvironment(createValidEnvironment()).secrets
      .keyrings;
    const dependencies = {
      cohortAllowed: true,
      correctionEnabled: false,
      database: client,
      documentStore: createMemoryDocumentStore(),
      erasureEnabled: true,
      notificationDeliveryKeyring: keyrings.NOTIFICATION_DELIVERY_KEYS,
      notificationRecipientHashKeyring:
        keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
      now: PHASE22_NOW,
      processingMode: "sandbox_command" as const,
    };
    const crashStages = [
      "ERASURE_NOTIFICATION_STAGED",
      "ERASURE_POSTGRES_ANONYMIZED",
      "ERASURE_PROCESSOR_OUTCOME_COMMITTED",
      "ERASURE_EXECUTION_COMPLETED",
    ] as const;

    for (const stage of crashStages) {
      await expect(
        runPrivacyExecutionV2(command, {
          ...dependencies,
          injectCrashAfterStage: (candidate) => candidate === stage,
        }),
      ).rejects.toThrow(stage);
      if (stage === "ERASURE_NOTIFICATION_STAGED") {
        await expect(
          client.notificationOutbox.count({
            where: {
              dedupeKey: {
                startsWith: "privacy-execution:",
              },
              payload: { path: ["requestId"], equals: request.id },
            },
          }),
        ).resolves.toBe(0);
        await expect(
          client.user.findUniqueOrThrow({ where: { id: users.requester.id } }),
        ).resolves.toMatchObject({ email: originalEmail, status: "ACTIVE" });
      }
    }

    await expect(
      runPrivacyExecutionV2(command, dependencies),
    ).resolves.toMatchObject({ ok: true, replay: true, status: "COMPLETED" });

    const execution = await client.privacyExecution.findUniqueOrThrow({
      where: {
        privacyRequestId_kind: {
          kind: "ERASURE",
          privacyRequestId: request.id,
        },
      },
      include: {
        processorOutcomes: true,
        erasureProofs: true,
      },
    });
    expect(execution.status).toBe("COMPLETED");
    expect(execution.processorOutcomes).toHaveLength(1);
    expect(execution.processorOutcomes[0]).toMatchObject({
      attemptCount: 3,
      processorKey: "postgres-primary",
      status: "SUCCEEDED",
    });
    expect(
      new Set(execution.erasureProofs.map(({ entityKey }) => entityKey)).size,
    ).toBe(execution.erasureProofs.length);
    await expect(
      client.notificationOutbox.count({
        where: {
          dedupeKey: {
            in: [
              `privacy-execution:${execution.id}:completed-email`,
              `privacy-execution:${execution.id}:erasure-retry-email`,
            ],
          },
        },
      }),
    ).resolves.toBe(2);
    await expect(
      client.privacyRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: "COMPLETED", version: request.version + 1 });

    const persistedEvidence = await Promise.all([
      client.privacyRequest.findUniqueOrThrow({ where: { id: request.id } }),
      client.privacyRequestEvent.findMany({
        where: { privacyRequestId: request.id },
      }),
      client.privacyProcessorOutcome.findMany({
        where: { privacyExecutionId: execution.id },
      }),
      client.erasureProof.findMany({
        where: { privacyExecutionId: execution.id },
      }),
      client.privacyTombstone.findMany({
        where: { subjectReferenceHash: execution.subjectReferenceHash },
      }),
      client.notificationOutbox.findMany({
        where: {
          dedupeKey: { startsWith: `privacy-execution:${execution.id}:` },
        },
      }),
      client.auditLog.findMany({ where: { targetId: execution.id } }),
    ]);
    expect(JSON.stringify(persistedEvidence)).not.toContain(originalEmail);
    await expect(
      client.user.findUniqueOrThrow({
        where: { id: users.requester.id },
        select: {
          email: true,
          name: true,
          status: true,
          candidateProfile: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              publicDisplayName: true,
            },
          },
        },
      }),
    ).resolves.toEqual({
      email: expect.not.stringContaining(originalEmail),
      name: null,
      status: "SUSPENDED",
      candidateProfile: {
        firstName: null,
        lastName: null,
        phone: null,
        publicDisplayName: null,
      },
    });
  }, 180_000);

  it("completes erasure and records omission when a staged address expires before the retention sweep", async () => {
    const { client } = requireFixture();
    const users = await seedPhase22Actors(
      client,
      "phase33-delete-expired-recipient",
    );
    await client.candidateProfile.create({
      data: {
        firstName: "Expired delivery recipient",
        publicDisplayName: "Expired delivery recipient",
        userId: users.requester.id,
      },
    });
    const seededRequest = await seedPrivacyRequest(client, users, "DELETE");
    const dueAt = new Date(Date.now() + 60 * 60_000);
    const request = await client.privacyRequest.update({
      where: { id: seededRequest.id },
      data: { dueAt },
    });
    const command = privacyExecutionCommand(request.id, users);
    const keyrings = parseEnvironment(createValidEnvironment()).secrets
      .keyrings;
    const baseDependencies = {
      cohortAllowed: true,
      correctionEnabled: false,
      database: client,
      documentStore: createMemoryDocumentStore(),
      erasureEnabled: true,
      notificationDeliveryKeyring: keyrings.NOTIFICATION_DELIVERY_KEYS,
      notificationRecipientHashKeyring:
        keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
      processingMode: "sandbox_command" as const,
    };
    await expect(
      runPrivacyExecutionV2(command, {
        ...baseDependencies,
        now: PHASE22_NOW,
        injectCrashAfterStage: (stage) =>
          stage === "ERASURE_POSTGRES_ANONYMIZED",
      }),
    ).rejects.toThrow("ERASURE_POSTGRES_ANONYMIZED");
    const execution = await client.privacyExecution.findUniqueOrThrow({
      where: {
        privacyRequestId_kind: {
          kind: "ERASURE",
          privacyRequestId: request.id,
        },
      },
      select: { id: true },
    });
    const retentionUntil = new Date(dueAt.getTime() + 23 * 60 * 60_000);
    await expect(
      client.notificationOutbox.findUniqueOrThrow({
        where: {
          dedupeKey: `privacy-execution:${execution.id}:completed-email`,
        },
        select: { recipientAddressExpiresAt: true, status: true },
      }),
    ).resolves.toEqual({
      recipientAddressExpiresAt: retentionUntil,
      status: "PENDING",
    });

    const completedAt = new Date(retentionUntil.getTime() + 1);
    await expect(
      runPrivacyExecutionV2(command, {
        ...baseDependencies,
        now: completedAt,
      }),
    ).resolves.toMatchObject({
      executionId: execution.id,
      ok: true,
      replay: true,
      status: "COMPLETED",
    });
    await expect(
      client.notificationOutbox.findUniqueOrThrow({
        where: {
          dedupeKey: `privacy-execution:${execution.id}:completed-email`,
        },
        select: {
          lastErrorCode: true,
          recipientAddressCiphertext: true,
          recipientAddressDestroyedAt: true,
          status: true,
          suppressedAt: true,
        },
      }),
    ).resolves.toEqual({
      lastErrorCode: "RECIPIENT_MATERIAL_RETENTION_EXPIRED",
      recipientAddressCiphertext: null,
      recipientAddressDestroyedAt: completedAt,
      status: "SUPPRESSED",
      suppressedAt: completedAt,
    });
    await expect(
      client.privacyRequestEvent.count({
        where: {
          privacyRequestId: request.id,
          reasonCode: "DELIVERY_OMITTED_RETENTION_EXPIRED",
        },
      }),
    ).resolves.toBe(1);
  }, 180_000);
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-33 erasure notification fixture unavailable.");
  }
  return Object.freeze({ client: harness.client, users: actors });
}
