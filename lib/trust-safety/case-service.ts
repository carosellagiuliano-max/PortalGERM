import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { hasCurrentStrongCompanyTrustEvidence } from "@/lib/companies/verification/read-model";
import {
  adminFailure,
  adminNow,
  adminSuccess,
  boundedPlainText,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
  type AdminDependencies,
} from "@/lib/admin/common";
import { resolveAdminActor } from "@/lib/admin/role-policy";
import { hasCurrentAal2 } from "@/lib/auth/assurance/mfa-service";
import { consumeStepUpGrant } from "@/lib/auth/assurance/step-up-service";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  applyTrustContainment,
  restoreReversibleContainment,
} from "@/lib/trust-safety/containment";

const uuid = z.uuid();
const reasonCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
const stepUpFields = {
  stepUpEvidenceId: uuid.optional(),
  stepUpGrantToken: z.string().min(32).max(128).optional(),
} as const;
const assignSchema = z.strictObject({
  caseId: uuid,
  assigneeUserId: uuid,
  expectedVersion: z.number().int().positive(),
  reasonCode,
});
const decisionSchema = z.strictObject({
  caseId: uuid,
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["HOLD", "REVOKE", "RESOLVE"]),
  reasonCode,
  safeNote: z.string().trim().min(10).max(1_000),
  ...stepUpFields,
});
const appealSchema = z.strictObject({
  caseId: uuid,
  safeStatement: z.string().trim().min(20).max(2_000),
});
const appealDecisionSchema = z.strictObject({
  appealId: uuid,
  decision: z.enum(["APPROVE", "REJECT"]),
  reasonCode,
  expectedCaseVersion: z.number().int().positive(),
  ...stepUpFields,
});

export type TrustSafetyAdminDependencies = AdminDependencies &
  Readonly<{
    actor: AdminDependencies["actor"] &
      Readonly<{
        sessionId: string;
      }>;
  }>;

export async function listTrustSafetyCases(
  dependencies: TrustSafetyAdminDependencies,
  input: Readonly<{
    status?: string | null;
    assigneeUserId?: string | null;
    cursor?: string | null;
  }> = {},
) {
  if (!(await requireCapability(dependencies, "TRUST_SAFETY_READ"))) {
    return null;
  }
  const statuses = [
    "OPEN",
    "IN_REVIEW",
    "HELD",
    "REVOKED",
    "APPEALED",
    "RESOLVED",
    "EXPIRED",
  ] as const;
  const status = statuses.find((value) => value === input.status);
  const cursor = uuid.safeParse(input.cursor).success ? input.cursor : null;
  const assignee = uuid.safeParse(input.assigneeUserId).success
    ? input.assigneeUserId
    : null;
  const rows = await dependencies.database.trustSafetyCase.findMany({
    where: {
      ...(status === undefined ? {} : { status }),
      ...(assignee === null ? {} : { assigneeUserId: assignee }),
      ...(cursor === null ? {} : { id: { lt: cursor } }),
    },
    orderBy: [
      { severity: "desc" },
      { reviewDueAt: "asc" },
      { id: "desc" },
    ],
    take: 51,
    select: {
      id: true,
      category: true,
      subjectType: true,
      subjectId: true,
      companyId: true,
      severity: true,
      status: true,
      safeReasonCode: true,
      assigneeUserId: true,
      reviewDueAt: true,
      holdExpiresAt: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { appeals: true, effects: true } },
    },
  });
  return Object.freeze({
    rows: Object.freeze(rows.slice(0, 50)),
    nextCursor: rows.length > 50 ? rows[49]!.id : null,
  });
}

export async function getTrustSafetyCase(
  caseId: string,
  dependencies: TrustSafetyAdminDependencies,
) {
  if (
    !uuid.safeParse(caseId).success ||
    !(await requireCapability(dependencies, "TRUST_SAFETY_READ"))
  ) {
    return null;
  }
  return dependencies.database.trustSafetyCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      category: true,
      subjectType: true,
      subjectId: true,
      companyId: true,
      severity: true,
      status: true,
      policyVersion: true,
      safeReasonCode: true,
      assigneeUserId: true,
      reviewDueAt: true,
      holdExpiresAt: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          actorUserId: true,
          reasonCode: true,
          safeNote: true,
          createdAt: true,
        },
      },
      appeals: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          appellantUserId: true,
          status: true,
          safeStatement: true,
          decisionReasonCode: true,
          decidedByUserId: true,
          decidedAt: true,
          decisionVersion: true,
          createdAt: true,
        },
      },
      effects: {
        orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          effectScope: true,
          targetType: true,
          targetId: true,
          previousState: true,
          appliedState: true,
          reversible: true,
          appliedAt: true,
          reversedAt: true,
        },
      },
    },
  });
}

export async function listOwnedTrustSafetyCases(
  database: DatabaseClient,
  actorUserId: string,
) {
  if (!uuid.safeParse(actorUserId).success) return Object.freeze([]);
  const memberships = await database.companyMembership.findMany({
    where: {
      userId: actorUserId,
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: { companyId: true },
  });
  const sessionIds = (
    await database.session.findMany({
      where: { userId: actorUserId },
      select: { id: true },
    })
  ).map(({ id }) => id);
  const rows = await database.trustSafetyCase.findMany({
    where: {
      status: { in: ["HELD", "REVOKED", "APPEALED", "EXPIRED"] },
      OR: [
        { subjectType: "USER", subjectId: actorUserId },
        {
          subjectType: "SESSION",
          subjectId: { in: sessionIds },
        },
        {
          companyId: {
            in: memberships.map(({ companyId }) => companyId),
          },
        },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true,
      category: true,
      severity: true,
      status: true,
      safeReasonCode: true,
      reviewDueAt: true,
      holdExpiresAt: true,
      version: true,
      appeals: {
        where: { status: "OPEN" },
        take: 1,
        select: { id: true, status: true, createdAt: true },
      },
    },
  });
  return Object.freeze(rows);
}

export async function assignTrustSafetyCase(
  raw: unknown,
  dependencies: TrustSafetyAdminDependencies,
): Promise<AdminCommandResult<{ caseId: string; version: number }>> {
  const parsed = assignSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const now = adminNow(dependencies.now);
  if (
    !(await requireCapability(dependencies, "TRUST_SAFETY_REVIEW")) ||
    !(await hasCurrentAal2(dependencies.database, {
      userId: dependencies.actor.userId,
      sessionId: dependencies.actor.sessionId,
      now,
    }))
  ) {
    return adminFailure("FORBIDDEN");
  }
  const assignee = await dependencies.database.user.findUnique({
    where: { id: parsed.data.assigneeUserId },
    select: { id: true, role: true, status: true },
  });
  if (assignee?.role !== "ADMIN" || assignee.status !== "ACTIVE") {
    return adminFailure("NOT_FOUND");
  }
  const resolved = await resolveAdminActor(
    dependencies.database,
    {
      userId: assignee.id,
      role: assignee.role,
      status: assignee.status,
    },
    now,
  );
  if (!resolved.capabilities.includes("TRUST_SAFETY_REVIEW")) {
    return adminFailure("FORBIDDEN");
  }
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockCase(transaction, parsed.data.caseId);
        const changed = await transaction.trustSafetyCase.updateMany({
          where: {
            id: parsed.data.caseId,
            version: parsed.data.expectedVersion,
            status: { in: ["OPEN", "IN_REVIEW"] },
          },
          data: {
            assigneeUserId: parsed.data.assigneeUserId,
            status: "IN_REVIEW",
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        const version = parsed.data.expectedVersion + 1;
        await appendCaseEvent(transaction, {
          caseId: parsed.data.caseId,
          kind: "ASSIGNED",
          actorUserId: dependencies.actor.userId,
          reasonCode: parsed.data.reasonCode,
          safeNote: null,
          idempotencyKey: `trust:${parsed.data.caseId}:assigned:v${version}`,
          now,
        });
        await writeAdminAudit(transaction, dependencies, now, {
          action: "TRUST_SAFETY_CASE_CHANGED",
          capability: "TRUST_SAFETY_REVIEW",
          targetType: "TRUST_SAFETY_CASE",
          targetId: parsed.data.caseId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ caseId: parsed.data.caseId, version });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return adminFailure("WRITE_FAILED");
  }
}

export async function decideTrustSafetyCase(
  raw: unknown,
  dependencies: TrustSafetyAdminDependencies,
): Promise<AdminCommandResult<{ caseId: string; version: number }>> {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const safeNote = boundedPlainText(parsed.data.safeNote, 10, 1_000);
  if (safeNote === null) return adminFailure("INVALID_INPUT");
  const now = adminNow(dependencies.now);
  if (!(await requireCapability(dependencies, "TRUST_SAFETY_REVIEW"))) {
    return adminFailure("FORBIDDEN");
  }
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockCase(transaction, parsed.data.caseId);
        const current = await transaction.trustSafetyCase.findFirst({
          where: {
            id: parsed.data.caseId,
            version: parsed.data.expectedVersion,
            status: { in: ["OPEN", "IN_REVIEW"] },
            assigneeUserId: dependencies.actor.userId,
          },
          select: {
            id: true,
            companyId: true,
            subjectType: true,
            subjectId: true,
            riskDecision: { select: { effectScope: true } },
          },
        });
        if (current === null) return adminFailure("CONFLICT");
        const action = `TRUST_${parsed.data.decision}`;
        if (
          parsed.data.stepUpEvidenceId === undefined ||
          parsed.data.stepUpGrantToken === undefined ||
          !(await consumeStepUpGrant(transaction, {
            evidenceId: parsed.data.stepUpEvidenceId,
            grantToken: parsed.data.stepUpGrantToken,
            actor: {
              userId: dependencies.actor.userId,
              sessionId: dependencies.actor.sessionId,
              role: "ADMIN",
              status: "ACTIVE",
            },
            purpose: "TRUST_SAFETY",
            action,
            tenantId: current.companyId,
            resourceId: current.id,
            correlationId: dependencies.correlationId,
            now,
          }))
        ) {
          return adminFailure("FORBIDDEN");
        }
        if (parsed.data.decision !== "RESOLVE") {
          await applyTrustContainment(transaction, {
            caseId: current.id,
            companyId: current.companyId,
            subjectType: current.subjectType,
            subjectId: current.subjectId,
            mode: parsed.data.decision,
            actorUserId: dependencies.actor.userId,
            correlationId: dependencies.correlationId,
            reasonCode: parsed.data.reasonCode,
            effectScope: current.riskDecision.effectScope,
            now,
          });
        }
        const version = parsed.data.expectedVersion + 1;
        const nextStatus =
          parsed.data.decision === "HOLD"
            ? "HELD"
            : parsed.data.decision === "REVOKE"
              ? "REVOKED"
              : "RESOLVED";
        const changed = await transaction.trustSafetyCase.updateMany({
          where: {
            id: current.id,
            version: parsed.data.expectedVersion,
            status: { in: ["OPEN", "IN_REVIEW"] },
          },
          data: {
            status: nextStatus,
            holdExpiresAt:
              parsed.data.decision === "HOLD"
                ? new Date(now.getTime() + 24 * 60 * 60_000)
                : null,
            resolvedAt:
              parsed.data.decision === "RESOLVE" ? now : null,
            version,
            updatedAt: now,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        await appendCaseEvent(transaction, {
          caseId: current.id,
          kind:
            parsed.data.decision === "HOLD"
              ? "HELD"
              : parsed.data.decision === "REVOKE"
                ? "REVOKED"
                : "RESOLVED",
          actorUserId: dependencies.actor.userId,
          reasonCode: parsed.data.reasonCode,
          safeNote,
          idempotencyKey: `trust:${current.id}:${parsed.data.decision.toLowerCase()}:v${version}`,
          now,
        });
        if (parsed.data.decision === "REVOKE") {
          await transaction.systemTask.upsert({
            where: { idempotencyKey: `trust-revoke:${current.id}` },
            update: {},
            create: {
              kind: "SECURITY_INCIDENT",
              reasonCode: parsed.data.reasonCode,
              policyVersion: "TRUST_RISK_POLICY_V1",
              evidenceReference: `trust-case:${current.id}`,
              dueAt: now,
              status: "OPEN",
              idempotencyKey: `trust-revoke:${current.id}`,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
        }
        await writeAdminAudit(transaction, dependencies, now, {
          action: "TRUST_SAFETY_CASE_CHANGED",
          capability: "TRUST_SAFETY_REVIEW",
          targetType: "TRUST_SAFETY_CASE",
          targetId: current.id,
          companyId: current.companyId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ caseId: current.id, version });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return adminFailure("WRITE_FAILED");
  }
}

export async function submitTrustSafetyAppeal(
  raw: unknown,
  dependencies: Readonly<{
    database: DatabaseClient;
    actorUserId: string;
    correlationId: string;
    now?: Date;
  }>,
): Promise<
  Readonly<
    | { ok: true; value: Readonly<{ appealId: string; caseId: string }> }
    | {
        ok: false;
        code: "INVALID_INPUT" | "FORBIDDEN" | "CONFLICT" | "WRITE_FAILED";
      }
  >
> {
  const parsed = appealSchema.safeParse(raw);
  if (!parsed.success) return userFailure("INVALID_INPUT");
  const statement = boundedPlainText(parsed.data.safeStatement, 20, 2_000);
  if (statement === null) return userFailure("INVALID_INPUT");
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockCase(transaction, parsed.data.caseId);
        const current = await transaction.trustSafetyCase.findFirst({
          where: {
            id: parsed.data.caseId,
            status: { in: ["HELD", "REVOKED", "EXPIRED"] },
          },
          select: {
            id: true,
            subjectType: true,
            subjectId: true,
            companyId: true,
            version: true,
          },
        });
        if (
          current === null ||
          !(await ownsTrustCase(
            transaction,
            dependencies.actorUserId,
            current,
          ))
        ) {
          return userFailure("FORBIDDEN");
        }
        const existing = await transaction.trustSafetyAppeal.findFirst({
          where: {
            trustSafetyCaseId: current.id,
            decisionVersion: current.version,
          },
          select: { id: true },
        });
        if (existing !== null) return userFailure("CONFLICT");
        const appealId = randomUUID();
        await transaction.trustSafetyAppeal.create({
          data: {
            id: appealId,
            trustSafetyCaseId: current.id,
            appellantUserId: dependencies.actorUserId,
            status: "OPEN",
            safeStatement: statement,
            statementDigest: digest(statement),
            decisionVersion: current.version,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        const changed = await transaction.trustSafetyCase.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            status: "APPEALED",
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        if (changed.count !== 1) return userFailure("CONFLICT");
        await appendCaseEvent(transaction, {
          caseId: current.id,
          kind: "APPEAL_SUBMITTED",
          actorUserId: dependencies.actorUserId,
          reasonCode: "USER_APPEAL",
          safeNote: null,
          idempotencyKey: `trust:${current.id}:appeal:${appealId}`,
          now,
        });
        return Object.freeze({
          ok: true as const,
          value: Object.freeze({ appealId, caseId: current.id }),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return userFailure("WRITE_FAILED");
  }
}

export async function decideTrustSafetyAppeal(
  raw: unknown,
  dependencies: TrustSafetyAdminDependencies,
): Promise<AdminCommandResult<{ appealId: string; caseId: string }>> {
  const parsed = appealDecisionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  const capability =
    parsed.data.decision === "APPROVE"
      ? "TRUST_SAFETY_RESTORE"
      : "TRUST_SAFETY_REVIEW";
  if (!(await requireCapability(dependencies, capability))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "TrustSafetyAppeal"
          WHERE "id" = ${parsed.data.appealId}::uuid
          FOR UPDATE
        `;
        const appeal = await transaction.trustSafetyAppeal.findFirst({
          where: { id: parsed.data.appealId, status: "OPEN" },
          include: {
            trustSafetyCase: {
              include: { riskDecision: { select: { kind: true } } },
            },
          },
        });
        if (
          appeal === null ||
          appeal.trustSafetyCase.status !== "APPEALED" ||
          appeal.trustSafetyCase.version !== parsed.data.expectedCaseVersion ||
          appeal.appellantUserId === dependencies.actor.userId ||
          appeal.trustSafetyCase.assigneeUserId === dependencies.actor.userId
        ) {
          return adminFailure("CONFLICT");
        }
        const trustCase = appeal.trustSafetyCase;
        if (
          parsed.data.stepUpEvidenceId === undefined ||
          parsed.data.stepUpGrantToken === undefined ||
          !(await consumeStepUpGrant(transaction, {
            evidenceId: parsed.data.stepUpEvidenceId,
            grantToken: parsed.data.stepUpGrantToken,
            actor: {
              userId: dependencies.actor.userId,
              sessionId: dependencies.actor.sessionId,
              role: "ADMIN",
              status: "ACTIVE",
            },
            purpose: "TRUST_SAFETY",
            action:
              parsed.data.decision === "APPROVE"
                ? "TRUST_APPEAL_APPROVE"
                : "TRUST_APPEAL_REJECT",
            tenantId: trustCase.companyId,
            resourceId: trustCase.id,
            correlationId: dependencies.correlationId,
            now,
          }))
        ) {
          return adminFailure("FORBIDDEN");
        }
        if (
          parsed.data.decision === "APPROVE" &&
          !(await restorePreconditionsMet(transaction, trustCase, now))
        ) {
          return adminFailure("VERIFICATION_REQUIRED");
        }
        if (parsed.data.decision === "APPROVE") {
          await restoreReversibleContainment(transaction, {
            caseId: trustCase.id,
            actorUserId: dependencies.actor.userId,
            correlationId: dependencies.correlationId,
            reasonCode: parsed.data.reasonCode,
            now,
          });
        }
        const appealChanged = await transaction.trustSafetyAppeal.updateMany({
          where: { id: appeal.id, status: "OPEN" },
          data: {
            status:
              parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
            decisionReasonCode: parsed.data.reasonCode,
            decidedByUserId: dependencies.actor.userId,
            decidedAt: now,
            updatedAt: now,
          },
        });
        if (appealChanged.count !== 1) return adminFailure("CONFLICT");
        const nextStatus =
          parsed.data.decision === "APPROVE"
            ? "RESOLVED"
            : trustCase.holdExpiresAt === null
              ? "REVOKED"
              : "HELD";
        const caseChanged = await transaction.trustSafetyCase.updateMany({
          where: {
            id: trustCase.id,
            status: "APPEALED",
            version: parsed.data.expectedCaseVersion,
          },
          data: {
            status: nextStatus,
            version: { increment: 1 },
            resolvedAt:
              parsed.data.decision === "APPROVE" ? now : null,
            updatedAt: now,
          },
        });
        if (caseChanged.count !== 1) return adminFailure("CONFLICT");
        await appendCaseEvent(transaction, {
          caseId: trustCase.id,
          kind:
            parsed.data.decision === "APPROVE"
              ? "APPEAL_APPROVED"
              : "APPEAL_REJECTED",
          actorUserId: dependencies.actor.userId,
          reasonCode: parsed.data.reasonCode,
          safeNote: null,
          idempotencyKey: `trust:${trustCase.id}:appeal-decision:${appeal.id}`,
          now,
        });
        if (parsed.data.decision === "APPROVE") {
          await appendCaseEvent(transaction, {
            caseId: trustCase.id,
            kind: "RESTORED",
            actorUserId: dependencies.actor.userId,
            reasonCode: parsed.data.reasonCode,
            safeNote: null,
            idempotencyKey: `trust:${trustCase.id}:restored:${appeal.id}`,
            now,
          });
        }
        await writeAdminAudit(transaction, dependencies, now, {
          action: "TRUST_SAFETY_APPEAL_CHANGED",
          capability,
          targetType: "TRUST_SAFETY_APPEAL",
          targetId: appeal.id,
          companyId: trustCase.companyId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({
          appealId: appeal.id,
          caseId: trustCase.id,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return adminFailure("WRITE_FAILED");
  }
}

export async function projectExpiredTrustCases(
  database: DatabaseClient,
  now = new Date(),
): Promise<Readonly<{ expired: number; alerts: number }>> {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Trust expiry requires a valid clock.");
  }
  return database.$transaction(
    async (transaction) => {
      const due = await transaction.trustSafetyCase.findMany({
        where: {
          status: "HELD",
          holdExpiresAt: { lte: now },
        },
        orderBy: { id: "asc" },
        select: { id: true, version: true, safeReasonCode: true },
      });
      let expired = 0;
      let alerts = 0;
      for (const trustCase of due) {
        const changed = await transaction.trustSafetyCase.updateMany({
          where: {
            id: trustCase.id,
            version: trustCase.version,
            status: "HELD",
            holdExpiresAt: { lte: now },
          },
          data: {
            status: "EXPIRED",
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        if (changed.count !== 1) continue;
        expired += 1;
        await appendCaseEvent(transaction, {
          caseId: trustCase.id,
          kind: "EXPIRED",
          actorUserId: null,
          reasonCode: "HOLD_REVIEW_EXPIRED",
          safeNote: null,
          idempotencyKey: `trust:${trustCase.id}:expired:v${trustCase.version + 1}`,
          now,
        });
        await transaction.systemTask.upsert({
          where: { idempotencyKey: `trust-expired:${trustCase.id}` },
          update: {},
          create: {
            kind: "SECURITY_INCIDENT",
            reasonCode: "TRUST_HOLD_REVIEW_EXPIRED",
            policyVersion: "TRUST_RISK_POLICY_V1",
            evidenceReference: `trust-case:${trustCase.id}`,
            dueAt: now,
            status: "OPEN",
            idempotencyKey: `trust-expired:${trustCase.id}`,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        alerts += 1;
      }
      return Object.freeze({ expired, alerts });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function restorePreconditionsMet(
  transaction: Prisma.TransactionClient,
  trustCase: Readonly<{
    subjectType: string;
    subjectId: string;
    companyId: string | null;
    createdAt: Date;
  }>,
  now: Date,
): Promise<boolean> {
  if (trustCase.companyId !== null) {
    return hasCurrentStrongCompanyTrustEvidence(
      transaction,
      trustCase.companyId,
      { now, verifiedAfter: trustCase.createdAt },
    );
  }
  if (trustCase.subjectType === "USER") {
    return (
      (await transaction.user.count({
        where: {
          id: trustCase.subjectId,
          status: "ACTIVE",
          emailVerifiedAt: { not: null },
        },
      })) === 1
    );
  }
  if (trustCase.subjectType === "SESSION") {
    return (
      (await transaction.session.count({
        where: {
          id: trustCase.subjectId,
          user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
        },
      })) === 1
    );
  }
  return false;
}

async function ownsTrustCase(
  transaction: Prisma.TransactionClient,
  userId: string,
  trustCase: Readonly<{
    subjectType: string;
    subjectId: string;
    companyId: string | null;
  }>,
): Promise<boolean> {
  if (trustCase.subjectType === "USER") return trustCase.subjectId === userId;
  if (trustCase.subjectType === "SESSION") {
    return (
      (await transaction.session.count({
        where: { id: trustCase.subjectId, userId },
      })) === 1
    );
  }
  if (trustCase.companyId !== null) {
    return (
      (await transaction.companyMembership.count({
        where: {
          companyId: trustCase.companyId,
          userId,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN"] },
        },
      })) === 1
    );
  }
  return false;
}

async function lockCase(
  transaction: Prisma.TransactionClient,
  caseId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "TrustSafetyCase"
    WHERE "id" = ${caseId}::uuid
    FOR UPDATE
  `;
}

async function appendCaseEvent(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    caseId: string;
    kind:
      | "OPENED"
      | "ASSIGNED"
      | "REVIEW_STARTED"
      | "HELD"
      | "REVOKED"
      | "APPEAL_SUBMITTED"
      | "APPEAL_APPROVED"
      | "APPEAL_REJECTED"
      | "RESTORED"
      | "RESOLVED"
      | "EXPIRED";
    actorUserId: string | null;
    reasonCode: string;
    safeNote: string | null;
    idempotencyKey: string;
    now: Date;
  }>,
): Promise<void> {
  await transaction.trustSafetyCaseEvent.create({
    data: {
      id: randomUUID(),
      trustSafetyCaseId: input.caseId,
      kind: input.kind,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode,
      safeNote: input.safeNote,
      evidenceDigest: digest(
        `${input.caseId}\0${input.kind}\0${input.idempotencyKey}`,
      ),
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    },
    select: { id: true },
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function userFailure(
  code: "INVALID_INPUT" | "FORBIDDEN" | "CONFLICT" | "WRITE_FAILED",
) {
  return Object.freeze({ ok: false as const, code });
}
