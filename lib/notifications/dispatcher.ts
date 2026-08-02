import "server-only";

import { createHash } from "node:crypto";

import { createPasswordResetToken } from "@/lib/auth/password-reset-token";
import { createCompanyInvitationToken } from "@/lib/auth/invitation-token";
import {
  JOB_ALERT_DELIVERY_NOTICE_V2,
  JOB_ALERT_POLICY_V1,
  deriveJobAlertUnsubscribeToken,
  hashJobAlertUnsubscribeToken,
  jobAlertConsentNoticeHash,
} from "@/lib/candidate/job-alert-policy";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type {
  NotificationDeliveryOutcome,
  NotificationOutbox,
} from "@/lib/generated/prisma/client";
import { decryptNotificationRecipient } from "@/lib/notifications/delivery-material";
import {
  hashNotificationRecipientCandidates,
  legacyV1NotificationRecipientHashForRead,
  notificationRecipientHashEvidence,
} from "@/lib/notifications/outbox";
import {
  decryptNotificationProviderRequest,
  encryptNotificationProviderRequest,
  type FrozenEmailDeliveryRequest,
} from "@/lib/notifications/provider-request-material";
import {
  policyForTemplate,
  providerUseCaseForTemplate,
  resolveNotificationSendDecision,
} from "@/lib/notifications/purpose-policy";
import {
  destroyedNotificationRecipientMaterial,
  maintainNotificationPrivacyRetention,
  notificationAttemptEvidenceRetainUntil,
  NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS,
} from "@/lib/notifications/retention";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { projectPendingResendEventsForReceipt } from "@/lib/providers/email/resend-event-inbox";
import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
} from "@/lib/providers/email/email-delivery-provider";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import { normalizedEmailSchema } from "@/lib/validation/common";

import {
  createVerificationToken,
  hashVerificationTarget,
  hashVerificationToken,
} from "../auth/verification-token";

const LEASE_MILLISECONDS = 60_000;
const HEARTBEAT_MILLISECONDS = 20_000;
const PROVIDER_TIMEOUT_MILLISECONDS = 10_000;
const PROVIDER_ACTIVATION_RECHECK_MILLISECONDS = 60_000;
// Resend retains idempotency keys for 24 hours. Stop one hour earlier so
// downtime/clock skew cannot turn an ambiguous retry into a duplicate send.
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
  | "recipientAddressBindingVersion"
  | "recipientAddressDestroyedAt"
  | "recipientAddressExpiresAt"
  | "dedupeKey"
  | "purpose"
  | "purposeClass"
  | "templateKey"
  | "payloadSchemaVersion"
  | "payload"
  | "providerDedupeKey"
  | "providerRequestActivationId"
  | "providerRequestCiphertext"
  | "providerRequestCreatedAt"
  | "providerRequestDestroyedAt"
  | "providerRequestDigest"
  | "providerRequestKeyVersion"
  | "providerRequestNonce"
  | "providerRequestTag"
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
  const sweepAt = clock();
  const retention = await maintainNotificationPrivacyRetention(
    dependencies.database,
    sweepAt,
  );
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
    paused: retention.pausedRequests,
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

function destroyedProviderRequestMaterial(now: Date) {
  return Object.freeze({
    providerRequestCiphertext: null,
    providerRequestNonce: null,
    providerRequestTag: null,
    providerRequestDestroyedAt: now,
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
       WHERE "providerRequestDestroyedAt" IS NULL
         AND "recipientAddressDestroyedAt" IS NULL
         AND (
           "recipientUserId" IS NOT NULL
           OR "recipientAddressExpiresAt" > ${now}
         )
         AND (
              ("status" IN ('PENDING', 'RETRY')
               AND "availableAt" <= ${now})
              OR
              ("status" = 'LEASED'
               AND "leaseExpiresAt" <= ${now})
              OR
              ("status" = 'PAUSED'
               AND "lastErrorCode" LIKE 'PROVIDER_ACTIVATION_%'
               AND "availableAt" <= ${now})
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
        recipientAddressBindingVersion: true,
        recipientAddressDestroyedAt: true,
        recipientAddressExpiresAt: true,
        purpose: true,
        purposeClass: true,
        templateKey: true,
        payloadSchemaVersion: true,
        payload: true,
        dedupeKey: true,
        providerDedupeKey: true,
        providerRequestActivationId: true,
        providerRequestCiphertext: true,
        providerRequestCreatedAt: true,
        providerRequestDestroyedAt: true,
        providerRequestDigest: true,
        providerRequestKeyVersion: true,
        providerRequestNonce: true,
        providerRequestTag: true,
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
): Promise<"delivered" | "retried" | "suppressed" | "deadLettered" | "paused"> {
  const startedAt = dependencies.clock();
  let recipientHash: string | undefined;
  let recipientHashKeyVersion: string | undefined;
  let providerActivationId: string | undefined;
  let providerRequestDigest: string | undefined;
  await heartbeatLease(
    dependencies.database,
    outbox.id,
    dependencies.workerId,
    startedAt,
  );
  try {
    const existingRequest = decryptFrozenProviderRequest(
      outbox,
      dependencies.environment,
    );
    // A frozen provider request fixes bytes/idempotency, not authority. Every
    // retry rechecks the current recipient/account state and template-specific
    // terminal conditions before the exact same provider effect may run.
    const currentRecipient = await resolveRecipient(outbox, dependencies);
    if (
      existingRequest !== null &&
      outbox.recipientUserId !== null &&
      currentRecipient !== existingRequest.request.to
    ) {
      throw new EmailDeliveryFailure(
        "SUPPRESSED",
        "RECIPIENT_CHANGED_AFTER_FREEZE",
      );
    }
    const to = existingRequest?.request.to ?? currentRecipient;
    const recipientKeyring =
      dependencies.environment.secrets.keyrings
        .NOTIFICATION_RECIPIENT_HASH_KEYS;
    const recipientEvidence = notificationRecipientHashEvidence(
      to,
      recipientKeyring,
    );
    recipientHash = recipientEvidence.hash;
    recipientHashKeyVersion = recipientEvidence.keyVersion;
    const recipientHashes = [
      ...hashNotificationRecipientCandidates(to, recipientKeyring),
      legacyV1NotificationRecipientHashForRead(to),
    ];
    const suppression =
      await dependencies.database.notificationSuppression.findFirst({
        where: {
          recipientHash: { in: [...recipientHashes] },
          releasedAt: null,
        },
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
    if (existingRequest !== null) {
      await hydrateTemplate(outbox, {
        ...dependencies,
        resolvedRecipient: existingRequest.request.to,
      });
    }
    const draftRequest =
      existingRequest?.request ??
      (await buildProviderRequest(outbox, to, dependencies));
    const activation = await requireExactProviderActivation(
      outbox,
      draftRequest.templateKey,
      {
        database: dependencies.database,
        environment: dependencies.environment,
        now: dependencies.clock(),
      },
    );
    if (
      existingRequest !== null &&
      existingRequest.activationId !== activation.activationId
    ) {
      throw new NotificationProviderOutcomeReconciliationRequired(
        "FROZEN_REQUEST_ACTIVATION_CHANGED_RECONCILIATION_REQUIRED",
      );
    }
    const frozen =
      existingRequest ??
      (await persistFrozenProviderRequest(
        outbox,
        draftRequest,
        activation.activationId,
        dependencies,
      ));
    providerActivationId = frozen.activationId;
    providerRequestDigest = frozen.digest;
    if (
      existingRequest !== null &&
      startedAt.getTime() - frozen.createdAt.getTime() >=
        NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS
    ) {
      throw new NotificationProviderOutcomeReconciliationRequired();
    }
    const sendActivation = await requireExactProviderActivation(
      outbox,
      draftRequest.templateKey,
      {
        database: dependencies.database,
        environment: dependencies.environment,
        now: dependencies.clock(),
      },
    );
    if (sendActivation.activationId !== frozen.activationId) {
      throw new NotificationProviderOutcomeReconciliationRequired(
        "FROZEN_REQUEST_ACTIVATION_CHANGED_RECONCILIATION_REQUIRED",
      );
    }
    assertRecipientRetentionCurrent(outbox, dependencies.clock());
    await heartbeatLease(
      dependencies.database,
      outbox.id,
      dependencies.workerId,
      dependencies.clock(),
    );
    assertRecipientRetentionCurrent(outbox, dependencies.clock());
    const receipt = await deliverWithDeadline(
      dependencies.provider,
      frozen.request,
      PROVIDER_TIMEOUT_MILLISECONDS,
    );
    return finalizeAttempt(outbox, dependencies, {
      outcome: "ACCEPTED",
      providerActivationId,
      providerReceipt: receipt.providerReceipt,
      providerRequestDigest,
      recipientHash,
      recipientHashKeyVersion,
      completedAt: dependencies.clock(),
    });
  } catch (error) {
    if (error instanceof NotificationRecipientRetentionExpired) {
      return pauseForRecipientRetention(outbox, dependencies, {
        ambiguousProviderOutcome:
          outbox.providerRequestActivationId !== null ||
          providerActivationId !== undefined,
        expiredAt: dependencies.clock(),
      });
    }
    if (error instanceof NotificationProviderActivationUnavailable) {
      return pauseForProviderActivation(outbox, dependencies, {
        errorCode: error.code,
        pausedAt: dependencies.clock(),
      });
    }
    if (error instanceof NotificationProviderOutcomeReconciliationRequired) {
      return pauseForManualReconciliation(outbox, dependencies, {
        errorCode: error.code,
        pausedAt: dependencies.clock(),
      });
    }
    const failure =
      error instanceof EmailDeliveryFailure
        ? error
        : new EmailDeliveryFailure(
            "TRANSIENT",
            "DISPATCH_INFRASTRUCTURE_FAILURE",
          );
    return finalizeAttempt(outbox, dependencies, {
      outcome: outcomeForFailure(failure),
      errorCode: failure.code,
      ...(providerActivationId === undefined ? {} : { providerActivationId }),
      ...(providerRequestDigest === undefined ? {} : { providerRequestDigest }),
      recipientHash,
      recipientHashKeyVersion,
      completedAt: dependencies.clock(),
    });
  }
}

async function buildProviderRequest(
  outbox: ClaimedOutbox,
  to: string,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    clock: () => Date;
  }>,
): Promise<FrozenEmailDeliveryRequest> {
  const hydrated = await hydrateTemplate(outbox, {
    ...dependencies,
    resolvedRecipient: to,
  });
  const rendered = renderEmailTemplate(hydrated.templateKey, hydrated.data);
  return Object.freeze({
    to,
    templateKey: hydrated.templateKey,
    subject: rendered.subject,
    text: rendered.body,
    templateData: hydrated.data,
    idempotencyKey: outbox.providerDedupeKey,
    timeoutMilliseconds: PROVIDER_TIMEOUT_MILLISECONDS,
  });
}

function decryptFrozenProviderRequest(
  outbox: ClaimedOutbox,
  environment: ServerEnvironment,
): Readonly<{
  activationId: string;
  createdAt: Date;
  digest: string;
  request: FrozenEmailDeliveryRequest;
}> | null {
  const evidence = [
    outbox.providerRequestActivationId,
    outbox.providerRequestCreatedAt,
    outbox.providerRequestDigest,
    outbox.providerRequestKeyVersion,
  ];
  const material = [
    outbox.providerRequestCiphertext,
    outbox.providerRequestNonce,
    outbox.providerRequestTag,
  ];
  if (
    evidence.every((field) => field === null) &&
    material.every((field) => field === null) &&
    outbox.providerRequestDestroyedAt === null
  ) {
    return null;
  }
  if (
    evidence.every((field) => field !== null) &&
    material.every((field) => field === null) &&
    outbox.providerRequestDestroyedAt !== null
  ) {
    throw new NotificationProviderOutcomeReconciliationRequired(
      "PROVIDER_REQUEST_MATERIAL_DESTROYED_RECONCILIATION_REQUIRED",
    );
  }
  if (
    evidence.some((field) => field === null) ||
    material.some((field) => field === null) ||
    outbox.providerRequestDestroyedAt !== null
  ) {
    throw new EmailDeliveryFailure(
      "PERMANENT",
      "PROVIDER_REQUEST_SNAPSHOT_PARTIAL",
    );
  }
  if (!isEmailTemplateKey(outbox.templateKey)) {
    throw new EmailDeliveryFailure("PERMANENT", "TEMPLATE_UNKNOWN");
  }
  try {
    const request = decryptNotificationProviderRequest(
      {
        authTag: Uint8Array.from(outbox.providerRequestTag!),
        ciphertext: Uint8Array.from(outbox.providerRequestCiphertext!),
        digest: outbox.providerRequestDigest!,
        keyVersion: outbox.providerRequestKeyVersion!,
        nonce: Uint8Array.from(outbox.providerRequestNonce!),
      },
      environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
      providerRequestBinding(
        outbox,
        outbox.providerRequestActivationId!,
        outbox.templateKey,
      ),
    );
    if (
      request.idempotencyKey !== outbox.providerDedupeKey ||
      request.templateKey !== outbox.templateKey
    ) {
      throw new Error("PROVIDER_REQUEST_BINDING_MISMATCH");
    }
    return Object.freeze({
      activationId: outbox.providerRequestActivationId!,
      createdAt: outbox.providerRequestCreatedAt!,
      digest: outbox.providerRequestDigest!,
      request,
    });
  } catch {
    throw new EmailDeliveryFailure(
      "CONFIGURATION",
      "PROVIDER_REQUEST_DECRYPT_FAILED",
    );
  }
}

async function persistFrozenProviderRequest(
  outbox: ClaimedOutbox,
  request: FrozenEmailDeliveryRequest,
  activationId: string,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    workerId: string;
    clock: () => Date;
  }>,
) {
  const encrypted = encryptNotificationProviderRequest(
    request,
    dependencies.environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
    providerRequestBinding(outbox, activationId, request.templateKey),
  );
  const createdAt = dependencies.clock();
  const updated = await dependencies.database.notificationOutbox.updateMany({
    where: {
      id: outbox.id,
      status: "LEASED",
      leaseOwner: dependencies.workerId,
      providerRequestActivationId: null,
      providerRequestCiphertext: null,
      providerRequestCreatedAt: null,
      providerRequestDestroyedAt: null,
      providerRequestDigest: null,
      providerRequestKeyVersion: null,
      providerRequestNonce: null,
      providerRequestTag: null,
    },
    data: {
      providerRequestActivationId: activationId,
      providerRequestCiphertext: Buffer.from(encrypted.ciphertext),
      providerRequestCreatedAt: createdAt,
      providerRequestDigest: encrypted.digest,
      providerRequestKeyVersion: encrypted.keyVersion,
      providerRequestNonce: Buffer.from(encrypted.nonce),
      providerRequestTag: Buffer.from(encrypted.authTag),
    },
  });
  if (updated.count !== 1) {
    throw new Error("NOTIFICATION_PROVIDER_REQUEST_SNAPSHOT_RACE");
  }
  const canonicalRequest = decryptNotificationProviderRequest(
    encrypted,
    dependencies.environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
    providerRequestBinding(outbox, activationId, request.templateKey),
  );
  return Object.freeze({
    activationId,
    createdAt,
    digest: encrypted.digest,
    request: canonicalRequest,
  });
}

function providerRequestBinding(
  outbox: Pick<ClaimedOutbox, "id" | "providerDedupeKey">,
  providerActivationId: string,
  templateKey: EmailTemplateKey,
) {
  return Object.freeze({
    outboxId: outbox.id,
    providerActivationId,
    providerDedupeKey: outbox.providerDedupeKey,
    templateKey,
  });
}

async function requireExactProviderActivation(
  outbox: ClaimedOutbox,
  templateKey: EmailTemplateKey,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
  }>,
) {
  const policy = policyForTemplate(templateKey);
  if (
    policy.purpose !== outbox.purpose ||
    policy.classification !== outbox.purposeClass
  ) {
    throw new EmailDeliveryFailure("PERMANENT", "NOTIFICATION_POLICY_MISMATCH");
  }
  const useCase = providerUseCaseForTemplate(templateKey);
  const binding = emailProviderActivationBinding(
    dependencies.environment,
    useCase,
  );
  if (binding === null) {
    throw new NotificationProviderActivationUnavailable(
      "PROVIDER_ACTIVATION_DISABLED",
    );
  }
  const decision = await resolvePersistedProviderActivation(
    dependencies.database,
    {
      environment: dependencies.environment.APP_ENV,
      useCase,
      adapterKey: binding.adapterKey,
      adapterVersion: binding.adapterVersion,
      expectedConfigurationDigest: binding.expectedConfigurationDigest,
      expectedMode: binding.expectedMode,
      expectedSecretVersionRef: binding.expectedSecretVersionRef,
      now: dependencies.now,
    },
  );
  if (!decision.active) {
    throw new NotificationProviderActivationUnavailable(
      `PROVIDER_ACTIVATION_${decision.reason}`,
    );
  }
  return decision;
}

async function pauseForProviderActivation(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    workerId: string;
  }>,
  input: Readonly<{ errorCode: string; pausedAt: Date }>,
): Promise<"paused"> {
  const updated = await dependencies.database.notificationOutbox.updateMany({
    where: {
      id: outbox.id,
      status: "LEASED",
      leaseOwner: dependencies.workerId,
    },
    data: {
      status: "PAUSED",
      availableAt: new Date(
        input.pausedAt.getTime() + PROVIDER_ACTIVATION_RECHECK_MILLISECONDS,
      ),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: input.errorCode,
    },
  });
  if (updated.count !== 1) {
    throw new Error("NOTIFICATION_LEASE_LOST");
  }
  return "paused";
}

async function pauseForManualReconciliation(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    workerId: string;
  }>,
  input: Readonly<{ errorCode: string; pausedAt: Date }>,
): Promise<"paused"> {
  const updated = await dependencies.database.notificationOutbox.updateMany({
    where: {
      id: outbox.id,
      status: "LEASED",
      leaseOwner: dependencies.workerId,
    },
    data: {
      status: "PAUSED",
      availableAt: input.pausedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: input.errorCode,
      ...(outbox.providerRequestActivationId !== null &&
      outbox.providerRequestDestroyedAt === null
        ? destroyedProviderRequestMaterial(input.pausedAt)
        : {}),
      ...(outbox.recipientUserId === null &&
      outbox.recipientAddressCiphertext !== null &&
      outbox.recipientAddressDestroyedAt === null
        ? destroyedNotificationRecipientMaterial(input.pausedAt)
        : {}),
    },
  });
  if (updated.count !== 1) {
    throw new Error("NOTIFICATION_LEASE_LOST");
  }
  return "paused";
}

class NotificationProviderActivationUnavailable extends Error {
  constructor(readonly code: string) {
    super(`Notification provider activation unavailable: ${code}`);
    this.name = "NotificationProviderActivationUnavailable";
  }
}

class NotificationProviderOutcomeReconciliationRequired extends Error {
  readonly code: string;

  constructor(code = "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED") {
    super(code);
    this.name = "NotificationProviderOutcomeReconciliationRequired";
    this.code = code;
  }
}

class NotificationRecipientRetentionExpired extends Error {
  constructor() {
    super("RECIPIENT_MATERIAL_RETENTION_EXPIRED");
    this.name = "NotificationRecipientRetentionExpired";
  }
}

async function pauseForRecipientRetention(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    workerId: string;
  }>,
  input: Readonly<{
    ambiguousProviderOutcome: boolean;
    expiredAt: Date;
  }>,
): Promise<"paused" | "suppressed"> {
  const status = input.ambiguousProviderOutcome ? "PAUSED" : "SUPPRESSED";
  const updated = await dependencies.database.notificationOutbox.updateMany({
    where: {
      id: outbox.id,
      status: "LEASED",
      leaseOwner: dependencies.workerId,
    },
    data: {
      status,
      availableAt: input.expiredAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: "RECIPIENT_MATERIAL_RETENTION_EXPIRED",
      ...(status === "SUPPRESSED" ? { suppressedAt: input.expiredAt } : {}),
      ...destroyedNotificationRecipientMaterial(input.expiredAt),
      ...(input.ambiguousProviderOutcome
        ? destroyedProviderRequestMaterial(input.expiredAt)
        : {}),
    },
  });
  if (updated.count !== 1) throw new Error("NOTIFICATION_LEASE_LOST");
  return status === "PAUSED" ? "paused" : "suppressed";
}

async function resolveRecipient(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    clock: () => Date;
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
    outbox.recipientAddressDestroyedAt !== null ||
    outbox.recipientAddressCiphertext === null ||
    outbox.recipientAddressNonce === null ||
    outbox.recipientAddressTag === null ||
    outbox.recipientAddressKeyVersion === null ||
    outbox.recipientAddressExpiresAt === null
  ) {
    throw new EmailDeliveryFailure("PERMANENT", "RECIPIENT_ENVELOPE_MISSING");
  }
  assertRecipientRetentionCurrent(outbox, dependencies.clock());
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
      outbox.recipientAddressBindingVersion === null
        ? undefined
        : {
            bindingVersion: "v2",
            dedupeKey: outbox.dedupeKey,
            outboxId: outbox.id,
            retentionUntil: outbox.recipientAddressExpiresAt.toISOString(),
            templateKey: outbox.templateKey,
          },
    );
  } catch {
    throw new EmailDeliveryFailure("CONFIGURATION", "RECIPIENT_DECRYPT_FAILED");
  }
  const normalized = normalizedEmailSchema.safeParse(decrypted);
  if (!normalized.success) {
    throw new EmailDeliveryFailure("PERMANENT", "RECIPIENT_INVALID");
  }
  return normalized.data;
}

function assertRecipientRetentionCurrent(
  outbox: Pick<ClaimedOutbox, "recipientUserId" | "recipientAddressExpiresAt">,
  now: Date,
) {
  if (
    outbox.recipientUserId === null &&
    (outbox.recipientAddressExpiresAt === null ||
      outbox.recipientAddressExpiresAt.getTime() <= now.getTime())
  ) {
    throw new NotificationRecipientRetentionExpired();
  }
}

async function hydrateTemplate(
  outbox: ClaimedOutbox,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    clock: () => Date;
    resolvedRecipient: string;
  }>,
): Promise<
  Readonly<{
    templateKey: EmailTemplateKey;
    data: Readonly<Record<string, unknown>>;
  }>
> {
  if (!isEmailTemplateKey(outbox.templateKey)) {
    throw new EmailDeliveryFailure("PERMANENT", "TEMPLATE_UNKNOWN");
  }
  if (
    outbox.templateKey === "job_alert_digest_mock" &&
    dependencies.environment.APP_ENV !== "local" &&
    dependencies.environment.APP_ENV !== "ci"
  ) {
    throw new EmailDeliveryFailure(
      "CONFIGURATION",
      "JOB_ALERT_MOCK_TEMPLATE_ENVIRONMENT_FORBIDDEN",
    );
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
          targetNormalizedHash: true,
          tokenHash: true,
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
    if (hashVerificationToken(rawToken) !== challenge.tokenHash) {
      throw new EmailDeliveryFailure(
        "CONFIGURATION",
        "CHALLENGE_TOKEN_BINDING_MISMATCH",
      );
    }
    if (
      hashVerificationTarget(
        dependencies.resolvedRecipient,
        dependencies.environment.secrets.session,
      ) !== challenge.targetNormalizedHash
    ) {
      throw new EmailDeliveryFailure(
        "SUPPRESSED",
        "CHALLENGE_RECIPIENT_MISMATCH",
      );
    }
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
    const invitation = await dependencies.database.companyInvitation.findUnique(
      {
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
      },
    );
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
    outbox.payloadSchemaVersion === "job-alert-digest-v1" &&
    outbox.templateKey === "job_alert_digest"
  ) {
    const digestId = readUuid(outbox.payload, "digestId");
    const unsubscribeTokenId = readUuid(outbox.payload, "unsubscribeTokenId");
    const tokenKeyVersion = readSafeIdentifier(
      outbox.payload,
      "tokenKeyVersion",
    );
    if (
      digestId === undefined ||
      unsubscribeTokenId === undefined ||
      tokenKeyVersion === undefined ||
      outbox.recipientUserId === null
    ) {
      throw new EmailDeliveryFailure("PERMANENT", "PAYLOAD_INVALID");
    }
    const tokenKey =
      dependencies.environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS.find(
        (candidate) => candidate.version === tokenKeyVersion,
      );
    if (tokenKey === undefined) {
      throw new EmailDeliveryFailure(
        "CONFIGURATION",
        "JOB_ALERT_TOKEN_KEY_UNAVAILABLE",
      );
    }
    const now = dependencies.clock();
    const [digest, consent] = await Promise.all([
      dependencies.database.jobAlertDigest.findUnique({
        where: { id: digestId },
        select: {
          alertNameSnapshot: true,
          itemCount: true,
          policyVersion: true,
          runAt: true,
          jobAlert: {
            select: {
              status: true,
              candidateProfile: {
                select: {
                  userId: true,
                  user: { select: { status: true } },
                },
              },
            },
          },
          unsubscribeTokens: {
            where: { id: unsubscribeTokenId },
            take: 1,
            select: {
              id: true,
              tokenHash: true,
              expiresAt: true,
              usedAt: true,
            },
          },
        },
      }),
      dependencies.database.userConsentEvent.findFirst({
        where: {
          userId: outbox.recipientUserId,
          kind: "JOB_ALERT_DELIVERY",
          effectiveAt: { lte: now },
        },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
        select: {
          granted: true,
          noticeHash: true,
          noticeVersion: true,
          purpose: true,
        },
      }),
    ]);
    const token = digest?.unsubscribeTokens[0];
    if (
      digest === null ||
      digest.runAt === null ||
      digest.policyVersion !== JOB_ALERT_POLICY_V1.version ||
      digest.jobAlert.status !== "ACTIVE" ||
      digest.jobAlert.candidateProfile.user.status !== "ACTIVE" ||
      digest.jobAlert.candidateProfile.userId !== outbox.recipientUserId ||
      token === undefined ||
      token.usedAt !== null ||
      token.expiresAt.getTime() <= now.getTime() ||
      consent?.granted !== true ||
      consent.noticeVersion !== JOB_ALERT_DELIVERY_NOTICE_V2.version ||
      consent.purpose !== JOB_ALERT_DELIVERY_NOTICE_V2.purpose ||
      consent.noticeHash !== jobAlertConsentNoticeHash()
    ) {
      throw new EmailDeliveryFailure("SUPPRESSED", "JOB_ALERT_TERMINAL");
    }
    const rawToken = deriveJobAlertUnsubscribeToken({
      digestId,
      tokenId: token.id,
      key: tokenKey,
    });
    if (hashJobAlertUnsubscribeToken(rawToken) !== token.tokenHash) {
      throw new EmailDeliveryFailure(
        "CONFIGURATION",
        "JOB_ALERT_TOKEN_BINDING_MISMATCH",
      );
    }
    const unsubscribeUrl = new URL(
      `/alerts/unsubscribe/${rawToken}`,
      dependencies.environment.APP_URL,
    );
    return Object.freeze({
      templateKey: outbox.templateKey,
      data: Object.freeze({
        alertName: digest.alertNameSnapshot,
        jobCount: digest.itemCount,
        unsubscribeUrl: unsubscribeUrl.toString(),
      }),
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
    providerActivationId?: string;
    providerReceipt?: string;
    providerRequestDigest?: string;
    errorCode?: string;
    recipientHash?: string;
    recipientHashKeyVersion?: string;
    completedAt: Date;
  }>,
): Promise<"delivered" | "retried" | "suppressed" | "deadLettered" | "paused"> {
  const attemptNumber = outbox.attemptCount + 1;
  const transient =
    completion.outcome === "TRANSIENT_FAILURE" ||
    completion.outcome === "TIMED_OUT";
  const retryAt = transient
    ? new Date(completion.completedAt.getTime() + retryDelay(attemptNumber))
    : undefined;
  const ambiguousOutcomeRequiresReconciliation =
    completion.outcome === "TIMED_OUT" && attemptNumber >= outbox.maxAttempts;
  const finalStatus =
    completion.outcome === "ACCEPTED"
      ? "DELIVERED"
      : completion.outcome === "SUPPRESSED" || completion.outcome === "BOUNCED"
        ? "SUPPRESSED"
        : completion.outcome === "CONFIGURATION_ERROR"
          ? "PAUSED"
          : ambiguousOutcomeRequiresReconciliation
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
        lastErrorCode: ambiguousOutcomeRequiresReconciliation
          ? "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED"
          : (completion.errorCode ?? null),
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
        ...(finalStatus === "DELIVERED" ||
        finalStatus === "SUPPRESSED" ||
        finalStatus === "DEAD_LETTER"
          ? (outbox.providerRequestActivationId !== null ||
              (completion.providerActivationId !== undefined &&
                completion.providerRequestDigest !== undefined)) &&
            outbox.providerRequestDestroyedAt === null
            ? destroyedProviderRequestMaterial(completion.completedAt)
            : {}
          : {}),
        ...(outbox.recipientUserId === null &&
        outbox.recipientAddressCiphertext !== null &&
        outbox.recipientAddressDestroyedAt === null &&
        (finalStatus === "DELIVERED" ||
          finalStatus === "SUPPRESSED" ||
          finalStatus === "DEAD_LETTER")
          ? destroyedNotificationRecipientMaterial(completion.completedAt)
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
        providerActivationId: completion.providerActivationId,
        providerRequestDigest: completion.providerRequestDigest,
        recipientHash: completion.recipientHash,
        recipientHashKeyVersion: completion.recipientHashKeyVersion,
        recipientEvidenceRetainUntil: notificationAttemptEvidenceRetainUntil(
          completion.completedAt,
        ),
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
      completion.outcome === "ACCEPTED" &&
      completion.providerReceipt !== undefined &&
      dependencies.provider.providerClass.startsWith("resend-")
    ) {
      await projectPendingResendEventsForReceipt(
        transaction,
        completion.providerReceipt,
        completion.completedAt,
      );
    }
    if (
      completion.outcome === "BOUNCED" &&
      completion.recipientHash !== undefined &&
      completion.recipientHashKeyVersion !== undefined
    ) {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`swisstalenthub.email-suppression.v1:${completion.recipientHash}`},
            0
          )
        )
      `;
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
            recipientHashKeyVersion: completion.recipientHashKeyVersion,
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
          () => reject(new EmailDeliveryFailure("TIMEOUT", "PROVIDER_TIMEOUT")),
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
      Math.min(attemptNumber - 1, RETRY_DELAYS_MILLISECONDS.length - 1)
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

function readSafeIdentifier(payload: unknown, key: string) {
  if (
    payload === null ||
    Array.isArray(payload) ||
    typeof payload !== "object"
  ) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(value)
    ? value
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
