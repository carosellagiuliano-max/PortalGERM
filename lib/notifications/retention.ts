import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import { expireStaleResendEventRecipients } from "@/lib/providers/email/resend-event-inbox";

export const NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS =
  23 * 60 * 60_000;
export const NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS =
  400 * 24 * 60 * 60_000;

export function notificationRecipientMaterialExpiresAt(availableAt: Date) {
  return new Date(
    availableAt.getTime() +
      NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS,
  );
}

export function notificationAttemptEvidenceRetainUntil(completedAt: Date) {
  return new Date(
    completedAt.getTime() +
      NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS,
  );
}

/**
 * Provider-independent privacy maintenance. It must remain schedulable while
 * every delivery provider is revoked: provider downtime may never extend the
 * lifetime of rendered tokens, explicit recipient addresses, message content,
 * or webhook recipient hashes.
 */
export async function maintainNotificationPrivacyRetention(
  database: DatabaseClient,
  now: Date,
) {
  const expiredBefore = new Date(
    now.getTime() - NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS,
  );
  const outbox = await database.$transaction(async (transaction) => {
    // Keep the immutable delivery timeline but remove all correlatable
    // recipient/provider evidence after exactly 400 x 24 hours. Locking both
    // the attempt and its outbox row with SKIP LOCKED makes this safe against
    // a concurrent dispatcher claim: an in-flight/live lease is never wiped.
    const compactedAttempts = await transaction.$queryRaw<
      Array<{ id: string }>
    >`
      WITH eligible AS MATERIALIZED (
        SELECT attempt."id"
        FROM "NotificationDeliveryAttempt" AS attempt
        INNER JOIN "NotificationOutbox" AS outbox
          ON outbox."id" = attempt."outboxId"
        WHERE attempt."recipientEvidenceWipedAt" IS NULL
          AND attempt."recipientEvidenceRetainUntil" <= ${now}
          AND attempt."recipientEvidenceRetainUntil" <= CURRENT_TIMESTAMP
          AND (
            outbox."status" <> 'LEASED'
            OR outbox."leaseExpiresAt" <= ${now}
          )
        FOR UPDATE OF attempt, outbox SKIP LOCKED
      )
      UPDATE "NotificationDeliveryAttempt" AS attempt
      SET "providerReceipt" = NULL,
          "providerRequestDigest" = NULL,
          "recipientHash" = NULL,
          "recipientHashKeyVersion" = NULL,
          "recipientEvidenceWipedAt" = date_trunc('milliseconds', CURRENT_TIMESTAMP)
      FROM eligible
      WHERE attempt."id" = eligible."id"
        AND attempt."recipientEvidenceWipedAt" IS NULL
      RETURNING attempt."id"
    `;

    const terminalRequests = await transaction.notificationOutbox.updateMany({
      where: {
        providerRequestActivationId: { not: null },
        providerRequestCiphertext: { not: null },
        providerRequestDestroyedAt: null,
        status: { in: ["DELIVERED", "SUPPRESSED", "DEAD_LETTER"] },
      },
      data: destroyedProviderRequestMaterial(now),
    });

    const terminalRecipients = await transaction.notificationOutbox.updateMany({
      where: {
        recipientUserId: null,
        recipientAddressCiphertext: { not: null },
        recipientAddressDestroyedAt: null,
        status: { in: ["DELIVERED", "SUPPRESSED", "DEAD_LETTER"] },
      },
      data: destroyedNotificationRecipientMaterial(now),
    });
    // One predicate-checked UPDATE closes the lease-reclaim race. PostgreSQL
    // rechecks this WHERE clause after any row-lock wait, so a dispatcher that
    // has renewed the lease cannot have its material stolen mid-provider I/O.
    const expired = await transaction.$queryRaw<
      Array<{
        id: string;
        lastErrorCode:
          | "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED"
          | "RECIPIENT_MATERIAL_RETENTION_EXPIRED";
        status: "PAUSED" | "SUPPRESSED";
      }>
    >`
      UPDATE "NotificationOutbox"
         SET "providerRequestCiphertext" = CASE
               WHEN (
                 (
                   "providerRequestActivationId" IS NOT NULL
                   AND "providerRequestCiphertext" IS NOT NULL
                   AND "providerRequestDestroyedAt" IS NULL
                   AND "providerRequestCreatedAt" <= ${expiredBefore}
                 )
                 OR (
                   "recipientUserId" IS NULL
                   AND "recipientAddressCiphertext" IS NOT NULL
                   AND "recipientAddressDestroyedAt" IS NULL
                   AND "recipientAddressExpiresAt" <= ${now}
                 )
               ) THEN NULL
               ELSE "providerRequestCiphertext"
             END,
             "providerRequestNonce" = CASE
               WHEN (
                 (
                   "providerRequestActivationId" IS NOT NULL
                   AND "providerRequestCiphertext" IS NOT NULL
                   AND "providerRequestDestroyedAt" IS NULL
                   AND "providerRequestCreatedAt" <= ${expiredBefore}
                 )
                 OR (
                   "recipientUserId" IS NULL
                   AND "recipientAddressCiphertext" IS NOT NULL
                   AND "recipientAddressDestroyedAt" IS NULL
                   AND "recipientAddressExpiresAt" <= ${now}
                 )
               ) THEN NULL
               ELSE "providerRequestNonce"
             END,
             "providerRequestTag" = CASE
               WHEN (
                 (
                   "providerRequestActivationId" IS NOT NULL
                   AND "providerRequestCiphertext" IS NOT NULL
                   AND "providerRequestDestroyedAt" IS NULL
                   AND "providerRequestCreatedAt" <= ${expiredBefore}
                 )
                 OR (
                   "recipientUserId" IS NULL
                   AND "recipientAddressCiphertext" IS NOT NULL
                   AND "recipientAddressDestroyedAt" IS NULL
                   AND "recipientAddressExpiresAt" <= ${now}
                 )
               ) THEN NULL
               ELSE "providerRequestTag"
             END,
             "providerRequestDestroyedAt" = CASE
               WHEN "providerRequestActivationId" IS NOT NULL
                AND "providerRequestCiphertext" IS NOT NULL
                AND "providerRequestDestroyedAt" IS NULL
                AND (
                  "providerRequestCreatedAt" <= ${expiredBefore}
                  OR (
                    "recipientUserId" IS NULL
                    AND "recipientAddressCiphertext" IS NOT NULL
                    AND "recipientAddressDestroyedAt" IS NULL
                    AND "recipientAddressExpiresAt" <= ${now}
                  )
                ) THEN ${now}
               ELSE "providerRequestDestroyedAt"
             END,
             "recipientAddressCiphertext" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressCiphertext" END,
             "recipientAddressNonce" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressNonce" END,
             "recipientAddressTag" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressTag" END,
             "recipientAddressKeyVersion" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressKeyVersion" END,
             "recipientAddressBindingVersion" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressBindingVersion" END,
             "recipientAddressDigest" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressDigest" END,
             "recipientAddressDigestKeyVersion" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN NULL ELSE "recipientAddressDigestKeyVersion" END,
             "recipientAddressDestroyedAt" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
               THEN ${now} ELSE "recipientAddressDestroyedAt" END,
             "status" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
                AND "providerRequestActivationId" IS NULL
               THEN 'SUPPRESSED'::"NotificationDeliveryStatus"
               ELSE 'PAUSED'::"NotificationDeliveryStatus"
             END,
             "suppressedAt" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
                AND "providerRequestActivationId" IS NULL
               THEN ${now} ELSE "suppressedAt" END,
             "availableAt" = ${now},
             "leaseOwner" = NULL,
             "leaseExpiresAt" = NULL,
             "lastErrorCode" = CASE
               WHEN "recipientUserId" IS NULL
                AND "recipientAddressCiphertext" IS NOT NULL
                AND "recipientAddressDestroyedAt" IS NULL
                AND "recipientAddressExpiresAt" <= ${now}
                AND "providerRequestActivationId" IS NULL
               THEN 'RECIPIENT_MATERIAL_RETENTION_EXPIRED'
               ELSE 'PROVIDER_OUTCOME_RECONCILIATION_REQUIRED'
             END,
             "updatedAt" = ${now}
       WHERE "status" IN ('PENDING', 'RETRY', 'PAUSED', 'LEASED')
         AND ("status" <> 'LEASED' OR "leaseExpiresAt" <= ${now})
         AND (
           (
             "providerRequestActivationId" IS NOT NULL
             AND "providerRequestCiphertext" IS NOT NULL
             AND "providerRequestDestroyedAt" IS NULL
             AND "providerRequestCreatedAt" <= ${expiredBefore}
           )
           OR (
             "recipientUserId" IS NULL
             AND "recipientAddressCiphertext" IS NOT NULL
             AND "recipientAddressDestroyedAt" IS NULL
             AND "recipientAddressExpiresAt" <= ${now}
           )
         )
       RETURNING "id", "status"::text, "lastErrorCode"
    `;
    const deadProviderRecipientIds = expired
      .filter(
        ({ lastErrorCode }) =>
          lastErrorCode === "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
      )
      .map(({ id }) => id);
    const deadProviderRecipients =
      deadProviderRecipientIds.length === 0
        ? { count: 0 }
        : await transaction.notificationOutbox.updateMany({
            where: {
              id: { in: deadProviderRecipientIds },
              recipientUserId: null,
              recipientAddressCiphertext: { not: null },
              recipientAddressDestroyedAt: null,
              status: "PAUSED",
            },
            data: destroyedNotificationRecipientMaterial(now),
          });

    return Object.freeze({
      attemptEvidenceWiped: compactedAttempts.length,
      pausedIds: expired.filter(({ status }) => status === "PAUSED").length,
      suppressedRecipients: expired.filter(
        ({ status }) => status === "SUPPRESSED",
      ).length,
      terminalRecipientsWiped:
        terminalRecipients.count + deadProviderRecipients.count,
      terminalRequestsWiped: terminalRequests.count,
    });
  });
  const staleEventsWiped = await expireStaleResendEventRecipients(
    database,
    now,
  );
  return Object.freeze({
    attemptEvidenceWiped: outbox.attemptEvidenceWiped,
    pausedRequests: outbox.pausedIds,
    staleEventsWiped,
    suppressedRecipients: outbox.suppressedRecipients,
    terminalRecipientsWiped: outbox.terminalRecipientsWiped,
    terminalRequestsWiped: outbox.terminalRequestsWiped,
  });
}

export function destroyedNotificationRecipientMaterial(now: Date) {
  return Object.freeze({
    recipientAddressCiphertext: null,
    recipientAddressNonce: null,
    recipientAddressTag: null,
    recipientAddressKeyVersion: null,
    recipientAddressBindingVersion: null,
    recipientAddressDigest: null,
    recipientAddressDigestKeyVersion: null,
    recipientAddressDestroyedAt: now,
  });
}

function destroyedProviderRequestMaterial(now: Date) {
  return Object.freeze({
    providerRequestCiphertext: null,
    providerRequestNonce: null,
    providerRequestTag: null,
    providerRequestDestroyedAt: now,
  });
}
