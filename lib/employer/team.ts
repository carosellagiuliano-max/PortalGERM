import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { hashPassword, PASSWORD_HASH_POLICY_V1 } from "@/lib/auth/password";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { issueSession } from "@/lib/auth/session-issuance";
import {
  getEffectiveEntitlements,
} from "@/lib/billing/entitlements";
import { canAddRecruiterSeat } from "@/lib/billing/feature-gates";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { passwordSchema } from "@/lib/validation/auth";
import {
  createRegistrationMarketingConsent,
  createRegistrationTermsConsent,
} from "@/lib/auth/registration-consent";
import { trimmedString } from "@/lib/validation/common";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

const DAY = 86_400_000;
const AUDIT_TTL = 365 * DAY;
const INVITATION_TTL = 7 * DAY;
const INVITATION_TRANSACTION_MAX_ATTEMPTS = 3;
const membershipRoles = ["OWNER", "ADMIN", "RECRUITER", "VIEWER"] as const;
const assignmentRoles = ["EDITOR", "REVIEWER", "PIPELINE"] as const;

export const teamInvitationSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(membershipRoles),
});
export const membershipRoleSchema = z.strictObject({
  membershipId: z.uuid(),
  role: z.enum(membershipRoles),
});
export const removeMembershipSchema = z.strictObject({
  membershipId: z.uuid(),
  reason: trimmedString(3, 500),
});
export const assignmentSchema = z.strictObject({
  jobId: z.uuid(),
  membershipId: z.uuid(),
  role: z.enum(assignmentRoles),
  expiresAt: z.coerce.date().optional(),
});
const invitationRegistrationSchema = z.strictObject({
  name: trimmedString(2, 160),
  email: z.string().trim().toLowerCase().email().max(320),
  password: passwordSchema,
  acceptedTerms: z.literal(true),
  marketingConsent: z.boolean(),
});

type Actor = Readonly<{
  userId: string;
  membershipId: string;
  role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;
type CommandDependencies = Readonly<{
  database: DatabaseClient;
  request: AuthRequestContext;
  environment: ServerEnvironment;
  emailProvider?: EmailProvider;
  now?: Date;
}>;
type CommandResult<T extends object | void = void> =
  | (T extends object ? Readonly<{ ok: true } & T> : Readonly<{ ok: true }>)
  | Readonly<{ ok: false; code: string; suggestedPlanSlug?: string }>;
type LockedInvitation = Readonly<{
  id: string;
  companyId: string;
  inviteeEmailNormalized: string;
  intendedRole: string;
  status: string;
  expiresAt: Date;
}>;

export async function getEmployerTeam(
  companyId: string,
  actor: Actor,
  database: DatabaseClient,
  now = new Date(),
) {
  const companyScope: Prisma.CompanyWhereInput = {
    id: companyId,
    status: { in: ["DRAFT", "ACTIVE"] },
    memberships: {
      some: {
        id: actor.membershipId,
        userId: actor.userId,
        status: "ACTIVE",
        role: { in: ["OWNER", "ADMIN"] },
      },
    },
  };
  return database.$transaction(async (tx) => {
    const authorized = await tx.company.findFirst({
      where: companyScope,
      select: { id: true },
    });
    if (authorized === null) return null;
    const [memberships, invitations, assignments, jobs] = await Promise.all([
      tx.companyMembership.findMany({
        where: {
          companyId,
          status: { in: ["ACTIVE", "SUSPENDED"] },
          company: companyScope,
        },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }, { id: "asc" }],
        select: {
          id: true, role: true, status: true, joinedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      tx.companyInvitation.findMany({
        where: {
          companyId,
          status: "PENDING",
          expiresAt: { gt: now },
          company: companyScope,
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        select: { id: true, inviteeEmailNormalized: true, intendedRole: true, tokenVersion: true, expiresAt: true },
      }),
      tx.jobAssignment.findMany({
        where: {
          companyId,
          status: "ACTIVE",
          validFrom: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          company: companyScope,
        },
        orderBy: [{ job: { createdAt: "desc" } }, { id: "asc" }],
        select: {
          id: true, role: true, expiresAt: true,
          membership: { select: { id: true, user: { select: { name: true, email: true } } } },
          job: { select: { id: true, currentRevision: { select: { title: true } } } },
        },
      }),
      tx.job.findMany({
        where: {
          companyId,
          status: { not: "REMOVED" },
          company: companyScope,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { id: true, currentRevision: { select: { title: true } } },
      }),
    ]);
    return Object.freeze({ memberships, invitations, assignments, jobs });
  }, { isolationLevel: "RepeatableRead" });
}

export async function sendCompanyInvitation(
  companyId: string,
  actor: Actor,
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CommandResult<{ invitationId: string; emailRecorded: boolean }>> {
  const parsed = teamInvitationSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(rawToken);
  let committed:
    | { id: string; companyName: string; inviterName: string; version: number }
    | undefined;
  for (
    let attempt = 1;
    attempt <= INVITATION_TRANSACTION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const result = await dependencies.database.$transaction(async (tx) => {
        await lockCompany(tx, companyId);
        const access = await loadTeamManager(tx, companyId, actor.userId);
        if (access === null) return { ok: false as const, code: "NOT_FOUND" };
        if (parsed.data.role === "OWNER" && access.role !== "OWNER") {
          return { ok: false as const, code: "OWNER_REQUIRED" };
        }
        if (access.company.status !== "ACTIVE") return { ok: false as const, code: "COMPANY_INACTIVE" };
        await expireCompanyInvitations(tx, companyId, now, dependencies.request.correlationId);
        const duplicate = await tx.companyInvitation.findFirst({
          where: { companyId, inviteeEmailNormalized: parsed.data.email, status: "PENDING", expiresAt: { gt: now } },
          select: { id: true },
        });
        if (duplicate !== null) return { ok: false as const, code: "DUPLICATE" };
        const existing = await tx.user.findUnique({
          where: { emailNormalized: parsed.data.email },
          select: { companyMemberships: { where: { companyId, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { id: true }, take: 1 } },
        });
        if ((existing?.companyMemberships.length ?? 0) > 0) return { ok: false as const, code: "ALREADY_MEMBER" };
        const entitlements = await getEffectiveEntitlements(companyId, now, createPrismaEntitlementRepository(tx));
        if (!entitlements.ok) return { ok: false as const, code: "ENTITLEMENT_UNAVAILABLE" };
        const seats = await countReservedSeats(tx, companyId, now);
        const seatGate = canAddRecruiterSeat({
          effectiveEntitlements: entitlements.value,
          currentSeatCount: seats,
        });
        if (!seatGate.allowed) {
          return {
            ok: false as const,
            code: seatGate.reason === "SEAT_LIMIT_REACHED"
              ? "SEAT_LIMIT"
              : "ENTITLEMENT_UNAVAILABLE",
            ...(seatGate.suggestedPlanSlug === undefined
              ? {}
              : { suggestedPlanSlug: seatGate.suggestedPlanSlug }),
          };
        }
        const invitation = await tx.companyInvitation.create({
          data: {
            companyId, inviterUserId: actor.userId,
            inviteeEmailNormalized: parsed.data.email,
            intendedRole: parsed.data.role,
            tokenHash, tokenVersion: 1, status: "PENDING",
            expiresAt: new Date(now.getTime() + INVITATION_TTL),
            createdAt: now,
            events: { create: { kind: "CREATED", actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now } },
          },
          select: { id: true, tokenVersion: true },
        });
        await writeTeamAudit(tx, "INVITATION_SENT", actor.userId, companyId, invitation.id, "INVITATION", "COMPANY_TEAM_INVITE", dependencies.request, now);
        return { ok: true as const, value: { id: invitation.id, companyName: access.company.name, inviterName: access.user.name ?? "Ein Teammitglied", version: invitation.tokenVersion } };
      }, { isolationLevel: "Serializable" });
      if (!result.ok) return result;
      committed = result.value;
      break;
    } catch (error) {
      if (
        attempt < INVITATION_TRANSACTION_MAX_ATTEMPTS &&
        isRetryableTransactionError(error)
      ) {
        continue;
      }
      return { ok: false, code: isUniqueError(error) ? "DUPLICATE" : "WRITE_FAILED" };
    }
  }
  if (committed === undefined) {
    return { ok: false, code: "WRITE_FAILED" };
  }
  const emailRecorded = await sendInvitationEmail(dependencies, parsed.data.email, rawToken, committed);
  return { ok: true, invitationId: committed.id, emailRecorded };
}

export async function resendCompanyInvitation(
  companyId: string,
  actor: Actor,
  invitationId: string,
  dependencies: CommandDependencies,
): Promise<CommandResult<{ invitationId: string; emailRecorded: boolean }>> {
  if (!z.uuid().safeParse(invitationId).success) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  const rawToken = randomBytes(32).toString("base64url");
  let committed: { id: string; email: string; companyName: string; inviterName: string; version: number };
  try {
    const result = await runInvitationTransaction(dependencies.database, async (tx) => {
      await lockCompany(tx, companyId);
      const access = await loadTeamManager(tx, companyId, actor.userId);
      if (access === null || access.company.status !== "ACTIVE") return { ok: false as const, code: "NOT_FOUND" };
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; expiresAt: Date; inviteeEmailNormalized: string }>>`
        SELECT "id", "status"::text, "expiresAt", "inviteeEmailNormalized" FROM "CompanyInvitation"
        WHERE "id" = ${invitationId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE
      `;
      const invitation = rows[0];
      if (invitation === undefined || invitation.status !== "PENDING" || invitation.expiresAt.getTime() <= now.getTime()) {
        return { ok: false as const, code: "NOT_FOUND" };
      }
      const entitlements = await getEffectiveEntitlements(companyId, now, createPrismaEntitlementRepository(tx));
      if (!entitlements.ok) return { ok: false as const, code: "ENTITLEMENT_UNAVAILABLE" };
      const seatGate = canAddRecruiterSeat({
        effectiveEntitlements: entitlements.value,
        currentSeatCount: Math.max(
          0,
          (await countReservedSeats(tx, companyId, now)) - 1,
        ),
      });
      if (!seatGate.allowed) {
        return {
          ok: false as const,
          code: seatGate.reason === "SEAT_LIMIT_REACHED"
            ? "SEAT_LIMIT"
            : "ENTITLEMENT_UNAVAILABLE",
          ...(seatGate.suggestedPlanSlug === undefined
            ? {}
            : { suggestedPlanSlug: seatGate.suggestedPlanSlug }),
        };
      }
      const updated = await tx.companyInvitation.update({
        where: { id: invitation.id },
        data: { tokenHash: hashInvitationToken(rawToken), tokenVersion: { increment: 1 }, expiresAt: new Date(now.getTime() + INVITATION_TTL), updatedAt: now },
        select: { id: true, tokenVersion: true },
      });
      await tx.companyInvitationEvent.create({ data: { invitationId: invitation.id, kind: "RESENT", actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now } });
      await writeTeamAudit(tx, "INVITATION_SENT", actor.userId, companyId, invitation.id, "INVITATION", "COMPANY_TEAM_INVITE_RESEND", dependencies.request, now);
      return { ok: true as const, value: { id: updated.id, email: invitation.inviteeEmailNormalized, companyName: access.company.name, inviterName: access.user.name ?? "Ein Teammitglied", version: updated.tokenVersion } };
    });
    if (!result.ok) return result;
    committed = result.value;
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
  const emailRecorded = await sendInvitationEmail(dependencies, committed.email, rawToken, committed);
  return { ok: true, invitationId: committed.id, emailRecorded };
}

export async function revokeCompanyInvitation(
  companyId: string,
  actor: Actor,
  invitationId: string,
  dependencies: CommandDependencies,
): Promise<CommandResult> {
  if (!z.uuid().safeParse(invitationId).success) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  try {
    return await runInvitationTransaction(dependencies.database, async (tx) => {
      await lockCompany(tx, companyId);
      if (await loadTeamManager(tx, companyId, actor.userId) === null) return { ok: false as const, code: "NOT_FOUND" };
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT "id", "status"::text FROM "CompanyInvitation"
        WHERE "id" = ${invitationId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE
      `;
      const invitation = rows[0];
      if (invitation === undefined || invitation.status !== "PENDING") return { ok: false as const, code: "NOT_FOUND" };
      await tx.companyInvitation.update({
        where: { id: invitation.id },
        data: { status: "REVOKED", revokedAt: now, updatedAt: now },
      });
      await tx.companyInvitationEvent.create({ data: { invitationId, kind: "REVOKED", actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now } });
      await writeTeamAudit(tx, "INVITATION_REVOKED", actor.userId, companyId, invitationId, "INVITATION", "COMPANY_TEAM_INVITE_REVOKE", dependencies.request, now);
      return { ok: true as const };
    });
  } catch { return { ok: false, code: "WRITE_FAILED" }; }
}

export async function changeCompanyMemberRole(
  companyId: string,
  actor: Actor,
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CommandResult> {
  const parsed = membershipRoleSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  try {
    const result = await dependencies.database.$transaction(async (tx) => {
      await lockCompany(tx, companyId);
      const manager = await loadTeamManager(tx, companyId, actor.userId);
      if (manager === null) return { ok: false as const, code: "NOT_FOUND" };
      const target = await tx.companyMembership.findFirst({ where: { id: parsed.data.membershipId, companyId, status: "ACTIVE" }, select: { id: true, role: true, userId: true } });
      if (target === null) return { ok: false as const, code: "NOT_FOUND" };
      if ((target.role === "OWNER" || parsed.data.role === "OWNER") && manager.role !== "OWNER") return { ok: false as const, code: "OWNER_REQUIRED" };
      if (target.role === "OWNER" && parsed.data.role !== "OWNER" && await activeOwnerCount(tx, companyId) <= 1) return { ok: false as const, code: "LAST_OWNER" };
      if (
        target.role === "OWNER" &&
        parsed.data.role !== "OWNER" &&
        await isPendingBoundaryRetainedOwner(tx, companyId, target.id, target.userId)
      ) return { ok: false as const, code: "RETAINED_OWNER_REQUIRED" };
      if (target.role === parsed.data.role) {
        const replayEvent = await tx.companyMembershipEvent.findFirst({
          where: {
            membershipId: target.id,
            kind: "ROLE_CHANGED",
            toRole: parsed.data.role,
            actorUserId: actor.userId,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        return {
          ok: true as const,
          recipientUserId: replayEvent === null ? null : target.userId,
          notificationEventId: replayEvent?.id ?? null,
        };
      }
      if (target.role === "RECRUITER" && parsed.data.role !== "RECRUITER") {
        const assignments = await tx.jobAssignment.findMany({
          where: { membershipId: target.id, companyId, status: "ACTIVE" },
          select: { id: true, role: true },
        });
        for (const assignment of assignments) {
          await tx.jobAssignment.update({
            where: { id: assignment.id },
            data: { status: "REVOKED", revokedAt: now, updatedAt: now },
          });
          await tx.jobAssignmentEvent.create({
            data: {
              jobAssignmentId: assignment.id,
              kind: "REVOKED",
              fromRole: assignment.role,
              actorUserId: actor.userId,
              reasonCode: "MEMBERSHIP_ROLE_CHANGED",
              correlationId: dependencies.request.correlationId,
              createdAt: now,
            },
          });
          await writeTeamAudit(tx, "JOB_ASSIGNMENT_REVOKED", actor.userId, companyId, assignment.id, "JOB_ASSIGNMENT", "COMPANY_JOB_ASSIGN_REVOKE", dependencies.request, now, "MEMBERSHIP_ROLE_CHANGED");
        }
      }
      await tx.companyMembership.update({ where: { id: target.id }, data: { role: parsed.data.role, updatedAt: now } });
      const notificationEvent = await tx.companyMembershipEvent.create({ data: { membershipId: target.id, kind: "ROLE_CHANGED", fromRole: target.role, toRole: parsed.data.role, actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now }, select: { id: true } });
      await writeTeamAudit(tx, "MEMBERSHIP_ROLE_CHANGED", actor.userId, companyId, target.id, "MEMBERSHIP", "COMPANY_TEAM_ROLE_CHANGE", dependencies.request, now);
      return { ok: true as const, recipientUserId: target.userId, notificationEventId: notificationEvent.id };
    });
    if (!result.ok) return result;
    if (result.recipientUserId !== null && result.notificationEventId !== null) {
      await notifyMembership(dependencies.database, result.recipientUserId, parsed.data.membershipId, "ACTIVE", `membership-event:${result.notificationEventId}`, "ROLE_CHANGED");
    }
    return { ok: true };
  } catch { return { ok: false, code: "WRITE_FAILED" }; }
}

export async function removeCompanyMember(
  companyId: string,
  actor: Actor,
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CommandResult> {
  const parsed = removeMembershipSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  if (parsed.data.membershipId === actor.membershipId) return { ok: false, code: "SELF_REMOVAL" };
  const now = dependencies.now ?? new Date();
  try {
    const result = await dependencies.database.$transaction(async (tx) => {
      await lockCompany(tx, companyId);
      const manager = await loadTeamManager(tx, companyId, actor.userId);
      if (manager === null) return { ok: false as const, code: "NOT_FOUND" };
      const target = await tx.companyMembership.findFirst({ where: { id: parsed.data.membershipId, companyId }, select: { id: true, role: true, status: true, userId: true } });
      if (target === null) return { ok: false as const, code: "NOT_FOUND" };
      if (target.status === "REMOVED") {
        const replayEvent = await tx.companyMembershipEvent.findFirst({
          where: {
            membershipId: target.id,
            kind: "REMOVED",
            actorUserId: actor.userId,
            reasonCode: "EXPLICIT_REMOVAL",
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (replayEvent === null) return { ok: false as const, code: "NOT_FOUND" };
        return { ok: true as const, recipientUserId: target.userId, notificationEventId: replayEvent.id };
      }
      if (target.status !== "ACTIVE") return { ok: false as const, code: "NOT_FOUND" };
      if (target.role === "OWNER" && manager.role !== "OWNER") return { ok: false as const, code: "OWNER_REQUIRED" };
      if (target.role === "OWNER" && await activeOwnerCount(tx, companyId) <= 1) return { ok: false as const, code: "LAST_OWNER" };
      if (
        target.role === "OWNER" &&
        await isPendingBoundaryRetainedOwner(tx, companyId, target.id, target.userId)
      ) return { ok: false as const, code: "RETAINED_OWNER_REQUIRED" };
      const assignments = await tx.jobAssignment.findMany({ where: { membershipId: target.id, companyId, status: "ACTIVE" }, select: { id: true, role: true } });
      for (const assignment of assignments) {
        await tx.jobAssignment.update({ where: { id: assignment.id }, data: { status: "REVOKED", revokedAt: now, updatedAt: now } });
        await tx.jobAssignmentEvent.create({ data: { jobAssignmentId: assignment.id, kind: "REVOKED", fromRole: assignment.role, actorUserId: actor.userId, reasonCode: "MEMBERSHIP_REMOVED", correlationId: dependencies.request.correlationId, createdAt: now } });
      }
      await tx.companyMembership.update({ where: { id: target.id }, data: { status: "REMOVED", removedAt: now, updatedAt: now } });
      const notificationEvent = await tx.companyMembershipEvent.create({ data: { membershipId: target.id, kind: "REMOVED", fromRole: target.role, actorUserId: actor.userId, reasonCode: "EXPLICIT_REMOVAL", correlationId: dependencies.request.correlationId, createdAt: now }, select: { id: true } });
      await writeTeamAudit(tx, "MEMBERSHIP_REMOVED", actor.userId, companyId, target.id, "MEMBERSHIP", "COMPANY_TEAM_REMOVE", dependencies.request, now, "EXPLICIT_REMOVAL");
      return { ok: true as const, recipientUserId: target.userId, notificationEventId: notificationEvent.id };
    });
    if (!result.ok) return result;
    await notifyMembership(dependencies.database, result.recipientUserId, parsed.data.membershipId, "REMOVED", `membership-event:${result.notificationEventId}`, "REMOVED");
    return { ok: true };
  } catch { return { ok: false, code: "WRITE_FAILED" }; }
}

export async function assignRecruiterToJob(
  companyId: string,
  actor: Actor,
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CommandResult<{ assignmentId: string }>> {
  const parsed = assignmentSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  if (parsed.data.expiresAt !== undefined && parsed.data.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "INVALID_INPUT" };
  try {
    const result = await dependencies.database.$transaction(async (tx) => {
      await lockCompany(tx, companyId);
      if (await loadTeamManager(tx, companyId, actor.userId) === null) return { ok: false as const, code: "NOT_FOUND" };
      const [job, membership] = await Promise.all([
        tx.job.findFirst({ where: { id: parsed.data.jobId, companyId, status: { not: "REMOVED" } }, select: { id: true } }),
        tx.companyMembership.findFirst({ where: { id: parsed.data.membershipId, companyId, status: "ACTIVE", role: "RECRUITER" }, select: { id: true, userId: true } }),
      ]);
      if (job === null || membership === null) return { ok: false as const, code: "NOT_FOUND" };
      const expiredAssignments = await tx.jobAssignment.findMany({
        where: { jobId: job.id, userId: membership.userId, status: "ACTIVE", expiresAt: { lte: now } },
        select: { id: true, role: true },
      });
      for (const expired of expiredAssignments) {
        await tx.jobAssignment.update({ where: { id: expired.id }, data: { status: "EXPIRED", updatedAt: now } });
        await tx.jobAssignmentEvent.create({
          data: {
            jobAssignmentId: expired.id,
            kind: "EXPIRED",
            fromRole: expired.role,
            actorUserId: actor.userId,
            reasonCode: "TTL_ELAPSED",
            correlationId: dependencies.request.correlationId,
            createdAt: now,
          },
        });
      }
      const existing = await tx.jobAssignment.findFirst({ where: { jobId: job.id, userId: membership.userId, status: "ACTIVE" }, select: { id: true, role: true, expiresAt: true, assignedByUserId: true } });
      let assignmentId: string;
      let notificationEventId: string | null = null;
      if (existing === null) {
        const created = await tx.jobAssignment.create({ data: { membershipId: membership.id, companyId, jobId: job.id, userId: membership.userId, role: parsed.data.role, status: "ACTIVE", assignedByUserId: actor.userId, validFrom: now, expiresAt: parsed.data.expiresAt ?? null, createdAt: now }, select: { id: true } });
        assignmentId = created.id;
        const notificationEvent = await tx.jobAssignmentEvent.create({ data: { jobAssignmentId: created.id, kind: "ASSIGNED", toRole: parsed.data.role, actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now }, select: { id: true } });
        notificationEventId = notificationEvent.id;
      } else {
        assignmentId = existing.id;
        const requestedExpiry = parsed.data.expiresAt ?? null;
        const exactReplay = existing.role === parsed.data.role &&
          existing.assignedByUserId === actor.userId &&
          sameInstant(existing.expiresAt, requestedExpiry);
        if (exactReplay) {
          const replayEvent = await tx.jobAssignmentEvent.findFirst({
            where: {
              jobAssignmentId: existing.id,
              actorUserId: actor.userId,
              toRole: parsed.data.role,
              kind: { in: ["ASSIGNED", "ROLE_CHANGED"] },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          return {
            ok: true as const,
            assignmentId,
            recipientUserId: membership.userId,
            recipientMembershipId: membership.id,
            notificationEventId: replayEvent?.id ?? null,
          };
        }
        await tx.jobAssignment.update({ where: { id: existing.id }, data: { role: parsed.data.role, expiresAt: parsed.data.expiresAt ?? null, assignedByUserId: actor.userId, validFrom: now, updatedAt: now } });
        if (existing.role !== parsed.data.role) {
          const notificationEvent = await tx.jobAssignmentEvent.create({ data: { jobAssignmentId: existing.id, kind: "ROLE_CHANGED", fromRole: existing.role, toRole: parsed.data.role, actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now }, select: { id: true } });
          notificationEventId = notificationEvent.id;
        }
      }
      await writeTeamAudit(tx, "JOB_ASSIGNMENT_CREATED", actor.userId, companyId, assignmentId, "JOB_ASSIGNMENT", "COMPANY_JOB_ASSIGN", dependencies.request, now);
      return { ok: true as const, assignmentId, recipientUserId: membership.userId, recipientMembershipId: membership.id, notificationEventId };
    });
    if (!result.ok) return result;
    if (result.notificationEventId !== null) {
      await notifyMembership(dependencies.database, result.recipientUserId, result.recipientMembershipId, "ACTIVE", `job-assignment-event:${result.notificationEventId}`);
    }
    return { ok: true, assignmentId: result.assignmentId };
  } catch { return { ok: false, code: "WRITE_FAILED" }; }
}

export async function revokeJobAssignment(
  companyId: string,
  actor: Actor,
  assignmentId: string,
  dependencies: CommandDependencies,
): Promise<CommandResult> {
  if (!z.uuid().safeParse(assignmentId).success) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  try {
    const result = await dependencies.database.$transaction(async (tx) => {
      await lockCompany(tx, companyId);
      if (await loadTeamManager(tx, companyId, actor.userId) === null) return { ok: false as const, code: "NOT_FOUND" };
      const assignment = await tx.jobAssignment.findFirst({ where: { id: assignmentId, companyId }, select: { id: true, role: true, status: true, userId: true, membershipId: true } });
      if (assignment === null) return { ok: false as const, code: "NOT_FOUND" };
      if (assignment.status === "REVOKED") {
        const replayEvent = await tx.jobAssignmentEvent.findFirst({
          where: {
            jobAssignmentId: assignment.id,
            kind: "REVOKED",
            actorUserId: actor.userId,
            reasonCode: null,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (replayEvent === null) return { ok: false as const, code: "NOT_FOUND" };
        return {
          ok: true as const,
          recipientUserId: assignment.userId,
          recipientMembershipId: assignment.membershipId,
          notificationEventId: replayEvent.id,
        };
      }
      if (assignment.status !== "ACTIVE") return { ok: false as const, code: "NOT_FOUND" };
      await tx.jobAssignment.update({ where: { id: assignment.id }, data: { status: "REVOKED", revokedAt: now, updatedAt: now } });
      const notificationEvent = await tx.jobAssignmentEvent.create({ data: { jobAssignmentId: assignment.id, kind: "REVOKED", fromRole: assignment.role, actorUserId: actor.userId, correlationId: dependencies.request.correlationId, createdAt: now }, select: { id: true } });
      await writeTeamAudit(tx, "JOB_ASSIGNMENT_REVOKED", actor.userId, companyId, assignment.id, "JOB_ASSIGNMENT", "COMPANY_JOB_ASSIGN_REVOKE", dependencies.request, now);
      return { ok: true as const, recipientUserId: assignment.userId, recipientMembershipId: assignment.membershipId, notificationEventId: notificationEvent.id };
    });
    if (!result.ok) return result;
    await notifyMembership(dependencies.database, result.recipientUserId, result.recipientMembershipId, "ACTIVE", `job-assignment-event:${result.notificationEventId}`);
    return { ok: true };
  } catch { return { ok: false, code: "WRITE_FAILED" }; }
}

export function hashInvitationToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export async function inspectCompanyInvitation(rawToken: string, database: DatabaseClient, user?: Readonly<{ id: string; email: string; role: string }> | null, now = new Date()) {
  if (!isPlausibleToken(rawToken)) return Object.freeze({ state: "INVALID" as const });
  const invitation = await database.companyInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(rawToken) },
    select: { id: true, status: true, expiresAt: true, inviteeEmailNormalized: true, intendedRole: true, company: { select: { name: true, status: true } } },
  });
  if (invitation === null) return Object.freeze({ state: "INVALID" as const });
  if (invitation.status === "ACCEPTED") return Object.freeze({ state: "USED" as const });
  if (invitation.status === "REVOKED") return Object.freeze({ state: "REVOKED" as const });
  if (invitation.status !== "PENDING" || invitation.expiresAt.getTime() <= now.getTime()) return Object.freeze({ state: "EXPIRED" as const });
  if (invitation.company.status !== "ACTIVE") return Object.freeze({ state: "COMPANY_INACTIVE" as const });
  if (user === undefined || user === null) return Object.freeze({ state: "AUTH_REQUIRED" as const });
  if (user.email.trim().toLowerCase() !== invitation.inviteeEmailNormalized) return Object.freeze({ state: "EMAIL_MISMATCH" as const });
  if (user.role !== "EMPLOYER" && user.role !== "RECRUITER") return Object.freeze({ state: "ACCOUNT_TYPE_UNSUPPORTED" as const });
  return Object.freeze({ state: "READY" as const, companyName: invitation.company.name, intendedRole: invitation.intendedRole });
}

export async function acceptCompanyInvitation(rawToken: string, user: Readonly<{ id: string; email: string; role: string }>, dependencies: CommandDependencies): Promise<CommandResult<{ companyId: string; membershipId: string }>> {
  if (!isPlausibleToken(rawToken)) return { ok: false, code: "INVALID" };
  const now = dependencies.now ?? new Date();
  return acceptInvitationTransaction(hashInvitationToken(rawToken), user, dependencies, now);
}

export async function registerAndAcceptCompanyInvitation(
  rawToken: string,
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CommandResult<{ companyId: string; membershipId: string; session: Awaited<ReturnType<typeof issueSession>> }>> {
  const parsed = invitationRegistrationSchema.safeParse(rawInput);
  if (!parsed.success || !isPlausibleToken(rawToken)) return { ok: false, code: "INVALID_INPUT" };
  const now = dependencies.now ?? new Date();
  const tokenHash = hashInvitationToken(rawToken);
  try {
    const scope = await resolveInvitationCompanyScope(dependencies.database, tokenHash);
    if (!isUsableInvitationScope(scope, parsed.data.email, now)) return { ok: false, code: "INVALID" };
    const rateLimit = await consumeAuthRateLimit(
      "REGISTER",
      { normalizedEmail: parsed.data.email },
      dependencies.request,
      now,
      { environment: dependencies.environment, database: dependencies.database },
    );
    if (!rateLimit.allowed) {
      await recordRateLimitDenial(
        rateLimit.audit,
        {
          actorKind: "ANONYMOUS",
          capability: "AUTH_REGISTER_INVITATION",
          companyId: scope.companyId,
          targetId: scope.companyId,
          targetType: "COMPANY",
        },
        {
          database: dependencies.database,
          environment: dependencies.environment,
          request: dependencies.request,
          now,
        },
      );
      return { ok: false, code: "RATE_LIMITED" };
    }
    const existingAccount = await dependencies.database.user.findUnique({
      where: { emailNormalized: parsed.data.email },
      select: { id: true },
    });
    if (existingAccount !== null) return { ok: false, code: "ACCOUNT_EXISTS" };
    const passwordHash = await hashPassword(parsed.data.password);
    return await runInvitationTransaction(dependencies.database, async (tx) => {
      await lockCompany(tx, scope.companyId);
      const invitation = await lockInvitationByToken(tx, tokenHash, scope.companyId);
      if (invitation === null || invitation.inviteeEmailNormalized !== parsed.data.email) return { ok: false as const, code: "INVALID" };
      const globalRole = invitation.intendedRole === "RECRUITER" ? "RECRUITER" as const : "EMPLOYER" as const;
      const existing = await tx.user.findUnique({ where: { emailNormalized: parsed.data.email }, select: { id: true } });
      if (existing !== null) return { ok: false as const, code: "ACCOUNT_EXISTS" };
      const user = await tx.user.create({
        data: {
          email: parsed.data.email, emailNormalized: parsed.data.email, name: parsed.data.name, role: globalRole,
          employerProfile: { create: { displayName: parsed.data.name } },
          credential: { create: { passwordHash, algorithm: PASSWORD_HASH_POLICY_V1.algorithm, algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion, passwordChangedAt: now } },
        }, select: { id: true, email: true, role: true },
      });
      const terms = createRegistrationTermsConsent({ userId: user.id, effectiveAt: now });
      const marketing = createRegistrationMarketingConsent({ userId: user.id, effectiveAt: now, granted: parsed.data.marketingConsent });
      await tx.userConsentEvent.createMany({ data: [terms, marketing] });
      await writeTeamAudit(tx, "USER_REGISTERED", user.id, null, user.id, "USER", "AUTH_REGISTER_INVITATION", dependencies.request, now, undefined, { role: globalRole });
      const accepted = await acceptLockedInvitation(tx, invitation, user, dependencies, now);
      if (!accepted.ok) throw new InvitationAcceptanceRollback(accepted.code);
      const session = await issueSession(tx, { userId: user.id, now, request: dependencies.request, auditIpKeyring: dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS });
      return { ...accepted, session };
    });
  } catch (error) {
    return { ok: false, code: error instanceof InvitationAcceptanceRollback ? error.code : isUniqueError(error) ? "ACCOUNT_EXISTS" : "WRITE_FAILED" };
  }
}

async function acceptInvitationTransaction(tokenHash: string, user: Readonly<{ id: string; email: string; role: string }>, dependencies: CommandDependencies, now: Date): Promise<CommandResult<{ companyId: string; membershipId: string }>> {
  if (user.role !== "EMPLOYER" && user.role !== "RECRUITER") return { ok: false, code: "ACCOUNT_TYPE_UNSUPPORTED" };
  const normalizedEmail = user.email.trim().toLowerCase();
  try {
    const scope = await resolveInvitationCompanyScope(dependencies.database, tokenHash);
    if (!isUsableInvitationScope(scope, normalizedEmail, now)) return { ok: false, code: "INVALID" };
    return await runInvitationTransaction(dependencies.database, async (tx) => {
      await lockCompany(tx, scope.companyId);
      const invitation = await lockInvitationByToken(tx, tokenHash, scope.companyId);
      if (invitation === null || invitation.inviteeEmailNormalized !== normalizedEmail) return { ok: false as const, code: "INVALID" };
      return acceptLockedInvitation(tx, invitation, user, dependencies, now);
    });
  } catch { return { ok: false, code: "WRITE_FAILED" }; }
}

async function acceptLockedInvitation(tx: Prisma.TransactionClient, invitation: LockedInvitation, user: { id: string; email: string; role: string }, dependencies: CommandDependencies, now: Date): Promise<CommandResult<{ companyId: string; membershipId: string }>> {
  if (invitation.status !== "PENDING" || invitation.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "INVALID" };
  const company = await tx.company.findFirst({ where: { id: invitation.companyId, status: "ACTIVE" }, select: { id: true } });
  if (company === null) return { ok: false, code: "COMPANY_INACTIVE" };
  await expireCompanyInvitations(tx, invitation.companyId, now, dependencies.request.correlationId, invitation.id);
  const entitlements = await getEffectiveEntitlements(invitation.companyId, now, createPrismaEntitlementRepository(tx));
  if (!entitlements.ok) return { ok: false, code: "ENTITLEMENT_UNAVAILABLE" };
  const seatGate = canAddRecruiterSeat({
    effectiveEntitlements: entitlements.value,
    currentSeatCount: Math.max(
      0,
      (await countReservedSeats(tx, invitation.companyId, now)) - 1,
    ),
  });
  if (!seatGate.allowed) {
    return {
      ok: false,
      code: seatGate.reason === "SEAT_LIMIT_REACHED"
        ? "SEAT_LIMIT"
        : "ENTITLEMENT_UNAVAILABLE",
      ...(seatGate.suggestedPlanSlug === undefined
        ? {}
        : { suggestedPlanSlug: seatGate.suggestedPlanSlug }),
    };
  }
  const intendedRole = z.enum(membershipRoles).safeParse(invitation.intendedRole);
  if (!intendedRole.success) return { ok: false, code: "INVALID" };
  const existing = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } }, select: { id: true, status: true, role: true } });
  let membershipId: string;
  if (existing === null) {
    const membership = await tx.companyMembership.create({ data: { companyId: invitation.companyId, userId: user.id, role: intendedRole.data, status: "ACTIVE", joinedAt: now, createdAt: now, events: { create: { kind: "CREATED", toRole: intendedRole.data, actorUserId: user.id, reasonCode: "INVITATION_ACCEPTED", correlationId: dependencies.request.correlationId, createdAt: now } } }, select: { id: true } });
    membershipId = membership.id;
  } else if (existing.status === "REMOVED") {
    await tx.companyMembership.update({ where: { id: existing.id }, data: { status: "ACTIVE", role: intendedRole.data, joinedAt: now, removedAt: null, updatedAt: now } });
    await tx.companyMembershipEvent.create({ data: { membershipId: existing.id, kind: "REACTIVATED", fromRole: existing.role, toRole: intendedRole.data, actorUserId: user.id, reasonCode: "INVITATION_ACCEPTED", correlationId: dependencies.request.correlationId, createdAt: now } });
    membershipId = existing.id;
  } else return { ok: false, code: "ALREADY_MEMBER" };
  await tx.companyInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: user.id, updatedAt: now } });
  await tx.companyInvitationEvent.create({ data: { invitationId: invitation.id, kind: "ACCEPTED", actorUserId: user.id, correlationId: dependencies.request.correlationId, createdAt: now } });
  await writeTeamAudit(tx, "INVITATION_ACCEPTED", user.id, invitation.companyId, invitation.id, "INVITATION", "COMPANY_TEAM_INVITE_ACCEPT", dependencies.request, now);
  return { ok: true, companyId: invitation.companyId, membershipId };
}

async function resolveInvitationCompanyScope(database: DatabaseClient, tokenHash: string) {
  return database.companyInvitation.findUnique({
    where: { tokenHash },
    select: {
      companyId: true,
      inviteeEmailNormalized: true,
      status: true,
      expiresAt: true,
      company: { select: { status: true } },
    },
  });
}

function isUsableInvitationScope(
  scope: Awaited<ReturnType<typeof resolveInvitationCompanyScope>>,
  normalizedEmail: string,
  now: Date,
): scope is NonNullable<typeof scope> {
  return scope !== null &&
    scope.inviteeEmailNormalized === normalizedEmail &&
    scope.status === "PENDING" &&
    scope.expiresAt.getTime() > now.getTime() &&
    scope.company.status === "ACTIVE";
}

async function lockInvitationByToken(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  companyId: string,
): Promise<LockedInvitation | null> {
  const rows = await tx.$queryRaw<LockedInvitation[]>`
    SELECT "id", "companyId", "inviteeEmailNormalized", "intendedRole"::text, "status"::text, "expiresAt"
    FROM "CompanyInvitation"
    WHERE "tokenHash" = ${tokenHash} AND "companyId" = ${companyId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function loadTeamManager(tx: Prisma.TransactionClient, companyId: string, userId: string) {
  return tx.companyMembership.findFirst({ where: { companyId, userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, company: { status: { in: ["DRAFT", "ACTIVE"] } } }, select: { id: true, role: true, user: { select: { name: true } }, company: { select: { name: true, status: true } } } });
}
async function lockCompany(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(1010, hashtext(${companyId})::integer) IS NULL AS "locked"`;
  await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE`;
}
async function countReservedSeats(tx: Prisma.TransactionClient, companyId: string, now: Date) {
  const [members, invites] = await Promise.all([
    tx.companyMembership.count({ where: { companyId, status: "ACTIVE" } }),
    tx.companyInvitation.count({ where: { companyId, status: "PENDING", expiresAt: { gt: now } } }),
  ]);
  return members + invites;
}
async function activeOwnerCount(tx: Prisma.TransactionClient, companyId: string) {
  return tx.companyMembership.count({ where: { companyId, status: "ACTIVE", role: "OWNER" } });
}
async function isPendingBoundaryRetainedOwner(
  tx: Prisma.TransactionClient,
  companyId: string,
  membershipId: string,
  userId: string,
) {
  return (await tx.subscriptionChangeSchedule.findFirst({
    where: {
      companyId,
      status: "PENDING",
      retainedDefaultOwnerId: userId,
      retainedMembershipIds: { has: membershipId },
    },
    select: { id: true },
  })) !== null;
}
async function expireCompanyInvitations(tx: Prisma.TransactionClient, companyId: string, now: Date, correlationId: string, exceptId?: string) {
  const expired = await tx.companyInvitation.findMany({ where: { companyId, status: "PENDING", expiresAt: { lte: now }, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) }, select: { id: true } });
  for (const row of expired) {
    await tx.companyInvitation.update({ where: { id: row.id }, data: { status: "EXPIRED", updatedAt: now } });
    await tx.companyInvitationEvent.create({ data: { invitationId: row.id, kind: "EXPIRED", reasonCode: "TTL_ELAPSED", correlationId, createdAt: now } });
  }
}
async function writeTeamAudit(tx: Prisma.TransactionClient, action: Parameters<typeof writeRequiredAudit>[1]["action"], actorUserId: string, companyId: string | null, targetId: string, targetType: Parameters<typeof writeRequiredAudit>[1]["targetType"], capability: string, request: AuthRequestContext, now: Date, reasonCode?: string, metadata?: unknown) {
  return writeRequiredAudit(createPrismaTransactionAuditPort(tx), { action, actorKind: "USER", actorUserId, capability, companyId, correlationId: request.correlationId, ...(metadata === undefined ? {} : { metadata }), ...(reasonCode === undefined ? {} : { reasonCode }), result: "SUCCEEDED", retainUntil: new Date(now.getTime() + AUDIT_TTL), targetId, targetType });
}
async function sendInvitationEmail(dependencies: CommandDependencies, email: string, rawToken: string, invitation: { id: string; companyName: string; inviterName: string; version: number }) {
  if (dependencies.emailProvider === undefined) return false;
  try {
    await dependencies.emailProvider.send({ to: email, templateKey: "company_invitation", subject: "Einladung zu einem Unternehmen auf SwissTalentHub", data: { companyName: invitation.companyName, inviterName: invitation.inviterName, invitationUrl: `${dependencies.environment.APP_URL}/invite/${rawToken}`, invitationVersion: `${invitation.id}:${invitation.version}` } });
    return true;
  } catch { return false; }
}
async function notifyMembership(database: DatabaseClient, recipientUserId: string, membershipId: string, status: "ACTIVE" | "SUSPENDED" | "REMOVED", dedupeIdentity: string, reasonCode?: "ROLE_CHANGED" | "REMOVED") {
  try { await writeNotificationExactlyOnce(createPrismaNotificationPort(database), { recipientUserId, kind: "TEAM_MEMBERSHIP_CHANGED", dedupeKey: dedupeIdentity, payload: { membershipId, status, ...(reasonCode === undefined ? {} : { reasonCode }) } }); } catch { /* committed team mutation remains authoritative */ }
}
function isPlausibleToken(value: string) { return /^[A-Za-z0-9_-]{32,128}$/u.test(value); }
function sameInstant(left: Date | null, right: Date | null) {
  return left === null || right === null
    ? left === right
    : left.getTime() === right.getTime();
}
function isUniqueError(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
function isRetryableTransactionError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? error.meta
    : null;
  if (code === "P2010" && meta !== null && "code" in meta) {
    const databaseCode = String(meta.code);
    if (databaseCode === "40001" || databaseCode === "40P01") return true;
  }
  const messages = [
    "message" in error && typeof error.message === "string" ? error.message : "",
    meta !== null && "message" in meta && typeof meta.message === "string" ? meta.message : "",
  ].join("\n");
  return /could not serialize access|deadlock detected|write conflict/iu.test(messages);
}
async function runInvitationTransaction<T>(database: DatabaseClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= INVITATION_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= INVITATION_TRANSACTION_MAX_ATTEMPTS || !isRetryableTransactionError(error)) throw error;
    }
  }
  throw new Error("Invitation transaction retry budget exhausted.");
}
class InvitationAcceptanceRollback extends Error { constructor(readonly code: string) { super(code); } }
