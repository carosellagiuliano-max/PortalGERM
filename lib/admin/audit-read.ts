import "server-only";

import { z } from "zod";

import {
  AUDIT_RESULTS_V1,
  AUDIT_TARGET_TYPES_V1,
} from "@/lib/audit/log";
import {
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";
import { AUDIT_ACTIONS_V1 } from "@/lib/domains/audit/audit-actions";

const auditFilterSchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS_V1).optional(),
  result: z.enum(AUDIT_RESULTS_V1).optional(),
  targetType: z.enum(AUDIT_TARGET_TYPES_V1).optional(),
  correlationId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u)
    .optional(),
});

export type AdminAuditFilter = Readonly<{
  action?: string;
  correlationId?: string;
  result?: string;
  targetType?: string;
}>;

export async function listAdminAuditEntries(
  raw: AdminAuditFilter,
  dependencies: AdminDependencies,
) {
  if (!requireCapability(dependencies, "ADMIN_AUDIT_READ")) return null;
  const parsed = auditFilterSchema.safeParse(compactFilter(raw));
  if (!parsed.success) {
    return Object.freeze({ entries: [], invalidFilter: true });
  }
  const filter = parsed.data;
  const entries = await dependencies.database.auditLog.findMany({
    where: {
      ...(filter.action === undefined ? {} : { action: filter.action }),
      ...(filter.result === undefined ? {} : { result: filter.result }),
      ...(filter.targetType === undefined
        ? {}
        : { targetType: filter.targetType }),
      ...(filter.correlationId === undefined
        ? {}
        : { correlationId: filter.correlationId }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      action: true,
      actorKind: true,
      capability: true,
      targetType: true,
      targetId: true,
      companyId: true,
      result: true,
      reasonCode: true,
      correlationId: true,
      createdAt: true,
      retainUntil: true,
      actor: { select: { name: true, email: true } },
      company: { select: { name: true } },
    },
  });
  return Object.freeze({ entries, invalidFilter: false });
}

function compactFilter(input: AdminAuditFilter) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => typeof value === "string" && value.trim() !== "",
    ),
  );
}
