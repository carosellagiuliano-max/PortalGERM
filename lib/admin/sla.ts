import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AdminDependencies } from "@/lib/admin/common";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import {
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
} from "@/lib/admin/common";

export const OPS_CASE_SLA_POLICY_VERSION = "OPS_CASE_SLA_POLICY_V1" as const;

export const OPS_CASE_SLA_HOURS = Object.freeze({
  ABUSE_CRITICAL: 1,
  ABUSE_HIGH: 4,
  ABUSE_MEDIUM: 24,
  ABUSE_LOW: 72,
  SUPPORT_URGENT: 4,
  SUPPORT_HIGH: 8,
  SUPPORT_NORMAL: 24,
  SUPPORT_LOW: 72,
  JOB_REVIEW: 48,
  COMPANY_CLAIM: 72,
  COMPANY_VERIFICATION: 72,
  IMPORT_FAILURE: 4,
  LEAD_FIRST_ACTION: 24,
} as const);

export type OpsCaseSlaKey = keyof typeof OPS_CASE_SLA_HOURS;

export function slaDueAt(createdAt: Date, key: OpsCaseSlaKey): Date {
  if (!Number.isFinite(createdAt.getTime())) throw new TypeError("SLA clock must be valid.");
  return new Date(createdAt.getTime() + OPS_CASE_SLA_HOURS[key] * 3_600_000);
}

export function tightenSlaDueAt(currentDueAt: Date, createdAt: Date, key: OpsCaseSlaKey): Date {
  const proposed = slaDueAt(createdAt, key);
  return proposed < currentDueAt ? proposed : new Date(currentDueAt);
}

export function slaThreshold(
  createdAt: Date,
  dueAt: Date,
  now: Date,
): "NONE" | "WARNING_75" | "OVERDUE" {
  if (now >= dueAt) return "OVERDUE";
  const warningAt = new Date(createdAt.getTime() + (dueAt.getTime() - createdAt.getTime()) * 0.75);
  return now >= warningAt ? "WARNING_75" : "NONE";
}

const projectionSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});

type ProjectableCase = Readonly<{
  id: string;
  companyId: string | null;
  createdAt: Date;
  dueAt: Date;
  ownerUserId: string | null;
  kind: "MODERATION" | "VERIFICATION" | "SUPPORT" | "SALES_FOLLOW_UP";
  referenceType: string;
}>;

export async function projectAdminSlaAlerts(
  input: Readonly<{ idempotencyKey: string }>,
  dependencies: AdminDependencies,
): Promise<AdminCommandResult<Readonly<{ projected: number }>>> {
  const parsed = projectionSchema.safeParse(input);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_SLA_PROJECT")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);

  const [reports, supportCases, claims, verifications, leads] = await Promise.all([
    dependencies.database.abuseReport.findMany({
      where: { status: { in: ["OPEN", "IN_REVIEW"] } },
      select: { id: true, createdAt: true, dueAt: true, assigneeUserId: true },
      take: 200,
    }),
    dependencies.database.supportCase.findMany({
      where: { status: { in: ["OPEN", "TRIAGED", "WAITING_FOR_REQUESTER", "IN_PROGRESS"] } },
      select: { id: true, companyId: true, createdAt: true, dueAt: true, assigneeUserId: true },
      take: 200,
    }),
    dependencies.database.companyClaimRequest.findMany({
      where: { status: { in: ["PENDING", "NEEDS_EVIDENCE"] } },
      select: { id: true, candidateCompanyId: true, createdAt: true },
      take: 200,
    }),
    dependencies.database.companyVerificationRequest.findMany({
      where: { status: { in: ["PENDING", "CHANGES_REQUESTED"] }, supersededBy: null },
      select: { id: true, companyId: true, createdAt: true },
      take: 200,
    }),
    dependencies.database.salesLead.findMany({
      where: { status: "NEW" },
      select: { id: true, companyId: true, createdAt: true, dueAt: true, ownerUserId: true },
      take: 200,
    }),
  ]);

  const cases: ProjectableCase[] = [
    ...reports.map((row) => ({ id: row.id, companyId: null, createdAt: row.createdAt, dueAt: row.dueAt, ownerUserId: row.assigneeUserId, kind: "MODERATION" as const, referenceType: "ABUSE_REPORT" })),
    ...supportCases.map((row) => ({ id: row.id, companyId: row.companyId, createdAt: row.createdAt, dueAt: row.dueAt, ownerUserId: row.assigneeUserId, kind: "SUPPORT" as const, referenceType: "SUPPORT_CASE" })),
    ...claims.map((row) => ({ id: row.id, companyId: row.candidateCompanyId, createdAt: row.createdAt, dueAt: slaDueAt(row.createdAt, "COMPANY_CLAIM"), ownerUserId: null, kind: "VERIFICATION" as const, referenceType: "COMPANY_CLAIM" })),
    ...verifications.map((row) => ({ id: row.id, companyId: row.companyId, createdAt: row.createdAt, dueAt: slaDueAt(row.createdAt, "COMPANY_VERIFICATION"), ownerUserId: null, kind: "VERIFICATION" as const, referenceType: "COMPANY_VERIFICATION" })),
    ...leads.map((row) => ({ id: row.id, companyId: row.companyId, createdAt: row.createdAt, dueAt: row.dueAt ?? slaDueAt(row.createdAt, "LEAD_FIRST_ACTION"), ownerUserId: row.ownerUserId, kind: "SALES_FOLLOW_UP" as const, referenceType: "SALES_LEAD" })),
  ];

  let projected = 0;
  await dependencies.database.$transaction(async (transaction) => {
    for (const item of cases) {
      const threshold = slaThreshold(item.createdAt, item.dueAt, now);
      if (threshold === "NONE") continue;
      const idempotencyKey = `sla:${OPS_CASE_SLA_POLICY_VERSION}:${item.referenceType}:${item.id}:${threshold}`;
      const existing = await transaction.systemTask.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (existing !== null) continue;
      const task = await transaction.systemTask.create({ data: {
        id: randomUUID(),
        companyId: item.companyId,
        kind: item.kind,
        reasonCode: threshold === "OVERDUE" ? "SLA_OVERDUE" : "SLA_WARNING_75",
        policyVersion: OPS_CASE_SLA_POLICY_VERSION,
        thresholdCode: threshold,
        evidenceWindowStart: item.createdAt,
        evidenceWindowEnd: item.dueAt,
        evidenceReference: `${item.referenceType}:${item.id}`,
        ownerUserId: item.ownerUserId,
        dueAt: item.dueAt,
        status: item.ownerUserId === null ? "OPEN" : "ASSIGNED",
        idempotencyKey,
      } });
      if (item.ownerUserId !== null) {
        await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
          recipientUserId: item.ownerUserId,
          kind: "SYSTEM_TASK_ASSIGNED",
          dedupeKey: `phase11:${task.id}`,
          payload: { taskId: task.id, status: "ASSIGNED" },
        });
      }
      await writeAdminAudit(transaction, dependencies, now, { action: "SYSTEM_TASK_ASSIGNED", capability: "ADMIN_SLA_PROJECT", targetType: "SYSTEM_TASK", targetId: task.id, companyId: item.companyId, reasonCode: threshold === "OVERDUE" ? "SLA_OVERDUE" : "SLA_WARNING_75" });
      projected += 1;
    }
  });

  return adminSuccess({ projected });
}
