import "server-only";

import { randomUUID } from "node:crypto";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import {
  consumeAuthRateLimit,
  hashAuthIdentifier,
} from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { writeAuthSecurityEvent } from "@/lib/auth/security-events";
import { revokeUserStepUpState } from "@/lib/auth/assurance/step-up-service";
import { issueSession } from "@/lib/auth/session-issuance";
import {
  activeSessionTokenHashWhere,
  hashSessionToken,
  type CreatedSession,
} from "@/lib/auth/session";
import {
  createVerificationToken,
  hashVerificationTarget,
  hashVerificationToken,
  parseVerificationToken,
  verifyDerivedVerificationToken,
} from "@/lib/auth/verification-token";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type {
  EmailVerificationPurpose,
  Prisma,
  Role,
} from "@/lib/generated/prisma/client";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { notificationRecipientMaterialExpiresAt } from "@/lib/notifications/retention";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";
import { createLogger } from "@/lib/utils/logger";

import {
  EMAIL_VERIFICATION_POLICY_V1,
  isVerificationChallengeCurrent,
} from "./email-verification-policy";
import { canCommitLoginEmailChange } from "./email-change-policy";

const AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;
const PUBLIC_TIMING_FLOOR_MILLISECONDS = 250;
const logger = createLogger();

type VerificationDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  now?: Date;
}>;

export type VerificationConsumeResult =
  | Readonly<{
      ok: true;
      status: "VERIFIED";
      role: Role;
      session?: CreatedSession;
    }>
  | Readonly<{
      ok: false;
      status: "INVALID" | "RATE_LIMITED";
      retryAfterSeconds?: number;
    }>;

export async function createInitialEmailVerification(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    userId: string;
    emailNormalized: string;
    purpose?: Extract<EmailVerificationPurpose, "REGISTRATION" | "INVITATION">;
    addressEpoch?: number;
    now: Date;
    correlationId: string;
    environment: ServerEnvironment;
  }>,
) {
  return createChallenge(transaction, {
    userId: input.userId,
    emailNormalized: input.emailNormalized,
    purpose: input.purpose ?? "REGISTRATION",
    addressEpoch: input.addressEpoch ?? 1,
    recipient: { userId: input.userId },
    now: input.now,
    correlationId: input.correlationId,
    environment: input.environment,
    auditRequested: false,
  });
}

export async function requestEmailVerification(
  normalizedEmail: string,
  dependencies: VerificationDependencies,
) {
  const startedAt = Date.now();
  if (!dependencies.environment.NOTIFICATION_OUTBOX_PRODUCERS) {
    await completeTimingEnvelope(startedAt);
    return Object.freeze({ ok: true as const, rateLimited: false });
  }
  const now = dependencies.now ?? new Date();
  const targetHash = hashAuthIdentifier(
    normalizedEmail,
    dependencies.environment,
  );
  const rate = await consumeAuthRateLimit(
    "EMAIL_VERIFICATION_RESEND",
    { normalizedEmail },
    dependencies.request,
    now,
    {
      database: dependencies.database,
      environment: dependencies.environment,
    },
  );
  if (!rate.allowed) {
    await Promise.all([
      recordRateLimitDenial(
        {
          preset: "EMAIL_VERIFICATION_RESEND",
          scope: rate.audit.scope,
        },
        {
          actorKind: "ANONYMOUS",
          capability: "AUTH_EMAIL_VERIFICATION_RESEND",
          targetId: dependencies.request.correlationId,
          targetType: "SYSTEM_TASK",
        },
        { ...dependencies, now },
      ),
      dependencies.database.authSecurityEvent
        .create({
          data: {
            kind: "VERIFICATION_RATE_LIMITED",
            targetHash,
            correlationId: dependencies.request.correlationId,
            outcomeCode: "RATE_LIMITED",
            occurredAt: now,
            retainUntil: securityRetainUntil(now),
          },
          select: { id: true },
        })
        .catch(() =>
          reportVerificationObservabilityFailure(
            "security.verification_signal_write_failed",
            "VERIFICATION_RATE_LIMIT_SIGNAL_WRITE_FAILED",
            dependencies.request.correlationId,
          ),
        ),
    ]);
    await completeTimingEnvelope(startedAt);
    return Object.freeze({
      ok: true as const,
      rateLimited: true,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  try {
    await dependencies.database.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw<
        Array<{
          id: string;
          emailNormalized: string;
          emailAddressEpoch: number;
          emailVerifiedAt: Date | null;
          identityAssurance: string;
        }>
      >`
        SELECT "id", "emailNormalized", "emailAddressEpoch",
               "emailVerifiedAt", "identityAssurance"::text
          FROM "User"
         WHERE "emailNormalized" = ${normalizedEmail}
           AND "status" = 'ACTIVE'
         FOR UPDATE
      `;
      const user = users[0];
      if (
        user === undefined ||
        (user.emailVerifiedAt !== null &&
          user.identityAssurance === "VERIFIED_EMAIL")
      ) {
        await writeAuthSecurityEvent(transaction, {
          kind: "VERIFICATION_REQUESTED",
          targetHash,
          correlationId: dependencies.request.correlationId,
          outcomeCode: "GENERIC_NO_ACTION",
          occurredAt: now,
        });
        return;
      }
      await createChallenge(transaction, {
        userId: user.id,
        emailNormalized: user.emailNormalized,
        purpose: "REGISTRATION",
        addressEpoch: user.emailAddressEpoch,
        recipient: { userId: user.id },
        now,
        correlationId: dependencies.request.correlationId,
        environment: dependencies.environment,
      });
    });
  } catch {
    // The public contract is deliberately indistinguishable for unknown
    // identities, uniqueness races and persistence failures.
    reportVerificationObservabilityFailure(
      "security.verification_request_failed",
      "VERIFICATION_REQUEST_FAILED",
      dependencies.request.correlationId,
    );
  }
  await completeTimingEnvelope(startedAt);
  return Object.freeze({ ok: true as const, rateLimited: false });
}

export async function consumeEmailVerification(
  rawToken: string,
  sessionToken: string | undefined,
  dependencies: VerificationDependencies,
): Promise<VerificationConsumeResult> {
  const now = dependencies.now ?? new Date();
  const rate = await consumeAuthRateLimit(
    "EMAIL_VERIFICATION_CONSUME",
    {},
    dependencies.request,
    now,
    {
      database: dependencies.database,
      environment: dependencies.environment,
    },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      {
        preset: "EMAIL_VERIFICATION_CONSUME",
        scope: rate.audit.scope,
      },
      {
        actorKind: "ANONYMOUS",
        capability: "AUTH_EMAIL_VERIFICATION_CONSUME",
        targetId: dependencies.request.correlationId,
        targetType: "SYSTEM_TASK",
      },
      { ...dependencies, now },
    );
    return Object.freeze({
      ok: false,
      status: "RATE_LIMITED",
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const parsed = parseVerificationToken(rawToken);
  if (parsed === null) {
    await recordRejectedConsume(undefined, dependencies, now, "MALFORMED");
    return Object.freeze({ ok: false, status: "INVALID" });
  }

  try {
    const result = await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
            FROM "EmailVerificationChallenge"
           WHERE "id" = ${parsed.challengeId}::uuid
           FOR UPDATE
        `;
        if (locked.length !== 1) return null;
        const challenge =
          await transaction.emailVerificationChallenge.findUnique({
            where: { id: parsed.challengeId },
            select: {
              id: true,
              userId: true,
              purpose: true,
              addressEpoch: true,
              targetNormalizedHash: true,
              tokenHash: true,
              expiresAt: true,
              usedAt: true,
              supersededAt: true,
              pendingEmailChange: {
                select: {
                  id: true,
                  initiatedBySessionId: true,
                  targetEmail: true,
                  targetEmailNormalized: true,
                  addressEpoch: true,
                  status: true,
                  expiresAt: true,
                },
              },
              user: {
                select: {
                  email: true,
                  emailNormalized: true,
                  emailAddressEpoch: true,
                  role: true,
                  status: true,
                },
              },
            },
          });
        if (
          challenge === null ||
          challenge.user.status !== "ACTIVE" ||
          challenge.tokenHash !== parsed.tokenHash ||
          !verifyDerivedVerificationToken(rawToken, {
            challengeId: challenge.id,
            purpose: challenge.purpose,
            addressEpoch: challenge.addressEpoch,
            secret: dependencies.environment.secrets.session,
          }) ||
          challenge.usedAt !== null ||
          challenge.supersededAt !== null ||
          challenge.expiresAt.getTime() <= now.getTime()
        ) {
          return null;
        }

        if (challenge.purpose === "LOGIN_EMAIL_CHANGE") {
          const pending = challenge.pendingEmailChange;
          if (
            pending === null ||
            pending.addressEpoch !== challenge.addressEpoch ||
            pending.expiresAt.getTime() !== challenge.expiresAt.getTime() ||
            challenge.targetNormalizedHash !==
              hashVerificationTarget(
                pending.targetEmailNormalized,
                dependencies.environment.secrets.session,
              ) ||
            sessionToken === undefined
          ) {
            return null;
          }
          const matchingSession = await transaction.session.findFirst({
            where: {
              id: pending.initiatedBySessionId,
              userId: challenge.userId,
              ...activeSessionTokenHashWhere(
                hashSessionToken(sessionToken),
                now,
              ),
            },
            select: { id: true },
          });
          if (
            matchingSession === null ||
            !canCommitLoginEmailChange({
              pendingStatus: pending.status,
              challengeEpoch: challenge.addressEpoch,
              currentEpoch: challenge.user.emailAddressEpoch,
              initiatedBySessionId: pending.initiatedBySessionId,
              currentSessionId: matchingSession.id,
              expiresAt: challenge.expiresAt,
              now,
            })
          ) {
            return null;
          }
          const occupied = await transaction.user.findUnique({
            where: { emailNormalized: pending.targetEmailNormalized },
            select: { id: true },
          });
          if (occupied !== null && occupied.id !== challenge.userId) {
            return null;
          }
          const consumed =
            await transaction.emailVerificationChallenge.updateMany({
              where: {
                id: challenge.id,
                tokenHash: parsed.tokenHash,
                usedAt: null,
                supersededAt: null,
                expiresAt: { gt: now },
              },
              data: { usedAt: now },
            });
          if (consumed.count !== 1) return null;
          const changed = await transaction.user.updateMany({
            where: {
              id: challenge.userId,
              status: "ACTIVE",
              emailAddressEpoch: challenge.user.emailAddressEpoch,
              emailNormalized: challenge.user.emailNormalized,
            },
            data: {
              email: pending.targetEmail,
              emailNormalized: pending.targetEmailNormalized,
              emailAddressEpoch: challenge.addressEpoch,
              emailVerifiedAt: now,
              identityAssurance: "VERIFIED_EMAIL",
            },
          });
          if (changed.count !== 1) return null;
          const completed = await transaction.pendingEmailChange.updateMany({
            where: {
              id: pending.id,
              status: "PENDING",
              initiatedBySessionId: matchingSession.id,
            },
            data: { status: "COMPLETED", completedAt: now },
          });
          if (completed.count !== 1) return null;
          await transaction.session.updateMany({
            where: { userId: challenge.userId, revokedAt: null },
            data: { revokedAt: now },
          });
          await revokeUserStepUpState(transaction, challenge.userId, now);
          await transaction.sessionAssurance.updateMany({
            where: { userId: challenge.userId, revokedAt: null },
            data: { revokedAt: now },
          });
          const session = await issueSession(transaction, {
            userId: challenge.userId,
            now,
            request: dependencies.request,
            auditIpKeyring:
              dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
          });
          await transaction.authAssuranceEvidence.create({
            data: {
              userId: challenge.userId,
              sessionId: session.record.id,
              purpose: "LOGIN_EMAIL_CHANGE",
              action: "LOGIN_EMAIL_CHANGE_COMMIT",
              method: "PASSWORD_AND_EMAIL_LINK",
              issuedAt: now,
              expiresAt: session.record.expiresAt,
              usedAt: now,
            },
            select: { id: true },
          });
          await enqueueNotification(transaction, {
            recipient: {
              address: challenge.user.emailNormalized,
              keyring:
                dependencies.environment.secrets.keyrings
                  .NOTIFICATION_DELIVERY_KEYS,
              hashKeyring:
                dependencies.environment.secrets.keyrings
                  .NOTIFICATION_RECIPIENT_HASH_KEYS,
              retentionUntil: notificationRecipientMaterialExpiresAt(now),
            },
            templateKey: "login_email_changed_notice",
            payloadSchemaVersion: "identity-v1",
            payload: { emailChangeId: pending.id },
            dedupeKey: `login-email-changed:${pending.id}`,
            createdAt: now,
            availableAt: now,
          });
          await writeAuthSecurityEvent(transaction, {
            userId: challenge.userId,
            kind: "EMAIL_CHANGE_COMPLETED",
            targetHash: challenge.targetNormalizedHash,
            correlationId: dependencies.request.correlationId,
            outcomeCode: "ADDRESS_EPOCH_CHANGED",
            occurredAt: now,
          });
          await writeAuthSecurityEvent(transaction, {
            userId: challenge.userId,
            kind: "SESSIONS_REVOKED",
            correlationId: dependencies.request.correlationId,
            outcomeCode: "EMAIL_CHANGE",
            occurredAt: now,
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "LOGIN_EMAIL_CHANGE_COMPLETED",
              actorKind: "USER",
              actorUserId: challenge.userId,
              capability: "AUTH_LOGIN_EMAIL_CHANGE",
              correlationId: dependencies.request.correlationId,
              result: "SUCCEEDED",
              retainUntil: auditRetainUntil(now),
              targetId: pending.id,
              targetType: "VERIFICATION_REQUEST",
            },
            {
              sourceIp: dependencies.request.sourceIp,
              keyring:
                dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
            },
          );
          return Object.freeze({
            role: challenge.user.role,
            session,
          });
        }

        if (
          challenge.targetNormalizedHash !==
            hashVerificationTarget(
              challenge.user.emailNormalized,
              dependencies.environment.secrets.session,
            ) ||
          !isVerificationChallengeCurrent({
            addressEpoch: challenge.addressEpoch,
            currentAddressEpoch: challenge.user.emailAddressEpoch,
            expiresAt: challenge.expiresAt,
            usedAt: challenge.usedAt,
            supersededAt: challenge.supersededAt,
            now,
          })
        ) {
          return null;
        }

        const consumed =
          await transaction.emailVerificationChallenge.updateMany({
            where: {
              id: challenge.id,
              tokenHash: parsed.tokenHash,
              usedAt: null,
              supersededAt: null,
              expiresAt: { gt: now },
            },
            data: { usedAt: now },
          });
        if (consumed.count !== 1) return null;
        const verified = await transaction.user.updateMany({
          where: {
            id: challenge.userId,
            status: "ACTIVE",
            emailAddressEpoch: challenge.addressEpoch,
          },
          data: {
            emailVerifiedAt: now,
            identityAssurance: "VERIFIED_EMAIL",
          },
        });
        if (verified.count !== 1) return null;

        const matchingSession =
          sessionToken === undefined
            ? null
            : await transaction.session.findFirst({
                where: {
                  userId: challenge.userId,
                  ...activeSessionTokenHashWhere(
                    hashSessionToken(sessionToken),
                    now,
                  ),
                },
                select: { id: true },
              });
        let session: CreatedSession | undefined;
        if (matchingSession !== null) {
          await transaction.session.updateMany({
            where: { userId: challenge.userId, revokedAt: null },
            data: { revokedAt: now },
          });
          session = await issueSession(transaction, {
            userId: challenge.userId,
            now,
            request: dependencies.request,
            auditIpKeyring:
              dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
          });
          await transaction.authAssuranceEvidence.create({
            data: {
              userId: challenge.userId,
              sessionId: session.record.id,
              purpose: "EMAIL_VERIFICATION",
              action: "IDENTITY_BASELINE",
              method: "EMAIL_LINK",
              issuedAt: now,
              expiresAt: session.record.expiresAt,
            },
            select: { id: true },
          });
        }
        await writeAuthSecurityEvent(transaction, {
          userId: challenge.userId,
          kind: "VERIFICATION_SUCCEEDED",
          targetHash: challenge.targetNormalizedHash,
          correlationId: dependencies.request.correlationId,
          outcomeCode: "VERIFIED",
          occurredAt: now,
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "EMAIL_VERIFICATION_COMPLETED",
            actorKind: "ANONYMOUS",
            capability: "AUTH_EMAIL_VERIFICATION_CONSUME",
            correlationId: dependencies.request.correlationId,
            result: "SUCCEEDED",
            retainUntil: auditRetainUntil(now),
            targetId: challenge.id,
            targetType: "VERIFICATION_REQUEST",
          },
          {
            sourceIp: dependencies.request.sourceIp,
            keyring:
              dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
          },
        );
        return Object.freeze({
          role: challenge.user.role,
          ...(session === undefined ? {} : { session }),
        });
      },
    );
    if (result === null) {
      await recordRejectedConsume(
        parsed.challengeId,
        dependencies,
        now,
        "INVALID_OR_TERMINAL",
      );
      return Object.freeze({ ok: false, status: "INVALID" });
    }
    return Object.freeze({
      ok: true,
      status: "VERIFIED",
      role: result.role,
      ...(result.session === undefined ? {} : { session: result.session }),
    });
  } catch {
    await recordRejectedConsume(
      parsed.challengeId,
      dependencies,
      now,
      "CONFLICT",
    );
    return Object.freeze({ ok: false, status: "INVALID" });
  }
}

export async function createChallenge(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    userId: string;
    emailNormalized: string;
    purpose: EmailVerificationPurpose;
    addressEpoch: number;
    recipient:
      | Readonly<{ userId: string }>
      | Readonly<{
          address: string;
          keyring: ServerEnvironment["secrets"]["keyrings"]["NOTIFICATION_DELIVERY_KEYS"];
        }>;
    now: Date;
    correlationId: string;
    environment: ServerEnvironment;
    auditRequested?: boolean;
  }>,
) {
  await transaction.emailVerificationChallenge.updateMany({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      addressEpoch: input.addressEpoch,
      usedAt: null,
      supersededAt: null,
    },
    data: { supersededAt: input.now },
  });
  const challengeId = randomUUID();
  const rawToken = createVerificationToken(
    challengeId,
    input.purpose,
    input.addressEpoch,
    input.environment.secrets.session,
  );
  const expiresAt = new Date(
    input.now.getTime() + EMAIL_VERIFICATION_POLICY_V1.ttlMilliseconds,
  );
  const targetNormalizedHash = hashVerificationTarget(
    input.emailNormalized,
    input.environment.secrets.session,
  );
  const challenge = await transaction.emailVerificationChallenge.create({
    data: {
      id: challengeId,
      userId: input.userId,
      purpose: input.purpose,
      addressEpoch: input.addressEpoch,
      targetNormalizedHash,
      tokenHash: hashVerificationToken(rawToken),
      expiresAt,
      createdAt: input.now,
    },
    select: { id: true },
  });
  const templateKey =
    input.purpose === "LOGIN_EMAIL_CHANGE"
      ? "login_email_change_verification"
      : "identity_verification";
  const outbox = await enqueueNotification(transaction, {
    recipient:
      "address" in input.recipient
        ? {
            ...input.recipient,
            hashKeyring:
              input.environment.secrets.keyrings
                .NOTIFICATION_RECIPIENT_HASH_KEYS,
            retentionUntil: expiresAt,
          }
        : input.recipient,
    templateKey,
    payloadSchemaVersion: "identity-v1",
    payload: {
      challengeId: challenge.id,
      purpose: input.purpose,
      expiresInMinutes: EMAIL_VERIFICATION_POLICY_V1.ttlMilliseconds / 60_000,
    },
    dedupeKey: `email-verification:${challenge.id}`,
    createdAt: input.now,
    availableAt: input.now,
  });
  await writeAuthSecurityEvent(transaction, {
    userId: input.userId,
    kind:
      input.purpose === "LOGIN_EMAIL_CHANGE"
        ? "EMAIL_CHANGE_REQUESTED"
        : "VERIFICATION_REQUESTED",
    targetHash: targetNormalizedHash,
    correlationId: input.correlationId,
    outcomeCode: "CHALLENGE_CREATED",
    occurredAt: input.now,
  });
  if (input.auditRequested !== false) {
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action:
        input.purpose === "LOGIN_EMAIL_CHANGE"
          ? "LOGIN_EMAIL_CHANGE_REQUESTED"
          : "EMAIL_VERIFICATION_REQUESTED",
      actorKind: "USER",
      actorUserId: input.userId,
      capability:
        input.purpose === "LOGIN_EMAIL_CHANGE"
          ? "AUTH_LOGIN_EMAIL_CHANGE"
          : "AUTH_EMAIL_VERIFICATION_RESEND",
      correlationId: input.correlationId,
      result: "SUCCEEDED",
      retainUntil: auditRetainUntil(input.now),
      targetId: challenge.id,
      targetType: "VERIFICATION_REQUEST",
    });
  }
  return Object.freeze({
    challengeId: challenge.id,
    expiresAt,
    outboxId: outbox.id,
    rawToken,
  });
}

async function recordRejectedConsume(
  challengeId: string | undefined,
  dependencies: VerificationDependencies,
  now: Date,
  outcomeCode: string,
) {
  try {
    await dependencies.database.authSecurityEvent.create({
      data: {
        kind: "VERIFICATION_REJECTED",
        correlationId: dependencies.request.correlationId,
        outcomeCode,
        occurredAt: now,
        retainUntil: securityRetainUntil(now),
        ...(challengeId === undefined
          ? {}
          : {
              targetHash: hashAuthIdentifier(
                challengeId,
                dependencies.environment,
              ),
            }),
      },
      select: { id: true },
    });
  } catch {
    // A redacted signal must not alter the public token result.
    reportVerificationObservabilityFailure(
      "security.verification_signal_write_failed",
      "VERIFICATION_REJECTED_SIGNAL_WRITE_FAILED",
      dependencies.request.correlationId,
    );
  }
}

function reportVerificationObservabilityFailure(
  event: string,
  errorCode: string,
  correlationId: string,
) {
  try {
    logger.error(
      event,
      { errorCode, operation: "email_verification" },
      correlationId,
    );
  } catch {
    // Observability must never change enumeration-safe verification results.
  }
}

function auditRetainUntil(now: Date) {
  return new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS);
}

function securityRetainUntil(now: Date) {
  return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000);
}

async function completeTimingEnvelope(startedAt: number) {
  const remaining = PUBLIC_TIMING_FLOOR_MILLISECONDS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, remaining);
    });
  }
}
