import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import {
  resolveStepUpPolicy,
  STEP_UP_POLICY_VERSION,
} from "@/lib/auth/assurance/step-up-policy";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";

const uuidSchema = z.uuid();
const bindingSchema = z.strictObject({
  purpose: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  action: z
    .string()
    .trim()
    .min(2)
    .max(96)
    .regex(/^[A-Za-z0-9:_-]+$/u),
  tenantId: uuidSchema.nullish(),
  resourceId: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/u)
    .nullish(),
});
const completeSchema = z.strictObject({
  challengeId: uuidSchema,
  challengeToken: z.string().min(32).max(128),
});

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type StepUpActor = Readonly<{
  userId: string;
  sessionId: string;
  role: string;
  status: string;
}>;

export type StepUpDependencies = Readonly<{
  actor: StepUpActor;
  correlationId: string;
  database: DatabaseClient;
  now?: Date;
}>;

export type StepUpResult<T> =
  | Readonly<{ ok: true; value: Readonly<T> }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "FORBIDDEN"
        | "AAL2_REQUIRED"
        | "INVALID_CHALLENGE"
        | "STEP_UP_REQUIRED"
        | "CONFLICT"
        | "WRITE_FAILED";
    }>;

export async function beginStepUpChallenge(
  raw: unknown,
  dependencies: StepUpDependencies,
): Promise<
  StepUpResult<{
    challengeId: string;
    challengeToken: string;
    policyCode: string;
    requiredLevel: "AAL2";
    expiresAt: Date;
  }>
> {
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = stepUpNow(dependencies.now);
  if (!(await validSessionActor(dependencies.database, dependencies.actor, now))) {
    return failure("FORBIDDEN");
  }
  const decision = resolveStepUpPolicy({
    actorRole: dependencies.actor.role,
    purpose: parsed.data.purpose,
    action: parsed.data.action,
    tenantId: parsed.data.tenantId,
    resourceId: parsed.data.resourceId,
  });
  if (!decision.allowed) return failure("FORBIDDEN");
  const challengeId = randomUUID();
  const challengeToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  try {
    await dependencies.database.$transaction(async (transaction) => {
      await transaction.stepUpChallenge.create({
        data: {
          id: challengeId,
          userId: dependencies.actor.userId,
          sessionId: dependencies.actor.sessionId,
          purpose: parsed.data.purpose,
          action: parsed.data.action,
          tenantId: parsed.data.tenantId ?? null,
          resourceId: parsed.data.resourceId ?? null,
          policyVersion: decision.policy.policyVersion,
          requiredLevel: decision.policy.requiredLevel,
          status: "PENDING",
          challengeDigest: digest(challengeToken),
          maxAttempts: MAX_ATTEMPTS,
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeStepUpAudit(transaction, dependencies, now, {
        action: "STEP_UP_CHALLENGE_CREATED",
        targetType: "SECURITY_CHALLENGE",
        targetId: challengeId,
        capability: decision.policy.code,
      });
    });
    return success({
      challengeId,
      challengeToken,
      policyCode: decision.policy.code,
      requiredLevel: decision.policy.requiredLevel,
      expiresAt,
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function completeStepUpChallenge(
  raw: unknown,
  dependencies: StepUpDependencies,
): Promise<
  StepUpResult<{
    evidenceId: string;
    grantToken: string;
    expiresAt: Date;
    purpose: string;
    action: string;
    tenantId: string | null;
    resourceId: string | null;
  }>
> {
  const parsed = completeSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = stepUpNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        if (!(await validSessionActor(transaction, dependencies.actor, now))) {
          return failure("FORBIDDEN");
        }
        await transaction.$queryRaw`
          SELECT "id"
          FROM "StepUpChallenge"
          WHERE "id" = ${parsed.data.challengeId}::uuid
          FOR UPDATE
        `;
        const challenge = await transaction.stepUpChallenge.findFirst({
          where: {
            id: parsed.data.challengeId,
            userId: dependencies.actor.userId,
            sessionId: dependencies.actor.sessionId,
            status: "PENDING",
            expiresAt: { gt: now },
            attemptCount: { lt: MAX_ATTEMPTS },
          },
        });
        if (
          challenge === null ||
          challenge.challengeDigest !== digest(parsed.data.challengeToken)
        ) {
          if (challenge !== null) {
            await registerStepUpFailure(transaction, challenge.id, now);
          }
          return failure("INVALID_CHALLENGE");
        }
        const decision = resolveStepUpPolicy({
          actorRole: dependencies.actor.role,
          purpose: challenge.purpose,
          action: challenge.action,
          tenantId: challenge.tenantId,
          resourceId: challenge.resourceId,
        });
        if (
          !decision.allowed ||
          decision.policy.policyVersion !== challenge.policyVersion
        ) {
          return failure("CONFLICT");
        }
        const assurance = await transaction.sessionAssurance.findFirst({
          where: {
            userId: dependencies.actor.userId,
            sessionId: dependencies.actor.sessionId,
            level: "AAL2",
            policyVersion: "ADMIN_MFA_POLICY_V1",
            verifiedAt: {
              lte: now,
              gt: new Date(
                now.getTime() -
                  decision.policy.maximumAssuranceAgeMilliseconds,
              ),
            },
            expiresAt: { gt: now },
            revokedAt: null,
            session: {
              revokedAt: null,
              expiresAt: { gt: now },
              absoluteExpiresAt: { gt: now },
            },
          },
          select: { method: true, verifiedAt: true },
        });
        if (assurance === null) return failure("AAL2_REQUIRED");
        const consumed = await transaction.stepUpChallenge.updateMany({
          where: {
            id: challenge.id,
            status: "PENDING",
            expiresAt: { gt: now },
          },
          data: { status: "VERIFIED", verifiedAt: now },
        });
        if (consumed.count !== 1) return failure("CONFLICT");
        const evidenceId = randomUUID();
        const grantToken = randomBytes(32).toString("base64url");
        const expiresAt = new Date(
          Math.min(
            challenge.expiresAt.getTime(),
            now.getTime() + decision.policy.grantTtlMilliseconds,
          ),
        );
        await transaction.authAssuranceEvidence.create({
          data: {
            id: evidenceId,
            userId: dependencies.actor.userId,
            sessionId: dependencies.actor.sessionId,
            purpose: challenge.purpose,
            action: challenge.action,
            tenantId: challenge.tenantId,
            resourceId: challenge.resourceId,
            policyVersion: decision.policy.policyVersion,
            challengeId: challenge.id,
            grantDigest: digest(grantToken),
            method: assurance.method,
            issuedAt: now,
            expiresAt,
            createdAt: now,
          },
          select: { id: true },
        });
        await writeStepUpAudit(transaction, dependencies, now, {
          action: "STEP_UP_GRANT_ISSUED",
          targetType: "SESSION_ASSURANCE",
          targetId: evidenceId,
          capability: decision.policy.code,
        });
        return success({
          evidenceId,
          grantToken,
          expiresAt,
          purpose: challenge.purpose,
          action: challenge.action,
          tenantId: challenge.tenantId,
          resourceId: challenge.resourceId,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function consumeStepUpGrant(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    evidenceId: string;
    grantToken: string;
    actor: StepUpActor;
    purpose: string;
    action: string;
    tenantId?: string | null;
    resourceId?: string | null;
    correlationId: string;
    now: Date;
  }>,
): Promise<boolean> {
  const parsed = bindingSchema.safeParse({
    purpose: input.purpose,
    action: input.action,
    tenantId: input.tenantId,
    resourceId: input.resourceId,
  });
  if (
    !parsed.success ||
    !uuidSchema.safeParse(input.evidenceId).success ||
    input.grantToken.length < 32 ||
    !Number.isFinite(input.now.getTime())
  ) {
    return false;
  }
  const decision = resolveStepUpPolicy({
    actorRole: input.actor.role,
    purpose: parsed.data.purpose,
    action: parsed.data.action,
    tenantId: parsed.data.tenantId,
    resourceId: parsed.data.resourceId,
  });
  if (!decision.allowed) return false;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "AuthAssuranceEvidence"
    WHERE "id" = ${input.evidenceId}::uuid
    FOR UPDATE
  `;
  const evidence = await transaction.authAssuranceEvidence.findFirst({
    where: {
      id: input.evidenceId,
      userId: input.actor.userId,
      sessionId: input.actor.sessionId,
      purpose: parsed.data.purpose,
      action: parsed.data.action,
      tenantId: parsed.data.tenantId ?? null,
      resourceId: parsed.data.resourceId ?? null,
      policyVersion: STEP_UP_POLICY_VERSION,
      grantDigest: digest(input.grantToken),
      issuedAt: {
        lte: input.now,
        gt: new Date(
          input.now.getTime() -
            decision.policy.maximumAssuranceAgeMilliseconds,
        ),
      },
      expiresAt: { gt: input.now },
      usedAt: null,
      revokedAt: null,
      session: {
        revokedAt: null,
        expiresAt: { gt: input.now },
        absoluteExpiresAt: { gt: input.now },
      },
      user: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (evidence === null) return false;
  const consumed = await transaction.authAssuranceEvidence.updateMany({
    where: {
      id: evidence.id,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: input.now },
    },
    data: { usedAt: input.now },
  });
  if (consumed.count !== 1) return false;
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "STEP_UP_GRANT_CONSUMED",
    actorKind: "USER",
    actorUserId: input.actor.userId,
    capability: decision.policy.code,
    companyId: parsed.data.tenantId ?? null,
    correlationId: input.correlationId,
    reasonCode: null,
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + 400 * 86_400_000),
    targetId: evidence.id,
    targetType: "SESSION_ASSURANCE",
  });
  return true;
}

export async function revokeUserStepUpState(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  await Promise.all([
    transaction.stepUpChallenge.updateMany({
      where: { userId, status: "PENDING" },
      data: { status: "REVOKED", cancelledAt: now },
    }),
    transaction.authAssuranceEvidence.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

async function validSessionActor(
  database: DatabaseClient | Prisma.TransactionClient,
  actor: StepUpActor,
  now: Date,
): Promise<boolean> {
  return (
    actor.status === "ACTIVE" &&
    ["ADMIN", "CANDIDATE", "EMPLOYER", "RECRUITER"].includes(actor.role) &&
    (await database.session.count({
      where: {
        id: actor.sessionId,
        userId: actor.userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { status: "ACTIVE", role: actor.role as never },
      },
    })) === 1
  );
}

async function registerStepUpFailure(
  transaction: Prisma.TransactionClient,
  challengeId: string,
  now: Date,
) {
  const challenge = await transaction.stepUpChallenge.findUnique({
    where: { id: challengeId },
    select: { attemptCount: true, maxAttempts: true },
  });
  if (challenge === null || challenge.attemptCount >= challenge.maxAttempts) {
    return;
  }
  const next = challenge.attemptCount + 1;
  await transaction.stepUpChallenge.update({
    where: { id: challengeId },
    data: {
      attemptCount: next,
      ...(next >= challenge.maxAttempts
        ? { status: "REVOKED", cancelledAt: now }
        : {}),
    },
    select: { id: true },
  });
}

async function writeStepUpAudit(
  transaction: Prisma.TransactionClient,
  dependencies: StepUpDependencies,
  now: Date,
  input: Readonly<{
    action: "STEP_UP_CHALLENGE_CREATED" | "STEP_UP_GRANT_ISSUED";
    targetType: "SECURITY_CHALLENGE" | "SESSION_ASSURANCE";
    targetId: string;
    capability: string;
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: dependencies.actor.userId,
    capability: input.capability,
    correlationId: dependencies.correlationId,
    reasonCode: null,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + 400 * 86_400_000),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stepUpNow(value?: Date): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Step-up requires a valid clock.");
  }
  return new Date(now);
}

function success<T>(value: T): StepUpResult<T> {
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}

function failure(
  code: Extract<StepUpResult<never>, { ok: false }>["code"],
): StepUpResult<never> {
  return Object.freeze({ ok: false, code });
}
