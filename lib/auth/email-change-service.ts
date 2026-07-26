import "server-only";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { createChallenge } from "@/lib/auth/email-verification-service";
import { isIdentityActionAllowed } from "@/lib/auth/email-verification-policy";
import { verifyPassword } from "@/lib/auth/password";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { hashSessionToken } from "@/lib/auth/session";
import { writeAuthSecurityEvent } from "@/lib/auth/security-events";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { normalizedEmailSchema } from "@/lib/validation/common";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

import { LOGIN_EMAIL_CHANGE_POLICY_V1 } from "./email-change-policy";

const AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

type EmailChangeDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  now?: Date;
}>;

export type EmailChangeRequestResult =
  | Readonly<{
      ok: true;
      status: "PENDING";
      expiresAt: Date;
    }>
  | Readonly<{
      ok: false;
      status:
        | "LOCKED"
        | "INVALID_CREDENTIALS"
        | "CONFLICT"
        | "RATE_LIMITED";
      retryAfterSeconds?: number;
    }>;

export async function requestLoginEmailChange(
  input: Readonly<{
    userId: string;
    sessionToken: string;
    targetEmail: string;
    password: string;
  }>,
  dependencies: EmailChangeDependencies,
): Promise<EmailChangeRequestResult> {
  if (!dependencies.environment.LOGIN_EMAIL_CHANGE) {
    return Object.freeze({ ok: false, status: "LOCKED" });
  }
  const target = normalizedEmailSchema.safeParse(input.targetEmail);
  if (!target.success) {
    return Object.freeze({ ok: false, status: "CONFLICT" });
  }
  const now = dependencies.now ?? new Date();
  const rate = await consumeAuthRateLimit(
    "LOGIN_EMAIL_CHANGE",
    { userId: input.userId },
    dependencies.request,
    now,
    {
      database: dependencies.database,
      environment: dependencies.environment,
    },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      { preset: "LOGIN_EMAIL_CHANGE", scope: rate.audit.scope },
      {
        actorKind: "USER",
        actorUserId: input.userId,
        capability: "AUTH_LOGIN_EMAIL_CHANGE",
        targetId: input.userId,
        targetType: "USER",
      },
      { ...dependencies, now },
    );
    return Object.freeze({
      ok: false,
      status: "RATE_LIMITED",
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const current = await dependencies.database.user.findUnique({
    where: { id: input.userId },
    select: {
      status: true,
      emailNormalized: true,
      emailVerifiedAt: true,
      identityAssurance: true,
      credential: { select: { passwordHash: true } },
      sessions: {
        where: {
          tokenHash: hashSessionToken(input.sessionToken),
          revokedAt: null,
          expiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        take: 1,
        select: { id: true },
      },
    },
  });
  const passwordMatches =
    current?.credential === null || current?.credential === undefined
      ? false
      : await verifyPassword(input.password, current.credential.passwordHash);
  if (
    current !== null &&
    dependencies.environment.IDENTITY_VERIFICATION_ENFORCEMENT &&
    !isIdentityActionAllowed({
      action: "LOGIN_EMAIL_CHANGE",
      assurance: current.identityAssurance,
      emailVerifiedAt: current.emailVerifiedAt,
    })
  ) {
    await recordRejectedChange(
      input.userId,
      dependencies,
      now,
      "VERIFIED_IDENTITY_REQUIRED",
    );
    return Object.freeze({ ok: false, status: "LOCKED" });
  }
  if (
    current === null ||
    current.status !== "ACTIVE" ||
    current.sessions.length !== 1 ||
    !passwordMatches
  ) {
    await recordRejectedChange(
      input.userId,
      dependencies,
      now,
      "INVALID_CREDENTIALS_OR_SESSION",
    );
    return Object.freeze({ ok: false, status: "INVALID_CREDENTIALS" });
  }
  if (current.emailNormalized === target.data) {
    return Object.freeze({ ok: false, status: "CONFLICT" });
  }

  try {
    const pending = await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<
          Array<{
            id: string;
            emailAddressEpoch: number;
            emailNormalized: string;
          }>
        >`
          SELECT "id", "emailAddressEpoch", "emailNormalized"
            FROM "User"
           WHERE "id" = ${input.userId}::uuid
             AND "status" = 'ACTIVE'
             AND (
               ${!dependencies.environment.IDENTITY_VERIFICATION_ENFORCEMENT}
               OR (
                 "identityAssurance" = 'VERIFIED_EMAIL'
                 AND "emailVerifiedAt" IS NOT NULL
               )
             )
           FOR UPDATE
        `;
        const user = locked[0];
        if (
          user === undefined ||
          user.emailNormalized === target.data
        ) {
          return null;
        }
        const liveSession = await transaction.session.findFirst({
          where: {
            id: current.sessions[0]!.id,
            userId: input.userId,
            tokenHash: hashSessionToken(input.sessionToken),
            revokedAt: null,
            expiresAt: { gt: now },
            absoluteExpiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (liveSession === null) return null;
        const occupied = await transaction.user.findUnique({
          where: { emailNormalized: target.data },
          select: { id: true },
        });
        if (occupied !== null) return null;

        const priorPending = await transaction.pendingEmailChange.findFirst({
          where: { userId: input.userId, status: "PENDING" },
          select: { id: true, challengeId: true },
        });
        if (priorPending !== null) {
          await transaction.pendingEmailChange.update({
            where: { id: priorPending.id },
            data: { status: "EXPIRED", cancelledAt: now },
            select: { id: true },
          });
          await transaction.emailVerificationChallenge.updateMany({
            where: {
              id: priorPending.challengeId,
              usedAt: null,
              supersededAt: null,
            },
            data: { supersededAt: now },
          });
        }
        const addressEpoch = user.emailAddressEpoch + 1;
        const challenge = await createChallenge(transaction, {
          userId: input.userId,
          emailNormalized: target.data,
          purpose: "LOGIN_EMAIL_CHANGE",
          addressEpoch,
          recipient: {
            address: target.data,
            keyring:
              dependencies.environment.secrets.keyrings
                .NOTIFICATION_DELIVERY_KEYS,
          },
          now,
          correlationId: dependencies.request.correlationId,
          environment: dependencies.environment,
        });
        const created = await transaction.pendingEmailChange.create({
          data: {
            userId: input.userId,
            challengeId: challenge.challengeId,
            initiatedBySessionId: liveSession.id,
            targetEmail: target.data,
            targetEmailNormalized: target.data,
            addressEpoch,
            expiresAt: challenge.expiresAt,
            createdAt: now,
          },
          select: { id: true, expiresAt: true },
        });
        await transaction.authAssuranceEvidence.create({
          data: {
            userId: input.userId,
            sessionId: liveSession.id,
            purpose: "LOGIN_EMAIL_CHANGE",
            action: "LOGIN_EMAIL_CHANGE_REQUEST",
            method: "PASSWORD",
            issuedAt: now,
            expiresAt: new Date(
              now.getTime() +
                LOGIN_EMAIL_CHANGE_POLICY_V1.freshCredentialWindowMilliseconds,
            ),
            usedAt: now,
          },
          select: { id: true },
        });
        return created;
      },
    );
    if (pending === null) {
      await recordRejectedChange(
        input.userId,
        dependencies,
        now,
        "TARGET_OR_SESSION_CONFLICT",
      );
      return Object.freeze({ ok: false, status: "CONFLICT" });
    }
    return Object.freeze({
      ok: true,
      status: "PENDING",
      expiresAt: pending.expiresAt,
    });
  } catch {
    await recordRejectedChange(
      input.userId,
      dependencies,
      now,
      "PERSISTENCE_CONFLICT",
    );
    return Object.freeze({ ok: false, status: "CONFLICT" });
  }
}

export async function cancelLoginEmailChange(
  input: Readonly<{ userId: string; sessionToken: string }>,
  dependencies: EmailChangeDependencies,
) {
  const now = dependencies.now ?? new Date();
  const result = await dependencies.database.$transaction(
    async (transaction) => {
      const session = await transaction.session.findFirst({
        where: {
          userId: input.userId,
          tokenHash: hashSessionToken(input.sessionToken),
          revokedAt: null,
          expiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (session === null) return false;
      const pending = await transaction.pendingEmailChange.findFirst({
        where: {
          userId: input.userId,
          initiatedBySessionId: session.id,
          status: "PENDING",
        },
        select: { id: true, challengeId: true },
      });
      if (pending === null) return true;
      await transaction.pendingEmailChange.update({
        where: { id: pending.id },
        data: { status: "CANCELLED", cancelledAt: now },
        select: { id: true },
      });
      await transaction.emailVerificationChallenge.updateMany({
        where: {
          id: pending.challengeId,
          usedAt: null,
          supersededAt: null,
        },
        data: { supersededAt: now },
      });
      await writeRequiredAudit(
        createPrismaTransactionAuditPort(transaction),
        {
          action: "LOGIN_EMAIL_CHANGE_CANCELLED",
          actorKind: "USER",
          actorUserId: input.userId,
          capability: "AUTH_LOGIN_EMAIL_CHANGE",
          correlationId: dependencies.request.correlationId,
          result: "SUCCEEDED",
          retainUntil: new Date(
            now.getTime() + AUDIT_RETENTION_MILLISECONDS,
          ),
          targetId: pending.id,
          targetType: "VERIFICATION_REQUEST",
        },
      );
      return true;
    },
  );
  return Object.freeze({ ok: result });
}

async function recordRejectedChange(
  userId: string,
  dependencies: EmailChangeDependencies,
  now: Date,
  outcomeCode: string,
) {
  try {
    await dependencies.database.$transaction((transaction) =>
      writeAuthSecurityEvent(transaction, {
        userId,
        kind: "EMAIL_CHANGE_REJECTED",
        correlationId: dependencies.request.correlationId,
        outcomeCode,
        occurredAt: now,
      }),
    );
  } catch {
    // A minimized signal is best effort and never changes the denial.
  }
}
