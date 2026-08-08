import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { providerUseCaseForTemplate } from "@/lib/notifications/purpose-policy";
import { resolveProviderActivation } from "@/lib/ops/provider-activation-policy";
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import type { VerifiedResendDeliveryWebhook } from "@/lib/providers/email/resend-webhook";

const uuidSchema = z.uuid();

export const RESEND_EVENT_PROJECTION_POLICY_V1 = Object.freeze({
  handlerKey: "notifications.provider-event-project" as const,
  handlerVersion: "v1" as const,
  maximumAttempts: 8,
  payloadVersion: "v1" as const,
  priority: 50,
  subjectType: "EMAIL_PROVIDER_EVENT_INBOX" as const,
});

export class ResendEventInboxConflictError extends Error {
  readonly code = "EVENT_IDENTITY_CONFLICT";

  constructor() {
    super("A Resend event id was reused with different immutable evidence.");
    this.name = "ResendEventInboxConflictError";
  }
}

export async function ingestVerifiedResendDeliveryWebhook(
  input: Readonly<{
    adapterKey: "resend_contract" | "resend_sandbox" | "resend_live";
    environment: string;
    providerActivationId: string;
    receivedAt: Date;
    verified: VerifiedResendDeliveryWebhook;
  }>,
  database: DatabaseClient,
) {
  if (!Number.isFinite(input.receivedAt.getTime())) {
    throw new TypeError("receivedAt must be a valid Date.");
  }
  return database.$transaction(async (transaction) => {
    await assertCurrentProviderActivation(transaction, input);
    await lockProviderReceipt(
      transaction,
      input.verified.event.providerReceipt,
    );
    const inboxId = randomUUID();
    const recipientHashes = Array.from(
      new Set(input.verified.event.recipientHashes),
    ).sort();
    const inserted = await transaction.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "EmailProviderEventInbox" (
        "id",
        "environment",
        "adapterKey",
        "adapterVersion",
        "providerActivationId",
        "svixId",
        "providerReceipt",
        "recipientHashes",
        "eventType",
        "eventCreatedAt",
        "payloadDigest",
        "receivedAt",
        "status",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${inboxId}::uuid,
        ${input.environment},
        ${input.adapterKey},
        'v1',
        ${input.providerActivationId}::uuid,
        ${input.verified.eventId},
        ${input.verified.event.providerReceipt},
        ${recipientHashes}::text[],
        ${providerEventType(input.verified.event.kind)},
        ${input.verified.event.occurredAt},
        ${input.verified.payloadDigest},
        ${input.receivedAt},
        'RECEIVED'::"EmailProviderEventInboxStatus",
        ${input.receivedAt},
        ${input.receivedAt}
      )
      ON CONFLICT ("environment", "adapterKey", "svixId") DO NOTHING
      RETURNING "id"
    `;
    const row = await transaction.emailProviderEventInbox.findFirst({
      where: {
        environment: input.environment,
        adapterKey: input.adapterKey,
        svixId: input.verified.eventId,
      },
    });
    if (row === null || !sameImmutableEvidence(row, input, recipientHashes)) {
      throw new ResendEventInboxConflictError();
    }
    const projection =
      row.status === "RECEIVED"
        ? await projectResendEventInTransaction(
            transaction,
            row.id,
            input.receivedAt,
          )
        : Object.freeze({
            projectedSuppressions: 0,
            status: row.status,
          });
    const queued = projection.status === "RECEIVED";
    if (queued) {
      await createResendEventProjectionWorkItem(
        transaction,
        row.id,
        input.receivedAt,
      );
    }
    return Object.freeze({
      inboxId: row.id,
      projectedSuppressions: projection.projectedSuppressions,
      queued,
      replay: inserted.length === 0,
      status: projection.status,
    });
  });
}

/**
 * Projects one durable inbox row from the worker boundary. Environment,
 * adapter and the exact currently-authorized provider activation are checked
 * inside the same transaction as the projection so a forged cross-environment
 * payload or a superseded activation cannot create a suppression effect.
 */
export async function projectResendEventInbox(
  input: Readonly<{
    expectedAdapterKey: "resend_contract" | "resend_sandbox" | "resend_live";
    expectedEnvironment: string;
    expectedProviderActivationId: string;
    inboxId: string;
    now: Date;
  }>,
  database: DatabaseClient,
) {
  if (
    !uuidSchema.safeParse(input.inboxId).success ||
    !uuidSchema.safeParse(input.expectedProviderActivationId).success ||
    input.expectedEnvironment.trim().length === 0 ||
    input.expectedEnvironment.length > 32 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Resend event inbox projection input is invalid.");
  }

  return database.$transaction(async (transaction) => {
    const inbox = await transaction.emailProviderEventInbox.findUnique({
      where: { id: input.inboxId },
      select: {
        adapterKey: true,
        adapterVersion: true,
        environment: true,
        providerActivationId: true,
        providerReceipt: true,
        status: true,
      },
    });
    if (inbox === null) {
      return Object.freeze({
        projectedSuppressions: 0,
        status: "NOT_FOUND" as const,
      });
    }
    if (
      inbox.environment !== input.expectedEnvironment ||
      inbox.adapterKey !== input.expectedAdapterKey ||
      inbox.adapterVersion !== "v1"
    ) {
      return Object.freeze({
        projectedSuppressions: 0,
        status: "BINDING_MISMATCH" as const,
      });
    }
    if (inbox.status !== "RECEIVED") {
      return Object.freeze({
        projectedSuppressions: 0,
        status: inbox.status,
      });
    }
    if (inbox.providerActivationId !== input.expectedProviderActivationId) {
      return Object.freeze({
        projectedSuppressions: 0,
        status: "BINDING_MISMATCH" as const,
      });
    }

    await lockProviderReceipt(transaction, inbox.providerReceipt);
    return projectResendEventInTransaction(
      transaction,
      input.inboxId,
      input.now,
    );
  });
}

/**
 * The route resolves the configured activation before signature verification,
 * but revocation can otherwise race the subsequent durable projection. A row
 * lock plus a second full policy decision closes that window: revoke/kill
 * updates wait until this transaction commits, and already-revoked or stale
 * activations fail closed before any inbox or suppression row is written.
 */
async function assertCurrentProviderActivation(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    adapterKey: "resend_contract" | "resend_sandbox" | "resend_live";
    environment: string;
    providerActivationId: string;
    receivedAt: Date;
  }>,
) {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ProviderActivation"
    WHERE "id" = ${input.providerActivationId}::uuid
    FOR SHARE
  `;
  if (locked.length !== 1) throw new ResendEventInboxConflictError();

  const activation = await transaction.providerActivation.findUnique({
    where: { id: input.providerActivationId },
  });
  const decision = resolveProviderActivation({
    activation,
    adapterKey: input.adapterKey,
    adapterVersion: "v1",
    environment: input.environment,
    now: input.receivedAt,
    useCase: "email.delivery-events",
  });
  if (!decision.active) throw new ResendEventInboxConflictError();
}

/**
 * Called in the same transaction that records a successful provider attempt.
 * The shared advisory lock closes the webhook-before-API-persist write skew:
 * whichever side commits second always observes and projects the other side.
 */
export async function projectPendingResendEventsForReceipt(
  transaction: Prisma.TransactionClient,
  providerReceipt: string,
  now: Date,
) {
  await lockProviderReceipt(transaction, providerReceipt);
  const pending = await transaction.emailProviderEventInbox.findMany({
    where: { providerReceipt, status: "RECEIVED" },
    orderBy: [{ eventCreatedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  let projected = 0;
  for (const row of pending) {
    const result = await projectResendEventInTransaction(
      transaction,
      row.id,
      now,
    );
    if (result.status === "PROJECTED") projected += 1;
  }
  return Object.freeze({ selected: pending.length, projected });
}

export async function expireStaleResendEventRecipients(
  database: DatabaseClient,
  now: Date,
) {
  const expiredBefore = new Date(now.getTime() - 23 * 60 * 60_000);
  const expired = await database.emailProviderEventInbox.updateMany({
    where: {
      status: "RECEIVED",
      receivedAt: { lte: expiredBefore },
      recipientHashesWipedAt: null,
    },
    data: {
      status: "IGNORED",
      processedAt: now,
      recipientHashes: [],
      recipientHashesWipedAt: now,
      updatedAt: now,
    },
  });
  return expired.count;
}

async function projectResendEventInTransaction(
  transaction: Prisma.TransactionClient,
  inboxId: string,
  now: Date,
) {
  const inbox = await transaction.emailProviderEventInbox.findUnique({
    where: { id: inboxId },
    include: { providerActivation: true },
  });
  if (inbox === null || inbox.status !== "RECEIVED") {
    return Object.freeze({
      projectedSuppressions: 0,
      status: inbox?.status ?? "IGNORED",
    });
  }
  const attempts = await transaction.notificationDeliveryAttempt.findMany({
    where: {
      providerClass: providerClassForAdapter(inbox.adapterKey),
      providerReceipt: inbox.providerReceipt,
      outcome: "ACCEPTED",
    },
    take: 2,
    include: {
      providerActivation: true,
      outbox: {
        select: {
          providerRequestActivationId: true,
          providerRequestDigest: true,
          purpose: true,
          purposeClass: true,
          templateKey: true,
        },
      },
    },
  });
  if (attempts.length === 0) {
    // Resend may deliver webhooks before the API response is durably recorded.
    // Keep the verified envelope pending; finalizeAttempt retries projection.
    return Object.freeze({ projectedSuppressions: 0, status: "RECEIVED" });
  }
  const attempt = attempts.length === 1 ? attempts[0]! : null;
  const activationUseCase =
    attempt === null || !isEmailTemplateKey(attempt.outbox.templateKey)
      ? null
      : providerUseCaseForTemplate(attempt.outbox.templateKey);
  const activationBound =
    attempt !== null &&
    attempt.providerActivation !== null &&
    attempt.providerActivationId ===
      attempt.outbox.providerRequestActivationId &&
    attempt.providerRequestDigest !== null &&
    attempt.providerRequestDigest === attempt.outbox.providerRequestDigest &&
    attempt.recipientHash !== null &&
    attempt.recipientHashKeyVersion !== null &&
    inbox.recipientHashes.includes(attempt.recipientHash) &&
    attempt.providerActivation.environment === inbox.environment &&
    attempt.providerActivation.useCase === activationUseCase &&
    attempt.providerActivation.adapterKey === inbox.adapterKey &&
    attempt.providerActivation.adapterVersion === inbox.adapterVersion &&
    inbox.providerActivation.environment === inbox.environment &&
    inbox.providerActivation.useCase === "email.delivery-events" &&
    inbox.providerActivation.adapterKey === inbox.adapterKey &&
    inbox.providerActivation.adapterVersion === inbox.adapterVersion;
  if (!activationBound) {
    await transaction.emailProviderEventInbox.update({
      where: { id: inbox.id },
      data: {
        status: "IGNORED",
        processedAt: now,
        recipientHashes: [],
        recipientHashesWipedAt: now,
        updatedAt: now,
      },
    });
    return Object.freeze({ projectedSuppressions: 0, status: "IGNORED" });
  }

  let projectedSuppressions = 0;
  if (
    inbox.eventType === "email.bounced" ||
    inbox.eventType === "email.suppressed"
  ) {
    const recipientHash = attempt!.recipientHash!;
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`swisstalenthub.email-suppression.v1:${recipientHash}`},
          0
        )
      )
    `;
    const active = await transaction.notificationSuppression.findFirst({
      where: { recipientHash, releasedAt: null },
      select: { id: true },
    });
    const laterRelease =
      active === null
        ? await transaction.notificationSuppression.findFirst({
            where: {
              recipientHash,
              releasedAt: { gte: inbox.eventCreatedAt },
            },
            select: { id: true },
          })
        : null;
    if (active === null && laterRelease === null) {
      await transaction.notificationSuppression.create({
        data: {
          recipientHash,
          recipientHashKeyVersion: attempt!.recipientHashKeyVersion!,
          reason:
            inbox.eventType === "email.bounced"
              ? "HARD_BOUNCE"
              : "PROVIDER_SUPPRESSION",
          source: "resend-webhook-v1",
          createdAt: inbox.eventCreatedAt,
        },
        select: { id: true },
      });
      projectedSuppressions = 1;
    }
  }
  const updated = await transaction.emailProviderEventInbox.updateMany({
    where: { id: inbox.id, status: "RECEIVED" },
    data: {
      status: "PROJECTED",
      processedAt: now,
      recipientHashes: [],
      recipientHashesWipedAt: now,
      updatedAt: now,
    },
  });
  if (updated.count !== 1) {
    throw new Error("RESEND_EVENT_INBOX_LEASE_LOST");
  }
  return Object.freeze({
    projectedSuppressions,
    status: "PROJECTED" as const,
  });
}

async function createResendEventProjectionWorkItem(
  transaction: Prisma.TransactionClient,
  inboxId: string,
  availableAt: Date,
) {
  const dedupeKey = resendEventProjectionWorkDedupeKey(inboxId);
  const payloadReference = { emailProviderEventInboxId: inboxId };
  const inserted = await transaction.workItem.createMany({
    data: [
      {
        handlerKey: RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey,
        handlerVersion: RESEND_EVENT_PROJECTION_POLICY_V1.handlerVersion,
        subjectType: RESEND_EVENT_PROJECTION_POLICY_V1.subjectType,
        subjectId: inboxId,
        dedupeKey,
        effectKey: `effect:${dedupeKey}`,
        priority: RESEND_EVENT_PROJECTION_POLICY_V1.priority,
        availableAt,
        maxAttempts: RESEND_EVENT_PROJECTION_POLICY_V1.maximumAttempts,
        payloadVersion: RESEND_EVENT_PROJECTION_POLICY_V1.payloadVersion,
        payloadReference,
        createdAt: availableAt,
        updatedAt: availableAt,
      },
    ],
    skipDuplicates: true,
  });
  const item = await transaction.workItem.findUniqueOrThrow({
    where: { dedupeKey },
    select: {
      availableAt: true,
      effectKey: true,
      handlerKey: true,
      handlerVersion: true,
      maxAttempts: true,
      payloadReference: true,
      payloadVersion: true,
      priority: true,
      subjectId: true,
      subjectType: true,
    },
  });
  if (
    item.handlerKey !== RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey ||
    item.handlerVersion !== RESEND_EVENT_PROJECTION_POLICY_V1.handlerVersion ||
    item.subjectType !== RESEND_EVENT_PROJECTION_POLICY_V1.subjectType ||
    item.subjectId !== inboxId ||
    item.effectKey !== `effect:${dedupeKey}` ||
    item.priority !== RESEND_EVENT_PROJECTION_POLICY_V1.priority ||
    (inserted.count === 1 &&
      item.availableAt.getTime() !== availableAt.getTime()) ||
    item.maxAttempts !== RESEND_EVENT_PROJECTION_POLICY_V1.maximumAttempts ||
    item.payloadVersion !== RESEND_EVENT_PROJECTION_POLICY_V1.payloadVersion ||
    JSON.stringify(item.payloadReference) !== JSON.stringify(payloadReference)
  ) {
    throw new ResendEventInboxConflictError();
  }
}

export function resendEventProjectionWorkDedupeKey(inboxId: string) {
  if (!uuidSchema.safeParse(inboxId).success) {
    throw new TypeError("Resend event inbox id is invalid.");
  }
  return `${RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey}:${RESEND_EVENT_PROJECTION_POLICY_V1.handlerVersion}:${inboxId}`;
}

async function lockProviderReceipt(
  transaction: Prisma.TransactionClient,
  providerReceipt: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`swisstalenthub.resend-receipt.v1:${providerReceipt}`},
        0
      )
    )
  `;
}

function sameImmutableEvidence(
  row: Readonly<{
    adapterVersion: string;
    providerReceipt: string;
    recipientHashes: string[];
    recipientHashesWipedAt: Date | null;
    eventType: string;
    eventCreatedAt: Date;
    payloadDigest: string;
    status: string;
  }>,
  input: Readonly<{
    verified: VerifiedResendDeliveryWebhook;
  }>,
  recipientHashes: readonly string[],
) {
  const sameCanonicalEvent =
    row.adapterVersion === "v1" &&
    row.providerReceipt === input.verified.event.providerReceipt &&
    row.eventType === providerEventType(input.verified.event.kind) &&
    row.eventCreatedAt.getTime() === input.verified.event.occurredAt.getTime();
  if (!sameCanonicalEvent) return false;

  // Terminal rows have already projected (or deliberately ignored) their
  // only effect and their recipient hashes were destroyed. A later retry of
  // the same Svix identity must remain idempotent even after every old
  // notification evidence key has left the rotation window.
  if (
    row.recipientHashesWipedAt !== null &&
    (row.status === "PROJECTED" || row.status === "IGNORED")
  ) {
    return true;
  }

  // A still-actionable RECEIVED row retains enough evidence to require both
  // an exact-body digest under a retained key and at least one recipient-HMAC
  // overlap. Rotation can add candidates, but cannot replace the event.
  return (
    input.verified.payloadDigestCandidates.includes(row.payloadDigest) &&
    row.recipientHashes.some((value) => recipientHashes.includes(value))
  );
}

function providerClassForAdapter(adapterKey: string) {
  switch (adapterKey) {
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

function providerEventType(
  kind: VerifiedResendDeliveryWebhook["event"]["kind"],
) {
  switch (kind) {
    case "BOUNCED":
      return "email.bounced";
    case "SUPPRESSED":
      return "email.suppressed";
    case "DELIVERED":
      return "email.delivered";
  }
}

function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}
