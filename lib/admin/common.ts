import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { z } from "zod";

import {
  writeRequiredAudit,
  type AuditResultV1,
  type AuditTargetTypeV1,
} from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import type { AuditActionV1 } from "@/lib/domains/audit/audit-actions";
import {
  hasAdminCapability,
  type AdminCapability,
  type AdminCapabilityActor,
} from "@/lib/admin/capabilities";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

export const ADMIN_AUDIT_RETENTION_MILLISECONDS = 400 * 86_400_000;

export const adminIdempotencyKeySchema = z.uuid();
export const adminReasonCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
export const adminUuidSchema = z.uuid();

export type AdminActor = AdminCapabilityActor &
  Readonly<{
    email: string;
  }>;

export type AdminDependencies = Readonly<{
  actor: AdminActor;
  correlationId: string;
  database: DatabaseClient;
  now?: Date;
}>;

export type AdminCommandCode =
  | "INVALID_INPUT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RESTRICTED"
  | "VERIFICATION_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "INCOMPLETE"
  | "WRITE_FAILED";

export type AdminCommandResult<T> = Readonly<
  | { ok: true; value: T; replay?: boolean }
  | { ok: false; code: AdminCommandCode; issues?: readonly string[] }
>;

export function adminSuccess<T>(
  value: T,
  replay = false,
): AdminCommandResult<T> {
  return Object.freeze({ ok: true, value: Object.freeze(value), ...(replay ? { replay: true } : {}) });
}

export function adminFailure(
  code: AdminCommandCode,
  issues?: readonly string[],
): AdminCommandResult<never> {
  return Object.freeze({ ok: false, code, ...(issues === undefined ? {} : { issues: Object.freeze([...issues]) }) });
}

export function requireCapability(
  dependencies: AdminDependencies,
  capability: AdminCapability,
): boolean {
  return hasAdminCapability(dependencies.actor, capability);
}

export function adminNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("Admin commands require a valid clock.");
  return new Date(now);
}

export function boundedPlainText(
  value: string,
  minimum: number,
  maximum: number,
): string | null {
  const clean = stripUnsafeHtml(value).trim();
  return clean.length >= minimum && clean.length <= maximum ? clean : null;
}

export function operationKey(operation: string, idempotencyKey: string): string {
  return `${operation}:${idempotencyKey}`;
}

export async function writeAdminAudit(
  transaction: Prisma.TransactionClient,
  dependencies: AdminDependencies,
  now: Date,
  input: Readonly<{
    action: AuditActionV1;
    capability: AdminCapability;
    targetType: AuditTargetTypeV1;
    targetId: string;
    companyId?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
    reasonCode?: string | null;
    result?: AuditResultV1;
  }>,
) {
  return writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: dependencies.actor.userId,
    capability: input.capability,
    companyId: input.companyId ?? null,
    correlationId: dependencies.correlationId,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    reasonCode: input.reasonCode ?? null,
    result: input.result ?? "SUCCEEDED",
    retainUntil: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MILLISECONDS),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

export function adminErrorResult(error: unknown): AdminCommandResult<never> {
  if (error instanceof AdminDomainError) return adminFailure(error.code);
  return adminFailure("WRITE_FAILED");
}

export class AdminDomainError extends Error {
  constructor(readonly code: AdminCommandCode) {
    super(code);
    this.name = "AdminDomainError";
  }
}
