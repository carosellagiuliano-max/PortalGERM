import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ADMIN_CAPABILITIES_V1,
  type AdminCapability,
} from "@/lib/admin/capabilities";
import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminReasonCodeSchema,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminCommandResult,
  type AdminDependencies,
} from "@/lib/admin/common";
import {
  ADMIN_GRANTS_POLICY_V2,
  ADMIN_ROLE_CATALOG_V2,
  dutiesConflict,
  resolveAdminActor,
  type AdminDutyV2,
  type AdminRoleCode,
} from "@/lib/admin/role-policy";
import { hasCurrentAal2 } from "@/lib/auth/assurance/mfa-service";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { Prisma } from "@/lib/generated/prisma/client";

const uuidSchema = z.uuid();
const isoDateSchema = z.iso.datetime({ offset: true });
const roleCodeSchema = z.enum(
  Object.keys(ADMIN_ROLE_CATALOG_V2) as [
    AdminRoleCode,
    ...AdminRoleCode[],
  ],
);
const capabilitySchema = z.enum(ADMIN_CAPABILITIES_V1);
const dutySchema = z.enum([
  "PLATFORM",
  "SECURITY",
  "SUPPORT",
  "MODERATION",
  "FINANCE",
  "PRIVACY_VERIFY",
  "PRIVACY_PROCESS",
  "CONTENT_SUPPLY",
  "TRUST_SAFETY",
]);

const requestRoleSchema = z.strictObject({
  userId: uuidSchema,
  roleCode: roleCodeSchema,
  validFrom: isoDateSchema.optional(),
  validTo: isoDateSchema,
  reasonCode: adminReasonCodeSchema,
});
const requestCapabilitySchema = z.strictObject({
  userId: uuidSchema,
  capability: capabilitySchema,
  duty: dutySchema,
  validFrom: isoDateSchema.optional(),
  validTo: isoDateSchema,
  reasonCode: adminReasonCodeSchema,
});
const requestBreakGlassSchema = z.strictObject({
  userId: uuidSchema,
  capabilities: z.array(capabilitySchema).min(1).max(8),
  incidentReference: z
    .string()
    .trim()
    .min(6)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/ -]+$/u),
  validTo: isoDateSchema,
  reasonCode: adminReasonCodeSchema,
});
const approvalSchema = z.strictObject({
  approvalId: uuidSchema,
  reasonCode: adminReasonCodeSchema,
});
const revokeSchema = z.strictObject({
  id: uuidSchema,
  reasonCode: adminReasonCodeSchema,
});
const authenticatorResetRequestSchema = z.strictObject({
  userId: uuidSchema,
  reasonCode: adminReasonCodeSchema,
});

const rolePayloadSchema = z.strictObject({
  version: z.literal("ROLE_ASSIGNMENT_V1"),
  userId: uuidSchema,
  roleCode: roleCodeSchema,
  validFrom: isoDateSchema,
  validTo: isoDateSchema,
});
const capabilityPayloadSchema = z.strictObject({
  version: z.literal("CAPABILITY_GRANT_V1"),
  userId: uuidSchema,
  capability: capabilitySchema,
  duty: dutySchema,
  validFrom: isoDateSchema,
  validTo: isoDateSchema,
});
const breakGlassPayloadSchema = z.strictObject({
  version: z.literal("BREAK_GLASS_V1"),
  userId: uuidSchema,
  capabilities: z.array(capabilitySchema).min(1).max(8),
  incidentReference: z.string().min(6).max(160),
  validFrom: isoDateSchema,
  validTo: isoDateSchema,
});
const resetPayloadSchema = z.strictObject({
  version: z.literal("AUTHENTICATOR_RESET_V1"),
  userId: uuidSchema,
});

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;
const MIN_GRANT_TTL_MS = 5 * 60 * 1_000;
const MAX_ROLE_TTL_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_DIRECT_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_BREAK_GLASS_TTL_MS = 60 * 60 * 1_000;

export type AdminSecurityDependencies = AdminDependencies &
  Readonly<{
    actor: AdminDependencies["actor"] & Readonly<{ sessionId: string }>;
    environment: Pick<ServerEnvironment, "BREAK_GLASS_ENABLED">;
  }>;

export async function listAdminSecurityGovernance(
  dependencies: AdminDependencies,
) {
  if (!(await requireCapability(dependencies, "ADMIN_SECURITY_READ"))) {
    return null;
  }
  const now = adminNow(dependencies.now);
  const [roles, adminUsers, assignments, directGrants, approvals, breakGlass] =
    await Promise.all([
      dependencies.database.adminRole.findMany({
        where: { active: true, policyVersion: ADMIN_GRANTS_POLICY_V2 },
        orderBy: [{ duty: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          duty: true,
          capabilities: {
            orderBy: { capability: "asc" },
            select: { capability: true },
          },
        },
      }),
      dependencies.database.user.findMany({
        where: { role: "ADMIN" },
        orderBy: [{ emailNormalized: "asc" }, { id: "asc" }],
        take: 250,
        select: { id: true, name: true, email: true, status: true },
      }),
      dependencies.database.adminRoleAssignment.findMany({
        where: { revokedAt: null, validTo: { gt: now } },
        orderBy: [{ validTo: "asc" }, { id: "asc" }],
        take: 250,
        select: {
          id: true,
          reasonCode: true,
          validFrom: true,
          validTo: true,
          user: { select: { id: true, name: true, email: true, status: true } },
          adminRole: { select: { code: true, name: true, duty: true } },
        },
      }),
      dependencies.database.adminCapabilityGrant.findMany({
        where: { revokedAt: null, validTo: { gt: now } },
        orderBy: [{ validTo: "asc" }, { id: "asc" }],
        take: 250,
        select: {
          id: true,
          capability: true,
          duty: true,
          reasonCode: true,
          validFrom: true,
          validTo: true,
          user: { select: { id: true, name: true, email: true, status: true } },
        },
      }),
      dependencies.database.privilegedApproval.findMany({
        where: { status: "PENDING", expiresAt: { gt: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: 250,
        select: {
          id: true,
          kind: true,
          requestedByUserId: true,
          targetType: true,
          targetId: true,
          duty: true,
          reasonCode: true,
          requestPayload: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      dependencies.database.breakGlassGrant.findMany({
        where: {
          status: { in: ["ACTIVE", "PENDING"] },
          revokedAt: null,
          validTo: { gt: now },
        },
        orderBy: [{ validTo: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          userId: true,
          requestedByUserId: true,
          approvedByUserId: true,
          status: true,
          incidentReference: true,
          reasonCode: true,
          capabilities: true,
          validFrom: true,
          validTo: true,
        },
      }),
    ]);
  return Object.freeze({
    policyVersion: ADMIN_GRANTS_POLICY_V2,
    roles,
    adminUsers,
    assignments,
    directGrants,
    approvals: approvals.map((approval) => ({
      ...approval,
      requestPayload: safeApprovalSummary(approval.requestPayload),
    })),
    breakGlass,
  });
}

export async function requestAdminRoleAssignment(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ approvalId: string }>> {
  const parsed = requestRoleSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_GRANT"))) {
    return adminFailure("FORBIDDEN");
  }
  if (parsed.data.userId === dependencies.actor.userId) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const validFrom = parsed.data.validFrom
    ? new Date(parsed.data.validFrom)
    : now;
  const validTo = new Date(parsed.data.validTo);
  if (!boundedWindow(validFrom, validTo, now, MAX_ROLE_TTL_MS)) {
    return adminFailure("INVALID_INPUT");
  }
  const role = ADMIN_ROLE_CATALOG_V2[parsed.data.roleCode];
  const target = await requireEligibleAdminTarget(
    dependencies,
    parsed.data.userId,
    now,
  );
  if (target === null || dutiesConflict(target.duties, role.duty)) {
    return adminFailure("CONFLICT");
  }
  const payload = Object.freeze({
    version: "ROLE_ASSIGNMENT_V1" as const,
    userId: parsed.data.userId,
    roleCode: parsed.data.roleCode,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
  });
  return createApprovalRequest(dependencies, now, {
    kind: "ROLE_ASSIGNMENT",
    duty: role.duty,
    targetType: "ADMIN_ROLE_ASSIGNMENT",
    targetId: parsed.data.userId,
    reasonCode: parsed.data.reasonCode,
    payload,
    action: "ADMIN_ROLE_ASSIGNMENT_REQUESTED",
    capability: "ADMIN_SECURITY_GRANT",
  });
}

export async function approveAdminRoleAssignment(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ assignmentId: string }>> {
  const parsed = approvalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_APPROVE"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const approval = await lockPendingApproval(
          transaction,
          parsed.data.approvalId,
          "ROLE_ASSIGNMENT",
          dependencies.actor.userId,
          now,
        );
        if (approval === null) return adminFailure("CONFLICT");
        const payload = rolePayloadSchema.safeParse(approval.requestPayload);
        if (!payload.success) return adminFailure("CONFLICT");
        const role = await transaction.adminRole.findFirst({
          where: {
            code: payload.data.roleCode,
            active: true,
            policyVersion: ADMIN_GRANTS_POLICY_V2,
          },
          select: { id: true, duty: true },
        });
        if (role === null || role.duty !== approval.duty) {
          return adminFailure("CONFLICT");
        }
        const target = await resolveAdminActor(
          transaction,
          await loadAdminTarget(transaction, payload.data.userId),
          now,
        );
        if (
          target.role !== "ADMIN" ||
          target.status !== "ACTIVE" ||
          dutiesConflict(target.duties, role.duty as AdminDutyV2)
        ) {
          return adminFailure("CONFLICT");
        }
        const assignmentId = randomUUID();
        await transaction.adminRoleAssignment.create({
          data: {
            id: assignmentId,
            userId: payload.data.userId,
            adminRoleId: role.id,
            grantedByUserId: dependencies.actor.userId,
            approvalId: approval.id,
            reasonCode: approval.reasonCode,
            validFrom: new Date(payload.data.validFrom),
            validTo: new Date(payload.data.validTo),
            createdAt: now,
          },
          select: { id: true },
        });
        await consumeApproval(
          transaction,
          approval.id,
          dependencies.actor.userId,
          now,
        );
        await writeAdminAudit(transaction, dependencies, now, {
          action: "ADMIN_ROLE_ASSIGNMENT_APPROVED",
          capability: "ADMIN_SECURITY_APPROVE",
          targetType: "ADMIN_ROLE_ASSIGNMENT",
          targetId: assignmentId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ assignmentId });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function revokeAdminRoleAssignment(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ assignmentId: string }>> {
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_GRANT"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const assignment = await transaction.adminRoleAssignment.findFirst({
          where: { id: parsed.data.id, revokedAt: null },
          select: { id: true, userId: true },
        });
        if (assignment === null) return adminFailure("NOT_FOUND");
        if (assignment.userId === dependencies.actor.userId) {
          return adminFailure("FORBIDDEN");
        }
        const changed = await transaction.adminRoleAssignment.updateMany({
          where: { id: assignment.id, revokedAt: null },
          data: {
            revokedAt: now,
            revokedByUserId: dependencies.actor.userId,
            reasonCode: parsed.data.reasonCode,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        await revokeUserSecurityState(transaction, assignment.userId, now);
        await writeAdminAudit(transaction, dependencies, now, {
          action: "ADMIN_ROLE_ASSIGNMENT_REVOKED",
          capability: "ADMIN_SECURITY_GRANT",
          targetType: "ADMIN_ROLE_ASSIGNMENT",
          targetId: assignment.id,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ assignmentId: assignment.id });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function requestAdminCapabilityGrant(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ approvalId: string }>> {
  const parsed = requestCapabilitySchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_GRANT"))) {
    return adminFailure("FORBIDDEN");
  }
  if (parsed.data.userId === dependencies.actor.userId) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const validFrom = parsed.data.validFrom
    ? new Date(parsed.data.validFrom)
    : now;
  const validTo = new Date(parsed.data.validTo);
  if (!boundedWindow(validFrom, validTo, now, MAX_DIRECT_GRANT_TTL_MS)) {
    return adminFailure("INVALID_INPUT");
  }
  const target = await requireEligibleAdminTarget(
    dependencies,
    parsed.data.userId,
    now,
  );
  if (
    target === null ||
    dutiesConflict(target.duties, parsed.data.duty as AdminDutyV2)
  ) {
    return adminFailure("CONFLICT");
  }
  const payload = Object.freeze({
    version: "CAPABILITY_GRANT_V1" as const,
    userId: parsed.data.userId,
    capability: parsed.data.capability,
    duty: parsed.data.duty,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
  });
  return createApprovalRequest(dependencies, now, {
    kind: "DIRECT_CAPABILITY_GRANT",
    duty: parsed.data.duty,
    targetType: "ADMIN_CAPABILITY_GRANT",
    targetId: parsed.data.userId,
    reasonCode: parsed.data.reasonCode,
    payload,
    action: "ADMIN_CAPABILITY_GRANT_REQUESTED",
    capability: "ADMIN_SECURITY_GRANT",
  });
}

export async function approveAdminCapabilityGrant(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ grantId: string }>> {
  const parsed = approvalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_APPROVE"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const approval = await lockPendingApproval(
          transaction,
          parsed.data.approvalId,
          "DIRECT_CAPABILITY_GRANT",
          dependencies.actor.userId,
          now,
        );
        if (approval === null) return adminFailure("CONFLICT");
        const payload = capabilityPayloadSchema.safeParse(
          approval.requestPayload,
        );
        if (
          !payload.success ||
          payload.data.duty !== approval.duty ||
          !ADMIN_CAPABILITIES_V1.includes(payload.data.capability)
        ) {
          return adminFailure("CONFLICT");
        }
        const target = await resolveAdminActor(
          transaction,
          await loadAdminTarget(transaction, payload.data.userId),
          now,
        );
        if (
          target.role !== "ADMIN" ||
          target.status !== "ACTIVE" ||
          dutiesConflict(target.duties, payload.data.duty as AdminDutyV2)
        ) {
          return adminFailure("CONFLICT");
        }
        const grantId = randomUUID();
        await transaction.adminCapabilityGrant.create({
          data: {
            id: grantId,
            userId: payload.data.userId,
            capability: payload.data.capability,
            duty: payload.data.duty,
            grantedByUserId: dependencies.actor.userId,
            approvalId: approval.id,
            reasonCode: approval.reasonCode,
            validFrom: new Date(payload.data.validFrom),
            validTo: new Date(payload.data.validTo),
            createdAt: now,
          },
          select: { id: true },
        });
        await consumeApproval(
          transaction,
          approval.id,
          dependencies.actor.userId,
          now,
        );
        await writeAdminAudit(transaction, dependencies, now, {
          action: "ADMIN_CAPABILITY_GRANT_APPROVED",
          capability: "ADMIN_SECURITY_APPROVE",
          targetType: "ADMIN_CAPABILITY_GRANT",
          targetId: grantId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ grantId });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function revokeAdminCapabilityGrant(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ grantId: string }>> {
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_GRANT"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const grant = await transaction.adminCapabilityGrant.findFirst({
          where: { id: parsed.data.id, revokedAt: null },
          select: { id: true, userId: true },
        });
        if (grant === null) return adminFailure("NOT_FOUND");
        if (grant.userId === dependencies.actor.userId) {
          return adminFailure("FORBIDDEN");
        }
        const changed = await transaction.adminCapabilityGrant.updateMany({
          where: { id: grant.id, revokedAt: null },
          data: {
            revokedAt: now,
            revokedByUserId: dependencies.actor.userId,
            reasonCode: parsed.data.reasonCode,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        await revokeUserSecurityState(transaction, grant.userId, now);
        await writeAdminAudit(transaction, dependencies, now, {
          action: "ADMIN_CAPABILITY_GRANT_REVOKED",
          capability: "ADMIN_SECURITY_GRANT",
          targetType: "ADMIN_CAPABILITY_GRANT",
          targetId: grant.id,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ grantId: grant.id });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function requestAuthenticatorReset(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ approvalId: string }>> {
  const parsed = authenticatorResetRequestSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_AUTHENTICATOR_RESET"))) {
    return adminFailure("FORBIDDEN");
  }
  if (parsed.data.userId === dependencies.actor.userId) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const target = await requireEligibleAdminTarget(
    dependencies,
    parsed.data.userId,
    now,
  );
  if (target === null) return adminFailure("NOT_FOUND");
  return createApprovalRequest(dependencies, now, {
    kind: "AUTHENTICATOR_RESET",
    duty: "SECURITY",
    targetType: "AUTHENTICATOR",
    targetId: parsed.data.userId,
    reasonCode: parsed.data.reasonCode,
    payload: {
      version: "AUTHENTICATOR_RESET_V1",
      userId: parsed.data.userId,
    },
    action: "AUTHENTICATOR_RESET_REQUESTED",
    capability: "ADMIN_AUTHENTICATOR_RESET",
  });
}

export async function approveAuthenticatorReset(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ userId: string; revokedFactors: number }>> {
  const parsed = approvalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_SECURITY_APPROVE"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const approval = await lockPendingApproval(
          transaction,
          parsed.data.approvalId,
          "AUTHENTICATOR_RESET",
          dependencies.actor.userId,
          now,
        );
        if (approval === null) return adminFailure("CONFLICT");
        const payload = resetPayloadSchema.safeParse(approval.requestPayload);
        if (!payload.success) return adminFailure("CONFLICT");
        const target = await loadAdminTarget(transaction, payload.data.userId);
        if (target.role !== "ADMIN" || target.status !== "ACTIVE") {
          return adminFailure("CONFLICT");
        }
        const factors = await transaction.authenticator.findMany({
          where: {
            userId: payload.data.userId,
            status: { in: ["ACTIVE", "PENDING"] },
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        await transaction.authenticator.updateMany({
          where: {
            userId: payload.data.userId,
            status: { in: ["ACTIVE", "PENDING"] },
          },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revokedByUserId: dependencies.actor.userId,
            updatedAt: now,
          },
        });
        await transaction.recoveryCode.updateMany({
          where: {
            userId: payload.data.userId,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        await transaction.authenticatorChallenge.updateMany({
          where: { userId: payload.data.userId, status: "PENDING" },
          data: { status: "REVOKED", cancelledAt: now },
        });
        await revokeUserSecurityState(transaction, payload.data.userId, now);
        for (const factor of factors) {
          await transaction.authenticatorEvent.create({
            data: {
              authenticatorId: factor.id,
              actorUserId: dependencies.actor.userId,
              kind: "ADMIN_RESET",
              reasonCode: approval.reasonCode,
              correlationId: dependencies.correlationId,
              createdAt: now,
            },
            select: { id: true },
          });
        }
        await consumeApproval(
          transaction,
          approval.id,
          dependencies.actor.userId,
          now,
        );
        await writeAdminAudit(transaction, dependencies, now, {
          action: "AUTHENTICATOR_RESET_APPROVED",
          capability: "ADMIN_AUTHENTICATOR_RESET",
          targetType: "USER",
          targetId: payload.data.userId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({
          userId: payload.data.userId,
          revokedFactors: factors.length,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function requestBreakGlassGrant(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ approvalId: string }>> {
  const parsed = requestBreakGlassSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (
    !dependencies.environment.BREAK_GLASS_ENABLED ||
    !(await canMutateSecurity(dependencies, "ADMIN_BREAK_GLASS_MANAGE"))
  ) {
    return adminFailure("FORBIDDEN");
  }
  if (parsed.data.userId === dependencies.actor.userId) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const validTo = new Date(parsed.data.validTo);
  if (!boundedWindow(now, validTo, now, MAX_BREAK_GLASS_TTL_MS)) {
    return adminFailure("INVALID_INPUT");
  }
  const target = await requireEligibleAdminTarget(
    dependencies,
    parsed.data.userId,
    now,
  );
  if (target === null) return adminFailure("NOT_FOUND");
  const capabilities = [...new Set(parsed.data.capabilities)].sort();
  if (capabilities.length !== parsed.data.capabilities.length) {
    return adminFailure("INVALID_INPUT");
  }
  return createApprovalRequest(dependencies, now, {
    kind: "BREAK_GLASS",
    duty: "SECURITY",
    targetType: "BREAK_GLASS_GRANT",
    targetId: parsed.data.userId,
    reasonCode: parsed.data.reasonCode,
    payload: {
      version: "BREAK_GLASS_V1",
      userId: parsed.data.userId,
      capabilities,
      incidentReference: parsed.data.incidentReference,
      validFrom: now.toISOString(),
      validTo: validTo.toISOString(),
    },
    action: "BREAK_GLASS_REQUESTED",
    capability: "ADMIN_BREAK_GLASS_MANAGE",
  });
}

export async function approveBreakGlassGrant(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ grantId: string; validTo: Date }>> {
  const parsed = approvalSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (
    !dependencies.environment.BREAK_GLASS_ENABLED ||
    !(await canMutateSecurity(dependencies, "ADMIN_SECURITY_APPROVE"))
  ) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const approval = await lockPendingApproval(
          transaction,
          parsed.data.approvalId,
          "BREAK_GLASS",
          dependencies.actor.userId,
          now,
        );
        if (approval === null) return adminFailure("CONFLICT");
        const payload = breakGlassPayloadSchema.safeParse(
          approval.requestPayload,
        );
        if (!payload.success) return adminFailure("CONFLICT");
        const validFrom = new Date(payload.data.validFrom);
        const validTo = new Date(payload.data.validTo);
        if (
          !boundedWindow(
            validFrom,
            validTo,
            validFrom,
            MAX_BREAK_GLASS_TTL_MS,
          ) ||
          validTo <= now
        ) {
          return adminFailure("CONFLICT");
        }
        const target = await loadAdminTarget(transaction, payload.data.userId);
        if (target.role !== "ADMIN" || target.status !== "ACTIVE") {
          return adminFailure("CONFLICT");
        }
        const grantId = randomUUID();
        const alertDedupeKey = `break-glass:${grantId}`;
        await transaction.breakGlassGrant.create({
          data: {
            id: grantId,
            approvalId: approval.id,
            userId: payload.data.userId,
            requestedByUserId: approval.requestedByUserId,
            approvedByUserId: dependencies.actor.userId,
            status: "ACTIVE",
            incidentReference: payload.data.incidentReference,
            reasonCode: approval.reasonCode,
            capabilities: payload.data.capabilities,
            validFrom,
            validTo,
            alertDedupeKey,
            createdAt: now,
          },
          select: { id: true },
        });
        await transaction.systemTask.create({
          data: {
            kind: "SECURITY_INCIDENT",
            reasonCode: "BREAK_GLASS_ACTIVATED",
            policyVersion: ADMIN_GRANTS_POLICY_V2,
            evidenceReference: `break-glass:${grantId}`,
            dueAt: now,
            status: "OPEN",
            idempotencyKey: alertDedupeKey,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        await consumeApproval(
          transaction,
          approval.id,
          dependencies.actor.userId,
          now,
        );
        await writeAdminAudit(transaction, dependencies, now, {
          action: "BREAK_GLASS_ACTIVATED",
          capability: "ADMIN_SECURITY_APPROVE",
          targetType: "BREAK_GLASS_GRANT",
          targetId: grantId,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ grantId, validTo });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function revokeBreakGlassGrant(
  raw: unknown,
  dependencies: AdminSecurityDependencies,
): Promise<AdminCommandResult<{ grantId: string }>> {
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await canMutateSecurity(dependencies, "ADMIN_BREAK_GLASS_MANAGE"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const grant = await transaction.breakGlassGrant.findFirst({
          where: {
            id: parsed.data.id,
            status: "ACTIVE",
            revokedAt: null,
          },
          select: { id: true, userId: true },
        });
        if (grant === null) return adminFailure("NOT_FOUND");
        const changed = await transaction.breakGlassGrant.updateMany({
          where: {
            id: grant.id,
            status: "ACTIVE",
            revokedAt: null,
          },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revokedByUserId: dependencies.actor.userId,
            reasonCode: parsed.data.reasonCode,
          },
        });
        if (changed.count !== 1) return adminFailure("CONFLICT");
        await revokeUserSecurityState(transaction, grant.userId, now);
        await writeAdminAudit(transaction, dependencies, now, {
          action: "BREAK_GLASS_REVOKED",
          capability: "ADMIN_BREAK_GLASS_MANAGE",
          targetType: "BREAK_GLASS_GRANT",
          targetId: grant.id,
          reasonCode: parsed.data.reasonCode,
        });
        return adminSuccess({ grantId: grant.id });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function projectExpiredSecurityGrants(
  dependencies: AdminSecurityDependencies,
): Promise<
  AdminCommandResult<{
    approvals: number;
    breakGlass: number;
    sessionsRevoked: number;
  }>
> {
  if (!(await canMutateSecurity(dependencies, "ADMIN_BREAK_GLASS_MANAGE"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const expired = await transaction.breakGlassGrant.findMany({
          where: {
            status: "ACTIVE",
            revokedAt: null,
            validTo: { lte: now },
          },
          orderBy: { id: "asc" },
          select: { id: true, userId: true },
        });
        const approvalResult = await transaction.privilegedApproval.updateMany({
          where: { status: "PENDING", expiresAt: { lte: now } },
          data: { status: "EXPIRED", decidedAt: now },
        });
        let sessionsRevoked = 0;
        for (const grant of expired) {
          await transaction.breakGlassGrant.update({
            where: { id: grant.id },
            data: {
              status: "EXPIRED",
              revokedAt: now,
              reasonCode: "BREAK_GLASS_TTL_EXPIRED",
            },
            select: { id: true },
          });
          sessionsRevoked += await revokeUserSecurityState(
            transaction,
            grant.userId,
            now,
          );
          await writeAdminAudit(transaction, dependencies, now, {
            action: "BREAK_GLASS_REVOKED",
            capability: "ADMIN_BREAK_GLASS_MANAGE",
            targetType: "BREAK_GLASS_GRANT",
            targetId: grant.id,
            reasonCode: "BREAK_GLASS_TTL_EXPIRED",
          });
        }
        return adminSuccess({
          approvals: approvalResult.count,
          breakGlass: expired.length,
          sessionsRevoked,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return adminErrorResult(error);
  }
}

async function canMutateSecurity(
  dependencies: AdminSecurityDependencies,
  capability: AdminCapability,
): Promise<boolean> {
  return (
    (await requireCapability(dependencies, capability)) &&
    (await hasCurrentAal2(dependencies.database, {
      userId: dependencies.actor.userId,
      sessionId: dependencies.actor.sessionId,
      now: adminNow(dependencies.now),
    }))
  );
}

async function requireEligibleAdminTarget(
  dependencies: AdminSecurityDependencies,
  userId: string,
  now: Date,
) {
  try {
    const actor = await loadAdminTarget(dependencies.database, userId);
    if (actor.role !== "ADMIN" || actor.status !== "ACTIVE") return null;
    return resolveAdminActor(dependencies.database, actor, now);
  } catch {
    return null;
  }
}

async function loadAdminTarget(
  database: Pick<
    Prisma.TransactionClient,
    "user"
  >,
  userId: string,
) {
  return database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  }).then((user) => ({
    userId: user.id,
    role: user.role,
    status: user.status,
  }));
}

async function createApprovalRequest(
  dependencies: AdminSecurityDependencies,
  now: Date,
  input: Readonly<{
    kind:
      | "ROLE_ASSIGNMENT"
      | "DIRECT_CAPABILITY_GRANT"
      | "AUTHENTICATOR_RESET"
      | "BREAK_GLASS";
    duty: AdminDutyV2;
    targetType: string;
    targetId: string;
    reasonCode: string;
    payload: Readonly<Record<string, unknown>>;
    action:
      | "ADMIN_ROLE_ASSIGNMENT_REQUESTED"
      | "ADMIN_CAPABILITY_GRANT_REQUESTED"
      | "AUTHENTICATOR_RESET_REQUESTED"
      | "BREAK_GLASS_REQUESTED";
    capability:
      | "ADMIN_SECURITY_GRANT"
      | "ADMIN_AUTHENTICATOR_RESET"
      | "ADMIN_BREAK_GLASS_MANAGE";
  }>,
): Promise<AdminCommandResult<{ approvalId: string }>> {
  const approvalId = randomUUID();
  try {
    await dependencies.database.$transaction(async (transaction) => {
      await transaction.privilegedApproval.create({
        data: {
          id: approvalId,
          kind: input.kind,
          status: "PENDING",
          requestedByUserId: dependencies.actor.userId,
          targetType: input.targetType,
          targetId: input.targetId,
          duty: input.duty,
          reasonCode: input.reasonCode,
          evidenceDigest: evidenceDigest({
            ...input.payload,
            requestedByUserId: dependencies.actor.userId,
            reasonCode: input.reasonCode,
          }),
          requestPayload: input.payload as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
          createdAt: now,
        },
        select: { id: true },
      });
      await writeAdminAudit(transaction, dependencies, now, {
        action: input.action,
        capability: input.capability,
        targetType:
          input.kind === "ROLE_ASSIGNMENT"
            ? "ADMIN_ROLE_ASSIGNMENT"
            : input.kind === "DIRECT_CAPABILITY_GRANT"
              ? "ADMIN_CAPABILITY_GRANT"
              : input.kind === "BREAK_GLASS"
                ? "BREAK_GLASS_GRANT"
                : "AUTHENTICATOR",
        targetId: approvalId,
        reasonCode: input.reasonCode,
      });
    });
    return adminSuccess({ approvalId });
  } catch (error) {
    return adminErrorResult(error);
  }
}

async function lockPendingApproval(
  transaction: Prisma.TransactionClient,
  id: string,
  kind:
    | "ROLE_ASSIGNMENT"
    | "DIRECT_CAPABILITY_GRANT"
    | "AUTHENTICATOR_RESET"
    | "BREAK_GLASS",
  approverUserId: string,
  now: Date,
) {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "PrivilegedApproval"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  return transaction.privilegedApproval.findFirst({
    where: {
      id,
      kind,
      status: "PENDING",
      requestedByUserId: { not: approverUserId },
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      requestedByUserId: true,
      duty: true,
      reasonCode: true,
      requestPayload: true,
    },
  });
}

async function consumeApproval(
  transaction: Prisma.TransactionClient,
  id: string,
  approverUserId: string,
  now: Date,
) {
  const changed = await transaction.privilegedApproval.updateMany({
    where: {
      id,
      status: "PENDING",
      requestedByUserId: { not: approverUserId },
      expiresAt: { gt: now },
    },
    data: {
      status: "CONSUMED",
      approvedByUserId: approverUserId,
      decidedAt: now,
      consumedAt: now,
    },
  });
  if (changed.count !== 1) throw new Error("APPROVAL_CONFLICT");
}

async function revokeUserSecurityState(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<number> {
  const sessions = await transaction.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await Promise.all([
    transaction.sessionAssurance.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    transaction.authAssuranceEvidence.updateMany({
      where: { userId, revokedAt: null, usedAt: null },
      data: { revokedAt: now },
    }),
    transaction.stepUpChallenge.updateMany({
      where: { userId, status: "PENDING" },
      data: { status: "REVOKED", cancelledAt: now },
    }),
  ]);
  return sessions.count;
}

function boundedWindow(
  validFrom: Date,
  validTo: Date,
  now: Date,
  maximumTtl: number,
): boolean {
  return (
    Number.isFinite(validFrom.getTime()) &&
    Number.isFinite(validTo.getTime()) &&
    validFrom >= new Date(now.getTime() - 60_000) &&
    validTo.getTime() - validFrom.getTime() >= MIN_GRANT_TTL_MS &&
    validTo.getTime() - validFrom.getTime() <= maximumTtl
  );
}

function evidenceDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function safeApprovalSummary(value: Prisma.JsonValue) {
  const role = rolePayloadSchema.safeParse(value);
  if (role.success) {
    return Object.freeze({
      kind: "ROLE_ASSIGNMENT",
      userId: role.data.userId,
      roleCode: role.data.roleCode,
      validTo: role.data.validTo,
    });
  }
  const capability = capabilityPayloadSchema.safeParse(value);
  if (capability.success) {
    return Object.freeze({
      kind: "DIRECT_CAPABILITY_GRANT",
      userId: capability.data.userId,
      capability: capability.data.capability,
      duty: capability.data.duty,
      validTo: capability.data.validTo,
    });
  }
  const breakGlass = breakGlassPayloadSchema.safeParse(value);
  if (breakGlass.success) {
    return Object.freeze({
      kind: "BREAK_GLASS",
      userId: breakGlass.data.userId,
      capabilities: breakGlass.data.capabilities,
      incidentReference: breakGlass.data.incidentReference,
      validTo: breakGlass.data.validTo,
    });
  }
  const reset = resetPayloadSchema.safeParse(value);
  if (reset.success) {
    return Object.freeze({
      kind: "AUTHENTICATOR_RESET",
      userId: reset.data.userId,
    });
  }
  return Object.freeze({ kind: "INVALID" });
}
