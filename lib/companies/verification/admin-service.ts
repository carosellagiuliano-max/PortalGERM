import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  boundedPlainText,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
  type AdminDependencies,
} from "@/lib/admin/common";
import { consumeStepUpGrant } from "@/lib/auth/assurance/step-up-service";
import {
  COMPANY_TRUST_POLICY_V2,
  companyTrustEvidenceDigest,
} from "@/lib/companies/verification/policy-v2";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { applyCompanyRadarEligibilityLoss } from "@/lib/talentradar/eligibility-loss-effects";

const DAY = 86_400_000;
const APPROVAL_TTL = 30 * 60_000;
const DEFAULT_TRUST_VALIDITY = 180 * DAY;
const reasonCode = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
const uuid = z.uuid();
const optionalStepUp = {
  stepUpEvidenceId: uuid.optional(),
  stepUpGrantToken: z.string().min(32).max(128).optional(),
} as const;

export type CompanyVerificationAdminDependencies = AdminDependencies &
  Readonly<{
    actor: AdminDependencies["actor"] & Readonly<{ sessionId: string }>;
    stepUpMode: "disabled" | "observe" | "enforce";
  }>;

export const assignCompanyVerificationSchema = z.strictObject({
  verificationRequestId: uuid,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const decideCompanyVerificationSchema = z.strictObject({
  verificationRequestId: uuid,
  expectedVersion: z.number().int().positive(),
  decision: z.enum([
    "APPROVE",
    "REQUEST_CHANGES",
    "REJECT",
    "REVOKE",
  ]),
  reasonCode,
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const requestIndependentApprovalSchema = z.strictObject({
  verificationRequestId: uuid,
  expectedVersion: z.number().int().positive(),
  reasonCode,
  riskLevel: z.enum(["HIGH", "MANUAL_EXCEPTION"]),
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const approveIndependentDecisionSchema = z.strictObject({
  approvalId: uuid,
  reasonCode,
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const decideCompanyVerificationAppealSchema = z.strictObject({
  appealId: uuid,
  decision: z.enum(["APPROVE", "REJECT"]),
  reasonCode,
  idempotencyKey: uuid,
  ...optionalStepUp,
});

const approvalPayloadSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  verificationRequestId: uuid,
  companyId: uuid,
  reviewerUserId: uuid,
  requestVersion: z.number().int().positive(),
  riskLevel: z.enum(["HIGH", "MANUAL_EXCEPTION"]),
  reasonCode,
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime(),
});

export async function listCompanyVerificationQueue(
  dependencies: CompanyVerificationAdminDependencies,
  input: Readonly<{
    status?: "PENDING" | "CHANGES_REQUESTED";
    assignedToMe?: boolean;
    after?: Readonly<{
      priority: number;
      reviewDueAt: Date;
      id: string;
    }>;
    limit?: number;
  }> = {},
) {
  if (!(await requireCapability(dependencies, "COMPANY_VERIFICATION_REVIEW"))) {
    return null;
  }
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  const after = input.after;
  return dependencies.database.companyVerificationRequest.findMany({
    where: {
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      status: input.status ?? { in: ["PENDING", "CHANGES_REQUESTED"] },
      ...(input.assignedToMe
        ? { assignedReviewerUserId: dependencies.actor.userId }
        : {}),
      ...(after === undefined
        ? {}
        : {
            OR: [
              { priority: { lt: after.priority } },
              {
                priority: after.priority,
                reviewDueAt: { gt: after.reviewDueAt },
              },
              {
                priority: after.priority,
                reviewDueAt: after.reviewDueAt,
                id: { gt: after.id },
              },
            ],
          }),
    },
    orderBy: [
      { priority: "desc" },
      { reviewDueAt: "asc" },
      { id: "asc" },
    ],
    take: limit,
    select: {
      id: true,
      companyId: true,
      status: true,
      riskLevel: true,
      priority: true,
      version: true,
      assignedReviewerUserId: true,
      assignedAt: true,
      reviewDueAt: true,
      reviewStartedAt: true,
      createdAt: true,
      company: {
        select: {
          name: true,
          slug: true,
          uid: true,
          status: true,
        },
      },
      requestedBy: {
        select: { id: true, name: true, email: true },
      },
      evidence: {
        orderBy: [{ type: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          type: true,
          scope: true,
          status: true,
          source: true,
          providerKey: true,
          checkedAt: true,
          validFrom: true,
          validTo: true,
          reasonCode: true,
          documentVersionId: true,
          domainChallenge: {
            select: {
              id: true,
              domain: true,
              status: true,
              expiresAt: true,
              verifiedAt: true,
            },
          },
          checks: {
            orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
            take: 3,
            select: {
              id: true,
              result: true,
              uidMatched: true,
              nameMatched: true,
              cantonMatched: true,
              domainMatched: true,
              retryable: true,
              failureCode: true,
              checkedAt: true,
            },
          },
        },
      },
    },
  });
}

export async function getCompanyVerificationReview(
  dependencies: CompanyVerificationAdminDependencies,
  verificationRequestId: string,
) {
  if (
    !uuid.safeParse(verificationRequestId).success ||
    !(await requireCapability(dependencies, "COMPANY_VERIFICATION_REVIEW"))
  ) {
    return null;
  }
  return dependencies.database.companyVerificationRequest.findUnique({
    where: { id: verificationRequestId },
    select: {
      id: true,
      companyId: true,
      status: true,
      riskLevel: true,
      policyVersion: true,
      priority: true,
      version: true,
      assignedReviewerUserId: true,
      assignedAt: true,
      reviewDueAt: true,
      reviewStartedAt: true,
      decidedAt: true,
      createdAt: true,
      updatedAt: true,
      company: {
        select: {
          name: true,
          slug: true,
          uid: true,
          status: true,
          website: true,
        },
      },
      requestedBy: { select: { id: true, name: true, email: true } },
      evidence: {
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          type: true,
          scope: true,
          status: true,
          source: true,
          providerKey: true,
          normalizedIdentifier: true,
          responseDigest: true,
          reasonCode: true,
          checkedAt: true,
          validFrom: true,
          validTo: true,
          revokedAt: true,
          documentVersionId: true,
          domainChallenge: {
            select: {
              id: true,
              domain: true,
              status: true,
              issuedAt: true,
              expiresAt: true,
              verifiedAt: true,
            },
          },
          checks: {
            orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              providerUseCase: true,
              adapterKey: true,
              adapterVersion: true,
              result: true,
              uidMatched: true,
              nameMatched: true,
              cantonMatched: true,
              domainMatched: true,
              retryable: true,
              failureCode: true,
              latencyMs: true,
              checkedAt: true,
            },
          },
        },
      },
      decisions: {
        orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          scope: true,
          riskLevel: true,
          reasonCode: true,
          validFrom: true,
          validTo: true,
          decidedAt: true,
          decidedBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      },
      appeals: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          status: true,
          safeStatement: true,
          decisionReasonCode: true,
          decidedAt: true,
          createdAt: true,
          appellant: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

export async function assignCompanyVerification(
  raw: unknown,
  dependencies: CompanyVerificationAdminDependencies,
): Promise<
  AdminCommandResult<{ requestId: string; version: number; assignedAt: Date }>
> {
  const parsed = assignCompanyVerificationSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await requireCapability(dependencies, "COMPANY_VERIFICATION_REVIEW"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockRequest(transaction, parsed.data.verificationRequestId);
        const request = await transaction.companyVerificationRequest.findFirst({
          where: {
            id: parsed.data.verificationRequestId,
            policyVersion: COMPANY_TRUST_POLICY_V2.version,
            status: { in: ["PENDING", "CHANGES_REQUESTED"] },
            version: parsed.data.expectedVersion,
            requestedByUserId: { not: dependencies.actor.userId },
            OR: [
              { assignedReviewerUserId: null },
              { assignedReviewerUserId: dependencies.actor.userId },
            ],
          },
          select: {
            id: true,
            companyId: true,
            version: true,
            assignedReviewerUserId: true,
          },
        });
        if (request === null) return adminFailure("CONFLICT");
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeAdminStepUp(
            transaction,
            dependencies,
            parsed.data,
            request.companyId,
            request.id,
            "COMPANY_VERIFICATION_ASSIGN",
            now,
          ))
        ) {
          return adminFailure("FORBIDDEN");
        }
        if (request.assignedReviewerUserId === dependencies.actor.userId) {
          return adminSuccess(
            {
              requestId: request.id,
              version: request.version,
              assignedAt: now,
            },
            true,
          );
        }
        const version = request.version + 1;
        const changed =
          await transaction.companyVerificationRequest.updateMany({
            where: {
              id: request.id,
              version: request.version,
              assignedReviewerUserId: null,
            },
            data: {
              assignedReviewerUserId: dependencies.actor.userId,
              assignedAt: now,
              reviewStartedAt: now,
              version,
              updatedAt: now,
            },
          });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        await writeAdminAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_ASSIGNED_V2",
          capability: "COMPANY_VERIFICATION_REVIEW",
          targetType: "VERIFICATION_REQUEST",
          targetId: request.id,
          companyId: request.companyId,
          reasonCode: "REVIEWER_SELF_ASSIGNED",
        });
        return adminSuccess({
          requestId: request.id,
          version,
          assignedAt: now,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function decideCompanyVerification(
  raw: unknown,
  dependencies: CompanyVerificationAdminDependencies,
): Promise<
  AdminCommandResult<{
    requestId: string;
    companyId: string;
    status: string;
    trustLevel: "STRONG" | "NONE";
  }>
> {
  const parsed = decideCompanyVerificationSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await requireCapability(dependencies, "COMPANY_VERIFICATION_REVIEW"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockRequest(transaction, parsed.data.verificationRequestId);
        const decisionKey = `phase26:decision:${parsed.data.idempotencyKey}`;
        const replay = await transaction.companyVerificationDecision.findUnique({
          where: { idempotencyKey: decisionKey },
          select: {
            kind: true,
            decidedByUserId: true,
            verificationRequest: {
              select: { id: true, companyId: true, status: true },
            },
          },
        });
        if (replay !== null) {
          if (
            replay.decidedByUserId !== dependencies.actor.userId ||
            replay.verificationRequest.id !==
              parsed.data.verificationRequestId
          ) {
            return adminFailure("CONFLICT");
          }
          return adminSuccess(
            {
              requestId: replay.verificationRequest.id,
              companyId: replay.verificationRequest.companyId,
              status: replay.verificationRequest.status,
              trustLevel:
                replay.kind === "APPROVED" ? "STRONG" : "NONE",
            },
            true,
          );
        }
        const request = await loadAssignedRequest(
          transaction,
          parsed.data.verificationRequestId,
          dependencies.actor.userId,
          parsed.data.expectedVersion,
        );
        if (request === null) return adminFailure("CONFLICT");
        if (request.riskLevel !== "NORMAL") {
          return adminFailure("RESTRICTED", [
            "INDEPENDENT_APPROVAL_REQUIRED",
          ]);
        }
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeAdminStepUp(
            transaction,
            dependencies,
            parsed.data,
            request.companyId,
            request.id,
            parsed.data.decision === "REVOKE"
              ? "COMPANY_VERIFICATION_REVOKE"
              : "COMPANY_VERIFICATION_DECIDE",
            now,
          ))
        ) {
          return adminFailure("FORBIDDEN");
        }
        return persistDecision(transaction, dependencies, now, request, {
          decision: parsed.data.decision,
          reasonCode: parsed.data.reasonCode,
          idempotencyKey: decisionKey,
          approvedByUserId: null,
          decidedByUserId: dependencies.actor.userId,
          auditCapability: "COMPANY_VERIFICATION_REVIEW",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function requestIndependentCompanyVerificationApproval(
  raw: unknown,
  dependencies: CompanyVerificationAdminDependencies,
): Promise<AdminCommandResult<{ approvalId: string; expiresAt: Date }>> {
  const parsed = requestIndependentApprovalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await requireCapability(dependencies, "COMPANY_VERIFICATION_REVIEW"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockRequest(transaction, parsed.data.verificationRequestId);
        const request = await loadAssignedRequest(
          transaction,
          parsed.data.verificationRequestId,
          dependencies.actor.userId,
          parsed.data.expectedVersion,
        );
        if (
          request === null ||
          request.riskLevel !== parsed.data.riskLevel
        ) {
          return adminFailure("CONFLICT");
        }
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeAdminStepUp(
            transaction,
            dependencies,
            parsed.data,
            request.companyId,
            request.id,
            "COMPANY_VERIFICATION_DECIDE",
            now,
          ))
        ) {
          return adminFailure("FORBIDDEN");
        }
        const evidence = currentEvidenceWindow(request.evidence, now);
        if (
          parsed.data.riskLevel === "HIGH" &&
          evidence === null
        ) {
          return adminFailure("INCOMPLETE");
        }
        const evidenceDigest =
          evidence?.digest ??
          companyTrustEvidenceDigest(
            request.evidence.map((item) => ({
              type: item.type,
              responseDigest: item.responseDigest,
              validTo: item.validTo,
            })),
          );
        const validFrom = now;
        const validTo =
          evidence?.validTo ??
          new Date(now.getTime() + 30 * DAY);
        const payload = Object.freeze({
          schemaVersion: "1" as const,
          verificationRequestId: request.id,
          companyId: request.companyId,
          reviewerUserId: dependencies.actor.userId,
          requestVersion: request.version,
          riskLevel: parsed.data.riskLevel,
          reasonCode: parsed.data.reasonCode,
          evidenceDigest,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
        });
        const existing = await transaction.privilegedApproval.findFirst({
          where: {
            kind: "COMPANY_VERIFICATION",
            targetType: "VERIFICATION_REQUEST",
            targetId: request.id,
            requestedByUserId: dependencies.actor.userId,
            status: "PENDING",
            evidenceDigest: payloadDigest(payload),
            expiresAt: { gt: now },
          },
          select: { id: true, expiresAt: true },
        });
        if (existing !== null) {
          return adminSuccess(
            { approvalId: existing.id, expiresAt: existing.expiresAt },
            true,
          );
        }
        const approvalId = randomUUID();
        const expiresAt = new Date(now.getTime() + APPROVAL_TTL);
        await transaction.privilegedApproval.create({
          data: {
            id: approvalId,
            kind: "COMPANY_VERIFICATION",
            status: "PENDING",
            requestedByUserId: dependencies.actor.userId,
            targetType: "VERIFICATION_REQUEST",
            targetId: request.id,
            duty: "TRUST_SAFETY",
            reasonCode: parsed.data.reasonCode,
            evidenceDigest: payloadDigest(payload),
            requestPayload: payload as Prisma.InputJsonValue,
            expiresAt,
            createdAt: now,
          },
        });
        await writeAdminAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_DECIDED_V2",
          capability: "COMPANY_VERIFICATION_REVIEW",
          targetType: "COMPANY_VERIFICATION_DECISION",
          targetId: approvalId,
          companyId: request.companyId,
          reasonCode: "INDEPENDENT_APPROVAL_REQUESTED",
        });
        return adminSuccess({ approvalId, expiresAt });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function approveIndependentCompanyVerificationDecision(
  raw: unknown,
  dependencies: CompanyVerificationAdminDependencies,
): Promise<
  AdminCommandResult<{
    requestId: string;
    companyId: string;
    status: string;
    trustLevel: "STRONG" | "NONE";
  }>
> {
  const parsed = approveIndependentDecisionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (
    !(await requireCapability(dependencies, "COMPANY_VERIFICATION_APPROVE"))
  ) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const decisionKey =
          `phase26:independent:${parsed.data.idempotencyKey}`;
        const replay = await transaction.companyVerificationDecision.findUnique({
          where: { idempotencyKey: decisionKey },
          select: {
            kind: true,
            approvedByUserId: true,
            verificationRequest: {
              select: { id: true, companyId: true, status: true },
            },
          },
        });
        if (replay !== null) {
          if (replay.approvedByUserId !== dependencies.actor.userId) {
            return adminFailure("CONFLICT");
          }
          return adminSuccess(
            {
              requestId: replay.verificationRequest.id,
              companyId: replay.verificationRequest.companyId,
              status: replay.verificationRequest.status,
              trustLevel:
                replay.kind === "APPROVED" ? "STRONG" : "NONE",
            },
            true,
          );
        }
        await transaction.$queryRaw`
          SELECT "id"
          FROM "PrivilegedApproval"
          WHERE "id" = ${parsed.data.approvalId}::uuid
          FOR UPDATE
        `;
        const approval = await transaction.privilegedApproval.findFirst({
          where: {
            id: parsed.data.approvalId,
            kind: "COMPANY_VERIFICATION",
            status: "PENDING",
            requestedByUserId: { not: dependencies.actor.userId },
            expiresAt: { gt: now },
          },
          select: {
            id: true,
            requestedByUserId: true,
            evidenceDigest: true,
            requestPayload: true,
          },
        });
        if (approval === null) return adminFailure("CONFLICT");
        const payload = approvalPayloadSchema.safeParse(
          approval.requestPayload,
        );
        if (
          !payload.success ||
          payloadDigest(payload.data) !== approval.evidenceDigest ||
          payload.data.reviewerUserId !== approval.requestedByUserId
        ) {
          return adminFailure("CONFLICT");
        }
        await lockRequest(transaction, payload.data.verificationRequestId);
        const request = await loadAssignedRequest(
          transaction,
          payload.data.verificationRequestId,
          payload.data.reviewerUserId,
          payload.data.requestVersion,
        );
        if (
          request === null ||
          request.companyId !== payload.data.companyId ||
          request.riskLevel !== payload.data.riskLevel
        ) {
          return adminFailure("CONFLICT");
        }
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeAdminStepUp(
            transaction,
            dependencies,
            parsed.data,
            request.companyId,
            request.id,
            "COMPANY_VERIFICATION_DECIDE",
            now,
          ))
        ) {
          return adminFailure("FORBIDDEN");
        }
        const evidence = currentEvidenceWindow(request.evidence, now);
        if (
          request.riskLevel === "HIGH" &&
          (evidence === null ||
            evidence.digest !== payload.data.evidenceDigest)
        ) {
          return adminFailure("CONFLICT");
        }
        const consumed = await transaction.privilegedApproval.updateMany({
          where: {
            id: approval.id,
            status: "PENDING",
            requestedByUserId: { not: dependencies.actor.userId },
            expiresAt: { gt: now },
          },
          data: {
            status: "CONSUMED",
            approvedByUserId: dependencies.actor.userId,
            decidedAt: now,
            consumedAt: now,
          },
        });
        if (consumed.count !== 1) return adminFailure("CONFLICT");
        return persistDecision(transaction, dependencies, now, request, {
          decision: "APPROVE",
          reasonCode: parsed.data.reasonCode,
          idempotencyKey: decisionKey,
          approvedByUserId: dependencies.actor.userId,
          decidedByUserId: payload.data.reviewerUserId,
          auditCapability: "COMPANY_VERIFICATION_APPROVE",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function decideCompanyVerificationAppeal(
  raw: unknown,
  dependencies: CompanyVerificationAdminDependencies,
): Promise<AdminCommandResult<{ appealId: string; status: string }>> {
  const parsed = decideCompanyVerificationAppealSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (
    !(await requireCapability(dependencies, "COMPANY_VERIFICATION_APPROVE"))
  ) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "CompanyVerificationAppeal"
          WHERE "id" = ${parsed.data.appealId}::uuid
          FOR UPDATE
        `;
        const appeal = await transaction.companyVerificationAppeal.findFirst({
          where: {
            id: parsed.data.appealId,
            status: "OPEN",
            appellantUserId: { not: dependencies.actor.userId },
          },
          select: {
            id: true,
            companyId: true,
            verificationRequestId: true,
          },
        });
        if (appeal === null) return adminFailure("CONFLICT");
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeAdminStepUp(
            transaction,
            dependencies,
            parsed.data,
            appeal.companyId,
            appeal.verificationRequestId,
            "COMPANY_VERIFICATION_APPEAL_DECIDE",
            now,
          ))
        ) {
          return adminFailure("FORBIDDEN");
        }
        const status =
          parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
        const changed =
          await transaction.companyVerificationAppeal.updateMany({
            where: { id: appeal.id, status: "OPEN" },
            data: {
              status,
              decidedByUserId: dependencies.actor.userId,
              decisionReasonCode: parsed.data.reasonCode,
              decidedAt: now,
              updatedAt: now,
            },
          });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        await writeAdminAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_APPEALED_V2",
          capability: "COMPANY_VERIFICATION_APPROVE",
          targetType: "COMPANY_VERIFICATION_APPEAL",
          targetId: appeal.id,
          companyId: appeal.companyId,
          reasonCode: parsed.data.reasonCode,
        });
        await notifyManagers(
          transaction,
          appeal.companyId,
          appeal.verificationRequestId,
          status === "APPROVED" ? "CHANGES_REQUESTED" : "REJECTED",
          status === "APPROVED" ? "EVIDENCE_REQUESTED" : "REJECTED",
          `phase26:appeal:${appeal.id}:${status}`,
        );
        return adminSuccess({ appealId: appeal.id, status });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

type AssignedRequest = NonNullable<
  Awaited<ReturnType<typeof loadAssignedRequest>>
>;

async function persistDecision(
  transaction: Prisma.TransactionClient,
  dependencies: CompanyVerificationAdminDependencies,
  now: Date,
  request: AssignedRequest,
  input: Readonly<{
    decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "REVOKE";
    reasonCode: string;
    idempotencyKey: string;
    decidedByUserId: string;
    approvedByUserId: string | null;
    auditCapability:
      | "COMPANY_VERIFICATION_REVIEW"
      | "COMPANY_VERIFICATION_APPROVE";
  }>,
): Promise<
  AdminCommandResult<{
    requestId: string;
    companyId: string;
    status: string;
    trustLevel: "STRONG" | "NONE";
  }>
> {
  const duplicate = await transaction.companyVerificationDecision.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { kind: true },
  });
  if (duplicate !== null) {
    return adminSuccess(
      {
        requestId: request.id,
        companyId: request.companyId,
        status: request.status,
        trustLevel: duplicate.kind === "APPROVED" ? "STRONG" : "NONE",
      },
      true,
    );
  }

  const kind =
    input.decision === "APPROVE"
      ? "APPROVED"
      : input.decision === "REQUEST_CHANGES"
        ? "CHANGES_REQUESTED"
        : input.decision === "REJECT"
          ? "REJECTED"
          : "REVOKED";
  const status =
    input.decision === "APPROVE"
      ? "VERIFIED"
      : input.decision === "REQUEST_CHANGES"
        ? "CHANGES_REQUESTED"
        : input.decision === "REJECT"
          ? "REJECTED"
          : "REVOKED";
  const eventKind =
    input.decision === "APPROVE"
      ? "VERIFIED"
      : input.decision === "REQUEST_CHANGES"
        ? "EVIDENCE_REQUESTED"
        : input.decision === "REJECT"
          ? "REJECTED"
          : "REVOKED";

  const currentEvidence = currentEvidenceWindow(request.evidence, now);
  if (
    input.decision === "APPROVE" &&
    request.riskLevel !== "MANUAL_EXCEPTION" &&
    currentEvidence === null
  ) {
    return adminFailure("INCOMPLETE");
  }
  const evidenceDigest =
    currentEvidence?.digest ??
    companyTrustEvidenceDigest(
      request.evidence.map((item) => ({
        type: item.type,
        responseDigest: item.responseDigest,
        validTo: item.validTo,
      })),
    );
  const validFrom = input.decision === "APPROVE" ? now : null;
  const validTo =
    input.decision === "APPROVE"
      ? currentEvidence?.validTo ??
        new Date(now.getTime() + 30 * DAY)
      : null;
  const decisionId = randomUUID();
  await transaction.companyVerificationDecision.create({
    data: {
      id: decisionId,
      verificationRequestId: request.id,
      companyId: request.companyId,
      decidedByUserId: input.decidedByUserId,
      approvedByUserId: input.approvedByUserId,
      kind,
      scope:
        request.riskLevel === "MANUAL_EXCEPTION"
          ? "REPRESENTATION"
          : "COMPANY_IDENTITY",
      riskLevel: request.riskLevel,
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      reasonCode: input.reasonCode,
      evidenceDigest,
      idempotencyKey: input.idempotencyKey,
      validFrom,
      validTo,
      decidedAt: now,
      createdAt: now,
    },
  });
  const nextVersion = request.version + 1;
  const changed = await transaction.companyVerificationRequest.updateMany({
    where: {
      id: request.id,
      companyId: request.companyId,
      version: request.version,
      assignedReviewerUserId: request.assignedReviewerUserId,
      status: request.status,
    },
    data: {
      status,
      version: nextVersion,
      decidedAt:
        input.decision === "REQUEST_CHANGES" ? null : now,
      updatedAt: now,
    },
  });
  if (changed.count !== 1) return adminFailure("CONFLICT");
  await transaction.companyVerificationEvent.create({
    data: {
      id: randomUUID(),
      verificationRequestId: request.id,
      kind: eventKind,
      fromStatus: request.status,
      toStatus: status,
      actorUserId: dependencies.actor.userId,
      reasonCode: input.reasonCode,
      evidenceRef: null,
      idempotencyKey: `${input.idempotencyKey}:event`.slice(0, 128),
      correlationId: dependencies.correlationId,
      createdAt: now,
    },
  });

  let trustLevel: "STRONG" | "NONE" = "NONE";
  if (
    input.decision === "APPROVE" &&
    request.riskLevel !== "MANUAL_EXCEPTION" &&
    currentEvidence !== null
  ) {
    await transaction.companyTrustProjection.upsert({
      where: {
        companyId_scope: {
          companyId: request.companyId,
          scope: "COMPANY_IDENTITY",
        },
      },
      create: {
        id: randomUUID(),
        companyId: request.companyId,
        verificationRequestId: request.id,
        decisionId,
        scope: "COMPANY_IDENTITY",
        level: "STRONG",
        status: "ACTIVE",
        riskState: "CLEAR",
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        evidenceDigest,
        reasonCode: input.reasonCode,
        verifiedAt: now,
        expiresAt: currentEvidence.validTo,
        changedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        verificationRequestId: request.id,
        decisionId,
        level: "STRONG",
        status: "ACTIVE",
        riskState: "CLEAR",
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        evidenceDigest,
        reasonCode: input.reasonCode,
        verifiedAt: now,
        expiresAt: currentEvidence.validTo,
        changedAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    trustLevel = "STRONG";
  } else if (input.decision === "REVOKE") {
    await transaction.companyTrustProjection.updateMany({
      where: {
        companyId: request.companyId,
        scope: "COMPANY_IDENTITY",
        status: { in: ["ACTIVE", "EXPIRING", "ON_HOLD"] },
      },
      data: {
        status: "REVOKED",
        riskState: "REVOKED",
        reasonCode: input.reasonCode,
        changedAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    await transaction.companyVerificationEvidence.updateMany({
      where: {
        verificationRequestId: request.id,
        status: "VALID",
        revokedAt: null,
      },
      data: {
        status: "REVOKED",
        reasonCode: input.reasonCode,
        revokedAt: now,
      },
    });
    await applyCompanyRadarEligibilityLoss(transaction, {
      companyId: request.companyId,
      reason: "COMPANY_VERIFICATION_LOST",
      actor: { kind: "USER", userId: dependencies.actor.userId },
      correlationId: dependencies.correlationId,
      now,
    });
  }

  await Promise.all([
    writeAdminAudit(transaction, dependencies, now, {
      action:
        input.decision === "REVOKE"
          ? "COMPANY_TRUST_CHANGED_V2"
          : "COMPANY_VERIFICATION_DECIDED_V2",
      capability: input.auditCapability,
      targetType:
        input.decision === "REVOKE"
          ? "COMPANY_TRUST_PROJECTION"
          : "COMPANY_VERIFICATION_DECISION",
      targetId: decisionId,
      companyId: request.companyId,
      reasonCode: input.reasonCode,
    }),
    notifyManagers(
      transaction,
      request.companyId,
      request.id,
      status,
      input.decision === "APPROVE"
        ? "VERIFIED"
        : input.decision === "REQUEST_CHANGES"
          ? "EVIDENCE_REQUESTED"
          : input.decision === "REJECT"
            ? "REJECTED"
            : "REVOKED",
      input.idempotencyKey,
    ),
  ]);
  return adminSuccess({
    requestId: request.id,
    companyId: request.companyId,
    status,
    trustLevel,
  });
}

async function loadAssignedRequest(
  transaction: Prisma.TransactionClient,
  requestId: string,
  reviewerUserId: string,
  expectedVersion: number,
) {
  return transaction.companyVerificationRequest.findFirst({
    where: {
      id: requestId,
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      status: { in: ["PENDING", "CHANGES_REQUESTED", "VERIFIED"] },
      version: expectedVersion,
      assignedReviewerUserId: reviewerUserId,
      requestedByUserId: { not: reviewerUserId },
      supersededBy: null,
    },
    select: {
      id: true,
      companyId: true,
      requestedByUserId: true,
      assignedReviewerUserId: true,
      status: true,
      riskLevel: true,
      version: true,
      evidence: {
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          type: true,
          scope: true,
          status: true,
          responseDigest: true,
          checkedAt: true,
          validFrom: true,
          validTo: true,
          revokedAt: true,
          domainChallenge: {
            select: { status: true, verifiedAt: true },
          },
          documentVersion: {
            select: { status: true, replacedAt: true },
          },
        },
      },
    },
  });
}

function currentEvidenceWindow(
  evidence: AssignedRequest["evidence"],
  now: Date,
): Readonly<{ digest: string; validTo: Date }> | null {
  const register = evidence.find(
    (item) =>
      item.type === "UID_REGISTER" &&
      item.scope === "COMPANY_IDENTITY" &&
      item.status === "VALID",
  );
  const domain = evidence.find(
    (item) =>
      item.type === "DOMAIN_CHALLENGE" &&
      item.scope === "COMPANY_IDENTITY" &&
      item.status === "VALID" &&
      item.domainChallenge?.status === "VERIFIED",
  );
  if (
    register === undefined ||
    domain === undefined ||
    !isCurrentEvidence(register, now) ||
    !isCurrentEvidence(domain, now)
  ) {
    return null;
  }
  const validTo = new Date(
    Math.min(
      register.validTo!.getTime(),
      domain.validTo!.getTime(),
      now.getTime() + DEFAULT_TRUST_VALIDITY,
    ),
  );
  return Object.freeze({
    digest: companyTrustEvidenceDigest([register, domain]),
    validTo,
  });
}

function isCurrentEvidence(
  evidence: Readonly<{
    checkedAt: Date | null;
    validFrom: Date | null;
    validTo: Date | null;
    revokedAt: Date | null;
    responseDigest: string;
  }>,
  now: Date,
) {
  return (
    evidence.checkedAt !== null &&
    evidence.validFrom !== null &&
    evidence.validTo !== null &&
    evidence.revokedAt === null &&
    evidence.validFrom.getTime() <= now.getTime() &&
    now.getTime() < evidence.validTo.getTime() &&
    /^[a-f0-9]{64}$/u.test(evidence.responseDigest)
  );
}

async function lockRequest(
  transaction: Prisma.TransactionClient,
  requestId: string,
) {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "CompanyVerificationRequest"
    WHERE "id" = ${requestId}::uuid
    FOR UPDATE
  `;
}

async function consumeAdminStepUp(
  transaction: Prisma.TransactionClient,
  dependencies: CompanyVerificationAdminDependencies,
  input: Readonly<{
    stepUpEvidenceId?: string;
    stepUpGrantToken?: string;
  }>,
  companyId: string,
  resourceId: string,
  action:
    | "COMPANY_VERIFICATION_ASSIGN"
    | "COMPANY_VERIFICATION_DECIDE"
    | "COMPANY_VERIFICATION_REVOKE"
    | "COMPANY_VERIFICATION_APPEAL_DECIDE",
  now: Date,
) {
  return (
    input.stepUpEvidenceId !== undefined &&
    input.stepUpGrantToken !== undefined &&
    (await consumeStepUpGrant(transaction, {
      evidenceId: input.stepUpEvidenceId,
      grantToken: input.stepUpGrantToken,
      actor: {
        userId: dependencies.actor.userId,
        sessionId: dependencies.actor.sessionId,
        role: "ADMIN",
        status: dependencies.actor.status,
      },
      purpose: "COMPANY_VERIFICATION",
      action,
      tenantId: companyId,
      resourceId,
      correlationId: dependencies.correlationId,
      now,
    }))
  );
}

async function notifyManagers(
  transaction: Prisma.TransactionClient,
  companyId: string,
  verificationRequestId: string,
  status:
    | "PENDING"
    | "CHANGES_REQUESTED"
    | "VERIFIED"
    | "REJECTED"
    | "REVOKED",
  reason:
    | "EVIDENCE_REQUESTED"
    | "VERIFIED"
    | "REJECTED"
    | "REVOKED",
  dedupeKey: string,
) {
  const managers = await transaction.companyMembership.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      removedAt: null,
      role: { in: ["OWNER", "ADMIN"] },
      user: { status: "ACTIVE" },
    },
    select: { userId: true },
  });
  for (const manager of managers) {
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      {
        recipientUserId: manager.userId,
        kind: "COMPANY_VERIFICATION_CHANGED",
        dedupeKey,
        payload: { verificationRequestId, status, reasonCode: reason },
      },
    );
  }
}

function payloadDigest(value: unknown) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function sanitizeCompanyVerificationReviewerNote(value: string) {
  return boundedPlainText(value, 2, 1_000);
}
