import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { decideContactRequestTransition } from "@/lib/policies/status/contact-request";
import type { EmployerRadarContactActor } from "@/lib/talentradar/request-contact";

const DAY_MILLISECONDS = 86_400_000;
const AUDIT_RETENTION_MILLISECONDS = 10 * 365 * DAY_MILLISECONDS;
const MAX_SERIALIZABLE_ATTEMPTS = 4;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

const contactTransitionInputSchema = z.strictObject({
  requestId: z.uuid(),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
});

export type CandidateContactRequestActor = Readonly<{ userId: string }>;

export type ContactRequestLifecycleDependencies = Readonly<{
  correlationId: string;
  database: DatabaseClient;
  now?: Date;
}>;

export type ContactRequestLifecycleResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        requestId: string;
        status: "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED";
        conversationId: string | null;
      }>;
      replay?: true;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "TRUST_REQUIRED"
        | "CONFLICT"
        | "IDEMPOTENCY_CONFLICT"
        | "WRITE_FAILED";
    }>;

type CandidateTransitionAction = "ACCEPT" | "DECLINE";

export async function acceptContactRequest(
  raw: unknown,
  actor: CandidateContactRequestActor,
  dependencies: ContactRequestLifecycleDependencies,
): Promise<ContactRequestLifecycleResult> {
  return transitionCandidateContactRequest("ACCEPT", raw, actor, dependencies);
}

export async function declineContactRequest(
  raw: unknown,
  actor: CandidateContactRequestActor,
  dependencies: ContactRequestLifecycleDependencies,
): Promise<ContactRequestLifecycleResult> {
  return transitionCandidateContactRequest("DECLINE", raw, actor, dependencies);
}

export async function cancelEmployerContactRequest(
  raw: unknown,
  actor: EmployerRadarContactActor,
  dependencies: ContactRequestLifecycleDependencies,
): Promise<ContactRequestLifecycleResult> {
  const parsed = parseLifecycleInput(raw, actor.userId, dependencies);
  if (!parsed.ok) return lifecycleFailure("INVALID_INPUT");
  const input = parsed.input;
  const now = parsed.now;

  return runSerializableLifecycleCommand(dependencies.database, async (transaction) => {
    await acquireEmployerCancellationLocks(
      transaction,
      actor.companyId,
      input.requestId,
    );
    if (!(await hasCurrentEmployerTrust(transaction, actor))) {
      return lifecycleFailure("NOT_FOUND");
    }

    const request = await transaction.employerContactRequest.findFirst({
      where: { id: input.requestId, companyId: actor.companyId },
      select: {
        id: true,
        companyId: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        candidateProfile: { select: { userId: true } },
      },
    });
    if (request === null) return lifecycleFailure("NOT_FOUND");

    const eventKey = contactLifecycleEventKey(
      "cancelled",
      actor.userId,
      input.idempotencyKey,
    );
    const replay = await loadLifecycleReplay(transaction, eventKey);
    if (replay !== null) {
      return replay.contactRequestId === request.id &&
        replay.kind === "CANCELLED" &&
        replay.actorUserId === actor.userId
        ? lifecycleSuccess(
            {
              requestId: request.id,
              status: "CANCELLED",
              conversationId: null,
            },
            true,
          )
        : lifecycleFailure("IDEMPOTENCY_CONFLICT");
    }

    const decision = decideContactRequestTransition({
      action: "CANCEL_BY_REQUESTING_COMPANY",
      actor: "REQUESTING_COMPANY_MEMBER",
      currentStatus: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      now,
    });
    if (decision.type !== "OK") return lifecycleFailure("CONFLICT");

    const updated = await transaction.employerContactRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "CANCELLED", terminalAt: now, updatedAt: now },
    });
    if (updated.count !== 1) return lifecycleFailure("CONFLICT");

    await transaction.contactRequestEvent.create({
      data: {
        id: randomUUID(),
        contactRequestId: request.id,
        kind: "CANCELLED",
        actorUserId: actor.userId,
        reasonCode: "REQUESTING_COMPANY_CANCELLED",
        correlationId: dependencies.correlationId,
        idempotencyKey: eventKey,
        createdAt: now,
      },
    });
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: request.candidateProfile.userId,
      kind: "CONTACT_REQUEST_CANCELLED",
      dedupeKey: eventKey,
      payload: {
        requestId: request.id,
        status: "CANCELLED",
        reasonCode: "REQUESTING_COMPANY_CANCELLED",
      },
    });
    await writeContactLifecycleAudit(transaction, {
      action: "CONTACT_REQUEST_CANCELLED",
      actorKind: "USER",
      actorUserId: actor.userId,
      capability: "EMPLOYER_TALENT_CONTACT_CANCEL",
      companyId: request.companyId,
      correlationId: dependencies.correlationId,
      reasonCode: "REQUESTING_COMPANY_CANCELLED",
      requestId: request.id,
      now,
    });
    return lifecycleSuccess({
      requestId: request.id,
      status: "CANCELLED",
      conversationId: null,
    });
  });
}

export async function expireContactRequest(
  raw: unknown,
  dependencies: ContactRequestLifecycleDependencies,
): Promise<ContactRequestLifecycleResult> {
  const parsed = parseLifecycleInput(raw, null, dependencies);
  if (!parsed.ok) return lifecycleFailure("INVALID_INPUT");
  const input = parsed.input;
  const now = parsed.now;

  return runSerializableLifecycleCommand(dependencies.database, async (transaction) => {
    await acquireRequestLock(transaction, input.requestId);
    const request = await transaction.employerContactRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        companyId: true,
        status: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    if (request === null) return lifecycleFailure("NOT_FOUND");
    if (request.status === "EXPIRED") {
      return lifecycleSuccess(
        {
          requestId: request.id,
          status: "EXPIRED",
          conversationId: null,
        },
        true,
      );
    }

    const decision = decideContactRequestTransition({
      action: "EXPIRE",
      actor: "SYSTEM_EXPIRY_PROJECTOR",
      currentStatus: request.status,
      expiresAt: request.expiresAt,
      now,
    });
    if (decision.type !== "OK") return lifecycleFailure("CONFLICT");

    const updated = await transaction.employerContactRequest.updateMany({
      where: { id: request.id, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED", terminalAt: now, updatedAt: now },
    });
    if (updated.count !== 1) return lifecycleFailure("CONFLICT");

    const eventKey = `contact-event:expired:${sha256(request.id)}`;
    await transaction.contactRequestEvent.create({
      data: {
        id: randomUUID(),
        contactRequestId: request.id,
        kind: "EXPIRED",
        actorUserId: null,
        reasonCode: "REQUEST_EXPIRED",
        correlationId: dependencies.correlationId,
        idempotencyKey: eventKey,
        createdAt: now,
      },
    });
    await writeContactLifecycleAudit(transaction, {
      action: "CONTACT_REQUEST_EXPIRED",
      actorKind: "SYSTEM",
      actorUserId: null,
      capability: "SYSTEM_CONTACT_REQUEST_EXPIRY",
      companyId: request.companyId,
      correlationId: dependencies.correlationId,
      reasonCode: "REQUEST_EXPIRED",
      requestId: request.id,
      now,
    });
    return lifecycleSuccess({
      requestId: request.id,
      status: "EXPIRED",
      conversationId: null,
    });
  });
}

export async function expireDueContactRequests(
  dependencies: ContactRequestLifecycleDependencies,
): Promise<Readonly<{ expired: number; failed: number }>> {
  const now = dependencies.now ?? new Date();
  if (
    !z.uuid().safeParse(dependencies.correlationId).success ||
    !Number.isFinite(now.getTime())
  ) {
    return Object.freeze({ expired: 0, failed: 1 });
  }
  const due = await dependencies.database.employerContactRequest.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true },
  });
  let expired = 0;
  let failed = 0;
  for (const request of due) {
    const result = await expireContactRequest(
      {
        requestId: request.id,
        idempotencyKey: `expire:${request.id}`,
      },
      { ...dependencies, now },
    );
    if (result.ok) expired += result.replay === true ? 0 : 1;
    else failed += 1;
  }
  return Object.freeze({ expired, failed });
}

export function isContactRequestEffectiveAt(
  request: Readonly<{
    status: string;
    createdAt: Date;
    expiresAt: Date;
  }>,
  now: Date,
): boolean {
  return (
    request.status === "PENDING" &&
    Number.isFinite(request.createdAt.getTime()) &&
    Number.isFinite(request.expiresAt.getTime()) &&
    Number.isFinite(now.getTime()) &&
    request.createdAt.getTime() <= now.getTime() &&
    now.getTime() < request.expiresAt.getTime()
  );
}

export function contactLifecycleEventKey(
  kind: "accepted" | "declined" | "cancelled",
  actorUserId: string,
  idempotencyKey: string,
): string {
  return `contact-event:${kind}:${sha256(`${actorUserId}\0${idempotencyKey}`)}`;
}

async function transitionCandidateContactRequest(
  action: CandidateTransitionAction,
  raw: unknown,
  actor: CandidateContactRequestActor,
  dependencies: ContactRequestLifecycleDependencies,
): Promise<ContactRequestLifecycleResult> {
  const parsed = parseLifecycleInput(raw, actor.userId, dependencies);
  if (!parsed.ok) return lifecycleFailure("INVALID_INPUT");
  const input = parsed.input;
  const now = parsed.now;

  return runSerializableLifecycleCommand(dependencies.database, async (transaction) => {
    await acquireRequestLock(transaction, input.requestId);
    const request = await transaction.employerContactRequest.findFirst({
      where: {
        id: input.requestId,
        candidateProfile: {
          userId: actor.userId,
          user: { status: "ACTIVE", role: "CANDIDATE" },
        },
      },
      select: {
        id: true,
        companyId: true,
        candidateProfileId: true,
        subject: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        candidateProfile: { select: { userId: true } },
      },
    });
    if (request === null) return lifecycleFailure("NOT_FOUND");
    if (!(await hasCurrentCompanyTrust(transaction, request.companyId))) {
      return lifecycleFailure("TRUST_REQUIRED");
    }

    const eventKind = action === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    const status = eventKind;
    const eventKey = contactLifecycleEventKey(
      action === "ACCEPT" ? "accepted" : "declined",
      actor.userId,
      input.idempotencyKey,
    );
    const replay = await loadLifecycleReplay(transaction, eventKey);
    if (replay !== null) {
      if (
        replay.contactRequestId !== request.id ||
        replay.kind !== eventKind ||
        replay.actorUserId !== actor.userId
      ) {
        return lifecycleFailure("IDEMPOTENCY_CONFLICT");
      }
      const conversation =
        action === "ACCEPT"
          ? await transaction.conversation.findUnique({
              where: { contactRequestId: request.id },
              select: { id: true },
            })
          : null;
      if (action === "ACCEPT" && conversation === null) {
        return lifecycleFailure("WRITE_FAILED");
      }
      return lifecycleSuccess(
        {
          requestId: request.id,
          status,
          conversationId: conversation?.id ?? null,
        },
        true,
      );
    }

    const decision = decideContactRequestTransition({
      action,
      actor: "CANDIDATE_OWNER",
      currentStatus: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      now,
    });
    if (decision.type !== "OK") return lifecycleFailure("CONFLICT");

    const updated = await transaction.employerContactRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status, terminalAt: now, updatedAt: now },
    });
    if (updated.count !== 1) return lifecycleFailure("CONFLICT");
    await transaction.contactRequestEvent.create({
      data: {
        id: randomUUID(),
        contactRequestId: request.id,
        kind: eventKind,
        actorUserId: actor.userId,
        reasonCode: null,
        correlationId: dependencies.correlationId,
        idempotencyKey: eventKey,
        createdAt: now,
      },
    });

    let conversationId: string | null = null;
    if (action === "ACCEPT") {
      const existingConversation = await transaction.conversation.findUnique({
        where: { contactRequestId: request.id },
        select: { id: true },
      });
      if (existingConversation !== null) {
        conversationId = existingConversation.id;
      } else {
        const conversation = await transaction.conversation.create({
          data: {
            id: randomUUID(),
            companyId: request.companyId,
            kind: "TALENT_RADAR",
            applicationId: null,
            contactRequestId: request.id,
            subject: request.subject,
            createdAt: now,
            updatedAt: now,
            participants: {
              create: [
                {
                  kind: "USER",
                  userId: request.candidateProfile.userId,
                  companyId: null,
                  joinedAt: now,
                },
                {
                  kind: "COMPANY_PRINCIPAL",
                  userId: null,
                  companyId: request.companyId,
                  joinedAt: now,
                },
              ],
            },
          },
          select: { id: true },
        });
        conversationId = conversation.id;
      }
    }

    const recipients = await loadCurrentCompanyRecipients(
      transaction,
      request.companyId,
    );
    for (const recipientUserId of recipients) {
      await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
        recipientUserId,
        kind:
          action === "ACCEPT"
            ? "CONTACT_REQUEST_ACCEPTED"
            : "CONTACT_REQUEST_DECLINED",
        dedupeKey: eventKey,
        payload: { requestId: request.id, status },
      });
    }
    await writeContactLifecycleAudit(transaction, {
      action:
        action === "ACCEPT"
          ? "CONTACT_REQUEST_ACCEPTED"
          : "CONTACT_REQUEST_DECLINED",
      actorKind: "USER",
      actorUserId: actor.userId,
      capability: "CANDIDATE_TALENT_CONTACT_DECIDE",
      companyId: request.companyId,
      correlationId: dependencies.correlationId,
      reasonCode:
        action === "ACCEPT" ? "CANDIDATE_ACCEPTED" : "CANDIDATE_DECLINED",
      requestId: request.id,
      now,
    });
    return lifecycleSuccess({
      requestId: request.id,
      status,
      conversationId,
    });
  });
}

function parseLifecycleInput(
  raw: unknown,
  actorUserId: string | null,
  dependencies: ContactRequestLifecycleDependencies,
):
  | Readonly<{
      ok: true;
      input: z.infer<typeof contactTransitionInputSchema>;
      now: Date;
    }>
  | Readonly<{ ok: false }> {
  const input = contactTransitionInputSchema.safeParse(raw);
  const now = dependencies.now ?? new Date();
  const context = z
    .strictObject({
      correlationId: z.uuid(),
      actorUserId: z.uuid().nullable(),
      now: z.date(),
    })
    .safeParse({
      correlationId: dependencies.correlationId,
      actorUserId,
      now,
    });
  return input.success && context.success && Number.isFinite(now.getTime())
    ? Object.freeze({ ok: true as const, input: input.data, now: new Date(now) })
    : Object.freeze({ ok: false as const });
}

async function hasCurrentEmployerTrust(
  transaction: Prisma.TransactionClient,
  actor: EmployerRadarContactActor,
): Promise<boolean> {
  const membership = await transaction.companyMembership.findFirst({
    where: {
      id: actor.membershipId,
      companyId: actor.companyId,
      userId: actor.userId,
      status: "ACTIVE",
      removedAt: null,
      role: { in: ["OWNER", "ADMIN", "RECRUITER"] },
      user: {
        status: "ACTIVE",
        role: { in: ["EMPLOYER", "RECRUITER"] },
      },
      company: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  return membership !== null &&
    (await currentVerificationCount(transaction, actor.companyId)) === 1;
}

async function hasCurrentCompanyTrust(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<boolean> {
  const company = await transaction.company.findUnique({
    where: { id: companyId },
    select: { status: true },
  });
  return company?.status === "ACTIVE" &&
    (await currentVerificationCount(transaction, companyId)) === 1;
}

async function currentVerificationCount(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  return transaction.companyVerificationRequest.count({
    where: { companyId, status: "VERIFIED", supersededBy: null },
  });
}

async function loadCurrentCompanyRecipients(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<readonly string[]> {
  const memberships = await transaction.companyMembership.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      removedAt: null,
      role: { in: ["OWNER", "ADMIN", "RECRUITER"] },
      user: { status: "ACTIVE" },
    },
    orderBy: [{ id: "asc" }],
    take: 500,
    select: { userId: true },
  });
  return Object.freeze([...new Set(memberships.map(({ userId }) => userId))]);
}

async function loadLifecycleReplay(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
) {
  return transaction.contactRequestEvent.findUnique({
    where: { idempotencyKey },
    select: {
      contactRequestId: true,
      kind: true,
      actorUserId: true,
    },
  });
}

async function acquireRequestLock(
  transaction: Prisma.TransactionClient,
  requestId: string,
): Promise<void> {
  const key = sha256(`talent-contact:request:${requestId}`);
  await transaction.$queryRaw<readonly { locked: boolean }[]>`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
  `;
  await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "EmployerContactRequest"
    WHERE "id" = ${requestId}::uuid
    FOR UPDATE
  `;
}

async function acquireEmployerCancellationLocks(
  transaction: Prisma.TransactionClient,
  companyId: string,
  requestId: string,
): Promise<void> {
  const keys = [
    sha256(`talent-contact:company:${companyId}`),
    sha256(`talent-contact:request:${requestId}`),
  ].sort();
  for (const key of keys) {
    await transaction.$queryRaw<readonly { locked: boolean }[]>`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
    `;
  }
  await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE
  `;
  await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "EmployerContactRequest"
    WHERE "id" = ${requestId}::uuid
    FOR UPDATE
  `;
}

async function writeContactLifecycleAudit(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    action:
      | "CONTACT_REQUEST_ACCEPTED"
      | "CONTACT_REQUEST_DECLINED"
      | "CONTACT_REQUEST_EXPIRED"
      | "CONTACT_REQUEST_CANCELLED";
    actorKind: "USER" | "SYSTEM";
    actorUserId: string | null;
    capability: string;
    companyId: string;
    correlationId: string;
    reasonCode: string;
    requestId: string;
    now: Date;
  }>,
): Promise<void> {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: input.actorKind,
    ...(input.actorUserId === null ? {} : { actorUserId: input.actorUserId }),
    capability: input.capability,
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + AUDIT_RETENTION_MILLISECONDS),
    targetId: input.requestId,
    targetType: "CONTACT_REQUEST",
  });
}

async function runSerializableLifecycleCommand(
  database: DatabaseClient,
  command: (
    transaction: Prisma.TransactionClient,
  ) => Promise<ContactRequestLifecycleResult>,
): Promise<ContactRequestLifecycleResult> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(command, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        return lifecycleFailure("WRITE_FAILED");
      }
    }
  }
  return lifecycleFailure("WRITE_FAILED");
}

function isRetryableDatabaseError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";
  return /could not serialize access|deadlock detected|write conflict/iu.test(
    message,
  );
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code.slice(0, 32)
    : undefined;
}

function lifecycleSuccess(
  value: Extract<ContactRequestLifecycleResult, { ok: true }>["value"],
  replay = false,
): Extract<ContactRequestLifecycleResult, { ok: true }> {
  return Object.freeze({
    ok: true as const,
    value: Object.freeze(value),
    ...(replay ? { replay: true as const } : {}),
  });
}

function lifecycleFailure(
  code: Extract<ContactRequestLifecycleResult, { ok: false }>["code"],
): Extract<ContactRequestLifecycleResult, { ok: false }> {
  return Object.freeze({ ok: false as const, code });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
