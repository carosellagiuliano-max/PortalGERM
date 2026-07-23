import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { trimmedString } from "@/lib/validation/common";
import { slaDueAt, tightenSlaDueAt, type OpsCaseSlaKey } from "@/lib/admin/sla";
import {
  ADMIN_AUDIT_RETENTION_MILLISECONDS,
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";

export type SupportRequesterActor = Readonly<{ userId: string; status: string }>;

const createCaseSchema = z.strictObject({
  companyId: z.uuid().nullable().optional(),
  category: z.enum(["ACCOUNT", "APPLICATION", "EMPLOYER", "BILLING", "PRIVACY", "ABUSE", "OTHER"]),
  subject: trimmedString(3, 200)
    .transform(stripUnsafeHtml)
    .pipe(z.string().min(3).max(200)),
  description: trimmedString(10, 3000)
    .transform(stripUnsafeHtml)
    .pipe(z.string().min(10).max(3000)),
  contactPreference: z.enum(["EMAIL", "PHONE"]),
  idempotencyKey: z.uuid(),
});

export async function createSupportCase(raw: unknown, actor: SupportRequesterActor, database: DatabaseClient, now = new Date()) {
  const parsed = createCaseSchema.safeParse(raw);
  if (!parsed.success || actor.status !== "ACTIVE" || !Number.isFinite(now.getTime())) return adminFailure("INVALID_INPUT");
  const eventKey = operationKey("support-case-create", parsed.data.idempotencyKey);
  try {
    return await database.$transaction(async (transaction) => {
      const replay = await transaction.supportCaseEvent.findUnique({ where: { idempotencyKey: eventKey }, select: { supportCaseId: true, supportCase: { select: { requesterUserId: true, status: true } } } });
      if (replay !== null) return replay.supportCase.requesterUserId === actor.userId ? adminSuccess({ caseId: replay.supportCaseId, status: replay.supportCase.status }, true) : adminFailure("CONFLICT");
      const user = await transaction.user.findFirst({ where: { id: actor.userId, status: "ACTIVE" }, select: { id: true } });
      if (user === null) return adminFailure("NOT_FOUND");
      const companyId = parsed.data.companyId ?? null;
      if (companyId !== null) {
        const membership = await transaction.companyMembership.findFirst({ where: { companyId, userId: actor.userId, status: "ACTIVE", removedAt: null }, select: { id: true } });
        if (membership === null) return adminFailure("FORBIDDEN");
      }
      const caseRow = await transaction.supportCase.create({ data: { id: randomUUID(), requesterUserId: actor.userId, companyId, category: parsed.data.category, priority: "NORMAL", status: "OPEN", subject: parsed.data.subject, description: parsed.data.description, contactPreference: parsed.data.contactPreference, dueAt: slaDueAt(now, "SUPPORT_NORMAL"), correlationId: randomCorrelation(eventKey), createdAt: now, updatedAt: now } });
      await transaction.supportCaseEvent.create({ data: { id: randomUUID(), supportCaseId: caseRow.id, kind: "CREATED", actorUserId: actor.userId, safeBody: null, reasonCode: "REQUESTER_CREATED", correlationId: caseRow.correlationId, idempotencyKey: eventKey, createdAt: now } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), { action: "SUPPORT_CASE_CREATED", actorKind: "USER", actorUserId: actor.userId, capability: "SUPPORT_CASE_CREATE", companyId, correlationId: caseRow.correlationId, reasonCode: "REQUESTER_CREATED", result: "SUCCEEDED", retainUntil: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MILLISECONDS), targetId: caseRow.id, targetType: "SUPPORT_CASE" });
      return adminSuccess({ caseId: caseRow.id, status: "OPEN" as const });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

export async function listRequesterSupportCases(database: DatabaseClient, actor: SupportRequesterActor) {
  if (actor.status !== "ACTIVE") return [];
  return database.supportCase.findMany({ where: { requesterUserId: actor.userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, category: true, priority: true, status: true, subject: true, dueAt: true, createdAt: true, updatedAt: true } });
}

export async function getRequesterSupportCase(database: DatabaseClient, actor: SupportRequesterActor, caseId: string) {
  if (actor.status !== "ACTIVE" || !z.uuid().safeParse(caseId).success) return null;
  return database.supportCase.findFirst({ where: { id: caseId, requesterUserId: actor.userId }, select: { id: true, category: true, priority: true, status: true, subject: true, description: true, contactPreference: true, dueAt: true, createdAt: true, updatedAt: true, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, safeBody: true, createdAt: true } } } });
}

const replySchema = z.strictObject({ caseId: z.uuid(), body: trimmedString(1, 2000).transform(stripUnsafeHtml).pipe(z.string().min(1).max(2000)), idempotencyKey: z.uuid() });

export async function replyToSupportCase(raw: unknown, actor: SupportRequesterActor, database: DatabaseClient, now = new Date()) {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success || actor.status !== "ACTIVE" || !Number.isFinite(now.getTime())) return adminFailure("INVALID_INPUT");
  const eventKey = operationKey("support-case-reply", parsed.data.idempotencyKey);
  try {
    return await database.$transaction(async (transaction) => {
      await lockSupportCase(transaction, parsed.data.caseId);
      const caseRow = await transaction.supportCase.findUnique({ where: { id: parsed.data.caseId }, select: { id: true, requesterUserId: true, status: true, version: true, companyId: true, assigneeUserId: true, correlationId: true, events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } } } });
      if (caseRow === null || caseRow.requesterUserId !== actor.userId) return adminFailure("NOT_FOUND");
      if (caseRow.events.length > 0 && caseRow.status === "IN_PROGRESS") return adminSuccess({ caseId: caseRow.id, status: "IN_PROGRESS" as const }, true);
      if (caseRow.status !== "WAITING_FOR_REQUESTER") return adminFailure("CONFLICT");
      const changed = await transaction.supportCase.updateMany({ where: { id: caseRow.id, requesterUserId: actor.userId, status: "WAITING_FOR_REQUESTER", version: caseRow.version }, data: { status: "IN_PROGRESS", version: { increment: 1 }, updatedAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      await transaction.supportCaseEvent.create({ data: { id: randomUUID(), supportCaseId: caseRow.id, kind: "REPLIED", actorUserId: actor.userId, safeBody: parsed.data.body, reasonCode: "REQUESTER_REPLIED", correlationId: caseRow.correlationId, idempotencyKey: eventKey, createdAt: now } });
      if (caseRow.assigneeUserId !== null) await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), { recipientUserId: caseRow.assigneeUserId, kind: "SUPPORT_CASE_CHANGED", dedupeKey: eventKey, payload: { caseId: caseRow.id, status: "IN_PROGRESS", reasonCode: "REPLIED" } });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), { action: "SUPPORT_CASE_REPLIED", actorKind: "USER", actorUserId: actor.userId, capability: "SUPPORT_CASE_REPLY", companyId: caseRow.companyId, correlationId: caseRow.correlationId, reasonCode: "REQUESTER_REPLIED", result: "SUCCEEDED", retainUntil: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MILLISECONDS), targetId: caseRow.id, targetType: "SUPPORT_CASE" });
      return adminSuccess({ caseId: caseRow.id, status: "IN_PROGRESS" as const });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

export async function listAdminSupportCases(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_SUPPORT_MANAGE")) return null;
  const now = adminNow(dependencies.now);
  return dependencies.database.supportCase.findMany({ orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { id: "asc" }], take: 250, select: { id: true, category: true, priority: true, status: true, subject: true, dueAt: true, version: true, createdAt: true, company: { select: { id: true, name: true } }, requester: { select: { id: true, name: true, email: true } }, assignee: { select: { id: true, name: true, email: true } } } }).then((rows) => rows.sort((a, b) => Number(a.dueAt > now) - Number(b.dueAt > now) || a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id)));
}

export async function getAdminSupportCase(dependencies: AdminDependencies, caseId: string) {
  if (!requireCapability(dependencies, "ADMIN_SUPPORT_MANAGE") || !z.uuid().safeParse(caseId).success) return null;
  return dependencies.database.supportCase.findUnique({ where: { id: caseId }, select: { id: true, category: true, priority: true, status: true, subject: true, description: true, contactPreference: true, dueAt: true, version: true, createdAt: true, updatedAt: true, company: { select: { id: true, name: true } }, requester: { select: { id: true, name: true, email: true } }, assignee: { select: { id: true, name: true, email: true } }, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, actorUserId: true, safeBody: true, reasonCode: true, createdAt: true } } } });
}

const adminSupportSchema = z.strictObject({
  caseId: z.uuid(), expectedVersion: z.coerce.number().int().positive(), action: z.enum(["TRIAGE", "ASSIGN", "REQUEST_INFORMATION", "RESOLVE", "REOPEN"]), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assigneeUserId: z.uuid().nullable().optional(), reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u), safeBody: trimmedString(1, 2000).transform(stripUnsafeHtml).pipe(z.string().min(1).max(2000)).optional(), idempotencyKey: z.uuid(),
});

export async function manageSupportCase(raw: unknown, dependencies: AdminDependencies) {
  const parsed = adminSupportSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.action === "TRIAGE" && parsed.data.priority === undefined) || (parsed.data.action === "ASSIGN" && parsed.data.assigneeUserId == null) || (parsed.data.action === "REQUEST_INFORMATION" && parsed.data.safeBody === undefined)) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_SUPPORT_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const eventKey = operationKey(`admin-support-${parsed.data.action.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await lockSupportCase(transaction, parsed.data.caseId);
      const caseRow = await transaction.supportCase.findUnique({ where: { id: parsed.data.caseId }, select: { id: true, requesterUserId: true, companyId: true, status: true, priority: true, assigneeUserId: true, dueAt: true, createdAt: true, version: true, correlationId: true, events: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } } } });
      if (caseRow === null) return adminFailure("NOT_FOUND");
      if (caseRow.events.length > 0) return adminSuccess({ caseId: caseRow.id, status: caseRow.status, version: caseRow.version }, true);
      if (caseRow.version !== parsed.data.expectedVersion) return adminFailure("CONFLICT");
      let status = caseRow.status;
      let kind: "TRIAGED" | "ASSIGNED" | "INFORMATION_REQUESTED" | "RESOLVED" | "REOPENED";
      let assigneeUserId = caseRow.assigneeUserId;
      let priority = caseRow.priority;
      let dueAt = caseRow.dueAt;
      if (parsed.data.action === "TRIAGE") {
        if (!["OPEN", "TRIAGED"].includes(status)) return adminFailure("CONFLICT");
        status = "TRIAGED"; kind = "TRIAGED"; priority = parsed.data.priority!; dueAt = tightenSlaDueAt(caseRow.dueAt, caseRow.createdAt, supportSlaKey(priority));
      } else if (parsed.data.action === "ASSIGN") {
        if (["RESOLVED", "CLOSED"].includes(status)) return adminFailure("CONFLICT");
        const admin = await transaction.user.findFirst({ where: { id: parsed.data.assigneeUserId!, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
        if (admin === null) return adminFailure("INVALID_INPUT");
        assigneeUserId = admin.id; kind = "ASSIGNED";
      } else if (parsed.data.action === "REQUEST_INFORMATION") {
        if (!["TRIAGED", "IN_PROGRESS"].includes(status) || caseRow.assigneeUserId !== dependencies.actor.userId) return adminFailure("CONFLICT");
        status = "WAITING_FOR_REQUESTER"; kind = "INFORMATION_REQUESTED";
      } else if (parsed.data.action === "RESOLVE") {
        if (!["TRIAGED", "IN_PROGRESS", "WAITING_FOR_REQUESTER"].includes(status)) return adminFailure("CONFLICT");
        status = "RESOLVED"; kind = "RESOLVED";
      } else {
        if (status !== "RESOLVED") return adminFailure("CONFLICT");
        status = "IN_PROGRESS"; kind = "REOPENED";
      }
      const changed = await transaction.supportCase.updateMany({ where: { id: caseRow.id, version: caseRow.version, status: caseRow.status }, data: { status, priority, dueAt, assigneeUserId, version: { increment: 1 }, updatedAt: now } });
      if (changed.count !== 1) return adminFailure("CONFLICT");
      await transaction.supportCaseEvent.create({ data: { id: randomUUID(), supportCaseId: caseRow.id, kind, actorUserId: dependencies.actor.userId, safeBody: parsed.data.safeBody ?? null, reasonCode: parsed.data.reasonCode, correlationId: caseRow.correlationId, idempotencyKey: eventKey, createdAt: now } });
      const notificationReason = parsed.data.action === "REQUEST_INFORMATION" ? "REQUESTER_INPUT_REQUIRED" as const : parsed.data.action === "TRIAGE" ? "TRIAGED" as const : parsed.data.action === "ASSIGN" ? "ASSIGNED" as const : parsed.data.action === "RESOLVE" ? "RESOLVED" as const : "REOPENED" as const;
      await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), { recipientUserId: caseRow.requesterUserId, kind: "SUPPORT_CASE_CHANGED", dedupeKey: eventKey, payload: { caseId: caseRow.id, status, reasonCode: notificationReason } });
      const auditAction = parsed.data.action === "TRIAGE" ? "SUPPORT_CASE_TRIAGED" as const : parsed.data.action === "ASSIGN" ? "SUPPORT_CASE_ASSIGNED" as const : parsed.data.action === "RESOLVE" ? "SUPPORT_CASE_RESOLVED" as const : parsed.data.action === "REOPEN" ? "SUPPORT_CASE_REOPENED" as const : "SUPPORT_CASE_TRIAGED" as const;
      await writeAdminAudit(transaction, dependencies, now, { action: auditAction, capability: "ADMIN_SUPPORT_MANAGE", targetType: "SUPPORT_CASE", targetId: caseRow.id, companyId: caseRow.companyId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ caseId: caseRow.id, status, version: caseRow.version + 1 });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

async function lockSupportCase(transaction: Prisma.TransactionClient, caseId: string) { await transaction.$queryRaw`SELECT "id" FROM "SupportCase" WHERE "id" = ${caseId}::uuid FOR UPDATE`; }
function supportSlaKey(priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"): OpsCaseSlaKey { return `SUPPORT_${priority}`; }
function randomCorrelation(value: string) {
  const key = value.split(":").at(-1);
  return key !== undefined && z.uuid().safeParse(key).success ? key : randomUUID();
}
