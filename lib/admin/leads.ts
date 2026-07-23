import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createPrismaTransactionAnalyticsWriter,
  trackAnalyticsEventV1,
} from "@/lib/analytics/track";
import { salesLeadAnalyticsKeyV1 } from "@/lib/sales/lead-policy";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { trimmedString } from "@/lib/validation/common";
import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";

export async function listAdminLeads(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_LEAD_MANAGE")) return null;
  const now = adminNow(dependencies.now);
  return dependencies.database.salesLead.findMany({
    orderBy: [{ dueAt: "asc" }, { nextAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 250,
    select: { id: true, organizationName: true, contactName: true, emailNormalized: true, purpose: true, status: true, dueAt: true, nextAt: true, createdAt: true, owner: { select: { id: true, name: true, email: true } }, company: { select: { id: true, name: true } }, _count: { select: { activities: true } } },
  }).then((rows) => rows.sort((a, b) => Number((a.dueAt ?? a.nextAt ?? a.createdAt) > now) - Number((b.dueAt ?? b.nextAt ?? b.createdAt) > now) || (a.dueAt ?? a.nextAt ?? a.createdAt).getTime() - (b.dueAt ?? b.nextAt ?? b.createdAt).getTime() || a.id.localeCompare(b.id)));
}

export async function getAdminLeadDetail(dependencies: AdminDependencies, leadId: string) {
  if (!requireCapability(dependencies, "ADMIN_LEAD_MANAGE") || !z.uuid().safeParse(leadId).success) return null;
  return dependencies.database.salesLead.findUnique({ where: { id: leadId }, select: { id: true, organizationName: true, contactName: true, emailNormalized: true, phoneNormalized: true, companySizeCode: true, hiringNeedCode: true, interestCode: true, callbackWindowCode: true, purpose: true, needSummary: true, message: true, status: true, dueAt: true, nextAt: true, createdAt: true, updatedAt: true, owner: { select: { id: true, name: true, email: true } }, company: { select: { id: true, name: true } }, activities: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, safeNote: true, outcomeCode: true, createdAt: true } } } });
}

const leadCommandSchema = z.strictObject({
  leadId: z.uuid(),
  action: z.enum(["ASSIGN", "SET_NEXT", "STATUS", "NOTE", "CONTACT", "OUTCOME"]),
  ownerUserId: z.uuid().nullable().optional(),
  nextAt: z.coerce.date().nullable().optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]).optional(),
  safeNote: trimmedString(1, 1000)
    .transform(stripUnsafeHtml)
    .pipe(z.string().min(1).max(1000))
    .optional(),
  outcomeCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u).optional(),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  idempotencyKey: z.uuid(),
});

export async function manageSalesLead(raw: unknown, dependencies: AdminDependencies) {
  const parsed = leadCommandSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.action === "ASSIGN" && parsed.data.ownerUserId === undefined) || (parsed.data.action === "SET_NEXT" && parsed.data.nextAt === undefined) || (parsed.data.action === "STATUS" && parsed.data.status === undefined) || (["NOTE", "CONTACT"].includes(parsed.data.action) && parsed.data.safeNote === undefined) || (parsed.data.action === "OUTCOME" && parsed.data.outcomeCode === undefined)) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_LEAD_MANAGE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const activityKey = operationKey(`admin-lead-${parsed.data.action.toLowerCase()}`, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "SalesLead" WHERE "id" = ${parsed.data.leadId}::uuid FOR UPDATE`;
      const replay = await transaction.salesActivity.findUnique({ where: { idempotencyKey: activityKey }, select: { salesLeadId: true, salesLead: { select: { status: true, ownerUserId: true, nextAt: true } } } });
      if (replay !== null) return adminSuccess({ leadId: replay.salesLeadId, status: replay.salesLead.status, ownerUserId: replay.salesLead.ownerUserId, nextAt: replay.salesLead.nextAt }, true);
      const lead = await transaction.salesLead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true, companyId: true, purpose: true, status: true, ownerUserId: true, nextAt: true, company: { select: { dataProvenance: true } } } });
      if (lead === null) return adminFailure("NOT_FOUND");
      if (parsed.data.action === "ASSIGN" && parsed.data.ownerUserId !== null) {
        const owner = await transaction.user.findFirst({ where: { id: parsed.data.ownerUserId, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
        if (owner === null) return adminFailure("INVALID_INPUT");
      }
      const nextStatus = parsed.data.action === "STATUS" ? parsed.data.status! : lead.status;
      const nextAt = parsed.data.action === "SET_NEXT"
        ? parsed.data.nextAt!
        : parsed.data.action === "STATUS" && ["WON", "LOST"].includes(nextStatus)
          ? null
          : parsed.data.action === "STATUS" && parsed.data.nextAt !== undefined
            ? parsed.data.nextAt
          : lead.nextAt;
      const ownerUserId = parsed.data.action === "ASSIGN" ? parsed.data.ownerUserId! : lead.ownerUserId;
      if (["CONTACTED", "QUALIFIED"].includes(nextStatus) && (nextAt === null || nextAt <= now)) return adminFailure("INVALID_INPUT");
      if (["WON", "LOST"].includes(nextStatus) && nextAt !== null) return adminFailure("INVALID_INPUT");
      await transaction.salesLead.update({ where: { id: lead.id }, data: { status: nextStatus, ownerUserId, nextAt, updatedAt: now } });
      const kind = parsed.data.action === "ASSIGN" ? "TASK_ASSIGNED" as const : parsed.data.action === "STATUS" ? "STATUS_CHANGE" as const : parsed.data.action === "CONTACT" ? "CONTACT_ATTEMPT" as const : parsed.data.action === "OUTCOME" ? "OUTCOME" as const : "NOTE" as const;
      await transaction.salesActivity.create({ data: { id: randomUUID(), salesLeadId: lead.id, kind, actorUserId: dependencies.actor.userId, safeNote: parsed.data.safeNote ?? (parsed.data.action === "SET_NEXT" ? `Nächster Termin: ${nextAt?.toISOString() ?? "entfernt"}` : null), outcomeCode: parsed.data.outcomeCode ?? (parsed.data.action === "STATUS" ? nextStatus : parsed.data.reasonCode), idempotencyKey: activityKey, correlationId: dependencies.correlationId, createdAt: now } });
      if (
        parsed.data.action === "STATUS" &&
        nextStatus !== lead.status &&
        (nextStatus === "QUALIFIED" || nextStatus === "WON")
      ) {
        const analyticsKind = nextStatus === "QUALIFIED"
          ? "LEAD_QUALIFIED" as const
          : "LEAD_WON" as const;
        const leadPurpose = analyticsLeadPurpose(lead.purpose);
        const analyticsSessionId = salesLeadAnalyticsKeyV1(lead.id);
        const intakeProvenance = await transaction.analyticsEvent.findFirst({
          where: {
            kind: "LEAD_SUBMITTED",
            producer: "employer-demo",
            pseudonymousSessionId: analyticsSessionId,
            occurredAt: { lte: now },
            receivedAt: { lte: now },
          },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: {
            actorProvenanceSnapshot: true,
            companyProvenanceSnapshot: true,
            jobProvenanceSnapshot: true,
          },
        });
        await trackAnalyticsEventV1(
          {
            schemaVersion: "1",
            producerEventId: `${analyticsKind}:${lead.id}`,
            occurredAt: now,
            kind: analyticsKind,
            pseudonymousSessionId: analyticsSessionId,
            companyId: lead.companyId ?? undefined,
            properties: leadPurpose === undefined ? {} : { leadPurpose },
          },
          {
            producer: "admin-sales-lead",
            productAnalyticsEnabled: false,
            provenance: {
              actor: intakeProvenance?.actorProvenanceSnapshot ?? null,
              company:
                intakeProvenance?.companyProvenanceSnapshot ??
                lead.company?.dataProvenance ??
                null,
              job: intakeProvenance?.jobProvenanceSnapshot ?? null,
            },
          },
          createPrismaTransactionAnalyticsWriter(transaction),
        );
      }
      await writeAdminAudit(transaction, dependencies, now, { action: "LEAD_STATUS_CHANGED", capability: "ADMIN_LEAD_MANAGE", targetType: "SALES_LEAD", targetId: lead.id, companyId: lead.companyId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ leadId: lead.id, status: nextStatus, ownerUserId, nextAt });
    }, { isolationLevel: "Serializable" });
  } catch (error) { return adminErrorResult(error); }
}

function analyticsLeadPurpose(value: string) {
  switch (value) {
    case "EMPLOYER_DEMO":
    case "SALES_CONTACT":
    case "ENTERPRISE":
    case "IMPORT":
      return value;
    default:
      return undefined;
  }
}
