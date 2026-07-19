import { createHash, randomUUID } from "node:crypto";

import {
  writeRequiredAudit,
  type AuditPersistenceRecord,
} from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  PrivacyRequestStatus,
  type PrivacyRequestStatus as PrivacyRequestStatusType,
  type PrivacyRequestType as PrivacyRequestTypeType,
} from "@/lib/generated/prisma/enums";
import {
  addZurichCalendarDays,
  privacyRequestInputSchema,
  PRIVACY_REQUEST_POLICY_V1,
  type AtomicPrivacyRequestIntakeResult,
  type PrivacyRequestRepository,
  type PrivacyRequestSummary,
} from "@/lib/privacy/requests";
import type { RevealConfirmationAuthorization } from "@/lib/privacy/reveal-dto";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const PRIVACY_AUDIT_RETENTION_DAYS = 400;
const NONTERMINAL_PRIVACY_STATUSES = Object.freeze([
  PrivacyRequestStatus.PENDING,
  PrivacyRequestStatus.IDENTITY_CHECK,
  PrivacyRequestStatus.IN_PROGRESS,
] as const);

export const POSTGRES_PRIVACY_ADAPTER_POLICY_V1 = Object.freeze({
  requesterLockNamespace: "privacy-request-intake-v1" as const,
  revealLockNamespace: "privacy-reveal-confirm-v1" as const,
  transactionTimeoutMilliseconds: 15_000,
  auditRetentionDays: PRIVACY_AUDIT_RETENTION_DAYS,
});

type IntakeInput = Parameters<PrivacyRequestRepository["intakeAtomically"]>[0];
type TransactionClient = Prisma.TransactionClient;

/** Production PostgreSQL implementation of the atomic Privacy intake port. */
export function createPostgresPrivacyRequestRepository(
  database: DatabaseClient,
): PrivacyRequestRepository {
  const repository: PrivacyRequestRepository = {
    intakeAtomically: (input: IntakeInput) =>
      runAtomicPrivacyIntake(database, input),
    findOwned: async (requestId: string, userId: string) => {
      const request = await database.privacyRequest.findFirst({
        where: { id: requestId, requesterUserId: userId },
        select: privacyRequestSummarySelect,
      });
      return request === null ? null : toPrivacyRequestSummary(request);
    },
  };
  return Object.freeze(repository);
}

async function runAtomicPrivacyIntake(
  database: DatabaseClient,
  rawInput: IntakeInput,
): Promise<AtomicPrivacyRequestIntakeResult> {
  const input = validateAtomicIntakeInput(rawInput);
  return database.$transaction(
    async (transaction) => {
      await acquireAdvisoryLock(
        transaction,
        POSTGRES_PRIVACY_ADAPTER_POLICY_V1.requesterLockNamespace,
        input.userId,
      );

      const users = await transaction.$queryRaw<Array<{ status: string }>>`
        SELECT "status"::text AS "status"
        FROM "User"
        WHERE "id" = ${input.userId}::uuid
        FOR UPDATE
      `;
      if (users[0]?.status !== "ACTIVE") {
        return Object.freeze({ outcome: "UNAUTHORIZED" as const });
      }

      const idempotent = await transaction.privacyRequest.findFirst({
        where: {
          requesterUserId: input.userId,
          idempotencyKey: input.request.idempotencyKey,
        },
        select: privacyRequestSummarySelect,
      });
      if (idempotent !== null) {
        return Object.freeze({
          outcome: "IDEMPOTENT_RETRY" as const,
          request: toPrivacyRequestSummary(idempotent),
        });
      }

      const openRequest = await transaction.privacyRequest.findFirst({
        where: {
          requesterUserId: input.userId,
          type: input.request.type,
          status: { in: [...NONTERMINAL_PRIVACY_STATUSES] },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: privacyRequestSummarySelect,
      });
      if (openRequest !== null) {
        return Object.freeze({
          outcome: "OPEN_TYPE_LINKED" as const,
          request: toPrivacyRequestSummary(openRequest),
        });
      }

      const createdInWindow = await transaction.privacyRequest.count({
        where: {
          requesterUserId: input.userId,
          createdAt: {
            gte: input.rollingWindowStart,
            lte: input.createdAt,
          },
        },
      });
      if (createdInWindow >= input.rollingThirtyDayLimit) {
        return Object.freeze({ outcome: "RATE_LIMITED" as const });
      }

      const correlationId = randomUUID();
      const correctionRequest =
        input.request.type === "CORRECT" ? input.request : null;
      const created = await transaction.privacyRequest.create({
        data: {
          requesterUserId: input.userId,
          type: input.request.type,
          status: PrivacyRequestStatus.PENDING,
          dueAt: input.dueAt,
          idempotencyKey: input.request.idempotencyKey,
          deletionDependencies: [],
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        },
        select: privacyRequestSummarySelect,
      });

      if (correctionRequest !== null) {
        await transaction.privacyRequestCorrectionField.createMany({
          data: correctionRequest.correctionFieldCodes.map((fieldCode) => ({
            privacyRequestId: created.id,
            fieldCode,
            correctionText: correctionRequest.correctionText,
          })),
        });
      }

      await transaction.privacyRequestEvent.create({
        data: {
          privacyRequestId: created.id,
          kind: input.eventKind,
          fromStatus: null,
          toStatus: PrivacyRequestStatus.PENDING,
          actorUserId: input.userId,
          idempotencyKey: privacyCreatedEventIdempotencyKey(
            input.userId,
            input.request.idempotencyKey,
          ),
          correlationId,
          createdAt: input.createdAt,
        },
      });

      await writeRequiredAudit(prismaAuditPort(transaction), {
        action: input.auditAction,
        actorKind: "USER",
        actorUserId: input.userId,
        capability: "PRIVACY_REQUEST_CREATE",
        correlationId,
        metadata: {},
        result: "SUCCEEDED",
        retainUntil: new Date(
          input.createdAt.getTime() +
            POSTGRES_PRIVACY_ADAPTER_POLICY_V1.auditRetentionDays *
              DAY_MILLISECONDS,
        ),
        targetId: created.id,
        targetType: "PRIVACY_REQUEST",
      });

      return Object.freeze({
        outcome: "CREATED" as const,
        request: toPrivacyRequestSummary(created),
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait:
        POSTGRES_PRIVACY_ADAPTER_POLICY_V1.transactionTimeoutMilliseconds,
      timeout:
        POSTGRES_PRIVACY_ADAPTER_POLICY_V1.transactionTimeoutMilliseconds,
    },
  );
}

export type LockedRevealAuthorizationResult<T> =
  | Readonly<{ authorized: true; value: T }>
  | Readonly<{ authorized: false; code: "REVEAL_CONFIRMATION_UNAVAILABLE" }>;

export type LockedRevealConfirmationPort = Readonly<{
  withLockedAuthorization<T>(
    input: Readonly<{
      actorUserId: string;
      contactRequestId: string;
      conversationId: string;
    }>,
    operation: (
      authorization: RevealConfirmationAuthorization,
      transaction: TransactionClient,
    ) => Promise<T>,
  ): Promise<LockedRevealAuthorizationResult<T>>;
}>;

/**
 * Loads authorization and executes the caller operation while both the request
 * advisory lock and the concrete request/grant row locks are still held.
 */
export function createPostgresRevealConfirmationPort(
  database: DatabaseClient,
): LockedRevealConfirmationPort {
  return Object.freeze({
    withLockedAuthorization: async (input, operation) =>
      database.$transaction(
        async (transaction) => {
          if (
            !isUuid(input.actorUserId) ||
            !isUuid(input.contactRequestId) ||
            !isUuid(input.conversationId)
          ) {
            return unavailableReveal();
          }
          await acquireAdvisoryLock(
            transaction,
            POSTGRES_PRIVACY_ADAPTER_POLICY_V1.revealLockNamespace,
            input.contactRequestId,
          );
          const lockedRequests = await transaction.$queryRaw<
            Array<{
              id: string;
              candidateProfileId: string;
              companyId: string;
            }>
          >`
            SELECT
              "id",
              "candidateProfileId",
              "companyId"
            FROM "EmployerContactRequest"
            WHERE "id" = ${input.contactRequestId}::uuid
            FOR UPDATE
          `;
          if (lockedRequests.length !== 1) return unavailableReveal();
          const lockedRequest = lockedRequests[0]!;

          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "IdentityRevealGrant"
            WHERE "contactRequestId" = ${input.contactRequestId}::uuid
            FOR UPDATE
          `;
          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT candidate_profile."id"
            FROM "CandidateProfile" AS candidate_profile
            JOIN "User" AS candidate_user
              ON candidate_user."id" = candidate_profile."userId"
            WHERE candidate_profile."id" = ${lockedRequest.candidateProfileId}::uuid
            FOR UPDATE OF candidate_profile, candidate_user
          `;
          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Company"
            WHERE "id" = ${lockedRequest.companyId}::uuid
            FOR UPDATE
          `;
          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "CompanyVerificationRequest"
            WHERE "companyId" = ${lockedRequest.companyId}::uuid
            ORDER BY "id"
            FOR UPDATE
          `;
          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Conversation"
            WHERE "contactRequestId" = ${input.contactRequestId}::uuid
            FOR UPDATE
          `;

          const request = await transaction.employerContactRequest.findUnique({
            where: { id: input.contactRequestId },
            select: {
              id: true,
              status: true,
              companyId: true,
              candidateProfileId: true,
            },
          });
          if (request === null) return unavailableReveal();

          const candidateProfile =
            await transaction.candidateProfile.findUnique({
              where: { id: request.candidateProfileId },
              select: { userId: true },
            });
          if (candidateProfile === null) return unavailableReveal();
          const candidateUser = await transaction.user.findUnique({
            where: { id: candidateProfile.userId },
            select: { status: true },
          });
          const company = await transaction.company.findUnique({
            where: { id: request.companyId },
            select: { status: true },
          });
          const conversation = await transaction.conversation.findUnique({
            where: { contactRequestId: request.id },
            select: { id: true },
          });
          const currentVerifications =
            await transaction.companyVerificationRequest.findMany({
              where: {
                companyId: request.companyId,
                status: "VERIFIED",
                supersededBy: null,
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 2,
              select: { id: true },
            });
          const revealGrant = await transaction.identityRevealGrant.findUnique({
            where: { contactRequestId: request.id },
            select: {
              contactRequestId: true,
              candidateProfileId: true,
              companyId: true,
              conversationId: true,
              revokedAt: true,
            },
          });

          const conversationId = conversation?.id ?? null;
          const hasExactlyOneCurrentVerification =
            currentVerifications.length === 1;
          if (
            candidateProfile.userId !== input.actorUserId ||
            candidateUser?.status !== "ACTIVE" ||
            company?.status !== "ACTIVE" ||
            !hasExactlyOneCurrentVerification ||
            request.status !== "ACCEPTED" ||
            conversationId !== input.conversationId ||
            revealGrant?.revokedAt != null
          ) {
            return unavailableReveal();
          }

          const authorization: RevealConfirmationAuthorization = Object.freeze({
            actorUserId: input.actorUserId,
            candidateOwnerUserId: candidateProfile.userId,
            candidateUserStatus: candidateUser.status,
            candidateProfileId: request.candidateProfileId,
            companyId: request.companyId,
            companyStatus: company.status,
            companyVerified: hasExactlyOneCurrentVerification,
            requestId: request.id,
            requestStatus: request.status,
            requestCandidateProfileId: request.candidateProfileId,
            requestCompanyId: request.companyId,
            requestConversationId: conversationId,
            existingGrant:
              revealGrant === null ? null : Object.freeze({ ...revealGrant }),
          });
          return Object.freeze({
            authorized: true as const,
            value: await operation(authorization, transaction),
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait:
            POSTGRES_PRIVACY_ADAPTER_POLICY_V1.transactionTimeoutMilliseconds,
          timeout:
            POSTGRES_PRIVACY_ADAPTER_POLICY_V1.transactionTimeoutMilliseconds,
        },
      ),
  });
}

function validateAtomicIntakeInput(input: IntakeInput): IntakeInput {
  const request = privacyRequestInputSchema.parse(input.request);
  const expectedWindowStart = input.createdAt.getTime() - 30 * DAY_MILLISECONDS;
  const expectedDueAt = addZurichCalendarDays(
    input.createdAt,
    PRIVACY_REQUEST_POLICY_V1.dueCalendarDays,
  );
  if (
    !isUuid(input.userId) ||
    !isValidDate(input.createdAt) ||
    !isValidDate(input.dueAt) ||
    !isValidDate(input.rollingWindowStart) ||
    input.rollingWindowStart.getTime() !== expectedWindowStart ||
    input.dueAt.getTime() !== expectedDueAt.getTime() ||
    input.rollingThirtyDayLimit !==
      PRIVACY_REQUEST_POLICY_V1.rollingThirtyDayLimit ||
    input.maximumOpenPerType !== PRIVACY_REQUEST_POLICY_V1.maximumOpenPerType ||
    input.eventKind !== "CREATED" ||
    input.auditAction !== "PRIVACY_REQUEST_CREATED"
  ) {
    throw new TypeError("Atomic Privacy intake command is invalid.");
  }
  return Object.freeze({ ...input, request });
}

async function acquireAdvisoryLock(
  transaction: TransactionClient,
  namespace: string,
  key: string,
) {
  await transaction.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${namespace}:${key}`}, 0)
    ) IS NULL AS "locked"
  `;
}

const privacyRequestSummarySelect = {
  id: true,
  type: true,
  status: true,
  dueAt: true,
  createdAt: true,
} as const;

function toPrivacyRequestSummary(
  input: Readonly<{
    id: string;
    type: PrivacyRequestTypeType;
    status: PrivacyRequestStatusType;
    dueAt: Date;
    createdAt: Date;
  }>,
): PrivacyRequestSummary {
  return Object.freeze({
    id: input.id,
    type: input.type,
    status: input.status,
    dueAt: new Date(input.dueAt),
    createdAt: new Date(input.createdAt),
  });
}

function privacyCreatedEventIdempotencyKey(
  userId: string,
  idempotencyKey: string,
) {
  const digest = createHash("sha256")
    .update(userId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex");
  return `PRIVACY_CREATE:${digest}`;
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

function unavailableReveal(): LockedRevealAuthorizationResult<never> {
  return Object.freeze({
    authorized: false,
    code: "REVEAL_CONFIRMATION_UNAVAILABLE",
  });
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
