import "server-only";

import { randomUUID } from "node:crypto";

import {
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
  type AdminCommandResult,
} from "@/lib/admin/common";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  decryptNotificationRecipient,
  encryptNotificationRecipient,
} from "@/lib/notifications/delivery-material";
import {
  notificationProviderDedupeKey,
  notificationRecipientHashEvidence,
} from "@/lib/notifications/outbox";
import { destroyedNotificationRecipientMaterial } from "@/lib/notifications/retention";

const SANDBOX_CONFIRMATION = "PHASE20_LOCAL_SANDBOX_REPLAY";

/**
 * Requeues exactly one dead-lettered notification in the isolated local
 * sandbox. Capability and activation checks intentionally happen before the
 * outbox row is read, so Support cannot use this function as a payload/status
 * oracle. Production remains blocked until Phase 25 supplies a real step-up
 * grant.
 */
export async function replayDeadLetterNotification(
  input: Readonly<{
    outboxId: string;
    reasonCode: string;
    sandboxConfirmation: string;
  }>,
  dependencies: AdminDependencies &
    Readonly<{ environment: ServerEnvironment }>,
): Promise<
  AdminCommandResult<
    Readonly<{
      outboxId: string;
      predecessorOutboxId: string;
      nextAttempt: number;
    }>
  >
> {
  if (!(await requireCapability(dependencies, "ADMIN_SYSTEM_TASK_MANAGE"))) {
    return adminFailure("FORBIDDEN");
  }
  if (
    !dependencies.environment.DELIVERY_REPLAY ||
    dependencies.environment.APP_ENV !== "local" ||
    dependencies.environment.EMAIL_PROVIDER_MODE !== "local_mock" ||
    input.sandboxConfirmation !== SANDBOX_CONFIRMATION
  ) {
    return adminFailure("RESTRICTED");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.outboxId,
    ) ||
    !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.reasonCode)
  ) {
    return adminFailure("INVALID_INPUT");
  }
  const now = adminNow(dependencies.now);
  try {
    const result = await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<
          Array<{
            id: string;
            status: string;
            attemptCount: number;
            maxAttempts: number;
          }>
        >`
          SELECT "id", "status"::text, "attemptCount", "maxAttempts"
            FROM "NotificationOutbox"
           WHERE "id" = ${input.outboxId}::uuid
           FOR UPDATE
        `;
        const outbox = locked[0];
        if (outbox === undefined) return "NOT_FOUND" as const;
        if (outbox.status !== "DEAD_LETTER" || outbox.attemptCount >= 20) {
          return "CONFLICT" as const;
        }
        const predecessor =
          await transaction.notificationOutbox.findUniqueOrThrow({
            where: { id: outbox.id },
            select: {
              recipientUserId: true,
              recipientAddressCiphertext: true,
              recipientAddressNonce: true,
              recipientAddressTag: true,
              recipientAddressKeyVersion: true,
              recipientAddressBindingVersion: true,
              recipientAddressDestroyedAt: true,
              recipientAddressExpiresAt: true,
              purpose: true,
              purposeClass: true,
              channel: true,
              templateKey: true,
              payloadSchemaVersion: true,
              payload: true,
              dedupeKey: true,
              maxAttempts: true,
            },
          });
        const replayDedupeKey = `phase20-replay:${outbox.id}:${outbox.attemptCount + 1}`;
        const existingSuccessor =
          await transaction.notificationOutbox.findUnique({
            where: { dedupeKey: replayDedupeKey },
            select: { id: true },
          });
        if (existingSuccessor !== null) return "CONFLICT" as const;
        const successorId = randomUUID();
        let recipient:
          | Readonly<{ recipientUserId: string }>
          | Readonly<{
              recipientAddressBindingVersion: "v2";
              recipientAddressCiphertext: Uint8Array<ArrayBuffer>;
              recipientAddressDigest: string;
              recipientAddressDigestKeyVersion: string;
              recipientAddressExpiresAt: Date;
              recipientAddressKeyVersion: string;
              recipientAddressNonce: Uint8Array<ArrayBuffer>;
              recipientAddressTag: Uint8Array<ArrayBuffer>;
            }>;
        if (predecessor.recipientUserId !== null) {
          recipient = Object.freeze({
            recipientUserId: predecessor.recipientUserId,
          });
        } else {
          if (
            predecessor.recipientAddressDestroyedAt !== null ||
            predecessor.recipientAddressCiphertext === null ||
            predecessor.recipientAddressNonce === null ||
            predecessor.recipientAddressTag === null ||
            predecessor.recipientAddressKeyVersion === null ||
            predecessor.recipientAddressExpiresAt === null ||
            predecessor.recipientAddressExpiresAt.getTime() <= now.getTime()
          ) {
            return "CONFLICT" as const;
          }
          let normalizedAddress: string;
          try {
            normalizedAddress = decryptNotificationRecipient(
              {
                ciphertext: Uint8Array.from(
                  predecessor.recipientAddressCiphertext,
                ),
                nonce: Uint8Array.from(predecessor.recipientAddressNonce),
                authTag: Uint8Array.from(predecessor.recipientAddressTag),
                keyVersion: predecessor.recipientAddressKeyVersion,
              },
              dependencies.environment.secrets.keyrings
                .NOTIFICATION_DELIVERY_KEYS,
              predecessor.recipientAddressBindingVersion === "v2"
                ? {
                    bindingVersion: "v2",
                    dedupeKey: predecessor.dedupeKey,
                    outboxId: outbox.id,
                    retentionUntil:
                      predecessor.recipientAddressExpiresAt.toISOString(),
                    templateKey: predecessor.templateKey,
                  }
                : undefined,
            );
          } catch {
            return "CONFLICT" as const;
          }
          const keyring =
            dependencies.environment.secrets.keyrings
              .NOTIFICATION_DELIVERY_KEYS;
          const encrypted = encryptNotificationRecipient(
            normalizedAddress,
            keyring,
            {
              bindingVersion: "v2",
              dedupeKey: replayDedupeKey,
              outboxId: successorId,
              retentionUntil:
                predecessor.recipientAddressExpiresAt.toISOString(),
              templateKey: predecessor.templateKey,
            },
          );
          const hashEvidence = notificationRecipientHashEvidence(
            normalizedAddress,
            dependencies.environment.secrets.keyrings
              .NOTIFICATION_RECIPIENT_HASH_KEYS,
          );
          recipient = Object.freeze({
            recipientAddressBindingVersion: "v2" as const,
            recipientAddressCiphertext: Uint8Array.from(encrypted.ciphertext),
            recipientAddressDigest: hashEvidence.hash,
            recipientAddressDigestKeyVersion: hashEvidence.keyVersion,
            recipientAddressExpiresAt: predecessor.recipientAddressExpiresAt,
            recipientAddressKeyVersion: encrypted.keyVersion,
            recipientAddressNonce: Uint8Array.from(encrypted.nonce),
            recipientAddressTag: Uint8Array.from(encrypted.authTag),
          });
        }
        const successor = await transaction.notificationOutbox.create({
          data: {
            id: successorId,
            ...recipient,
            purpose: predecessor.purpose,
            purposeClass: predecessor.purposeClass,
            channel: predecessor.channel,
            templateKey: predecessor.templateKey,
            payloadSchemaVersion: predecessor.payloadSchemaVersion,
            payload: predecessor.payload as Prisma.InputJsonValue,
            dedupeKey: replayDedupeKey,
            providerDedupeKey: notificationProviderDedupeKey(replayDedupeKey),
            status: "PENDING",
            availableAt: now,
            maxAttempts: Math.max(outbox.maxAttempts, 1),
          },
          select: { id: true },
        });
        if (predecessor.recipientUserId === null) {
          await transaction.notificationOutbox.update({
            where: { id: outbox.id },
            data: destroyedNotificationRecipientMaterial(now),
            select: { id: true },
          });
        }
        await writeAdminAudit(transaction, dependencies, now, {
          action: "NOTIFICATION_DELIVERY_REPLAYED",
          capability: "ADMIN_SYSTEM_TASK_MANAGE",
          targetType: "SYSTEM_TASK",
          targetId: outbox.id,
          reasonCode: input.reasonCode,
        });
        return Object.freeze({
          outboxId: successor.id,
          predecessorOutboxId: outbox.id,
          nextAttempt: 1,
        });
      },
    );
    if (result === "NOT_FOUND") return adminFailure("NOT_FOUND");
    if (result === "CONFLICT") return adminFailure("CONFLICT");
    return adminSuccess(result);
  } catch {
    return adminFailure("WRITE_FAILED");
  }
}

export const PHASE20_SANDBOX_REPLAY_CONFIRMATION = SANDBOX_CONFIRMATION;
