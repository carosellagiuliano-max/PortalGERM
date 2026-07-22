import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  writeRequiredAudit,
  type AuditPersistenceRecord,
} from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  PrivacyRequestEventKind,
  PrivacyRequestStatus,
  type PrivacyCorrectionFieldCode,
  type PrivacyCorrectionOutcomeCode,
  type PrivacyDeletionDependencyCode,
  type PrivacyDeletionOutcomeCode,
  type PrivacyRequestEventKind as PrivacyRequestEventKindType,
  type PrivacyRequestRejectionCode,
  type PrivacyRequestStatus as PrivacyRequestStatusType,
  type PrivacyRequestType,
} from "@/lib/generated/prisma/enums";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { createPostgresPrivacyExportAdapter } from "@/lib/privacy/postgres-export-adapter";
import {
  decidePrivacyCaseTransitionV1,
  privacyCaseCommandSchema,
  PRIVACY_REQUEST_POLICY_V1,
  type PrivacyCaseAction,
  type PrivacyCaseActor,
  type PrivacyCaseCommand,
  type PrivacyCaseDecision,
  type PrivacyCaseState,
  type PrivacyIdentityChallengeState,
  type StoredPrivacyCaseResult,
} from "@/lib/privacy/requests";

const UUID = z.string().uuid();
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const CASE_ERROR = "Privacy case operation is unavailable.";
const PRIVACY_AUDIT_RETENTION_DAYS = 400;

const ADMIN_CAPABILITIES = [
  "PRIVACY_CASE_READ",
  "PRIVACY_CASE_VERIFY",
  "PRIVACY_CASE_PROCESS",
] as const;

const JUSTIFIED_ACCESS_CODES = [
  "QUEUE_TRIAGE",
  "SUPERVISORY_REVIEW",
  "LEGAL_REVIEW",
] as const;

const queueInputSchema = z
  .object({
    status: z.enum(PrivacyRequestStatus).optional(),
    limit: z.number().int().min(1).max(50).default(25),
  })
  .strict();

const detailInputSchema = z
  .object({
    requestId: UUID,
    justificationCode: z.enum(JUSTIFIED_ACCESS_CODES).optional(),
  })
  .strict();

const adminActorSchema = z
  .object({
    userId: UUID,
    capabilities: z
      .array(z.enum(ADMIN_CAPABILITIES))
      .max(ADMIN_CAPABILITIES.length)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

const ownerActorSchema = z.object({ userId: UUID }).strict();
const credentialEvidenceSchema = z
  .object({ credentialVerified: z.boolean() })
  .strict();

export const PRIVACY_CASE_SERVICE_POLICY_V1 = Object.freeze({
  lockNamespace: "privacy-case-v1" as const,
  transactionTimeoutMilliseconds: 15_000,
  auditRetentionDays: PRIVACY_AUDIT_RETENTION_DAYS,
  challengeLifetimeMinutes:
    PRIVACY_REQUEST_POLICY_V1.challengeLifetimeMinutes,
  challengeMaximumAttempts:
    PRIVACY_REQUEST_POLICY_V1.challengeMaximumAttempts,
  queueMaximumRows: 50,
  justifiedAccessCodes: Object.freeze([...JUSTIFIED_ACCESS_CODES]),
});

export type PrivacyCaseAdminCapability = (typeof ADMIN_CAPABILITIES)[number];
export type PrivacyCaseAdminActor = Readonly<{
  userId: string;
  capabilities: readonly PrivacyCaseAdminCapability[];
}>;
export type PrivacyCaseOwnerActor = Readonly<{ userId: string }>;

/**
 * Evidence from the action-layer credential verifier. This service never
 * accepts a password, password hash, token, identity document or client-owned
 * verification flag.
 */
export type PrivacyCredentialVerificationEvidence = Readonly<{
  credentialVerified: boolean;
}>;

export type PrivacyCaseAgeBucket =
  | "LT_24_HOURS"
  | "ONE_TO_THREE_DAYS"
  | "FOUR_TO_SEVEN_DAYS"
  | "EIGHT_TO_THIRTY_DAYS"
  | "OVER_THIRTY_DAYS";

export type PrivacyCaseDueBucket =
  | "OVERDUE"
  | "DUE_WITHIN_TWO_DAYS"
  | "DUE_WITHIN_SEVEN_DAYS"
  | "DUE_WITHIN_FOURTEEN_DAYS"
  | "DUE_LATER";

export type PrivacyCaseQueueItem = Readonly<{
  id: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatusType;
  ageBucket: PrivacyCaseAgeBucket;
  dueBucket: PrivacyCaseDueBucket;
}>;

export type PrivacyCaseQueueResult =
  | Readonly<{ ok: true; cases: readonly PrivacyCaseQueueItem[] }>
  | Readonly<{ ok: false; code: "FORBIDDEN" | "INVALID_INPUT" }>;

export type PrivacyCaseDetail = Readonly<{
  id: string;
  requesterUserId: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatusType;
  version: number;
  noticeVersion: string;
  dueAt: Date;
  createdAt: Date;
  updatedAt: Date;
  assignment: Readonly<{
    assignedAdminUserId: string | null;
    reasonCode: string | null;
  }>;
  verification: Readonly<{
    verifiedAt: Date | null;
    processingStartedAt: Date | null;
    challenge: Readonly<{
      attempts: number;
      expiresAt: Date;
      verifiedAt: Date | null;
      consumedAt: Date | null;
    }> | null;
  }>;
  correction: Readonly<{
    fields: readonly Readonly<{
      fieldCode: PrivacyCorrectionFieldCode;
      correctionText: string;
      reviewedAt: Date | null;
    }>[];
    outcomeCode: PrivacyCorrectionOutcomeCode | null;
    domainEventRefs: readonly string[];
  }>;
  deletion: Readonly<{
    dependencyCodes: readonly PrivacyDeletionDependencyCode[];
    outcomeCode: PrivacyDeletionOutcomeCode | null;
  }>;
  rejectionCode: PrivacyRequestRejectionCode | null;
  safeOutcomeNote: string | null;
  completedAt: Date | null;
  events: readonly Readonly<{
    kind: PrivacyRequestEventKindType;
    fromStatus: PrivacyRequestStatusType | null;
    toStatus: PrivacyRequestStatusType;
    reasonCode: string | null;
    safeNote: string | null;
    createdAt: Date;
  }>[];
}>;

export type PrivacyCaseDetailResult =
  | Readonly<{ ok: true; privacyCase: PrivacyCaseDetail }>
  | Readonly<{
      ok: false;
      code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND";
    }>;

export type PrivacyCaseMutationFailureCode =
  | Extract<PrivacyCaseDecision, { allowed: false }>["reason"]
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CHALLENGE_UNAVAILABLE";

export type PrivacyCaseMutationResult =
  | Readonly<{
      ok: true;
      idempotent: boolean;
      requestId: string;
      status: PrivacyRequestStatusType;
      version: number;
    }>
  | Readonly<{ ok: false; code: PrivacyCaseMutationFailureCode }>;

type CommandFor<Action extends PrivacyCaseAction> = Omit<
  Extract<PrivacyCaseCommand, { action: Action }>,
  "action"
>;

export type PrivacyCaseService = Readonly<{
  listAdminQueue(
    actor: PrivacyCaseAdminActor,
    input: unknown,
    now: Date,
  ): Promise<PrivacyCaseQueueResult>;
  getAdminDetail(
    actor: PrivacyCaseAdminActor,
    input: unknown,
    now: Date,
  ): Promise<PrivacyCaseDetailResult>;
  startIdentityCheck(
    actor: PrivacyCaseAdminActor,
    command: CommandFor<"START_IDENTITY_CHECK">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  completeIdentityChallenge(
    actor: PrivacyCaseOwnerActor,
    command: CommandFor<"COMPLETE_CHALLENGE">,
    evidence: PrivacyCredentialVerificationEvidence,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  verifyIdentity(
    actor: PrivacyCaseAdminActor,
    command: CommandFor<"VERIFY_IDENTITY">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  cancelOwnedRequest(
    actor: PrivacyCaseOwnerActor,
    command: CommandFor<"CANCEL">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  completeDeletionAssessment(
    actor: PrivacyCaseAdminActor,
    command: CommandFor<"COMPLETE_DELETE">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  completeCorrectionOutcome(
    actor: PrivacyCaseAdminActor,
    command: CommandFor<"COMPLETE_CORRECTION">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  rejectRequest(
    actor: PrivacyCaseAdminActor,
    command: CommandFor<"REJECT">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  addInternalNote(
    actor: PrivacyCaseAdminActor,
    command: CommandFor<"ADD_NOTE">,
    now: Date,
  ): Promise<PrivacyCaseMutationResult>;
  /** Existing manifest policy owns its own lock, idempotent stored result and audits. */
  exportCompletion: ReturnType<typeof createPostgresPrivacyExportAdapter>;
}>;

type TransactionClient = Prisma.TransactionClient;
type ParsedAdminActor = z.output<typeof adminActorSchema>;
type LoadedCase = Awaited<ReturnType<typeof loadLockedCase>>;

export function createPostgresPrivacyCaseService(
  database: DatabaseClient,
): PrivacyCaseService {
  return Object.freeze({
    listAdminQueue: (actor, input, now) =>
      listAdminQueue(database, actor, input, now),
    getAdminDetail: (actor, input, now) =>
      getAdminDetail(database, actor, input, now),
    startIdentityCheck: (actor, command, now) =>
      executeAdminCommand(database, actor, {
        ...command,
        action: "START_IDENTITY_CHECK",
      }, now),
    completeIdentityChallenge: (actor, command, evidence, now) =>
      completeIdentityChallenge(database, actor, {
        ...command,
        action: "COMPLETE_CHALLENGE",
      }, evidence, now),
    verifyIdentity: (actor, command, now) =>
      executeAdminCommand(database, actor, {
        ...command,
        action: "VERIFY_IDENTITY",
      }, now),
    cancelOwnedRequest: (actor, command, now) =>
      executeOwnerCommand(database, actor, {
        ...command,
        action: "CANCEL",
      }, now),
    completeDeletionAssessment: (actor, command, now) =>
      executeAdminCommand(database, actor, {
        ...command,
        action: "COMPLETE_DELETE",
      }, now),
    completeCorrectionOutcome: (actor, command, now) =>
      executeAdminCommand(database, actor, {
        ...command,
        action: "COMPLETE_CORRECTION",
      }, now),
    rejectRequest: (actor, command, now) =>
      executeAdminCommand(database, actor, {
        ...command,
        action: "REJECT",
      }, now),
    addInternalNote: (actor, command, now) =>
      executeAdminCommand(database, actor, {
        ...command,
        action: "ADD_NOTE",
      }, now),
    exportCompletion: createPostgresPrivacyExportAdapter(database),
  });
}

async function listAdminQueue(
  database: DatabaseClient,
  rawActor: PrivacyCaseAdminActor,
  rawInput: unknown,
  now: Date,
): Promise<PrivacyCaseQueueResult> {
  const actor = adminActorSchema.safeParse(rawActor);
  const input = queueInputSchema.safeParse(rawInput);
  if (!actor.success || !input.success || !isValidDate(now)) {
    return failure("INVALID_INPUT");
  }
  if (!actor.data.capabilities.includes("PRIVACY_CASE_READ")) {
    return failure("FORBIDDEN");
  }

  return database.$transaction(async (transaction) => {
    if (!(await isActiveAdmin(transaction, actor.data.userId))) {
      return failure("FORBIDDEN");
    }
    const rows = await transaction.privacyRequest.findMany({
      where:
        input.data.status === undefined
          ? undefined
          : { status: input.data.status },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: input.data.limit,
      select: {
        id: true,
        type: true,
        status: true,
        dueAt: true,
        createdAt: true,
      },
    });

    const correlationId = randomUUID();
    if (rows.length === 0) {
      await writePrivacyAudit(transaction, {
        action: "PRIVACY_CASE_ACCESSED",
        actorUserId: actor.data.userId,
        capability: "PRIVACY_CASE_READ",
        correlationId,
        reasonCode: "EMPTY_QUEUE_READ",
        targetId: actor.data.userId,
        targetType: "USER",
        now,
      });
    } else {
      for (const row of rows) {
        await writePrivacyAudit(transaction, {
          action: "PRIVACY_CASE_ACCESSED",
          actorUserId: actor.data.userId,
          capability: "PRIVACY_CASE_READ",
          correlationId,
          reasonCode: "QUEUE_READ",
          targetId: row.id,
          targetType: "PRIVACY_REQUEST",
          now,
        });
      }
    }

    return Object.freeze({
      ok: true as const,
      cases: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            id: row.id,
            type: row.type,
            status: row.status,
            ageBucket: ageBucket(row.createdAt, now),
            dueBucket: dueBucket(row.dueAt, now),
          }),
        ),
      ),
    });
  }, transactionOptions());
}

async function getAdminDetail(
  database: DatabaseClient,
  rawActor: PrivacyCaseAdminActor,
  rawInput: unknown,
  now: Date,
): Promise<PrivacyCaseDetailResult> {
  const actor = adminActorSchema.safeParse(rawActor);
  const input = detailInputSchema.safeParse(rawInput);
  if (!actor.success || !input.success || !isValidDate(now)) {
    return failure("INVALID_INPUT");
  }
  if (!actor.data.capabilities.includes("PRIVACY_CASE_READ")) {
    return failure("FORBIDDEN");
  }

  return database.$transaction(async (transaction) => {
    if (!(await isActiveAdmin(transaction, actor.data.userId))) {
      return failure("FORBIDDEN");
    }
    const privacyCase = await transaction.privacyRequest.findUnique({
      where: { id: input.data.requestId },
      select: detailSelect,
    });
    if (privacyCase === null) return failure("NOT_FOUND");

    const assigned = privacyCase.assignedAdminUserId === actor.data.userId;
    const justified = input.data.justificationCode !== undefined;
    if (!assigned && !justified) return failure("NOT_FOUND");

    const accessReason = assigned
      ? "ASSIGNED_CASE"
      : input.data.justificationCode!;
    await writePrivacyAudit(transaction, {
      action: "PRIVACY_CASE_ACCESSED",
      actorUserId: actor.data.userId,
      capability: "PRIVACY_CASE_READ",
      correlationId: randomUUID(),
      reasonCode: accessReason,
      targetId: privacyCase.id,
      targetType: "PRIVACY_REQUEST",
      now,
    });
    return Object.freeze({
      ok: true as const,
      privacyCase: toSafeCaseDetail(privacyCase),
    });
  }, transactionOptions());
}

async function executeAdminCommand(
  database: DatabaseClient,
  rawActor: PrivacyCaseAdminActor,
  rawCommand: unknown,
  now: Date,
): Promise<PrivacyCaseMutationResult> {
  const actor = adminActorSchema.safeParse(rawActor);
  const command = privacyCaseCommandSchema.safeParse(rawCommand);
  if (!actor.success || !command.success || !isValidDate(now)) {
    return failure("INVALID_COMMAND");
  }
  const requiredCapability = capabilityForAction(command.data.action);
  if (
    requiredCapability === null ||
    !actor.data.capabilities.includes(requiredCapability)
  ) {
    return failure("FORBIDDEN");
  }

  return runMutation(database, command.data.requestId, async (transaction) => {
    const loaded = await loadLockedCase(transaction, command.data.requestId);
    if (loaded === null) return failure("NOT_FOUND");
    if (!(await isActiveAdmin(transaction, actor.data.userId))) {
      return failure("FORBIDDEN");
    }
    if (
      loaded.assignedAdminUserId !== null &&
      loaded.assignedAdminUserId !== actor.data.userId
    ) {
      return failure("FORBIDDEN");
    }

    const stored = await loadStoredCommandResult(
      transaction,
      command.data.requestId,
      command.data.idempotencyKey,
      command.data.action,
    );
    if (stored.outcome === "REUSED") return failure("IDEMPOTENCY_KEY_REUSED");

    const decision = decidePrivacyCaseTransitionV1(
      toCaseState(loaded, stored.result),
      toDecisionActor(actor.data, loaded),
      command.data,
      now,
    );
    if (!decision.allowed) return failure(decision.reason);
    if (decision.idempotent) {
      return mutationSuccess(
        loaded.id,
        decision.toStatus,
        loaded.version,
        true,
      );
    }

    return applyAdminDecision(
      transaction,
      loaded,
      actor.data,
      command.data,
      decision,
      now,
    );
  });
}

async function executeOwnerCommand(
  database: DatabaseClient,
  rawActor: PrivacyCaseOwnerActor,
  rawCommand: unknown,
  now: Date,
): Promise<PrivacyCaseMutationResult> {
  const actor = ownerActorSchema.safeParse(rawActor);
  const command = privacyCaseCommandSchema.safeParse(rawCommand);
  if (
    !actor.success ||
    !command.success ||
    command.data.action !== "CANCEL" ||
    !isValidDate(now)
  ) {
    return failure("INVALID_COMMAND");
  }
  const cancelCommand = command.data as Extract<
    PrivacyCaseCommand,
    { action: "CANCEL" }
  >;

  return runMutation(database, cancelCommand.requestId, async (transaction) => {
    const loaded = await loadLockedCase(transaction, cancelCommand.requestId);
    if (loaded === null || loaded.requesterUserId !== actor.data.userId) {
      return failure("NOT_FOUND");
    }
    const stored = await loadStoredCommandResult(
      transaction,
      cancelCommand.requestId,
      cancelCommand.idempotencyKey,
      cancelCommand.action,
    );
    if (stored.outcome === "REUSED") return failure("IDEMPOTENCY_KEY_REUSED");

    const decision = decidePrivacyCaseTransitionV1(
      toCaseState(loaded, stored.result),
      {
        userId: actor.data.userId,
        emailVerified: loaded.requester.emailVerifiedAt !== null,
        capabilities: [],
      },
      cancelCommand,
      now,
    );
    if (!decision.allowed) return failure(decision.reason);
    if (decision.idempotent) {
      return mutationSuccess(
        loaded.id,
        decision.toStatus,
        loaded.version,
        true,
      );
    }
    return applyCancellation(
      transaction,
      loaded,
      actor.data.userId,
      cancelCommand,
      decision,
      now,
    );
  });
}

async function completeIdentityChallenge(
  database: DatabaseClient,
  rawActor: PrivacyCaseOwnerActor,
  rawCommand: unknown,
  evidence: PrivacyCredentialVerificationEvidence,
  now: Date,
): Promise<PrivacyCaseMutationResult> {
  const actor = ownerActorSchema.safeParse(rawActor);
  const command = privacyCaseCommandSchema.safeParse(rawCommand);
  const parsedEvidence = credentialEvidenceSchema.safeParse(evidence);
  if (
    !actor.success ||
    !command.success ||
    command.data.action !== "COMPLETE_CHALLENGE" ||
    !parsedEvidence.success ||
    !isValidDate(now)
  ) {
    return failure("INVALID_COMMAND");
  }

  return runMutation(database, command.data.requestId, async (transaction) => {
    const loaded = await loadLockedCase(transaction, command.data.requestId);
    if (loaded === null || loaded.requesterUserId !== actor.data.userId) {
      return failure("NOT_FOUND");
    }
    const challenge = loaded.challenges[0] ?? null;
    if (
      challenge?.idempotencyKey === command.data.idempotencyKey &&
      challenge.verifiedAt !== null
    ) {
      return mutationSuccess(
        loaded.id,
        loaded.status,
        loaded.version,
        true,
      );
    }
    if (
      challenge?.idempotencyKey === command.data.idempotencyKey &&
      challenge.verifiedAt === null
    ) {
      return failure("CHALLENGE_UNAVAILABLE");
    }
    const keyOwner = await transaction.privacyIdentityChallenge.findUnique({
      where: { idempotencyKey: command.data.idempotencyKey },
      select: { privacyRequestId: true },
    });
    if (
      keyOwner !== null &&
      keyOwner.privacyRequestId !== command.data.requestId
    ) {
      return failure("IDEMPOTENCY_KEY_REUSED");
    }

    const decision = decidePrivacyCaseTransitionV1(
      toCaseState(loaded),
      {
        userId: actor.data.userId,
        emailVerified: loaded.requester.emailVerifiedAt !== null,
        capabilities: [],
      },
      command.data,
      now,
      { credentialVerified: parsedEvidence.data.credentialVerified },
    );

    if (!decision.allowed) {
      if (
        decision.reason === "CHALLENGE_UNAVAILABLE" &&
        canRecordChallengeAttempt(loaded, now)
      ) {
        await recordFailedChallengeAttempt(
          transaction,
          loaded,
          command.data.idempotencyKey,
          actor.data.userId,
          now,
        );
      }
      return failure(decision.reason);
    }

    if (challenge === null) return failure("CHALLENGE_UNAVAILABLE");
    const updatedChallenge = await transaction.privacyIdentityChallenge.updateMany({
      where: {
        id: challenge.id,
        privacyRequestId: loaded.id,
        userId: loaded.requesterUserId,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: {
          lt: PRIVACY_CASE_SERVICE_POLICY_V1.challengeMaximumAttempts,
        },
      },
      data: {
        attempts: { increment: 1 },
        verifiedAt: now,
        idempotencyKey: command.data.idempotencyKey,
      },
    });
    if (updatedChallenge.count !== 1) return failure("CHALLENGE_UNAVAILABLE");

    const updatedCase = await transaction.privacyRequest.updateMany({
      where: {
        id: loaded.id,
        requesterUserId: actor.data.userId,
        status: PrivacyRequestStatus.IDENTITY_CHECK,
        version: loaded.version,
      },
      data: { version: { increment: 1 } },
    });
    if (updatedCase.count !== 1) return failure("STALE_VERSION");

    await writePrivacyAudit(transaction, {
      action: "PRIVACY_CASE_ACCESSED",
      actorUserId: actor.data.userId,
      capability: "PRIVACY_IDENTITY_CHALLENGE_COMPLETE",
      correlationId: randomUUID(),
      reasonCode: "IDENTITY_VERIFIED",
      targetId: loaded.id,
      targetType: "PRIVACY_REQUEST",
      now,
    });
    return mutationSuccess(
      loaded.id,
      PrivacyRequestStatus.IDENTITY_CHECK,
      loaded.version + 1,
      false,
    );
  });
}

async function applyAdminDecision(
  transaction: TransactionClient,
  loaded: NonNullable<LoadedCase>,
  actor: ParsedAdminActor,
  command: PrivacyCaseCommand,
  decision: Extract<PrivacyCaseDecision, { allowed: true }>,
  now: Date,
): Promise<PrivacyCaseMutationResult> {
  const correlationId = randomUUID();
  const assignment =
    loaded.assignedAdminUserId === null
      ? {
          assignedAdminUserId: actor.userId,
          assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
        }
      : {};

  switch (command.action) {
    case "START_IDENTITY_CHECK": {
      const updated = await updateCaseVersion(transaction, loaded, {
        ...assignment,
        status: PrivacyRequestStatus.IDENTITY_CHECK,
      });
      if (!updated) return failure("STALE_VERSION");
      await transaction.privacyIdentityChallenge.create({
        data: {
          privacyRequestId: loaded.id,
          userId: loaded.requesterUserId,
          attempts: 0,
          expiresAt: new Date(
            now.getTime() +
              PRIVACY_CASE_SERVICE_POLICY_V1.challengeLifetimeMinutes * 60_000,
          ),
          idempotencyKey: derivedIdempotencyKey(
            "PRIVACY_CHALLENGE",
            loaded.id,
            command.idempotencyKey,
          ),
          createdAt: now,
        },
      });
      await createCaseEvent(transaction, {
        loaded,
        actorUserId: actor.userId,
        kind: PrivacyRequestEventKind.IDENTITY_REQUESTED,
        fromStatus: loaded.status,
        toStatus: PrivacyRequestStatus.IDENTITY_CHECK,
        reasonCode: "IDENTITY_CHECK_REQUIRED",
        idempotencyKey: command.idempotencyKey,
        correlationId,
        now,
      });
      await notifyRequester(
        transaction,
        loaded,
        PrivacyRequestStatus.IDENTITY_CHECK,
        "IDENTITY_CHECK_REQUIRED",
        command.idempotencyKey,
      );
      break;
    }
    case "VERIFY_IDENTITY": {
      const challenge = loaded.challenges[0];
      if (challenge === undefined) return failure("CHALLENGE_UNAVAILABLE");
      const consumed = await transaction.privacyIdentityChallenge.updateMany({
        where: {
          id: challenge.id,
          privacyRequestId: loaded.id,
          userId: loaded.requesterUserId,
          verifiedAt: { not: null, lte: now },
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: {
            lte: PRIVACY_CASE_SERVICE_POLICY_V1.challengeMaximumAttempts,
          },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return failure("CHALLENGE_UNAVAILABLE");
      const updated = await updateCaseVersion(transaction, loaded, {
        ...assignment,
        status: PrivacyRequestStatus.IN_PROGRESS,
        verifiedAt: now,
        processingStartedAt: now,
      });
      if (!updated) return failure("STALE_VERSION");
      await createCaseEvent(transaction, {
        loaded,
        actorUserId: actor.userId,
        kind: PrivacyRequestEventKind.VERIFIED,
        fromStatus: loaded.status,
        toStatus: loaded.status,
        reasonCode: "IDENTITY_VERIFIED",
        idempotencyKey: derivedIdempotencyKey(
          "PRIVACY_VERIFIED",
          loaded.id,
          command.idempotencyKey,
        ),
        correlationId,
        now,
      });
      await createCaseEvent(transaction, {
        loaded,
        actorUserId: actor.userId,
        kind: PrivacyRequestEventKind.PROCESSING_STARTED,
        fromStatus: loaded.status,
        toStatus: PrivacyRequestStatus.IN_PROGRESS,
        reasonCode: "PROCESSING_STARTED",
        idempotencyKey: command.idempotencyKey,
        correlationId,
        now,
      });
      await notifyRequester(
        transaction,
        loaded,
        PrivacyRequestStatus.IN_PROGRESS,
        "PROCESSING_STARTED",
        command.idempotencyKey,
      );
      break;
    }
    case "COMPLETE_DELETE": {
      const updated = await updateCaseVersion(transaction, loaded, {
        ...assignment,
        status: PrivacyRequestStatus.COMPLETED,
        deletionDependencies: [...command.dependencyCodes],
        deletionOutcome: command.outcomeCode,
        safeOutcomeNote: command.safeNote ?? null,
        completedAt: now,
      });
      if (!updated) return failure("STALE_VERSION");
      await createCompletionEvidence(
        transaction,
        loaded,
        actor.userId,
        command.idempotencyKey,
        "DELETE_ASSESSMENT_COMPLETED",
        command.safeNote ?? null,
        correlationId,
        now,
      );
      break;
    }
    case "COMPLETE_CORRECTION": {
      const updated = await updateCaseVersion(transaction, loaded, {
        ...assignment,
        status: PrivacyRequestStatus.COMPLETED,
        correctionOutcome: command.outcomeCode,
        domainEventRefs: command.domainEventRefs ?? [],
        safeOutcomeNote: command.safeNote ?? null,
        completedAt: now,
      });
      if (!updated) return failure("STALE_VERSION");
      await transaction.privacyRequestCorrectionField.updateMany({
        where: {
          privacyRequestId: loaded.id,
          fieldCode: { in: [...command.reviewedFieldCodes] },
        },
        data: { reviewedAt: now },
      });
      await createCompletionEvidence(
        transaction,
        loaded,
        actor.userId,
        command.idempotencyKey,
        "CORRECTION_OUTCOME_COMPLETED",
        command.safeNote ?? null,
        correlationId,
        now,
      );
      break;
    }
    case "REJECT": {
      const updated = await updateCaseVersion(transaction, loaded, {
        ...assignment,
        status: PrivacyRequestStatus.REJECTED,
        rejectionCode: command.reasonCode,
        safeOutcomeNote: command.safeNote ?? null,
        completedAt: now,
      });
      if (!updated) return failure("STALE_VERSION");
      await createCaseEvent(transaction, {
        loaded,
        actorUserId: actor.userId,
        kind: PrivacyRequestEventKind.REJECTED,
        fromStatus: loaded.status,
        toStatus: PrivacyRequestStatus.REJECTED,
        reasonCode: command.reasonCode,
        safeNote: command.safeNote ?? null,
        idempotencyKey: command.idempotencyKey,
        correlationId,
        now,
      });
      await notifyRequester(
        transaction,
        loaded,
        PrivacyRequestStatus.REJECTED,
        command.reasonCode,
        command.idempotencyKey,
      );
      break;
    }
    case "ADD_NOTE": {
      const updated = await updateCaseVersion(transaction, loaded, assignment);
      if (!updated) return failure("STALE_VERSION");
      await createCaseEvent(transaction, {
        loaded,
        actorUserId: actor.userId,
        kind: PrivacyRequestEventKind.NOTE_ADDED,
        fromStatus: loaded.status,
        toStatus: loaded.status,
        reasonCode: "INTERNAL_NOTE",
        safeNote: command.note,
        idempotencyKey: command.idempotencyKey,
        correlationId,
        now,
      });
      break;
    }
    case "COMPLETE_EXPORT":
    case "COMPLETE_CHALLENGE":
    case "CANCEL":
      return failure("INVALID_COMMAND");
  }

  await writePrivacyAudit(transaction, {
    action:
      command.action === "ADD_NOTE"
        ? "PRIVACY_CASE_ACCESSED"
        : "PRIVACY_REQUEST_STATUS_CHANGED",
    actorUserId: actor.userId,
    capability: capabilityForAction(command.action)!,
    correlationId,
    reasonCode: auditReasonForCommand(command),
    targetId: loaded.id,
    targetType: "PRIVACY_REQUEST",
    now,
  });
  return mutationSuccess(
    loaded.id,
    decision.toStatus,
    loaded.version + 1,
    false,
  );
}

async function applyCancellation(
  transaction: TransactionClient,
  loaded: NonNullable<LoadedCase>,
  actorUserId: string,
  command: Extract<PrivacyCaseCommand, { action: "CANCEL" }>,
  decision: Extract<PrivacyCaseDecision, { allowed: true }>,
  now: Date,
): Promise<PrivacyCaseMutationResult> {
  const correlationId = randomUUID();
  const updated = await updateCaseVersion(transaction, loaded, {
    status: PrivacyRequestStatus.CANCELLED,
    completedAt: now,
  });
  if (!updated) return failure("STALE_VERSION");
  await createCaseEvent(transaction, {
    loaded,
    actorUserId,
    kind: PrivacyRequestEventKind.CANCELLED,
    fromStatus: loaded.status,
    toStatus: PrivacyRequestStatus.CANCELLED,
    reasonCode: "CANCELLED",
    idempotencyKey: command.idempotencyKey,
    correlationId,
    now,
  });
  if (loaded.assignedAdminUserId !== null) {
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: loaded.assignedAdminUserId,
      kind: "PRIVACY_REQUEST_CHANGED",
      dedupeKey: `privacy-case:${command.idempotencyKey}`,
      payload: {
        requestId: loaded.id,
        type: loaded.type,
        status: PrivacyRequestStatus.CANCELLED,
        reasonCode: "CANCELLED",
      },
    });
  }
  await writePrivacyAudit(transaction, {
    action: "PRIVACY_REQUEST_STATUS_CHANGED",
    actorUserId,
    capability: "PRIVACY_REQUEST_CANCEL",
    correlationId,
    reasonCode: "CANCELLED",
    targetId: loaded.id,
    targetType: "PRIVACY_REQUEST",
    now,
  });
  return mutationSuccess(
    loaded.id,
    decision.toStatus,
    loaded.version + 1,
    false,
  );
}

async function createCompletionEvidence(
  transaction: TransactionClient,
  loaded: NonNullable<LoadedCase>,
  actorUserId: string,
  idempotencyKey: string,
  reasonCode: "DELETE_ASSESSMENT_COMPLETED" | "CORRECTION_OUTCOME_COMPLETED",
  safeNote: string | null,
  correlationId: string,
  now: Date,
) {
  await createCaseEvent(transaction, {
    loaded,
    actorUserId,
    kind: PrivacyRequestEventKind.COMPLETED,
    fromStatus: loaded.status,
    toStatus: PrivacyRequestStatus.COMPLETED,
    reasonCode,
    safeNote,
    idempotencyKey,
    correlationId,
    now,
  });
  await notifyRequester(
    transaction,
    loaded,
    PrivacyRequestStatus.COMPLETED,
    "COMPLETED",
    idempotencyKey,
  );
}

async function recordFailedChallengeAttempt(
  transaction: TransactionClient,
  loaded: NonNullable<LoadedCase>,
  idempotencyKey: string,
  actorUserId: string,
  now: Date,
) {
  const challenge = loaded.challenges[0];
  if (challenge === undefined) return;
  const updated = await transaction.privacyIdentityChallenge.updateMany({
    where: {
      id: challenge.id,
      privacyRequestId: loaded.id,
      userId: actorUserId,
      verifiedAt: null,
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: {
        lt: PRIVACY_CASE_SERVICE_POLICY_V1.challengeMaximumAttempts,
      },
    },
    data: {
      attempts: { increment: 1 },
      idempotencyKey,
    },
  });
  if (updated.count !== 1) return;
  await writePrivacyAudit(transaction, {
    action: "AUTHORIZATION_DENIED_SENSITIVE",
    actorUserId,
    capability: "PRIVACY_IDENTITY_CHALLENGE_COMPLETE",
    correlationId: randomUUID(),
    reasonCode: "CHALLENGE_UNAVAILABLE",
    result: "DENIED",
    targetId: loaded.id,
    targetType: "PRIVACY_REQUEST",
    now,
  });
}

async function runMutation(
  database: DatabaseClient,
  requestId: string,
  operation: (transaction: TransactionClient) => Promise<PrivacyCaseMutationResult>,
): Promise<PrivacyCaseMutationResult> {
  if (!UUID.safeParse(requestId).success) return failure("INVALID_COMMAND");
  try {
    return await database.$transaction(async (transaction) => {
      await acquireCaseLock(transaction, requestId);
      return operation(transaction);
    }, transactionOptions());
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return failure("IDEMPOTENCY_KEY_REUSED");
    }
    throw new Error(CASE_ERROR, { cause: error });
  }
}

async function loadLockedCase(
  transaction: TransactionClient,
  requestId: string,
) {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PrivacyRequest"
    WHERE "id" = ${requestId}::uuid
    FOR UPDATE
  `;
  if (locked.length !== 1) return null;
  await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PrivacyIdentityChallenge"
    WHERE "privacyRequestId" = ${requestId}::uuid
    ORDER BY "createdAt" DESC, "id" DESC
    FOR UPDATE
  `;
  return transaction.privacyRequest.findUnique({
    where: { id: requestId },
    select: mutationSelect,
  });
}

async function loadStoredCommandResult(
  transaction: TransactionClient,
  requestId: string,
  idempotencyKey: string,
  action: PrivacyCaseAction,
): Promise<
  | Readonly<{ outcome: "AVAILABLE"; result?: StoredPrivacyCaseResult }>
  | Readonly<{ outcome: "REUSED" }>
> {
  const event = await transaction.privacyRequestEvent.findUnique({
    where: { idempotencyKey },
    select: {
      privacyRequestId: true,
      kind: true,
      reasonCode: true,
      fromStatus: true,
      toStatus: true,
      idempotencyKey: true,
    },
  });
  if (event === null) return Object.freeze({ outcome: "AVAILABLE" });
  const storedAction = actionForEvent(event.kind, event.reasonCode);
  if (
    event.privacyRequestId !== requestId ||
    storedAction === null ||
    storedAction !== action
  ) {
    return Object.freeze({ outcome: "REUSED" });
  }
  return Object.freeze({
    outcome: "AVAILABLE",
    result: Object.freeze({
      action: storedAction,
      idempotencyKey: event.idempotencyKey,
      fromStatus: event.fromStatus ?? event.toStatus,
      toStatus: event.toStatus,
      outcome:
        event.fromStatus === event.toStatus
          ? "NO_STATUS_CHANGE"
          : "TRANSITION",
    }),
  });
}

function toCaseState(
  loaded: NonNullable<LoadedCase>,
  lastResult?: StoredPrivacyCaseResult,
): PrivacyCaseState {
  const challenge = loaded.challenges[0];
  return Object.freeze({
    requestId: loaded.id,
    requesterUserId: loaded.requesterUserId,
    requesterUserStatus: loaded.requester.status,
    type: loaded.type,
    status: loaded.status,
    version: loaded.version,
    correctionFieldCodes: Object.freeze(
      loaded.correctionFields.map(({ fieldCode }) => fieldCode),
    ),
    challenge:
      challenge === undefined
        ? null
        : toChallengeState(loaded, challenge),
    ...(lastResult === undefined ? {} : { lastResult }),
  });
}

function toChallengeState(
  loaded: NonNullable<LoadedCase>,
  challenge: NonNullable<LoadedCase>["challenges"][number],
): PrivacyIdentityChallengeState {
  return Object.freeze({
    requestId: loaded.id,
    requesterUserId: loaded.requesterUserId,
    expiresAt: new Date(challenge.expiresAt),
    attempts: challenge.attempts,
    verifiedAt:
      challenge.verifiedAt === null ? null : new Date(challenge.verifiedAt),
    consumedAt:
      challenge.consumedAt === null ? null : new Date(challenge.consumedAt),
  });
}

function toDecisionActor(
  actor: ParsedAdminActor,
  loaded: NonNullable<LoadedCase>,
): PrivacyCaseActor {
  return Object.freeze({
    userId: actor.userId,
    emailVerified: loaded.requester.emailVerifiedAt !== null,
    capabilities: Object.freeze(
      actor.capabilities.filter(
        (capability): capability is "PRIVACY_CASE_VERIFY" | "PRIVACY_CASE_PROCESS" =>
          capability === "PRIVACY_CASE_VERIFY" ||
          capability === "PRIVACY_CASE_PROCESS",
      ),
    ),
  });
}

async function updateCaseVersion(
  transaction: TransactionClient,
  loaded: NonNullable<LoadedCase>,
  data: Prisma.PrivacyRequestUpdateManyMutationInput,
) {
  const updated = await transaction.privacyRequest.updateMany({
    where: {
      id: loaded.id,
      status: loaded.status,
      version: loaded.version,
    },
    data: { ...data, version: { increment: 1 } },
  });
  return updated.count === 1;
}

async function createCaseEvent(
  transaction: TransactionClient,
  input: Readonly<{
    loaded: NonNullable<LoadedCase>;
    kind: PrivacyRequestEventKindType;
    fromStatus: PrivacyRequestStatusType | null;
    toStatus: PrivacyRequestStatusType;
    actorUserId: string;
    reasonCode: string;
    safeNote?: string | null;
    idempotencyKey: string;
    correlationId: string;
    now: Date;
  }>,
) {
  await transaction.privacyRequestEvent.create({
    data: {
      privacyRequestId: input.loaded.id,
      kind: input.kind,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode,
      safeNote: input.safeNote ?? null,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      createdAt: input.now,
    },
  });
}

async function notifyRequester(
  transaction: TransactionClient,
  loaded: NonNullable<LoadedCase>,
  status: PrivacyRequestStatusType,
  reasonCode:
    | "IDENTITY_CHECK_REQUIRED"
    | "PROCESSING_STARTED"
    | "COMPLETED"
    | PrivacyRequestRejectionCode,
  idempotencyKey: string,
) {
  await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
    recipientUserId: loaded.requesterUserId,
    kind: "PRIVACY_REQUEST_CHANGED",
    dedupeKey: `privacy-case:${idempotencyKey}`,
    payload: {
      requestId: loaded.id,
      type: loaded.type,
      status,
      reasonCode,
    },
  });
}

async function writePrivacyAudit(
  transaction: TransactionClient,
  input: Readonly<{
    action:
      | "PRIVACY_CASE_ACCESSED"
      | "PRIVACY_REQUEST_STATUS_CHANGED"
      | "AUTHORIZATION_DENIED_SENSITIVE";
    actorUserId: string;
    capability: string;
    correlationId: string;
    reasonCode: string;
    result?: "SUCCEEDED" | "DENIED";
    targetId: string;
    targetType: "PRIVACY_REQUEST" | "USER";
    now: Date;
  }>,
) {
  await writeRequiredAudit(prismaAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: input.actorUserId,
    capability: input.capability,
    correlationId: input.correlationId,
    metadata: {},
    reasonCode: input.reasonCode,
    result: input.result ?? "SUCCEEDED",
    retainUntil: new Date(
      input.now.getTime() +
        PRIVACY_CASE_SERVICE_POLICY_V1.auditRetentionDays * DAY_MILLISECONDS,
    ),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

function prismaAuditPort(transaction: TransactionClient) {
  return {
    auditLog: {
      create: ({ data }: Readonly<{ data: AuditPersistenceRecord }>) =>
        transaction.auditLog.create({
          data: {
            ...data,
            metadata:
              data.metadata === null
                ? Prisma.JsonNull
                : (data.metadata as Prisma.InputJsonValue),
          },
        }),
    },
  };
}

async function isActiveAdmin(transaction: TransactionClient, userId: string) {
  return (
    (await transaction.user.count({
      where: { id: userId, role: "ADMIN", status: "ACTIVE" },
    })) === 1
  );
}

function canRecordChallengeAttempt(
  loaded: NonNullable<LoadedCase>,
  now: Date,
) {
  const challenge = loaded.challenges[0];
  return (
    loaded.status === PrivacyRequestStatus.IDENTITY_CHECK &&
    loaded.requester.status === "ACTIVE" &&
    loaded.requester.emailVerifiedAt !== null &&
    challenge !== undefined &&
    challenge.expiresAt.getTime() > now.getTime() &&
    challenge.verifiedAt === null &&
    challenge.consumedAt === null &&
    challenge.attempts <
      PRIVACY_CASE_SERVICE_POLICY_V1.challengeMaximumAttempts
  );
}

function capabilityForAction(action: PrivacyCaseAction) {
  switch (action) {
    case "START_IDENTITY_CHECK":
    case "VERIFY_IDENTITY":
      return "PRIVACY_CASE_VERIFY" as const;
    case "COMPLETE_EXPORT":
    case "COMPLETE_DELETE":
    case "COMPLETE_CORRECTION":
    case "REJECT":
    case "ADD_NOTE":
      return "PRIVACY_CASE_PROCESS" as const;
    case "COMPLETE_CHALLENGE":
    case "CANCEL":
      return null;
  }
}

function actionForEvent(
  kind: PrivacyRequestEventKindType,
  reasonCode: string | null,
): PrivacyCaseAction | null {
  switch (kind) {
    case PrivacyRequestEventKind.IDENTITY_REQUESTED:
      return "START_IDENTITY_CHECK";
    case PrivacyRequestEventKind.PROCESSING_STARTED:
      return "VERIFY_IDENTITY";
    case PrivacyRequestEventKind.COMPLETED:
      if (reasonCode === "DELETE_ASSESSMENT_COMPLETED") {
        return "COMPLETE_DELETE";
      }
      if (reasonCode === "CORRECTION_OUTCOME_COMPLETED") {
        return "COMPLETE_CORRECTION";
      }
      return reasonCode === "EXPORT_MANIFEST_COMPLETED"
        ? "COMPLETE_EXPORT"
        : null;
    case PrivacyRequestEventKind.REJECTED:
      return "REJECT";
    case PrivacyRequestEventKind.CANCELLED:
      return "CANCEL";
    case PrivacyRequestEventKind.NOTE_ADDED:
      return "ADD_NOTE";
    case PrivacyRequestEventKind.CREATED:
    case PrivacyRequestEventKind.VERIFIED:
    case PrivacyRequestEventKind.MANIFEST_CREATED:
      return null;
  }
}

function auditReasonForCommand(command: PrivacyCaseCommand) {
  switch (command.action) {
    case "START_IDENTITY_CHECK":
      return "IDENTITY_CHECK_REQUIRED";
    case "VERIFY_IDENTITY":
      return "PROCESSING_STARTED";
    case "COMPLETE_DELETE":
    case "COMPLETE_CORRECTION":
      return "COMPLETED";
    case "REJECT":
      return command.reasonCode;
    case "ADD_NOTE":
      return "NOTE_ADDED";
    case "COMPLETE_EXPORT":
      return "COMPLETED";
    case "COMPLETE_CHALLENGE":
      return "IDENTITY_VERIFIED";
    case "CANCEL":
      return "CANCELLED";
  }
}

function mutationSuccess(
  requestId: string,
  status: PrivacyRequestStatusType,
  version: number,
  idempotent: boolean,
): PrivacyCaseMutationResult {
  return Object.freeze({ ok: true, idempotent, requestId, status, version });
}

function failure<Code extends string>(code: Code) {
  return Object.freeze({ ok: false as const, code });
}

function derivedIdempotencyKey(
  prefix: string,
  requestId: string,
  idempotencyKey: string,
) {
  const digest = createHash("sha256")
    .update(prefix, "utf8")
    .update("\0", "utf8")
    .update(requestId, "utf8")
    .update("\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");
  return `${prefix}:${digest}`;
}

async function acquireCaseLock(
  transaction: TransactionClient,
  requestId: string,
) {
  await transaction.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`${PRIVACY_CASE_SERVICE_POLICY_V1.lockNamespace}:${requestId}`},
        0
      )
    ) IS NULL AS "locked"
  `;
}

function transactionOptions() {
  return Object.freeze({
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: PRIVACY_CASE_SERVICE_POLICY_V1.transactionTimeoutMilliseconds,
    timeout: PRIVACY_CASE_SERVICE_POLICY_V1.transactionTimeoutMilliseconds,
  });
}

function ageBucket(createdAt: Date, now: Date): PrivacyCaseAgeBucket {
  const age = Math.max(0, now.getTime() - createdAt.getTime());
  if (age < DAY_MILLISECONDS) return "LT_24_HOURS";
  if (age < 4 * DAY_MILLISECONDS) return "ONE_TO_THREE_DAYS";
  if (age < 8 * DAY_MILLISECONDS) return "FOUR_TO_SEVEN_DAYS";
  if (age <= 30 * DAY_MILLISECONDS) return "EIGHT_TO_THIRTY_DAYS";
  return "OVER_THIRTY_DAYS";
}

function dueBucket(dueAt: Date, now: Date): PrivacyCaseDueBucket {
  const remaining = dueAt.getTime() - now.getTime();
  if (remaining < 0) return "OVERDUE";
  if (remaining < 3 * DAY_MILLISECONDS) return "DUE_WITHIN_TWO_DAYS";
  if (remaining < 8 * DAY_MILLISECONDS) return "DUE_WITHIN_SEVEN_DAYS";
  if (remaining < 15 * DAY_MILLISECONDS) return "DUE_WITHIN_FOURTEEN_DAYS";
  return "DUE_LATER";
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function toSafeCaseDetail(input: DetailRow): PrivacyCaseDetail {
  const challenge = input.challenges[0];
  return Object.freeze({
    id: input.id,
    requesterUserId: input.requesterUserId,
    type: input.type,
    status: input.status,
    version: input.version,
    noticeVersion: input.noticeVersion,
    dueAt: new Date(input.dueAt),
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.updatedAt),
    assignment: Object.freeze({
      assignedAdminUserId: input.assignedAdminUserId,
      reasonCode: input.assignmentReasonCode,
    }),
    verification: Object.freeze({
      verifiedAt:
        input.verifiedAt === null ? null : new Date(input.verifiedAt),
      processingStartedAt:
        input.processingStartedAt === null
          ? null
          : new Date(input.processingStartedAt),
      challenge:
        challenge === undefined
          ? null
          : Object.freeze({
              attempts: challenge.attempts,
              expiresAt: new Date(challenge.expiresAt),
              verifiedAt:
                challenge.verifiedAt === null
                  ? null
                  : new Date(challenge.verifiedAt),
              consumedAt:
                challenge.consumedAt === null
                  ? null
                  : new Date(challenge.consumedAt),
            }),
    }),
    correction: Object.freeze({
      fields: Object.freeze(
        input.correctionFields.map((field) =>
          Object.freeze({
            fieldCode: field.fieldCode,
            correctionText: field.correctionText,
            reviewedAt:
              field.reviewedAt === null ? null : new Date(field.reviewedAt),
          }),
        ),
      ),
      outcomeCode: input.correctionOutcome,
      domainEventRefs: Object.freeze([...input.domainEventRefs]),
    }),
    deletion: Object.freeze({
      dependencyCodes: Object.freeze([...input.deletionDependencies]),
      outcomeCode: input.deletionOutcome,
    }),
    rejectionCode: input.rejectionCode,
    safeOutcomeNote: input.safeOutcomeNote,
    completedAt:
      input.completedAt === null ? null : new Date(input.completedAt),
    events: Object.freeze(
      input.events.map((event) =>
        Object.freeze({
          kind: event.kind,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          reasonCode: event.reasonCode,
          safeNote: event.safeNote,
          createdAt: new Date(event.createdAt),
        }),
      ),
    ),
  });
}

const mutationSelect = {
  id: true,
  requesterUserId: true,
  type: true,
  status: true,
  version: true,
  assignedAdminUserId: true,
  requester: {
    select: { status: true, emailVerifiedAt: true },
  },
  correctionFields: {
    orderBy: { fieldCode: "asc" },
    select: { fieldCode: true },
  },
  challenges: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      attempts: true,
      expiresAt: true,
      verifiedAt: true,
      consumedAt: true,
      idempotencyKey: true,
    },
  },
} satisfies Prisma.PrivacyRequestSelect;

const detailSelect = {
  id: true,
  requesterUserId: true,
  type: true,
  status: true,
  version: true,
  noticeVersion: true,
  dueAt: true,
  assignedAdminUserId: true,
  assignmentReasonCode: true,
  verifiedAt: true,
  processingStartedAt: true,
  completedAt: true,
  domainEventRefs: true,
  correctionOutcome: true,
  deletionDependencies: true,
  deletionOutcome: true,
  rejectionCode: true,
  safeOutcomeNote: true,
  createdAt: true,
  updatedAt: true,
  correctionFields: {
    orderBy: { fieldCode: "asc" },
    select: {
      fieldCode: true,
      correctionText: true,
      reviewedAt: true,
    },
  },
  challenges: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      attempts: true,
      expiresAt: true,
      verifiedAt: true,
      consumedAt: true,
    },
  },
  events: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      kind: true,
      fromStatus: true,
      toStatus: true,
      reasonCode: true,
      safeNote: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PrivacyRequestSelect;

type DetailRow = Prisma.PrivacyRequestGetPayload<{
  select: typeof detailSelect;
}>;
