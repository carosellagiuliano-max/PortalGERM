import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getEffectiveEntitlements } from "@/lib/billing/entitlements";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { decideCompanyTransition } from "@/lib/policies/status/company";
import { decideVerificationTransition, type VerificationStatus } from "@/lib/policies/status/verification";
import {
  adminErrorResult,
  AdminDomainError,
  adminFailure,
  adminNow,
  adminSuccess,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";

const reasonSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
const idempotencySchema = z.uuid();

export async function listAdminCompanies(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_COMPANY_REVIEW")) return null;
  const now = adminNow(dependencies.now);
  return dependencies.database.company.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      slug: true,
      industry: true,
      status: true,
      updatedAt: true,
      registrationCanton: { select: { code: true, name: true } },
      verificationRequests: {
        where: { supersededBy: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, status: true, createdAt: true },
      },
      subscriptions: {
        where: { status: { in: ["ACTIVE", "CANCELLING"] }, currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now } },
        take: 1,
        select: { planVersion: { select: { plan: { select: { name: true, code: true } } } } },
      },
      _count: { select: { jobs: true, memberships: true, claimRequests: true } },
    },
  });
}

export async function getAdminCompanyDetail(dependencies: AdminDependencies, companyId: string) {
  if (!requireCapability(dependencies, "ADMIN_COMPANY_REVIEW") || !z.uuid().safeParse(companyId).success) return null;
  const now = adminNow(dependencies.now);
  const [company, entitlements] = await Promise.all([
    dependencies.database.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, slug: true, uid: true, industry: true, size: true, website: true, about: true, status: true, createdAt: true, updatedAt: true,
        memberships: {
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
          select: { id: true, role: true, status: true, user: { select: { id: true, name: true, email: true, status: true } } },
        },
        verificationRequests: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true, evidenceMetadata: true, createdAt: true, updatedAt: true, supersedesRequestId: true, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, reasonCode: true, evidenceRef: true, createdAt: true } } },
        },
        claimRequests: {
          where: { status: { in: ["PENDING", "NEEDS_EVIDENCE"] } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, status: true, requestedRole: true, matchSignals: true, evidenceSummary: true, requester: { select: { id: true, name: true, email: true } }, createdAt: true },
        },
        subscriptions: {
          where: { status: { in: ["ACTIVE", "CANCELLING"] }, currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now } },
          select: { id: true, status: true, currentPeriodEnd: true, planVersion: { select: { plan: { select: { name: true, code: true } } } } },
        },
        jobs: { select: { id: true, status: true } },
        supportCases: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, select: { id: true, priority: true, status: true, dueAt: true } },
        auditLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, action: true, targetType: true, result: true, reasonCode: true, createdAt: true } },
      },
    }),
    getEffectiveEntitlements(companyId, now, createPrismaEntitlementRepository(dependencies.database)),
  ]);
  if (company === null) return null;
  return Object.freeze({ company, entitlements });
}

const verificationCommandSchema = z.strictObject({
  verificationRequestId: z.uuid(),
  expectedStatus: z.enum(["PENDING", "CHANGES_REQUESTED", "VERIFIED"]),
  reasonCode: reasonSchema.optional(),
  evidenceRef: z.string().trim().min(3).max(255).optional(),
  idempotencyKey: idempotencySchema,
});

type VerificationCommand = z.infer<typeof verificationCommandSchema>;

export async function requestCompanyVerificationEvidence(input: VerificationCommand, dependencies: AdminDependencies) {
  return transitionVerification(input, dependencies, "REQUEST_CHANGES");
}

export async function verifyCompany(input: VerificationCommand, dependencies: AdminDependencies) {
  return transitionVerification(input, dependencies, "VERIFY");
}

export async function rejectCompanyVerification(input: VerificationCommand, dependencies: AdminDependencies) {
  return transitionVerification(input, dependencies, "REJECT");
}

export async function revokeCompanyVerification(input: VerificationCommand, dependencies: AdminDependencies) {
  return transitionVerification(input, dependencies, "REVOKE");
}

async function transitionVerification(
  input: VerificationCommand,
  dependencies: AdminDependencies,
  action: "REQUEST_CHANGES" | "VERIFY" | "REJECT" | "REVOKE",
) {
  const parsed = verificationCommandSchema.safeParse(input);
  const reasonRequired = action !== "VERIFY";
  if (!parsed.success || (reasonRequired && parsed.data.reasonCode === undefined)) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_COMPANY_REVIEW")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const operation = `admin-verification-${action.toLowerCase()}`;
  const eventKey = operationKey(operation, parsed.data.idempotencyKey);
  const target = action === "REQUEST_CHANGES" ? { status: "CHANGES_REQUESTED" as const, kind: "EVIDENCE_REQUESTED" as const, audit: "COMPANY_VERIFICATION_CHANGES_REQUESTED" as const, reason: "EVIDENCE_REQUESTED" as const }
    : action === "VERIFY" ? { status: "VERIFIED" as const, kind: "VERIFIED" as const, audit: "COMPANY_VERIFIED" as const, reason: "VERIFIED" as const }
      : action === "REJECT" ? { status: "REJECTED" as const, kind: "REJECTED" as const, audit: "COMPANY_VERIFICATION_REJECTED" as const, reason: "REJECTED" as const }
        : { status: "REVOKED" as const, kind: "REVOKED" as const, audit: "COMPANY_VERIFICATION_REVOKED" as const, reason: "REVOKED" as const };
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "CompanyVerificationRequest" WHERE "id" = ${parsed.data.verificationRequestId}::uuid FOR UPDATE`;
      const request = await transaction.companyVerificationRequest.findUnique({
        where: { id: parsed.data.verificationRequestId },
        select: {
          id: true, companyId: true, status: true, supersededBy: { select: { id: true } },
          events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
        },
      });
      if (request === null) return adminFailure("NOT_FOUND");
      if (request.events.length > 0 && request.status === target.status) return adminSuccess({ requestId: request.id, companyId: request.companyId, status: target.status }, true);
      if (request.supersededBy !== null || request.status !== parsed.data.expectedStatus) return adminFailure("CONFLICT");
      const decision = decideVerificationTransition({ action, actor: "PLATFORM_VERIFICATION_REVIEWER", currentStatus: request.status as VerificationStatus, reasonCode: parsed.data.reasonCode });
      if (decision.type !== "OK") return adminFailure("CONFLICT");
      const changed = await transaction.companyVerificationRequest.updateMany({
        where: { id: request.id, companyId: request.companyId, status: request.status, supersededBy: null },
        data: { status: target.status, updatedAt: now },
      });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      await transaction.companyVerificationEvent.create({ data: {
        id: randomUUID(),
        verificationRequestId: request.id,
        kind: target.kind,
        fromStatus: request.status,
        toStatus: target.status,
        actorUserId: dependencies.actor.userId,
        reasonCode: parsed.data.reasonCode ?? target.reason,
        evidenceRef: parsed.data.evidenceRef ?? null,
        idempotencyKey: eventKey,
        correlationId: dependencies.correlationId,
        createdAt: now,
      } });
      await notifyCompanyManagers(transaction, request.companyId, request.id, target.status, target.reason, eventKey);
      await writeAdminAudit(transaction, dependencies, now, { action: target.audit, capability: "ADMIN_COMPANY_REVIEW", targetType: "VERIFICATION_REQUEST", targetId: request.id, companyId: request.companyId, reasonCode: parsed.data.reasonCode ?? target.reason });
      return adminSuccess({ requestId: request.id, companyId: request.companyId, status: target.status });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const companyLifecycleSchema = z.strictObject({
  companyId: z.uuid(),
  expectedStatus: z.enum(["ACTIVE", "SUSPENDED"]),
  reasonCode: reasonSchema,
  idempotencyKey: idempotencySchema,
});

export async function suspendCompany(raw: unknown, dependencies: AdminDependencies) {
  return transitionCompanyLifecycle(raw, dependencies, "SUSPEND");
}

export async function reactivateCompany(raw: unknown, dependencies: AdminDependencies) {
  return transitionCompanyLifecycle(raw, dependencies, "REACTIVATE");
}

async function transitionCompanyLifecycle(raw: unknown, dependencies: AdminDependencies, action: "SUSPEND" | "REACTIVATE") {
  const parsed = companyLifecycleSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_COMPANY_MODERATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const toStatus = action === "SUSPEND" ? "SUSPENDED" as const : "ACTIVE" as const;
  const eventKey = operationKey(`admin-company-${action.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${parsed.data.companyId}::uuid FOR UPDATE`;
      const company = await transaction.company.findUnique({
        where: { id: parsed.data.companyId },
        select: { id: true, status: true, statusEvents: { where: { correlationId: eventKey }, take: 1, select: { id: true } } },
      });
      if (company === null) return adminFailure("NOT_FOUND");
      if (company.statusEvents.length > 0 && company.status === toStatus) return adminSuccess({ companyId: company.id, status: toStatus, pausedJobs: 0 }, true);
      if (company.status !== parsed.data.expectedStatus) return adminFailure("CONFLICT");
      const decision = decideCompanyTransition({ action, actor: "PLATFORM_COMPANY_MODERATOR", currentStatus: company.status, reasonCode: parsed.data.reasonCode });
      if (decision.type !== "OK") return adminFailure("CONFLICT");
      const changed = await transaction.company.updateMany({ where: { id: company.id, status: company.status }, data: { status: toStatus, updatedAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      let pausedJobs = 0;
      if (action === "SUSPEND") {
        const jobs = await transaction.job.findMany({ where: { companyId: company.id, status: "PUBLISHED" }, select: { id: true, version: true, currentRevisionId: true } });
        for (const job of jobs) {
          const changedJob = await transaction.job.updateMany({ where: { id: job.id, companyId: company.id, status: "PUBLISHED", version: job.version }, data: { status: "PAUSED", version: { increment: 1 } } });
          if (changedJob.count !== 1) throw new AdminDomainError("CONFLICT");
          await transaction.jobStatusEvent.create({ data: { id: randomUUID(), jobId: job.id, jobRevisionId: job.currentRevisionId, kind: "PAUSED", fromStatus: "PUBLISHED", toStatus: "PAUSED", actorUserId: dependencies.actor.userId, reasonCode: "COMPANY_SUSPENDED", idempotencyKey: `${eventKey}:job:${job.id}`, correlationId: dependencies.correlationId, createdAt: now } });
          pausedJobs += 1;
        }
      }
      await transaction.companyStatusEvent.create({ data: { id: randomUUID(), companyId: company.id, kind: action === "SUSPEND" ? "SUSPENDED" : "REACTIVATED", fromStatus: company.status, toStatus, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: action === "SUSPEND" ? "COMPANY_SUSPENDED" : "COMPANY_REACTIVATED", capability: "ADMIN_COMPANY_MODERATE", targetType: "COMPANY", targetId: company.id, companyId: company.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ companyId: company.id, status: toStatus, pausedJobs });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const claimCommandSchema = z.strictObject({
  claimId: z.uuid(),
  expectedStatus: z.enum(["PENDING", "NEEDS_EVIDENCE"]),
  approvedRole: z.enum(["OWNER", "ADMIN"]).optional(),
  reasonCode: reasonSchema,
  evidenceRef: z.string().trim().min(3).max(255).optional(),
  idempotencyKey: idempotencySchema,
});

export async function requestCompanyClaimEvidence(raw: unknown, dependencies: AdminDependencies) {
  return reviewClaim(raw, dependencies, "EVIDENCE");
}

export async function rejectCompanyClaim(raw: unknown, dependencies: AdminDependencies) {
  return reviewClaim(raw, dependencies, "REJECT");
}

export async function approveCompanyClaim(raw: unknown, dependencies: AdminDependencies) {
  return reviewClaim(raw, dependencies, "APPROVE");
}

async function reviewClaim(raw: unknown, dependencies: AdminDependencies, action: "EVIDENCE" | "REJECT" | "APPROVE") {
  const parsed = claimCommandSchema.safeParse(raw);
  if (!parsed.success || (action === "APPROVE" && parsed.data.approvedRole === undefined)) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CLAIM_REVIEW")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-claim-${action.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "CompanyClaimRequest" WHERE "id" = ${parsed.data.claimId}::uuid FOR UPDATE`;
      const claim = await transaction.companyClaimRequest.findUnique({
        where: { id: parsed.data.claimId },
        select: { id: true, candidateCompanyId: true, requesterEmployerUserId: true, status: true, events: { where: { correlationId: eventKey }, take: 1, select: { id: true } } },
      });
      if (claim === null) return adminFailure("NOT_FOUND");
      const targetStatus = action === "EVIDENCE" ? "NEEDS_EVIDENCE" as const : action === "REJECT" ? "REJECTED" as const : "APPROVED" as const;
      if (claim.events.length > 0 && claim.status === targetStatus) return adminSuccess({ claimId: claim.id, status: targetStatus }, true);
      if (claim.status !== parsed.data.expectedStatus) return adminFailure("CONFLICT");
      await transaction.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${claim.candidateCompanyId}::uuid FOR UPDATE`;
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${claim.requesterEmployerUserId}::uuid FOR UPDATE`;
      if (action === "APPROVE") {
        const user = await transaction.user.findUnique({ where: { id: claim.requesterEmployerUserId }, select: { status: true, role: true } });
        if (user === null || user.status !== "ACTIVE" || user.role !== "EMPLOYER") return adminFailure("CONFLICT");
        const existing = await transaction.companyMembership.findUnique({ where: { companyId_userId: { companyId: claim.candidateCompanyId, userId: claim.requesterEmployerUserId } }, select: { id: true } });
        if (existing !== null) return adminFailure("CONFLICT");
        const rights = await getEffectiveEntitlements(claim.candidateCompanyId, now, createPrismaEntitlementRepository(transaction));
        if (!rights.ok) return adminFailure("CONFLICT");
        const activeSeats = await transaction.companyMembership.count({ where: { companyId: claim.candidateCompanyId, status: "ACTIVE", removedAt: null } });
        if (activeSeats >= rights.value.rights.SEAT_LIMIT) return adminFailure("QUOTA_EXCEEDED");
        const membership = await transaction.companyMembership.create({ data: { id: randomUUID(), companyId: claim.candidateCompanyId, userId: claim.requesterEmployerUserId, role: parsed.data.approvedRole!, status: "ACTIVE", joinedAt: now, createdAt: now, updatedAt: now } });
        await transaction.companyMembershipEvent.create({ data: { id: randomUUID(), membershipId: membership.id, kind: "CREATED", fromRole: null, toRole: parsed.data.approvedRole!, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: dependencies.correlationId, createdAt: now } });
      }
      const changed = await transaction.companyClaimRequest.updateMany({ where: { id: claim.id, status: claim.status }, data: { status: targetStatus, approvedRole: action === "APPROVE" ? parsed.data.approvedRole : null, reviewedAt: action === "EVIDENCE" ? null : now, updatedAt: now } });
      if (changed.count !== 1) throw new AdminDomainError("CONFLICT");
      await transaction.companyClaimEvent.create({ data: { id: randomUUID(), claimRequestId: claim.id, kind: action === "EVIDENCE" ? "EVIDENCE_REQUESTED" : action === "REJECT" ? "REJECTED" : "APPROVED", actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, evidenceRef: parsed.data.evidenceRef ?? null, correlationId: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: action === "EVIDENCE" ? "COMPANY_CLAIM_EVIDENCE_REQUESTED" : action === "REJECT" ? "COMPANY_CLAIM_REJECTED" : "COMPANY_CLAIM_APPROVED", capability: "ADMIN_CLAIM_REVIEW", targetType: "CLAIM_REQUEST", targetId: claim.id, companyId: claim.candidateCompanyId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ claimId: claim.id, status: targetStatus });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

async function notifyCompanyManagers(
  transaction: Prisma.TransactionClient,
  companyId: string,
  verificationRequestId: string,
  status: "CHANGES_REQUESTED" | "VERIFIED" | "REJECTED" | "REVOKED",
  reasonCode: "EVIDENCE_REQUESTED" | "VERIFIED" | "REJECTED" | "REVOKED",
  dedupeKey: string,
) {
  const managers = await transaction.companyMembership.findMany({
    where: { companyId, status: "ACTIVE", removedAt: null, role: { in: ["OWNER", "ADMIN"] }, user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  for (const manager of managers) {
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: manager.userId,
      kind: "COMPANY_VERIFICATION_CHANGED",
      dedupeKey,
      payload: { verificationRequestId, status, reasonCode },
    });
  }
}
