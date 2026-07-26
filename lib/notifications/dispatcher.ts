import "server-only";

import { createHash } from "node:crypto";

import { createPasswordResetToken } from "@/lib/auth/password-reset-token";
import { createCompanyInvitationToken } from "@/lib/auth/invitation-token";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type {
  NotificationDeliveryOutcome,
  NotificationOutbox,
} from "@/lib/generated/prisma/client";
import {
  decryptNotificationRecipient,
} from "@/lib/notifications/delivery-material";
import {
  hashNotificationRecipient,
} from "@/lib/notifications/outbox";
import {
  resolveNotificationSendDecision,
} from "@/lib/notifications/purpose-policy";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
} from "@/lib/providers/email/email-delivery-provider";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import { normalizedEmailSchema } from "@/lib/validation/common";

import { createVerificationToken } from "../auth/verification-token";

const LEASE_MILLISECONDS = 60_000;
const HEARTBEAT_MILLISECONDS = 20_000;
const PROVIDER_TIMEOUT_MILLISECONDS = 10_000;
const MAXIMUM_BATCH_SIZE = 100;
const RETRY_DELAYS_MILLISECONDS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
] as const;

type ClaimedOutbox = Pick<
  NotificationOutbox,
  | "id"
  | "recipientUserId"
  | "recipientAddressCiphertext"
  | "recipientAddressNonce"
  | "recipientAddressTag"
  | "recipientAddressKeyVersion"
  | "purpose"
  | "purposeClass"
  | "templateKey"
  | "payloadSchemaVersion"
  | "payload"
  | "providerDedupeKey"
  | "attemptCount"
  | "maxAttempts"
  | "leaseExpiresAt"
>;

export type DispatchBatchResult = Readonly<{
  status: "PAUSED" | "COMPLETED";
  claimed: number;
  delivered: number;
  retried: number;
  suppressed: number;
  deadLettered: number;
  paused: number;
}>;

export async function dispatchNotificationBatch(
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    provider: EmailDeliveryProvider;
    workerId: string;
    batchSize?: number;
    clock?: () => Date;
  }>,
): Promise<DispatchBatchResult> {
  if (dependencies.environment.NOTIFICATION_DISPATCH !== "command") {
    return emptyResult("PAUSED");
  }
  const batchSize = dependencies.batchSize ?? 25;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAXIMUM_BATCH_SIZE ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(dependencies.workerId)
  ) {
    throw new Error("NOTIFICATION_DISPATCH_COMMAND_INVALID");
  }
  const clock = dependencies.clock ?? (() => new Date());
  const claimed = await claimBatch(
    dependencies.database,
    dependencies.workerId,
    batchSize,
    clock(),
  );
  const counts = {
    delivered: 0,
    retried: 0,
    suppressed: 0,
    deadLettered: 0,
    paused: 0,
  };
  let lastBatchHeartbeatAt = clock();
  for (const [index, outbox] of claimed.entries()) {
    const heartbeatAt = clock();
    if (
      heartbeatAt.getTime() - lastBatchHeartbeatAt.getTime() >=
      HEARTBEAT_MILLISECONDS
    ) {
      await heartbeatRemainingLeases(
        dependencies.database,
        claimed.slice(index).map(({ id }) => id),
        dependencies.workerId,
        heartbeatAt,
      );
      lastBatchHeartbeatAt = heartbeatAt;
    }
    const result = await deliverClaim(outbox, {
      ...dependencies,
      clock,
    });
    counts[result] += 1;
  }
  return Object.freeze({
    status: "COMPLETED",
    claimed: claimed.length,
    ...counts,
  });
}

async function claimBatch(
  database: DatabaseClient,
  workerId: string,
  batchSize: number,
  now: Date,
) {
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MILLISECONDS);
  return database.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
        FROM "NotificationOutbox"
       WHERE (
              ("status" IN ('PENDING', 'RETRY')
               AND "availableAt" <= ${now})
              OR
              ("status" = 'LEASED'
               AND "leaseExpiresAt" <= ${now})
             )
       ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT ${batchSize}
    `;
    const ids = candidates.map(({ id }) => id);
    if (ids.length === 0) return [];
    await transaction.notificationOutbox.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "LEASED",
        leaseOwner: workerId,
        leaseExpiresAt,
      },
    });
    return transaction.notificationOutbox.findMany({
      where: { id: { in: ids } },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        recipientUserId: true,
        recipientAddressCiphertext: true,
        recipientAddressNonce: true,
        recipientAddressTag: true,
        recipientAddressKeyVersion: true,
        purpose: true,
        purposeClass: true,
        templateKey: true,
        payloadSchemaVersion: true,
        payload: true,
        providerDedupeKey: true,
        attemptCount: true,
        maxAttempts: true,
        leaseExpiresAt: true,
      },
    });
  });
}

async function deliverClaim(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    provider: EmailDeliveryProvider;
    workerId: string;
    clock: () => Date;
  }>,
): Promise<
  "delivered" | "retried" | "suppressed" | "deadLettered" | "paused"
> {
  const startedAt = dependencies.clock();
  let recipientHash: string | undefined;
  await heartbeatLease(
    dependencies.database,
    outbox.id,
    dependencies.workerId,
    startedAt,
  );
  try {
    const to = await resolveRecipient(outbox, dependencies);
    recipientHash = hashNotificationRecipient(to);
    const suppression =
      await dependencies.database.notificationSuppression.findFirst({
        where: { recipientHash, releasedAt: null },
        select: { id: true },
      });
    if (suppression !== null) {
      throw new EmailDeliveryFailure("SUPPRESSED", "ACTIVE_SUPPRESSION");
    }
    if (outbox.recipientUserId !== null) {
      const preference =
        await dependencies.database.notificationPreference.findUnique({
          where: {
            userId_purpose_channel: {
              userId: outbox.recipientUserId,
              purpose: outbox.purpose,
              channel: "EMAIL",
            },
          },
          select: { enabled: true },
        });
      const decision = resolveNotificationSendDecision({
        purpose: outbox.purpose,
        preferenceEnabled: preference?.enabled,
        optionalEmailEnabled: dependencies.environment.OPTIONAL_EMAIL,
      });
      if (decision !== "SEND") {
        throw new EmailDeliveryFailure(
          "SUPPRESSED",
          decision === "REJECT_UNKNOWN"
            ? "PURPOSE_UNKNOWN"
            : "OPTIONAL_PREFERENCE",
        );
      }
    }
    const hydrated = await hydrateTemplate(outbox, {
      ...dependencies,
      resolvedRecipient: to,
    });
    const rendered = renderEmailTemplate(
      hydrated.templateKey,
      hydrated.data,
    );
    const receipt = await deliverWithDeadline(
      dependencies.provider,
      {
        to,
        templateKey: hydrated.templateKey,
        subject: rendered.subject,
        text: rendered.body,
        templateData: hydrated.data,
        idempotencyKey: outbox.providerDedupeKey,
        timeoutMilliseconds: PROVIDER_TIMEOUT_MILLISECONDS,
      },
      PROVIDER_TIMEOUT_MILLISECONDS,
    );
    return finalizeAttempt(outbox, dependencies, {
      outcome: "ACCEPTED",
      providerReceipt: receipt.providerReceipt,
      recipientHash,
      completedAt: dependencies.clock(),
    });
  } catch (error) {
    const failure =
      error instanceof EmailDeliveryFailure
        ? error
        : new EmailDeliveryFailure("PERMANENT", "POISON_PAYLOAD");
    return finalizeAttempt(outbox, dependencies, {
      outcome: outcomeForFailure(failure),
      errorCode: failure.code,
      recipientHash,
      completedAt: dependencies.clock(),
    });
  }
}

async function resolveRecipient(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
  }>,
) {
  if (outbox.recipientUserId !== null) {
    const user = await dependencies.database.user.findUnique({
      where: { id: outbox.recipientUserId },
      select: { emailNormalized: true, status: true },
    });
    if (user === null || user.status !== "ACTIVE") {
      throw new EmailDeliveryFailure("PERMANENT", "RECIPIENT_UNAVAILABLE");
    }
    return user.emailNormalized;
  }
  if (
    outbox.recipientAddressCiphertext === null ||
    outbox.recipientAddressNonce === null ||
    outbox.recipientAddressTag === null ||
    outbox.recipientAddressKeyVersion === null
  ) {
    throw new EmailDeliveryFailure("PERMANENT", "RECIPIENT_ENVELOPE_MISSING");
  }
  let decrypted: string;
  try {
    decrypted = decryptNotificationRecipient(
      {
        ciphertext: Uint8Array.from(outbox.recipientAddressCiphertext),
        nonce: Uint8Array.from(outbox.recipientAddressNonce),
        authTag: Uint8Array.from(outbox.recipientAddressTag),
        keyVersion: outbox.recipientAddressKeyVersion,
      },
      dependencies.environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
    );
  } catch {
    throw new EmailDeliveryFailure(
      "CONFIGURATION",
      "RECIPIENT_DECRYPT_FAILED",
    );
  }
  const normalized = normalizedEmailSchema.safeParse(decrypted);
  if (!normalized.success) {
    throw new EmailDeliveryFailure("PERMANENT", "RECIPIENT_INVALID");
  }
  return normalized.data;
}

async function hydrateTemplate(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    clock: () => Date;
    resolvedRecipient: string;
  }>,
): Promise<Readonly<{
  templateKey: EmailTemplateKey;
  data: Readonly<Record<string, unknown>>;
}>> {
  if (!isEmailTemplateKey(outbox.templateKey)) {
    throw new EmailDeliveryFailure("PERMANENT", "TEMPLATE_UNKNOWN");
  }
  if (
    outbox.payloadSchemaVersion === "identity-v1" &&
    (outbox.templateKey === "identity_verification" ||
      outbox.templateKey === "login_email_change_verification")
  ) {
    const challengeId = readUuid(outbox.payload, "challengeId");
    if (challengeId === undefined) {
      throw new EmailDeliveryFailure("PERMANENT", "PAYLOAD_INVALID");
    }
    const challenge =
      await dependencies.database.emailVerificationChallenge.findUnique({
        where: { id: challengeId },
        select: {
          id: true,
          purpose: true,
          addressEpoch: true,
          expiresAt: true,
          usedAt: true,
          supersededAt: true,
        },
      });
    if (
      challenge === null ||
      challenge.usedAt !== null ||
      challenge.supersededAt !== null ||
      challenge.expiresAt.getTime() <= dependencies.clock().getTime()
    ) {
      throw new EmailDeliveryFailure("SUPPRESSED", "CHALLENGE_TERMINAL");
    }
    const rawToken = createVerificationToken(
      challenge.id,
      challenge.purpose,
      challenge.addressEpoch,
      dependencies.environment.secrets.session,
    );
    const verificationUrl = new URL(
      "/verify-email",
      dependencies.environment.APP_URL,
    );
    verificationUrl.hash = new URLSearchParams({ token: rawToken }).toString();
    return Object.freeze({
      templateKey: outbox.templateKey,
      data: Object.freeze({
        verificationUrl: verificationUrl.toString(),
        expiresInMinutes: 30,
      }),
    });
  }
  if (
    outbox.payloadSchemaVersion === "password-reset-v2" &&
    outbox.templateKey === "password_reset_mock"
  ) {
    const resetId = readUuid(outbox.payload, "resetId");
    if (resetId === undefined || outbox.recipientUserId === null) {
      throw new EmailDeliveryFailure("PERMANENT", "PAYLOAD_INVALID");
    }
    const reset = await dependencies.database.passwordResetToken.findUnique({
      where: { id: resetId },
      select: {
        userId: true,
        tokenHash: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (
      reset === null ||
      reset.userId !== outbox.recipientUserId ||
      reset.usedAt !== null ||
      reset.expiresAt.getTime() <= dependencies.clock().getTime()
    ) {
      throw new EmailDeliveryFailure("SUPPRESSED", "RESET_TOKEN_TERMINAL");
    }
    const rawToken = createPasswordResetToken(
      resetId,
      dependencies.environment.secrets.session,
    );
    if (
      createHash("sha256").update(rawToken, "utf8").digest("hex") !==
      reset.tokenHash
    ) {
      throw new EmailDeliveryFailure("PERMANENT", "RESET_TOKEN_MISMATCH");
    }
    const resetUrl = new URL(
      "/reset-password",
      dependencies.environment.APP_URL,
    );
    resetUrl.hash = new URLSearchParams({ token: rawToken }).toString();
    return Object.freeze({
      templateKey: outbox.templateKey,
      data: Object.freeze({
        resetUrl: resetUrl.toString(),
        expiresInMinutes: 15,
      }),
    });
  }
  if (
    outbox.payloadSchemaVersion === "company-invitation-v2" &&
    outbox.templateKey === "company_invitation"
  ) {
    const invitationId = readUuid(outbox.payload, "invitationId");
    const invitationVersion = readPositiveInteger(
      outbox.payload,
      "invitationVersion",
    );
    if (
      invitationId === undefined ||
      invitationVersion === undefined ||
      outbox.recipientUserId !== null
    ) {
      throw new EmailDeliveryFailure("PERMANENT", "PAYLOAD_INVALID");
    }
    const invitation =
      await dependencies.database.companyInvitation.findUnique({
        where: { id: invitationId },
        select: {
          inviteeEmailNormalized: true,
          tokenHash: true,
          tokenVersion: true,
          status: true,
          expiresAt: true,
          company: { select: { name: true, status: true } },
          inviter: { select: { name: true } },
        },
      });
    if (
      invitation === null ||
      invitation.status !== "PENDING" ||
      invitation.company.status !== "ACTIVE" ||
      invitation.expiresAt.getTime() <= dependencies.clock().getTime() ||
      invitation.tokenVersion !== invitationVersion ||
      invitation.inviteeEmailNormalized !== dependencies.resolvedRecipient
    ) {
      throw new EmailDeliveryFailure("SUPPRESSED", "INVITATION_TERMINAL");
    }
    const rawToken = createCompanyInvitationToken(
      invitationId,
      invitationVersion,
      dependencies.environment.secrets.session,
    );
    if (
      createHash("sha256").update(rawToken, "utf8").digest("hex") !==
      invitation.tokenHash
    ) {
      throw new EmailDeliveryFailure("PERMANENT", "INVITATION_TOKEN_MISMATCH");
    }
    return Object.freeze({
      templateKey: outbox.templateKey,
      data: Object.freeze({
        companyName: invitation.company.name,
        inviterName: invitation.inviter.name ?? "Ein Teammitglied",
        invitationUrl: `${dependencies.environment.APP_URL}/invite/${rawToken}`,
        invitationVersion: `${invitationId}:${invitationVersion}`,
      }),
    });
  }
  if (
    outbox.payloadSchemaVersion === "identity-v1" &&
    outbox.templateKey === "login_email_changed_notice"
  ) {
    return Object.freeze({
      templateKey: outbox.templateKey,
      data: Object.freeze({}),
    });
  }
  if (
    outbox.payload === null ||
    Array.isArray(outbox.payload) ||
    typeof outbox.payload !== "object"
  ) {
    throw new EmailDeliveryFailure("PERMANENT", "PAYLOAD_INVALID");
  }
  return Object.freeze({
    templateKey: outbox.templateKey,
    data: Object.freeze({ ...outbox.payload }),
  });
}

async function finalizeAttempt(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    provider: EmailDeliveryProvider;
    workerId: string;
  }>,
  completion: Readonly<{
    outcome: NotificationDeliveryOutcome;
    providerReceipt?: string;
    errorCode?: string;
    recipientHash?: string;
    completedAt: Date;
  }>,
): Promise<
  "delivered" | "retried" | "suppressed" | "deadLettered" | "paused"
> {
  const attemptNumber = outbox.attemptCount + 1;
  const transient =
    completion.outcome === "TRANSIENT_FAILURE" ||
    completion.outcome === "TIMED_OUT";
  const retryAt = transient
    ? new Date(
        completion.completedAt.getTime() +
          retryDelay(attemptNumber),
      )
    : undefined;
  const finalStatus =
    completion.outcome === "ACCEPTED"
      ? "DELIVERED"
      : completion.outcome === "SUPPRESSED" ||
          completion.outcome === "BOUNCED"
        ? "SUPPRESSED"
        : completion.outcome === "CONFIGURATION_ERROR"
          ? "PAUSED"
          : transient && attemptNumber < outbox.maxAttempts
            ? "RETRY"
            : "DEAD_LETTER";

  await dependencies.database.$transaction(async (transaction) => {
    const updated = await transaction.notificationOutbox.updateMany({
      where: {
        id: outbox.id,
        status: "LEASED",
        leaseOwner: dependencies.workerId,
      },
      data: {
        status: finalStatus,
        attemptCount: attemptNumber,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: completion.errorCode ?? null,
        ...(finalStatus === "DELIVERED"
          ? { deliveredAt: completion.completedAt }
          : {}),
        ...(finalStatus === "SUPPRESSED"
          ? { suppressedAt: completion.completedAt }
          : {}),
        ...(finalStatus === "DEAD_LETTER"
          ? { deadLetteredAt: completion.completedAt }
          : {}),
        ...(finalStatus === "RETRY" && retryAt !== undefined
          ? { availableAt: retryAt }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new Error("NOTIFICATION_LEASE_LOST");
    }
    await transaction.notificationDeliveryAttempt.create({
      data: {
        outboxId: outbox.id,
        attemptNumber,
        leaseOwner: dependencies.workerId,
        leaseExpiresAt:
          outbox.leaseExpiresAt ??
          new Date(completion.completedAt.getTime() + LEASE_MILLISECONDS),
        providerClass: dependencies.provider.providerClass,
        outcome: completion.outcome,
        providerReceipt: completion.providerReceipt,
        errorCode: completion.errorCode,
        nextAvailableAt: finalStatus === "RETRY" ? retryAt : undefined,
        startedAt: new Date(
          Math.min(
            completion.completedAt.getTime(),
            (outbox.leaseExpiresAt?.getTime() ??
              completion.completedAt.getTime() + LEASE_MILLISECONDS) -
              LEASE_MILLISECONDS,
          ),
        ),
        completedAt: completion.completedAt,
      },
      select: { id: true },
    });
    if (
      completion.outcome === "BOUNCED" &&
      completion.recipientHash !== undefined
    ) {
      const existing = await transaction.notificationSuppression.findFirst({
        where: {
          recipientHash: completion.recipientHash,
          releasedAt: null,
        },
        select: { id: true },
      });
      if (existing === null) {
        await transaction.notificationSuppression.create({
          data: {
            recipientHash: completion.recipientHash,
            reason: "HARD_BOUNCE",
            source: dependencies.provider.providerClass,
            createdAt: completion.completedAt,
          },
          select: { id: true },
        });
      }
    }
  });
  switch (finalStatus) {
    case "DELIVERED":
      return "delivered";
    case "RETRY":
      return "retried";
    case "SUPPRESSED":
      return "suppressed";
    case "DEAD_LETTER":
      return "deadLettered";
    case "PAUSED":
      return "paused";
  }
}

async function heartbeatLease(
  database: DatabaseClient,
  outboxId: string,
  workerId: string,
  now: Date,
) {
  const updated = await database.notificationOutbox.updateMany({
    where: { id: outboxId, status: "LEASED", leaseOwner: workerId },
    data: {
      leaseExpiresAt: new Date(now.getTime() + LEASE_MILLISECONDS),
    },
  });
  if (updated.count !== 1) {
    throw new Error("NOTIFICATION_LEASE_LOST");
  }
}

async function heartbeatRemainingLeases(
  database: DatabaseClient,
  outboxIds: readonly string[],
  workerId: string,
  now: Date,
) {
  if (outboxIds.length === 0) return;
  const updated = await database.notificationOutbox.updateMany({
    where: {
      id: { in: [...outboxIds] },
      status: "LEASED",
      leaseOwner: workerId,
    },
    data: {
      leaseExpiresAt: new Date(now.getTime() + LEASE_MILLISECONDS),
    },
  });
  if (updated.count !== outboxIds.length) {
    throw new Error("NOTIFICATION_LEASE_LOST");
  }
}

async function deliverWithDeadline(
  provider: EmailDeliveryProvider,
  input: Parameters<EmailDeliveryProvider["deliver"]>[0],
  timeoutMilliseconds: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.deliver(input),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new EmailDeliveryFailure("TIMEOUT", "PROVIDER_TIMEOUT"),
            ),
          timeoutMilliseconds,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function outcomeForFailure(
  failure: EmailDeliveryFailure,
): NotificationDeliveryOutcome {
  switch (failure.kind) {
    case "TRANSIENT":
      return "TRANSIENT_FAILURE";
    case "PERMANENT":
      return "PERMANENT_FAILURE";
    case "BOUNCE":
      return "BOUNCED";
    case "SUPPRESSED":
      return "SUPPRESSED";
    case "TIMEOUT":
      return "TIMED_OUT";
    case "CONFIGURATION":
      return "CONFIGURATION_ERROR";
  }
}

function retryDelay(attemptNumber: number) {
  return (
    RETRY_DELAYS_MILLISECONDS[
      Math.min(
        attemptNumber - 1,
        RETRY_DELAYS_MILLISECONDS.length - 1,
      )
    ] ?? RETRY_DELAYS_MILLISECONDS.at(-1)!
  );
}

function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return EMAIL_TEMPLATE_KEYS.includes(value as EmailTemplateKey);
}

function readUuid(payload: unknown, key: string) {
  if (
    payload === null ||
    Array.isArray(payload) ||
    typeof payload !== "object"
  ) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
    ? value
    : undefined;
}

function readPositiveInteger(payload: unknown, key: string) {
  if (
    payload === null ||
    Array.isArray(payload) ||
    typeof payload !== "object"
  ) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function emptyResult(status: "PAUSED"): DispatchBatchResult {
  return Object.freeze({
    status,
    claimed: 0,
    delivered: 0,
    retried: 0,
    suppressed: 0,
    deadLettered: 0,
    paused: 0,
  });
}
