import "server-only";

import {
  adminNow,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";
import { consumeStepUpGrant } from "@/lib/auth/assurance/step-up-service";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  digestNotificationReconciliationIdentifier,
  notificationOutcomeReconciliationAuditMetadataSchema,
  notificationOutcomeReconciliationInputSchema,
  notificationOutcomeReconciliationStepUpAction,
  type NotificationOutcomeReconciliationAuditMetadata,
  type NotificationOutcomeReconciliationResolution,
} from "@/lib/notifications/outcome-reconciliation-policy";
import { decryptNotificationProviderRequest } from "@/lib/notifications/provider-request-material";
import {
  destroyedNotificationRecipientMaterial,
  notificationAttemptEvidenceRetainUntil,
  NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS,
} from "@/lib/notifications/retention";
import { resolveProviderActivation } from "@/lib/ops/provider-activation-policy";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { projectPendingResendEventsForReceipt } from "@/lib/providers/email/resend-event-inbox";
import {
  policyForTemplate,
  providerUseCaseForTemplate,
} from "@/lib/notifications/purpose-policy";

const EXACT_PAUSE_CODE = "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED";
const AUDIT_ACTION = "SYSTEM_TASK_OUTCOME_RECORDED" as const;
const AUDIT_CAPABILITY = "ADMIN_SYSTEM_TASK_MANAGE" as const;

export type NotificationOutcomeReconciliationCode =
  | "INVALID_INPUT"
  | "FORBIDDEN"
  | "STEP_UP_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PROVIDER_CONTRACT_UNAVAILABLE"
  | "MATERIAL_EXPIRED"
  | "MATERIAL_INVALID"
  | "WRITE_FAILED";

export type NotificationOutcomeReconciliationResult = Readonly<
  | {
      ok: true;
      replay?: boolean;
      value: Readonly<{
        outboxId: string;
        providerActivationId: string;
        providerRequestDigest: string;
        resolution: NotificationOutcomeReconciliationResolution;
        status: string;
      }>;
    }
  | { ok: false; code: NotificationOutcomeReconciliationCode }
>;

export type NotificationOutcomeReconciliationDependencies = AdminDependencies &
  Readonly<{
    actor: AdminDependencies["actor"] & Readonly<{ sessionId: string }>;
    environment: ServerEnvironment;
  }>;

/**
 * Returns only the immutable provider correlation evidence required to look a
 * request up outside SwissTalentHub. Recipient, subject, body, template data
 * and user identity never cross this operations read boundary.
 */
export async function listNotificationOutcomeReconciliationCases(
  dependencies: AdminDependencies,
) {
  if (!(await requireCapability(dependencies, AUDIT_CAPABILITY))) return null;
  const now = adminNow(dependencies.now);
  const rows = await dependencies.database.notificationOutbox.findMany({
    where: {
      status: "PAUSED",
      lastErrorCode: EXACT_PAUSE_CODE,
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 50,
    select: {
      id: true,
      attemptCount: true,
      providerDedupeKey: true,
      providerRequestActivationId: true,
      providerRequestCreatedAt: true,
      providerRequestDestroyedAt: true,
      providerRequestDigest: true,
      purpose: true,
      updatedAt: true,
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        select: {
          attemptNumber: true,
          completedAt: true,
          providerClass: true,
        },
      },
    },
  });
  return Object.freeze(
    rows.map((row) => {
      const materialExpiresAt =
        row.providerRequestCreatedAt === null
          ? null
          : new Date(
              row.providerRequestCreatedAt.getTime() +
                NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS,
            );
      return Object.freeze({
        id: row.id,
        attemptCount: row.attemptCount,
        materialExpiresAt,
        materialState:
          row.providerRequestDestroyedAt !== null
            ? ("DESTROYED" as const)
            : materialExpiresAt === null ||
                materialExpiresAt.getTime() <= now.getTime()
              ? ("EXPIRED" as const)
              : ("AVAILABLE" as const),
        pausedAt: row.updatedAt,
        providerActivationId: row.providerRequestActivationId,
        providerClass: row.attempts[0]?.providerClass ?? null,
        providerDedupeKey: row.providerDedupeKey,
        providerRequestDigest: row.providerRequestDigest,
        purpose: row.purpose,
      });
    }),
  );
}

/**
 * Resolves only the exact ambiguous terminal-timeout state. The function has
 * intentionally no provider dependency: ACCEPTED records immutable evidence
 * without sending; DEFINITIVELY_NOT_ACCEPTED releases the already encrypted
 * request with its original provider idempotency key; UNKNOWN remains paused.
 */
export async function reconcileNotificationProviderOutcome(
  raw: unknown,
  dependencies: NotificationOutcomeReconciliationDependencies,
): Promise<NotificationOutcomeReconciliationResult> {
  const parsed = notificationOutcomeReconciliationInputSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  if (!(await requireCapability(dependencies, AUDIT_CAPABILITY))) {
    return failure("FORBIDDEN");
  }
  const input = parsed.data;
  const now = adminNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
          FROM "NotificationOutbox"
         WHERE "id" = ${input.outboxId}::uuid
         FOR UPDATE
      `;
      if (locked.length !== 1) throw new ReconciliationFailure("NOT_FOUND");

      const outbox = await transaction.notificationOutbox.findUniqueOrThrow({
        where: { id: input.outboxId },
        select: {
          id: true,
          attemptCount: true,
          maxAttempts: true,
          channel: true,
          providerDedupeKey: true,
          providerRequestActivationId: true,
          providerRequestCiphertext: true,
          providerRequestCreatedAt: true,
          providerRequestDestroyedAt: true,
          providerRequestDigest: true,
          providerRequestKeyVersion: true,
          providerRequestNonce: true,
          providerRequestTag: true,
          recipientAddressCiphertext: true,
          recipientAddressDestroyedAt: true,
          recipientAddressExpiresAt: true,
          recipientUserId: true,
          purpose: true,
          purposeClass: true,
          status: true,
          lastErrorCode: true,
          templateKey: true,
          attempts: {
            orderBy: { attemptNumber: "desc" },
            take: 1,
            select: {
              attemptNumber: true,
              completedAt: true,
              leaseExpiresAt: true,
              outcome: true,
              providerActivationId: true,
              providerClass: true,
              providerReceipt: true,
              providerRequestDigest: true,
              recipientHash: true,
              recipientHashKeyVersion: true,
            },
          },
        },
      });

      const replay = await transaction.auditLog.findFirst({
        where: {
          action: AUDIT_ACTION,
          correlationId: input.idempotencyKey,
          targetId: outbox.id,
        },
        select: { actorUserId: true, metadata: true, reasonCode: true },
      });
      if (replay !== null) {
        const metadata =
          notificationOutcomeReconciliationAuditMetadataSchema.safeParse(
            replay.metadata,
          );
        if (
          !metadata.success ||
          replay.actorUserId !== dependencies.actor.userId ||
          replay.reasonCode !== input.reasonCode ||
          metadata.data.resolution !== input.resolution ||
          metadata.data.evidenceDigest !== input.evidenceDigest ||
          metadata.data.evidenceReference !== input.evidenceReference ||
          metadata.data.providerReceiptDigest !==
            providerReceiptDigest(input.providerReceipt) ||
          metadata.data.stepUpEvidenceDigest !==
            digestNotificationReconciliationIdentifier(
              input.stepUpEvidenceId,
            ) ||
          metadata.data.stepUpGrantDigest !==
            digestNotificationReconciliationIdentifier(input.stepUpGrantToken)
        ) {
          throw new ReconciliationFailure("CONFLICT");
        }
        return success(
          {
            outboxId: outbox.id,
            providerActivationId: metadata.data.providerActivationId,
            providerRequestDigest: metadata.data.providerRequestDigest,
            resolution: metadata.data.resolution,
            status: reconciliationResultStatus(metadata.data.resolution),
          },
          true,
        );
      }

      const stepUpConsumed = await consumeStepUpGrant(transaction, {
        evidenceId: input.stepUpEvidenceId,
        grantToken: input.stepUpGrantToken,
        actor: dependencies.actor,
        purpose: "NOTIFICATION_RECONCILIATION",
        action: notificationOutcomeReconciliationStepUpAction(input.resolution),
        resourceId: input.outboxId,
        correlationId: input.idempotencyKey,
        now,
      });
      if (!stepUpConsumed) throw new ReconciliationFailure("STEP_UP_REQUIRED");

      assertExactPausedState(outbox);
      const templateKey = assertCurrentFrozenRequest(
        outbox,
        dependencies.environment,
        now,
      );
      const attempt = outbox.attempts[0]!;
      await assertCurrentProviderContract(
        transaction,
        outbox,
        templateKey,
        attempt.providerClass,
        dependencies.environment,
        now,
      );

      const metadata = Object.freeze({
        contract: "NOTIFICATION_OUTCOME_RECONCILIATION_V1" as const,
        evidenceDigest: input.evidenceDigest,
        evidenceReference: input.evidenceReference,
        idempotencyKey: input.idempotencyKey,
        providerActivationId: outbox.providerRequestActivationId!,
        providerClass: attempt.providerClass,
        providerDedupeKeyDigest: digestNotificationReconciliationIdentifier(
          outbox.providerDedupeKey,
        ),
        providerReceiptDigest: providerReceiptDigest(input.providerReceipt),
        providerRequestDigest: outbox.providerRequestDigest!,
        resolution: input.resolution,
        stepUpEvidenceDigest: digestNotificationReconciliationIdentifier(
          input.stepUpEvidenceId,
        ),
        stepUpGrantDigest: digestNotificationReconciliationIdentifier(
          input.stepUpGrantToken,
        ),
      }) satisfies NotificationOutcomeReconciliationAuditMetadata;

      if (input.resolution === "ACCEPTED") {
        await terminalizeAcceptedOutcome(
          transaction,
          outbox,
          attempt,
          input.providerReceipt!,
          now,
          dependencies.actor.userId,
        );
      } else if (input.resolution === "DEFINITIVELY_NOT_ACCEPTED") {
        const updated = await transaction.notificationOutbox.updateMany({
          where: {
            id: outbox.id,
            status: "PAUSED",
            lastErrorCode: EXACT_PAUSE_CODE,
            providerRequestActivationId: outbox.providerRequestActivationId,
            providerRequestDigest: outbox.providerRequestDigest,
            providerRequestDestroyedAt: null,
          },
          data: {
            availableAt: now,
            lastErrorCode: "PROVIDER_RETRY_AUTHORIZED_AFTER_RECONCILIATION",
            maxAttempts: outbox.attemptCount + 1,
            status: "RETRY",
          },
        });
        if (updated.count !== 1) throw new ReconciliationFailure("CONFLICT");
      }

      await writeAdminAudit(
        transaction,
        { ...dependencies, correlationId: input.idempotencyKey },
        now,
        {
          action: AUDIT_ACTION,
          capability: AUDIT_CAPABILITY,
          metadata,
          reasonCode: input.reasonCode,
          targetId: outbox.id,
          targetType: "SYSTEM_TASK",
        },
      );

      return success({
        outboxId: outbox.id,
        providerActivationId: outbox.providerRequestActivationId!,
        providerRequestDigest: outbox.providerRequestDigest!,
        resolution: input.resolution,
        status: reconciliationResultStatus(input.resolution),
      });
    });
  } catch (error) {
    return error instanceof ReconciliationFailure
      ? failure(error.code)
      : failure("WRITE_FAILED");
  }
}

type ReconciliationOutbox = Readonly<{
  id: string;
  attemptCount: number;
  maxAttempts: number;
  channel: string;
  providerDedupeKey: string;
  providerRequestActivationId: string | null;
  providerRequestCiphertext: Uint8Array | null;
  providerRequestCreatedAt: Date | null;
  providerRequestDestroyedAt: Date | null;
  providerRequestDigest: string | null;
  providerRequestKeyVersion: string | null;
  providerRequestNonce: Uint8Array | null;
  providerRequestTag: Uint8Array | null;
  recipientAddressCiphertext: Uint8Array | null;
  recipientAddressDestroyedAt: Date | null;
  recipientAddressExpiresAt: Date | null;
  recipientUserId: string | null;
  purpose: string;
  purposeClass: string;
  status: string;
  lastErrorCode: string | null;
  templateKey: string;
  attempts: readonly ReconciliationAttempt[];
}>;

type ReconciliationAttempt = Readonly<{
  attemptNumber: number;
  completedAt: Date;
  leaseExpiresAt: Date;
  outcome: string;
  providerActivationId: string | null;
  providerClass: string;
  providerReceipt: string | null;
  providerRequestDigest: string | null;
  recipientHash: string | null;
  recipientHashKeyVersion: string | null;
}>;

function assertExactPausedState(outbox: ReconciliationOutbox) {
  const attempt = outbox.attempts[0];
  if (
    outbox.status !== "PAUSED" ||
    outbox.lastErrorCode !== EXACT_PAUSE_CODE ||
    outbox.channel !== "EMAIL" ||
    attempt === undefined ||
    attempt.attemptNumber !== outbox.attemptCount ||
    outbox.attemptCount !== outbox.maxAttempts ||
    outbox.attemptCount >= 20 ||
    attempt.outcome !== "TIMED_OUT" ||
    attempt.providerReceipt !== null ||
    attempt.providerActivationId === null ||
    attempt.providerActivationId !== outbox.providerRequestActivationId ||
    attempt.providerRequestDigest === null ||
    attempt.providerRequestDigest !== outbox.providerRequestDigest ||
    attempt.recipientHash === null ||
    attempt.recipientHashKeyVersion === null
  ) {
    throw new ReconciliationFailure("CONFLICT");
  }
}

function assertCurrentFrozenRequest(
  outbox: ReconciliationOutbox,
  environment: ServerEnvironment,
  now: Date,
) {
  if (
    outbox.providerRequestCreatedAt === null ||
    outbox.providerRequestCreatedAt.getTime() > now.getTime() ||
    now.getTime() - outbox.providerRequestCreatedAt.getTime() >=
      NOTIFICATION_PROVIDER_MATERIAL_RETENTION_MILLISECONDS
  ) {
    throw new ReconciliationFailure("MATERIAL_EXPIRED");
  }
  if (
    outbox.providerRequestActivationId === null ||
    outbox.providerRequestCiphertext === null ||
    outbox.providerRequestDestroyedAt !== null ||
    outbox.providerRequestDigest === null ||
    outbox.providerRequestKeyVersion === null ||
    outbox.providerRequestNonce === null ||
    outbox.providerRequestTag === null ||
    !isEmailTemplateKey(outbox.templateKey) ||
    (outbox.recipientUserId === null &&
      (outbox.recipientAddressCiphertext === null ||
        outbox.recipientAddressDestroyedAt !== null ||
        outbox.recipientAddressExpiresAt === null ||
        outbox.recipientAddressExpiresAt.getTime() <= now.getTime()))
  ) {
    throw new ReconciliationFailure("MATERIAL_INVALID");
  }
  try {
    const request = decryptNotificationProviderRequest(
      {
        authTag: Uint8Array.from(outbox.providerRequestTag),
        ciphertext: Uint8Array.from(outbox.providerRequestCiphertext),
        digest: outbox.providerRequestDigest,
        keyVersion: outbox.providerRequestKeyVersion,
        nonce: Uint8Array.from(outbox.providerRequestNonce),
      },
      environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
      {
        outboxId: outbox.id,
        providerActivationId: outbox.providerRequestActivationId,
        providerDedupeKey: outbox.providerDedupeKey,
        templateKey: outbox.templateKey,
      },
    );
    if (
      request.idempotencyKey !== outbox.providerDedupeKey ||
      request.templateKey !== outbox.templateKey
    ) {
      throw new ReconciliationFailure("MATERIAL_INVALID");
    }
    return request.templateKey;
  } catch {
    throw new ReconciliationFailure("MATERIAL_INVALID");
  }
}

async function assertCurrentProviderContract(
  transaction: Prisma.TransactionClient,
  outbox: ReconciliationOutbox,
  templateKey: EmailTemplateKey,
  providerClass: string,
  environment: ServerEnvironment,
  now: Date,
) {
  const policy = policyForTemplate(templateKey);
  if (
    policy.purpose !== outbox.purpose ||
    policy.classification !== outbox.purposeClass
  ) {
    throw new ReconciliationFailure("MATERIAL_INVALID");
  }
  const useCase = providerUseCaseForTemplate(templateKey);
  const binding = emailProviderActivationBinding(environment, useCase);
  if (
    binding === null ||
    providerClass !== providerClassForAdapter(binding.adapterKey)
  ) {
    throw new ReconciliationFailure("PROVIDER_CONTRACT_UNAVAILABLE");
  }
  const current = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
      FROM "ProviderActivation"
     WHERE "environment" = ${environment.APP_ENV}
       AND "useCase" = ${useCase}
     ORDER BY "createdAt" DESC, "id" DESC
     LIMIT 1
     FOR SHARE
  `;
  if (
    current[0]?.id !== outbox.providerRequestActivationId ||
    current.length !== 1
  ) {
    throw new ReconciliationFailure("PROVIDER_CONTRACT_UNAVAILABLE");
  }
  const activation = await transaction.providerActivation.findUnique({
    where: { id: current[0].id },
  });
  const decision = resolveProviderActivation({
    activation,
    adapterKey: binding.adapterKey,
    adapterVersion: binding.adapterVersion,
    environment: environment.APP_ENV,
    expectedConfigurationDigest: binding.expectedConfigurationDigest,
    expectedMode: binding.expectedMode,
    expectedSecretVersionRef: binding.expectedSecretVersionRef,
    now,
    useCase,
  });
  if (!decision.active) {
    throw new ReconciliationFailure("PROVIDER_CONTRACT_UNAVAILABLE");
  }
}

async function terminalizeAcceptedOutcome(
  transaction: Prisma.TransactionClient,
  outbox: ReconciliationOutbox,
  attempt: ReconciliationAttempt,
  providerReceipt: string,
  now: Date,
  actorUserId: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`swisstalenthub.resend-receipt.v1:${providerReceipt}`},
        0
      )
    )
  `;
  const receiptCollision =
    await transaction.notificationDeliveryAttempt.findFirst({
      where: {
        outboxId: { not: outbox.id },
        providerActivationId: outbox.providerRequestActivationId,
        providerClass: attempt.providerClass,
        providerReceipt,
      },
      select: { id: true },
    });
  if (receiptCollision !== null) throw new ReconciliationFailure("CONFLICT");

  const updated = await transaction.notificationOutbox.updateMany({
    where: {
      id: outbox.id,
      status: "PAUSED",
      lastErrorCode: EXACT_PAUSE_CODE,
      attemptCount: outbox.attemptCount,
      providerRequestActivationId: outbox.providerRequestActivationId,
      providerRequestDigest: outbox.providerRequestDigest,
      providerRequestDestroyedAt: null,
    },
    data: {
      attemptCount: outbox.attemptCount + 1,
      deliveredAt: now,
      lastErrorCode: null,
      maxAttempts: outbox.attemptCount + 1,
      status: "DELIVERED",
      providerRequestCiphertext: null,
      providerRequestNonce: null,
      providerRequestTag: null,
      providerRequestDestroyedAt: now,
      ...(outbox.recipientUserId === null &&
      outbox.recipientAddressCiphertext !== null &&
      outbox.recipientAddressDestroyedAt === null
        ? destroyedNotificationRecipientMaterial(now)
        : {}),
    },
  });
  if (updated.count !== 1) throw new ReconciliationFailure("CONFLICT");

  await transaction.notificationDeliveryAttempt.create({
    data: {
      attemptNumber: outbox.attemptCount + 1,
      completedAt: now,
      leaseExpiresAt: now,
      leaseOwner: `reconciliation:${actorUserId}`,
      outcome: "ACCEPTED",
      outboxId: outbox.id,
      providerActivationId: outbox.providerRequestActivationId!,
      providerClass: attempt.providerClass,
      providerReceipt,
      providerRequestDigest: outbox.providerRequestDigest!,
      recipientHash: attempt.recipientHash!,
      recipientHashKeyVersion: attempt.recipientHashKeyVersion!,
      recipientEvidenceRetainUntil: notificationAttemptEvidenceRetainUntil(now),
      startedAt: now,
    },
    select: { id: true },
  });
  if (attempt.providerClass.startsWith("resend-")) {
    await projectPendingResendEventsForReceipt(
      transaction,
      providerReceipt,
      now,
    );
  }
}

function providerClassForAdapter(adapterKey: string) {
  switch (adapterKey) {
    case "local_mock":
      return "local-mock-v1";
    case "resend_contract":
      return "resend-contract-v1";
    case "resend_sandbox":
      return "resend-sandbox-v1";
    case "resend_live":
      return "resend-live-v1";
    default:
      return "unbound-provider";
  }
}

function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return EMAIL_TEMPLATE_KEYS.some((candidate) => candidate === value);
}

function providerReceiptDigest(value: string | null | undefined) {
  return value == null
    ? null
    : digestNotificationReconciliationIdentifier(value);
}

function reconciliationResultStatus(
  resolution: NotificationOutcomeReconciliationResolution,
) {
  return resolution === "ACCEPTED"
    ? "DELIVERED"
    : resolution === "DEFINITIVELY_NOT_ACCEPTED"
      ? "RETRY"
      : "PAUSED";
}

function success(
  value: Extract<
    NotificationOutcomeReconciliationResult,
    { ok: true }
  >["value"],
  replay = false,
): NotificationOutcomeReconciliationResult {
  return Object.freeze({
    ok: true,
    value: Object.freeze(value),
    ...(replay ? { replay: true } : {}),
  });
}

function failure(
  code: NotificationOutcomeReconciliationCode,
): NotificationOutcomeReconciliationResult {
  return Object.freeze({ ok: false, code });
}

class ReconciliationFailure extends Error {
  constructor(readonly code: NotificationOutcomeReconciliationCode) {
    super(code);
    this.name = "ReconciliationFailure";
  }
}
