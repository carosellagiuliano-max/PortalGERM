import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { tightenSlaDueAt, type OpsCaseSlaKey } from "@/lib/admin/sla";
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

const restrictionTypes = ["HIDE_JOB", "PAUSE_COMPANY", "SUSPEND_USER", "BLOCK_MESSAGE_THREAD"] as const;
const reasonSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u);

export async function listAdminReports(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_REPORT_REVIEW")) return null;
  const now = adminNow(dependencies.now);
  return dependencies.database.abuseReport.findMany({
    orderBy: [{ dueAt: "asc" }, { severity: "desc" }, { id: "asc" }],
    take: 250,
    select: {
      id: true, targetType: true, targetId: true, reasonCode: true, severity: true, status: true, dueAt: true, slaPolicyVersion: true, createdAt: true, updatedAt: true,
      assignee: { select: { id: true, name: true, email: true } },
      _count: { select: { restrictions: true } },
    },
  }).then((rows) => rows.sort((a, b) => Number(a.dueAt > now) - Number(b.dueAt > now) || a.dueAt.getTime() - b.dueAt.getTime() || severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id)));
}

export async function getAdminReportDetail(dependencies: AdminDependencies, reportId: string) {
  if (!requireCapability(dependencies, "ADMIN_REPORT_REVIEW") || !z.uuid().safeParse(reportId).success) return null;
  const [report, assignableAdmins] = await Promise.all([dependencies.database.abuseReport.findUnique({
    where: { id: reportId },
    select: {
      id: true, targetType: true, targetId: true, reasonCode: true, description: true, severity: true, status: true, dueAt: true, slaPolicyVersion: true, resolutionCode: true, resolvedAt: true, createdAt: true, version: true,
      reporter: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, reasonCode: true, safeNote: true, createdAt: true } },
      restrictions: { orderBy: [{ startsAt: "desc" }, { id: "desc" }], select: { id: true, targetType: true, targetId: true, status: true, reason: true, startsAt: true, endsAt: true, liftedAt: true, liftReason: true, expiredAt: true } },
    },
  }), dependencies.database.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }], select: { id: true, name: true, email: true } })]);
  if (report === null) return null;
  const preview = await getLeastPrivilegeTargetPreview(dependencies.database, report.targetType, report.targetId);
  return Object.freeze({ report, preview, assignableAdmins });
}

const triageSchema = z.strictObject({
  reportId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  assigneeUserId: z.uuid().nullable().optional(),
  reasonCode: reasonSchema,
  safeNote: z.string().trim().max(500).optional(),
  idempotencyKey: z.uuid(),
});

export async function triageAbuseReport(raw: unknown, dependencies: AdminDependencies) {
  const parsed = triageSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_REPORT_REVIEW")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey("admin-report-triage", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await lockReport(transaction, parsed.data.reportId);
      const report = await transaction.abuseReport.findUnique({ where: { id: parsed.data.reportId }, select: { id: true, status: true, severity: true, version: true, createdAt: true, dueAt: true, events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } } } });
      if (report === null) return adminFailure("NOT_FOUND");
      if (report.events.length > 0) return adminSuccess({ reportId: report.id, status: report.status, severity: report.severity, dueAt: report.dueAt }, true);
      if (report.version !== parsed.data.expectedVersion || ["RESOLVED", "DISMISSED"].includes(report.status)) return adminFailure("CONFLICT");
      if (parsed.data.assigneeUserId !== undefined && parsed.data.assigneeUserId !== null) {
        const assignee = await transaction.user.findFirst({ where: { id: parsed.data.assigneeUserId, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
        if (assignee === null) return adminFailure("INVALID_INPUT");
      }
      const dueAt = tightenSlaDueAt(report.dueAt, report.createdAt, abuseSlaKey(parsed.data.severity));
      const changed = await transaction.abuseReport.updateMany({ where: { id: report.id, version: report.version, status: report.status }, data: { status: "IN_REVIEW", severity: parsed.data.severity, dueAt, ...(parsed.data.assigneeUserId === undefined ? {} : { assigneeUserId: parsed.data.assigneeUserId }), version: { increment: 1 }, updatedAt: now } });
      if (changed.count !== 1) throw new AdminDomainError("CONFLICT");
      await transaction.abuseReportEvent.create({ data: { id: randomUUID(), abuseReportId: report.id, kind: parsed.data.assigneeUserId === undefined ? "TRIAGED" : "ASSIGNED", actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, safeNote: parsed.data.safeNote ?? null, correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: "ABUSE_REPORT_TRIAGED", capability: "ADMIN_REPORT_REVIEW", targetType: "ABUSE_REPORT", targetId: report.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ reportId: report.id, status: "IN_REVIEW" as const, severity: parsed.data.severity, dueAt });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const applyRestrictionSchema = z.strictObject({
  reportId: z.uuid(),
  expectedReportVersion: z.coerce.number().int().positive(),
  restrictionType: z.enum(restrictionTypes),
  affectedResourceId: z.uuid(),
  impactConfirmed: z.literal(true),
  reason: z.string().trim().min(3).max(1000),
  endsAt: z.coerce.date().nullable().optional(),
  idempotencyKey: z.uuid(),
});

export async function applyModerationRestriction(raw: unknown, dependencies: AdminDependencies) {
  const parsed = applyRestrictionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_RESTRICTION_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  if (parsed.data.endsAt !== null && parsed.data.endsAt !== undefined && parsed.data.endsAt <= now) return adminFailure("INVALID_INPUT");
  const restrictionKey = operationKey("admin-restriction-apply", parsed.data.idempotencyKey);
  const eventKey = `${restrictionKey}:event`;
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await lockReport(transaction, parsed.data.reportId);
      const replay = await transaction.moderationRestriction.findUnique({ where: { idempotencyKey: restrictionKey }, select: { id: true, targetType: true, targetId: true, status: true } });
      if (replay !== null) return replay.status === "ACTIVE" ? adminSuccess({ restrictionId: replay.id, type: replay.targetType, affectedResourceId: replay.targetId }, true) : adminFailure("CONFLICT");
      const report = await transaction.abuseReport.findUnique({ where: { id: parsed.data.reportId }, select: { id: true, targetType: true, targetId: true, status: true, version: true, reporterUserId: true } });
      if (report === null) return adminFailure("NOT_FOUND");
      if (report.version !== parsed.data.expectedReportVersion || ["RESOLVED", "DISMISSED"].includes(report.status)) return adminFailure("CONFLICT");
      const mapped = await resolveRestrictionTarget(transaction, report, parsed.data.restrictionType, parsed.data.affectedResourceId);
      if (mapped === null) return adminFailure("CONFLICT");
      const active = await transaction.moderationRestriction.findFirst({ where: { targetType: parsed.data.restrictionType, targetId: mapped.affectedResourceId, status: "ACTIVE" }, select: { id: true } });
      if (active !== null) return adminFailure("CONFLICT");
      const restriction = await transaction.moderationRestriction.create({ data: { id: randomUUID(), abuseReportId: report.id, targetType: parsed.data.restrictionType, targetId: mapped.affectedResourceId, status: "ACTIVE", reason: parsed.data.reason, appliedByUserId: dependencies.actor.userId, startsAt: now, endsAt: parsed.data.endsAt ?? null, idempotencyKey: restrictionKey, correlationId: dependencies.correlationId } });
      await applyRestrictionEffect(transaction, parsed.data.restrictionType, mapped, now, dependencies);
      const changed = await transaction.abuseReport.updateMany({ where: { id: report.id, version: report.version }, data: { status: "IN_REVIEW", version: { increment: 1 }, updatedAt: now } });
      if (changed.count !== 1) throw new AdminDomainError("CONFLICT");
      await transaction.abuseReportEvent.create({ data: { id: randomUUID(), abuseReportId: report.id, kind: "RESTRICTION_APPLIED", actorUserId: dependencies.actor.userId, reasonCode: parsed.data.restrictionType, safeNote: null, correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await notifyModerationChange(transaction, report, restriction.id, "APPLIED", mapped);
      await writeAdminAudit(transaction, dependencies, now, { action: "MODERATION_RESTRICTION_APPLIED", capability: "ADMIN_RESTRICTION_MANAGE", targetType: "MODERATION_RESTRICTION", targetId: restriction.id, companyId: mapped.companyId, reasonCode: parsed.data.restrictionType });
      if (parsed.data.restrictionType === "HIDE_JOB") {
        await writeAdminAudit(transaction, dependencies, now, { action: "JOB_FLAGGED", capability: "ADMIN_RESTRICTION_MANAGE", targetType: "JOB", targetId: mapped.affectedResourceId, companyId: mapped.companyId, reasonCode: "HIDE_JOB" });
      }
      return adminSuccess({ restrictionId: restriction.id, type: parsed.data.restrictionType, affectedResourceId: mapped.affectedResourceId });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const endRestrictionSchema = z.strictObject({
  restrictionId: z.uuid(),
  reasonCode: reasonSchema,
  idempotencyKey: z.uuid(),
});

export async function liftModerationRestriction(raw: unknown, dependencies: AdminDependencies) {
  return endRestriction(raw, dependencies, "LIFTED");
}

export async function expireModerationRestriction(raw: unknown, dependencies: AdminDependencies) {
  return endRestriction(raw, dependencies, "EXPIRED");
}

async function endRestriction(raw: unknown, dependencies: AdminDependencies, toStatus: "LIFTED" | "EXPIRED") {
  const parsed = endRestrictionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_RESTRICTION_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-restriction-${toStatus.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ModerationRestriction" WHERE "id" = ${parsed.data.restrictionId}::uuid FOR UPDATE`;
      const restriction = await transaction.moderationRestriction.findUnique({ where: { id: parsed.data.restrictionId }, select: { id: true, abuseReportId: true, targetType: true, targetId: true, status: true, endsAt: true, abuseReport: { select: { targetType: true, targetId: true, reporterUserId: true } } } });
      if (restriction === null) return adminFailure("NOT_FOUND");
      const replay = await transaction.abuseReportEvent.findUnique({ where: { idempotencyKey: eventKey }, select: { id: true } });
      if (replay !== null && restriction.status === toStatus) return adminSuccess({ restrictionId: restriction.id, status: toStatus }, true);
      if (restriction.status !== "ACTIVE") return adminFailure("CONFLICT");
      if (toStatus === "EXPIRED" && (restriction.endsAt === null || restriction.endsAt > now)) return adminFailure("CONFLICT");
      const mapped = await resolveStoredRestrictionTarget(transaction, restriction.targetType, restriction.targetId);
      if (mapped === null) return adminFailure("CONFLICT");
      const changed = await transaction.moderationRestriction.updateMany({ where: { id: restriction.id, status: "ACTIVE" }, data: toStatus === "LIFTED" ? { status: "LIFTED", liftedAt: now, liftedByUserId: dependencies.actor.userId, liftReason: parsed.data.reasonCode } : { status: "EXPIRED", expiredAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      await transaction.abuseReportEvent.create({ data: { id: randomUUID(), abuseReportId: restriction.abuseReportId, kind: toStatus === "LIFTED" ? "RESTRICTION_LIFTED" : "RESTRICTION_EXPIRED", actorUserId: dependencies.actor.userId, reasonCode: parsed.data.reasonCode, correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await notifyModerationChange(transaction, { id: restriction.abuseReportId, reporterUserId: restriction.abuseReport.reporterUserId }, restriction.id, toStatus, mapped);
      await writeAdminAudit(transaction, dependencies, now, { action: toStatus === "LIFTED" ? "MODERATION_RESTRICTION_LIFTED" : "MODERATION_RESTRICTION_EXPIRED", capability: "ADMIN_RESTRICTION_MANAGE", targetType: "MODERATION_RESTRICTION", targetId: restriction.id, companyId: mapped.companyId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ restrictionId: restriction.id, status: toStatus });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

const closeReportSchema = z.strictObject({
  reportId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  resolutionCode: reasonSchema,
  idempotencyKey: z.uuid(),
});

export async function resolveAbuseReport(raw: unknown, dependencies: AdminDependencies) {
  return closeReport(raw, dependencies, "RESOLVED");
}

export async function dismissAbuseReport(raw: unknown, dependencies: AdminDependencies) {
  return closeReport(raw, dependencies, "DISMISSED");
}

async function closeReport(raw: unknown, dependencies: AdminDependencies, status: "RESOLVED" | "DISMISSED") {
  const parsed = closeReportSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_REPORT_REVIEW")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-report-${status.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await lockReport(transaction, parsed.data.reportId);
      const report = await transaction.abuseReport.findUnique({ where: { id: parsed.data.reportId }, select: { id: true, status: true, version: true, events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } } } });
      if (report === null) return adminFailure("NOT_FOUND");
      if (report.events.length > 0 && report.status === status) return adminSuccess({ reportId: report.id, status }, true);
      if (report.version !== parsed.data.expectedVersion || ["RESOLVED", "DISMISSED"].includes(report.status)) return adminFailure("CONFLICT");
      const changed = await transaction.abuseReport.updateMany({ where: { id: report.id, version: report.version }, data: { status, resolutionCode: parsed.data.resolutionCode, resolvedAt: now, version: { increment: 1 }, updatedAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      await transaction.abuseReportEvent.create({ data: { id: randomUUID(), abuseReportId: report.id, kind: status, actorUserId: dependencies.actor.userId, reasonCode: parsed.data.resolutionCode, correlationId: dependencies.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await writeAdminAudit(transaction, dependencies, now, { action: "ABUSE_REPORT_RESOLVED", capability: "ADMIN_REPORT_REVIEW", targetType: "ABUSE_REPORT", targetId: report.id, reasonCode: parsed.data.resolutionCode });
      return adminSuccess({ reportId: report.id, status });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

type ReportTarget = Readonly<{ targetType: string; targetId: string }>;
type ResolvedRestrictionTarget = Readonly<{ affectedResourceId: string; companyId: string | null; userId: string | null; conversationId: string | null }>;

async function resolveRestrictionTarget(transaction: Prisma.TransactionClient, report: ReportTarget, restrictionType: (typeof restrictionTypes)[number], affectedResourceId: string): Promise<ResolvedRestrictionTarget | null> {
  if (restrictionType === "HIDE_JOB") {
    if (report.targetType !== "JOB" || report.targetId !== affectedResourceId) return null;
    const job = await transaction.job.findUnique({ where: { id: affectedResourceId }, select: { companyId: true } });
    return job === null ? null : { affectedResourceId, companyId: job.companyId, userId: null, conversationId: null };
  }
  if (restrictionType === "PAUSE_COMPANY") {
    if (report.targetType === "COMPANY" && report.targetId === affectedResourceId) {
      const company = await transaction.company.findUnique({ where: { id: affectedResourceId }, select: { id: true } });
      return company === null ? null : { affectedResourceId, companyId: affectedResourceId, userId: null, conversationId: null };
    }
    if (report.targetType === "JOB") {
      const job = await transaction.job.findUnique({ where: { id: report.targetId }, select: { companyId: true } });
      return job?.companyId === affectedResourceId ? { affectedResourceId, companyId: affectedResourceId, userId: null, conversationId: null } : null;
    }
    return null;
  }
  if (restrictionType === "SUSPEND_USER") {
    if (report.targetType === "USER" && report.targetId === affectedResourceId) {
      const user = await transaction.user.findUnique({ where: { id: affectedResourceId }, select: { id: true } });
      return user === null ? null : { affectedResourceId, companyId: null, userId: affectedResourceId, conversationId: null };
    }
    if (report.targetType === "MESSAGE") {
      const message = await transaction.message.findUnique({ where: { id: report.targetId }, select: { senderUserId: true, conversation: { select: { companyId: true, id: true } } } });
      return message?.senderUserId === affectedResourceId ? { affectedResourceId, companyId: message.conversation.companyId, userId: affectedResourceId, conversationId: message.conversation.id } : null;
    }
    return null;
  }
  if (report.targetType !== "MESSAGE") return null;
  const message = await transaction.message.findUnique({ where: { id: report.targetId }, select: { conversationId: true, conversation: { select: { companyId: true } } } });
  return message?.conversationId === affectedResourceId ? { affectedResourceId, companyId: message.conversation.companyId, userId: null, conversationId: affectedResourceId } : null;
}

async function resolveStoredRestrictionTarget(transaction: Prisma.TransactionClient, type: (typeof restrictionTypes)[number], targetId: string): Promise<ResolvedRestrictionTarget | null> {
  if (type === "HIDE_JOB") {
    const job = await transaction.job.findUnique({ where: { id: targetId }, select: { companyId: true } });
    return job === null ? null : { affectedResourceId: targetId, companyId: job.companyId, userId: null, conversationId: null };
  }
  if (type === "PAUSE_COMPANY") return { affectedResourceId: targetId, companyId: targetId, userId: null, conversationId: null };
  if (type === "SUSPEND_USER") return { affectedResourceId: targetId, companyId: null, userId: targetId, conversationId: null };
  const conversation = await transaction.conversation.findUnique({ where: { id: targetId }, select: { companyId: true } });
  return conversation === null ? null : { affectedResourceId: targetId, companyId: conversation.companyId, userId: null, conversationId: targetId };
}

async function applyRestrictionEffect(transaction: Prisma.TransactionClient, type: (typeof restrictionTypes)[number], target: ResolvedRestrictionTarget, now: Date, dependencies: AdminDependencies) {
  if (type === "PAUSE_COMPANY" && target.companyId !== null) {
    await transaction.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${target.companyId}::uuid FOR UPDATE`;
    const company = await transaction.company.findUnique({ where: { id: target.companyId }, select: { status: true } });
    if (company?.status === "ACTIVE") {
      await transaction.company.update({ where: { id: target.companyId }, data: { status: "SUSPENDED", updatedAt: now } });
      await transaction.companyStatusEvent.create({ data: { id: randomUUID(), companyId: target.companyId, kind: "SUSPENDED", fromStatus: "ACTIVE", toStatus: "SUSPENDED", actorUserId: dependencies.actor.userId, reasonCode: "MODERATION_RESTRICTION", correlationId: dependencies.correlationId, createdAt: now } });
    }
    const jobs = await transaction.job.findMany({ where: { companyId: target.companyId, status: "PUBLISHED" }, select: { id: true, currentRevisionId: true, version: true } });
    for (const job of jobs) {
      const changed = await transaction.job.updateMany({ where: { id: job.id, status: "PUBLISHED", version: job.version }, data: { status: "PAUSED", version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("CONFLICT");
      await transaction.jobStatusEvent.create({ data: { id: randomUUID(), jobId: job.id, jobRevisionId: job.currentRevisionId, kind: "PAUSED", fromStatus: "PUBLISHED", toStatus: "PAUSED", actorUserId: dependencies.actor.userId, reasonCode: "MODERATION_RESTRICTION", idempotencyKey: `moderation:${dependencies.correlationId}:${job.id}`, correlationId: dependencies.correlationId, createdAt: now } });
    }
  }
  if (type === "SUSPEND_USER" && target.userId !== null) {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${target.userId}::uuid FOR UPDATE`;
    const user = await transaction.user.findUnique({ where: { id: target.userId }, select: { status: true, candidateProfile: { select: { id: true } } } });
    if (user === null) throw new Error("NOT_FOUND");
    if (user.status === "ACTIVE") await transaction.user.update({ where: { id: target.userId }, data: { status: "SUSPENDED", updatedAt: now } });
    await transaction.session.deleteMany({ where: { userId: target.userId } });
    if (user.candidateProfile !== null) {
      await transaction.radarProfile.updateMany({ where: { candidateProfileId: user.candidateProfile.id, withdrawnAt: null }, data: { withdrawnAt: now, updatedAt: now } });
      await transaction.radarOpaqueMapping.updateMany({ where: { candidateProfileId: user.candidateProfile.id, revokedAt: null }, data: { revokedAt: now, revocationReason: "USER_SUSPENDED" } });
      const contacts = await transaction.employerContactRequest.findMany({ where: { candidateProfileId: user.candidateProfile.id, status: "PENDING" }, select: { id: true } });
      for (const contact of contacts) {
        await transaction.employerContactRequest.update({ where: { id: contact.id }, data: { status: "CANCELLED", terminalAt: now, updatedAt: now } });
        await transaction.contactRequestEvent.create({ data: { id: randomUUID(), contactRequestId: contact.id, kind: "CANCELLED", actorUserId: null, reasonCode: "CANDIDATE_USER_UNAVAILABLE", correlationId: dependencies.correlationId, createdAt: now } });
      }
    }
  }
  // HIDE_JOB and BLOCK_MESSAGE_THREAD are enforced by eligibility/send guards.
}

async function notifyModerationChange(transaction: Prisma.TransactionClient, report: Readonly<{ id: string; reporterUserId: string | null }>, restrictionId: string, status: "APPLIED" | "LIFTED" | "EXPIRED", target: ResolvedRestrictionTarget) {
  const recipients = new Set<string>();
  if (report.reporterUserId !== null) recipients.add(report.reporterUserId);
  if (target.userId !== null) recipients.add(target.userId);
  if (target.companyId !== null) {
    const managers = await transaction.companyMembership.findMany({ where: { companyId: target.companyId, status: "ACTIVE", removedAt: null, role: { in: ["OWNER", "ADMIN"] }, user: { status: "ACTIVE" } }, select: { userId: true } });
    for (const manager of managers) recipients.add(manager.userId);
  }
  if (target.conversationId !== null) {
    const participants = await transaction.conversationParticipant.findMany({ where: { conversationId: target.conversationId, kind: "USER", userId: { not: null }, leftAt: null }, select: { userId: true } });
    for (const participant of participants) if (participant.userId !== null) recipients.add(participant.userId);
  }
  for (const recipientUserId of recipients) {
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), { recipientUserId, kind: "MODERATION_CHANGED", dedupeKey: `moderation:${restrictionId}:${status}`, payload: { reportId: report.id, restrictionId, status } });
  }
}

async function getLeastPrivilegeTargetPreview(database: AdminDependencies["database"], targetType: string, targetId: string) {
  if (targetType === "JOB") return database.job.findUnique({ where: { id: targetId }, select: { id: true, status: true, currentRevision: { select: { title: true } }, company: { select: { id: true, name: true } } } });
  if (targetType === "COMPANY") return database.company.findUnique({ where: { id: targetId }, select: { id: true, name: true, status: true, slug: true } });
  if (targetType === "USER") return database.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, status: true, name: true } });
  return database.message.findUnique({ where: { id: targetId }, select: { id: true, createdAt: true, conversationId: true, senderUserId: true } });
}

async function lockReport(transaction: Prisma.TransactionClient, reportId: string) {
  await transaction.$queryRaw`SELECT "id" FROM "AbuseReport" WHERE "id" = ${reportId}::uuid FOR UPDATE`;
}

function abuseSlaKey(severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): OpsCaseSlaKey {
  return `ABUSE_${severity}`;
}

function severityRank(severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): number {
  return severity === "CRITICAL" ? 4 : severity === "HIGH" ? 3 : severity === "MEDIUM" ? 2 : 1;
}

export async function isConversationMessageBlocked(database: AdminDependencies["database"] | Prisma.TransactionClient, conversationId: string, now = new Date()) {
  if (!z.uuid().safeParse(conversationId).success) return true;
  return (await database.moderationRestriction.count({ where: { targetType: "BLOCK_MESSAGE_THREAD", targetId: conversationId, status: "ACTIVE", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } })) > 0;
}
