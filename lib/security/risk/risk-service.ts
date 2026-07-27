import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  evaluateTrustRiskSignal,
  TRUST_RISK_POLICY_VERSION,
  TRUST_RISK_SOURCES_V1,
} from "@/lib/security/risk/trust-risk-policy";
import { applyTrustContainment } from "@/lib/trust-safety/containment";

const SIGNAL_KINDS = [
  "CREDENTIAL_STUFFING",
  "PASSWORD_SPRAY",
  "SESSION_ANOMALY",
  "RECOVERY_ABUSE",
  "COMPROMISED_COMPANY",
  "JOB_SCAM",
  "JOB_DUPLICATE",
  "MASS_MESSAGING",
  "MASS_CONTACT",
  "REPEATED_COMPLAINT",
  "REVEAL_ANOMALY",
  "EXPORT_ANOMALY",
  "PAYMENT_FRAUD",
] as const;
const SUBJECT_TYPES = [
  "USER",
  "SESSION",
  "COMPANY",
  "JOB",
  "MESSAGE",
  "CONTACT_REQUEST",
  "REVEAL",
  "EXPORT",
  "PAYMENT",
] as const;
const inputSchema = z
  .strictObject({
    kind: z.enum(SIGNAL_KINDS),
    subjectType: z.enum(SUBJECT_TYPES),
    subjectId: z.uuid(),
    companyId: z.uuid().nullish(),
    source: z.enum(TRUST_RISK_SOURCES_V1),
    observedCount: z.number().int().min(0).max(1_000_000).nullish(),
    windowStartedAt: z.date().nullish(),
    windowEndedAt: z.date().nullish(),
    evidenceReference: z
      .string()
      .trim()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,159}$/u),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
  })
  .superRefine((value, context) => {
    const hasStart = value.windowStartedAt != null;
    const hasEnd = value.windowEndedAt != null;
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: "custom",
        path: ["windowStartedAt"],
        message: "A risk window requires both bounds.",
      });
    }
    if (
      hasStart &&
      hasEnd &&
      value.windowStartedAt!.getTime() >= value.windowEndedAt!.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["windowEndedAt"],
        message: "Risk window bounds are invalid.",
      });
    }
  });

export type RiskServiceDependencies = Readonly<{
  database: DatabaseClient;
  correlationId: string;
  mode: "observe" | "hold";
  recordedByUserId?: string | null;
  now?: Date;
}>;

export type RiskSignalResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        signalId: string;
        decisionId: string;
        caseId: string | null;
        decision: "ALLOW" | "STEP_UP" | "HOLD" | "REVIEW" | "REVOKE";
        caseStatus:
          | "OPEN"
          | "HELD"
          | null;
        replay: boolean;
      }>;
    }>
  | Readonly<{
      ok: false;
      code: "INVALID_INPUT" | "SUBJECT_MISMATCH" | "WRITE_FAILED";
    }>;

export async function recordAndDecideRiskSignal(
  raw: unknown,
  dependencies: RiskServiceDependencies,
): Promise<RiskSignalResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = normalizeNow(dependencies.now);
  if (
    parsed.data.windowEndedAt != null &&
    parsed.data.windowEndedAt.getTime() > now.getTime() + 60_000
  ) {
    return failure("INVALID_INPUT");
  }
  const evidenceDigest = digest(parsed.data.evidenceReference);
  const signalDedupeKey = `risk:${digest(
    [
      parsed.data.kind,
      parsed.data.subjectType,
      parsed.data.subjectId,
      parsed.data.idempotencyKey,
    ].join("\0"),
  )}`;

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const existing = await transaction.riskSignal.findUnique({
          where: { dedupeKey: signalDedupeKey },
          include: {
            decisions: {
              orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
              take: 1,
              include: {
                trustSafetyCase: { select: { id: true, status: true } },
              },
            },
          },
        });
        if (existing !== null) {
          const prior = existing.decisions[0];
          if (prior === undefined) throw new Error("RISK_DECISION_MISSING");
          return success({
            signalId: existing.id,
            decisionId: prior.id,
            caseId: prior.trustSafetyCase?.id ?? null,
            decision: prior.kind,
            caseStatus:
              prior.trustSafetyCase?.status === "OPEN" ||
              prior.trustSafetyCase?.status === "HELD"
                ? prior.trustSafetyCase.status
                : null,
            replay: true,
          });
        }

        const subject = await resolveRiskSubject(
          transaction,
          parsed.data.subjectType,
          parsed.data.subjectId,
          parsed.data.companyId ?? null,
        );
        if (subject === null) return failure("SUBJECT_MISMATCH");
        if (
          dependencies.recordedByUserId != null &&
          (await transaction.user.count({
            where: { id: dependencies.recordedByUserId },
          })) !== 1
        ) {
          return failure("SUBJECT_MISMATCH");
        }

        const policy = evaluateTrustRiskSignal({
          kind: parsed.data.kind,
          subjectType: parsed.data.subjectType,
          source: parsed.data.source,
          observedCount: parsed.data.observedCount,
        });
        const signalId = randomUUID();
        const decisionId = randomUUID();
        await transaction.riskSignal.create({
          data: {
            id: signalId,
            kind: parsed.data.kind,
            subjectType: parsed.data.subjectType,
            subjectId: parsed.data.subjectId,
            companyId: subject.companyId,
            source: parsed.data.source,
            purpose: purposeForSignal(parsed.data.kind),
            policyVersion: TRUST_RISK_POLICY_VERSION,
            windowStartedAt: parsed.data.windowStartedAt ?? null,
            windowEndedAt: parsed.data.windowEndedAt ?? null,
            observedCount: parsed.data.observedCount ?? null,
            evidenceDigest,
            dedupeKey: signalDedupeKey,
            recordedByUserId: dependencies.recordedByUserId ?? null,
            occurredAt: now,
            retainUntil: new Date(now.getTime() + 180 * 86_400_000),
            createdAt: now,
          },
          select: { id: true },
        });
        await transaction.trustRiskDecision.create({
          data: {
            id: decisionId,
            riskSignalId: signalId,
            kind: policy.kind,
            reasonCode: policy.reasonCode,
            policyVersion: policy.policyVersion,
            effectScope: [...policy.effectScope],
            evidenceDigest: digest(
              `${signalId}\0${policy.kind}\0${policy.reasonCode}`,
            ),
            decidedByUserId: dependencies.recordedByUserId ?? null,
            decidedAt: now,
            expiresAt:
              policy.holdTtlMilliseconds === null
                ? null
                : new Date(now.getTime() + policy.holdTtlMilliseconds),
            idempotencyKey: `decision:${signalId}:${policy.policyVersion}`,
            createdAt: now,
          },
          select: { id: true },
        });

        let caseId: string | null = null;
        let caseStatus: "OPEN" | "HELD" | null = null;
        if (policy.opensCase) {
          caseId = randomUUID();
          const automatedHold =
            dependencies.mode === "hold" && policy.kind === "HOLD";
          caseStatus = automatedHold ? "HELD" : "OPEN";
          await transaction.trustSafetyCase.create({
            data: {
              id: caseId,
              riskDecisionId: decisionId,
              subjectType: parsed.data.subjectType,
              subjectId: parsed.data.subjectId,
              companyId: subject.companyId,
              category: parsed.data.kind,
              severity: policy.severity,
              status: caseStatus,
              policyVersion: policy.policyVersion,
              safeReasonCode: policy.reasonCode,
              evidenceDigest: digest(
                `${decisionId}\0${policy.reasonCode}\0case`,
              ),
              dedupeKey: `case:${digest(
                `${parsed.data.kind}\0${parsed.data.subjectId}\0${parsed.data.idempotencyKey}`,
              )}`,
              reviewDueAt: new Date(
                now.getTime() + policy.reviewSlaMilliseconds,
              ),
              holdExpiresAt:
                automatedHold && policy.holdTtlMilliseconds !== null
                  ? new Date(now.getTime() + policy.holdTtlMilliseconds)
                  : null,
              version: automatedHold ? 2 : 1,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          await transaction.trustSafetyCaseEvent.create({
            data: {
              id: randomUUID(),
              trustSafetyCaseId: caseId,
              kind: "OPENED",
              actorUserId: dependencies.recordedByUserId ?? null,
              reasonCode: policy.reasonCode,
              evidenceDigest: digest(`${caseId}\0OPENED`),
              idempotencyKey: `trust:${caseId}:opened`,
              createdAt: now,
            },
            select: { id: true },
          });
          if (automatedHold) {
            await applyTrustContainment(transaction, {
              caseId,
              companyId: subject.companyId,
              subjectType: parsed.data.subjectType,
              subjectId: parsed.data.subjectId,
              mode: "HOLD",
              actorUserId: dependencies.recordedByUserId ?? null,
              correlationId: dependencies.correlationId,
              reasonCode: policy.reasonCode,
              effectScope: policy.effectScope,
              now,
            });
            await transaction.trustSafetyCaseEvent.create({
              data: {
                id: randomUUID(),
                trustSafetyCaseId: caseId,
                kind: "HELD",
                actorUserId: dependencies.recordedByUserId ?? null,
                reasonCode: policy.reasonCode,
                evidenceDigest: digest(`${caseId}\0HELD`),
                idempotencyKey: `trust:${caseId}:held:auto`,
                createdAt: now,
              },
              select: { id: true },
            });
          }
        }

        const audit = createPrismaTransactionAuditPort(transaction);
        const auditBase = {
          actorKind:
            dependencies.recordedByUserId == null
              ? ("SYSTEM" as const)
              : ("USER" as const),
          actorUserId: dependencies.recordedByUserId ?? null,
          companyId: subject.companyId,
          correlationId: dependencies.correlationId,
          retainUntil: new Date(now.getTime() + 400 * 86_400_000),
          result: "SUCCEEDED" as const,
        };
        await writeRequiredAudit(audit, {
          ...auditBase,
          action: "RISK_SIGNAL_RECORDED",
          capability: "TRUST_RISK_ENGINE",
          reasonCode: parsed.data.kind,
          targetId: signalId,
          targetType: "RISK_SIGNAL",
        });
        await writeRequiredAudit(audit, {
          ...auditBase,
          action: "RISK_DECISION_RECORDED",
          capability: "TRUST_RISK_ENGINE",
          reasonCode: policy.reasonCode,
          targetId: decisionId,
          targetType: "RISK_DECISION",
        });
        if (caseId !== null) {
          await writeRequiredAudit(audit, {
            ...auditBase,
            action: "TRUST_SAFETY_CASE_CHANGED",
            capability: "TRUST_RISK_ENGINE",
            reasonCode: policy.reasonCode,
            targetId: caseId,
            targetType: "TRUST_SAFETY_CASE",
          });
        }
        return success({
          signalId,
          decisionId,
          caseId,
          decision: policy.kind,
          caseStatus,
          replay: false,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return failure("WRITE_FAILED");
  }
}

async function resolveRiskSubject(
  transaction: Prisma.TransactionClient,
  subjectType: (typeof SUBJECT_TYPES)[number],
  subjectId: string,
  claimedCompanyId: string | null,
): Promise<Readonly<{ companyId: string | null }> | null> {
  let companyId: string | null = null;
  switch (subjectType) {
    case "USER": {
      if (
        (await transaction.user.count({ where: { id: subjectId } })) !== 1
      ) {
        return null;
      }
      if (claimedCompanyId !== null) {
        const membership = await transaction.companyMembership.findFirst({
          where: { userId: subjectId, companyId: claimedCompanyId },
          select: { companyId: true },
        });
        if (membership === null) return null;
        companyId = membership.companyId;
      }
      break;
    }
    case "SESSION": {
      const session = await transaction.session.findUnique({
        where: { id: subjectId },
        select: { userId: true },
      });
      if (session === null) return null;
      if (claimedCompanyId !== null) {
        const membership = await transaction.companyMembership.findFirst({
          where: { userId: session.userId, companyId: claimedCompanyId },
          select: { companyId: true },
        });
        if (membership === null) return null;
        companyId = membership.companyId;
      }
      break;
    }
    case "COMPANY":
      companyId =
        (await transaction.company.findUnique({
          where: { id: subjectId },
          select: { id: true },
        }))?.id ?? null;
      if (companyId === null) return null;
      break;
    case "JOB":
      companyId =
        (await transaction.job.findUnique({
          where: { id: subjectId },
          select: { companyId: true },
        }))?.companyId ?? null;
      if (companyId === null) return null;
      break;
    case "MESSAGE":
      companyId =
        (await transaction.message.findUnique({
          where: { id: subjectId },
          select: { conversation: { select: { companyId: true } } },
        }))?.conversation.companyId ?? null;
      if (companyId === null) return null;
      break;
    case "CONTACT_REQUEST":
      companyId =
        (await transaction.employerContactRequest.findUnique({
          where: { id: subjectId },
          select: { companyId: true },
        }))?.companyId ?? null;
      if (companyId === null) return null;
      break;
    case "REVEAL":
      companyId =
        (await transaction.identityRevealGrant.findUnique({
          where: { id: subjectId },
          select: { companyId: true },
        }))?.companyId ?? null;
      if (companyId === null) return null;
      break;
    case "EXPORT":
      if (
        (await transaction.privacyRequest.count({
          where: { id: subjectId, type: "EXPORT" },
        })) !== 1
      ) {
        return null;
      }
      break;
    case "PAYMENT":
      companyId =
        (await transaction.paymentAttempt.findUnique({
          where: { id: subjectId },
          select: { companyId: true },
        }))?.companyId ?? null;
      if (companyId === null) return null;
      break;
  }
  if (claimedCompanyId !== null && claimedCompanyId !== companyId) return null;
  return Object.freeze({ companyId });
}

function purposeForSignal(kind: (typeof SIGNAL_KINDS)[number]): string {
  if (
    kind === "CREDENTIAL_STUFFING" ||
    kind === "PASSWORD_SPRAY" ||
    kind === "SESSION_ANOMALY" ||
    kind === "RECOVERY_ABUSE"
  ) {
    return "ACCOUNT_SECURITY";
  }
  if (kind === "PAYMENT_FRAUD") return "PAYMENT_SECURITY";
  if (kind === "EXPORT_ANOMALY") return "PRIVACY_SECURITY";
  return "MARKETPLACE_TRUST";
}

function normalizeNow(value?: Date): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Risk service requires a valid clock.");
  }
  return new Date(now);
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function success(
  value: Extract<RiskSignalResult, { ok: true }>["value"],
): RiskSignalResult {
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}

function failure(
  code: Extract<RiskSignalResult, { ok: false }>["code"],
): RiskSignalResult {
  return Object.freeze({ ok: false, code });
}
