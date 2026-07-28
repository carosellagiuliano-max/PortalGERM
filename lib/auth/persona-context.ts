import { z } from "zod";

import { identityAnalyticsSubjectV1 } from "@/lib/analytics/pseudonyms";
import {
  createPrismaTransactionAnalyticsWriter,
  trackAnalyticsEventV1,
} from "@/lib/analytics/track";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { consumeStepUpGrant } from "@/lib/auth/assurance/step-up-service";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  listAvailablePortalContexts,
  type LegacyIdentityRole,
  type PersonaKindV2,
  type PortalContextV2,
} from "@/lib/auth/persona-policy";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";

const UUID = z.uuid();
const switchInputSchema = z
  .object({
    portal: z.enum(["CANDIDATE", "EMPLOYER", "ADMIN"]),
    companyId: UUID.nullish(),
  })
  .strict();
const createCandidatePersonaInputSchema = z
  .object({
    stepUpEvidenceId: z.uuid(),
    stepUpGrantToken: z.string().min(32).max(128),
  })
  .strict();

export type PersonaContextActor = Readonly<{
  userId: string;
  identityRole: LegacyIdentityRole;
  sessionId: string;
  currentPortal: PortalContextV2;
  activeCompanyId: string | null;
  contextVersion: number;
}>;

export type PersonaContextDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  now?: Date;
}>;

export type PersonaContextOption = Readonly<{
  portal: PortalContextV2;
  label: string;
  available: boolean;
  state: "ACTIVE" | "SUSPENDED" | "REVOKED" | "MISSING";
}>;

export type PersonaCompanyOption = Readonly<{
  companyId: string;
  companyName: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;

export type PersonaContextOverview = Readonly<{
  activePortal: PortalContextV2;
  activeCompanyId: string | null;
  contextVersion: number;
  portals: readonly PersonaContextOption[];
  companies: readonly PersonaCompanyOption[];
}>;

export async function getPersonaContextOverview(
  actor: PersonaContextActor,
  database: DatabaseClient,
): Promise<PersonaContextOverview> {
  const [assignments, memberships] = await Promise.all([
    database.personaAssignment.findMany({
      where: { userId: actor.userId },
      orderBy: { kind: "asc" },
      select: { id: true, kind: true, status: true, version: true },
    }),
    database.companyMembership.findMany({
      where: {
        userId: actor.userId,
        status: "ACTIVE",
        company: { status: { in: ["DRAFT", "ACTIVE"] } },
      },
      orderBy: [{ company: { name: "asc" } }, { id: "asc" }],
      select: {
        role: true,
        company: { select: { id: true, name: true } },
      },
    }),
  ]);
  const available = listAvailablePortalContexts(
    actor.identityRole,
    assignments,
  );
  const assignmentByKind = new Map(
    assignments.map((assignment) => [assignment.kind, assignment]),
  );
  const portals = (["CANDIDATE", "EMPLOYER", "ADMIN"] as const).map(
    (portal) => {
      const assignment =
        portal === "ADMIN" ? undefined : assignmentByKind.get(portal);
      const state =
        portal === "ADMIN"
          ? actor.identityRole === "ADMIN"
            ? "ACTIVE"
            : "MISSING"
          : (assignment?.status ?? "MISSING");
      return Object.freeze({
        portal,
        label: portalLabel(portal),
        available: available.includes(portal),
        state,
      });
    },
  );
  return Object.freeze({
    activePortal: actor.currentPortal,
    activeCompanyId:
      actor.currentPortal === "EMPLOYER"
        ? memberships.find(
            ({ company }) => company.id === actor.activeCompanyId,
          )?.company.id ?? null
        : null,
    contextVersion: actor.contextVersion,
    portals: Object.freeze(portals),
    companies: Object.freeze(
      memberships.map(({ company, role }) =>
        Object.freeze({
          companyId: company.id,
          companyName: company.name,
          membershipRole: role,
        }),
      ),
    ),
  });
}

export async function switchPersonaContext(
  rawInput: unknown,
  actor: PersonaContextActor,
  dependencies: PersonaContextDependencies,
): Promise<
  | Readonly<{
      ok: true;
      portal: PortalContextV2;
      companyId: string | null;
      contextVersion: number;
    }>
  | Readonly<{
      ok: false;
      code:
        | "FEATURE_DISABLED"
        | "INVALID_INPUT"
        | "STALE_CONTEXT"
        | "CONTEXT_UNAVAILABLE"
        | "COMPANY_SELECTION_REQUIRED";
    }>
> {
  const parsed = switchInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  if (!isPortalSwitchEnabled(dependencies.environment)) {
    return { ok: false, code: "FEATURE_DISABLED" };
  }
  const now = dependencies.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  return dependencies.database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
        FROM "Session"
       WHERE "id" = ${actor.sessionId}::uuid
       FOR UPDATE
    `;
    const session = await transaction.session.findFirst({
      where: {
        id: actor.sessionId,
        userId: actor.userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { status: "ACTIVE" },
      },
      select: {
        activePortal: true,
        activeCompanyId: true,
        contextVersion: true,
        user: {
          select: {
            role: true,
            dataProvenance: true,
          },
        },
      },
    });
    if (
      session === null ||
      session.user.role !== actor.identityRole ||
      session.contextVersion !== actor.contextVersion
    ) {
      return { ok: false as const, code: "STALE_CONTEXT" as const };
    }

    const target = await authorizeTargetContext(
      transaction,
      actor.userId,
      actor.identityRole,
      parsed.data.portal,
      parsed.data.companyId ?? null,
    );
    if (!target.ok) return target;

    const nextVersion = session.contextVersion + 1;
    const changed = await transaction.session.updateMany({
      where: {
        id: actor.sessionId,
        userId: actor.userId,
        contextVersion: session.contextVersion,
        revokedAt: null,
      },
      data: {
        activePortal: parsed.data.portal,
        activeCompanyId: target.companyId,
        contextVersion: nextVersion,
        contextChangedAt: now,
      },
    });
    if (changed.count !== 1) {
      return { ok: false as const, code: "STALE_CONTEXT" as const };
    }

    await transaction.stepUpChallenge.updateMany({
      where: { sessionId: actor.sessionId, status: "PENDING" },
      data: { status: "REVOKED", cancelledAt: now },
    });
    await transaction.authAssuranceEvidence.updateMany({
      where: {
        sessionId: actor.sessionId,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    await writeRequiredAudit(
      createPrismaTransactionAuditPort(transaction),
      {
        action: "PERSONA_CONTEXT_SWITCHED",
        actorKind: "USER",
        actorUserId: actor.userId,
        capability: "IDENTITY_PERSONA_SWITCH",
        companyId: target.companyId,
        portalContext: parsed.data.portal,
        sessionContextVersion: nextVersion,
        correlationId: dependencies.request.correlationId,
        metadata: {
          fromPortal: session.activePortal,
          toPortal: parsed.data.portal,
          contextVersion: nextVersion,
        },
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + 400 * 86_400_000),
        targetId: actor.sessionId,
        targetType: "SESSION",
      },
    );
    await trackAnalyticsEventV1(
      {
        schemaVersion: "1",
        producerEventId: `persona-switch:${actor.sessionId}:${nextVersion}`,
        occurredAt: now,
        kind: "PERSONA_CONTEXT_SWITCHED",
        pseudonymousActorId: identityAnalyticsSubjectV1(actor.userId),
        companyId: target.companyId ?? undefined,
        portalContext: parsed.data.portal,
        sessionContextVersion: nextVersion,
        properties: {
          fromPortal: session.activePortal,
          toPortal: parsed.data.portal,
          contextVersion: nextVersion,
          companySelected: target.companyId !== null,
        },
      },
      {
        producer: "persona-context",
        productAnalyticsEnabled: false,
        provenance: { actor: session.user.dataProvenance },
      },
      createPrismaTransactionAnalyticsWriter(transaction),
    );
    return Object.freeze({
      ok: true as const,
      portal: parsed.data.portal,
      companyId: target.companyId,
      contextVersion: nextVersion,
    });
  });
}

export async function createCandidatePersona(
  rawInput: unknown,
  actor: PersonaContextActor,
  dependencies: PersonaContextDependencies,
): Promise<
  | Readonly<{ ok: true; assignmentId: string; candidateProfileId: string }>
  | Readonly<{
      ok: false;
      code:
        | "FEATURE_DISABLED"
        | "INVALID_INPUT"
        | "STALE_CONTEXT"
        | "ALREADY_EXISTS"
        | "PERSONA_SUSPENDED"
        | "PERSONA_REVOKED"
        | "CONFLICT"
        | "STEP_UP_REQUIRED"
        | "WRITE_FAILED";
    }>
> {
  const parsed = createCandidatePersonaInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  if (!isPortalSwitchEnabled(dependencies.environment)) {
    return { ok: false, code: "FEATURE_DISABLED" };
  }
  const now = dependencies.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
            FROM "Session"
           WHERE "id" = ${actor.sessionId}::uuid
           FOR UPDATE
        `;
        const session = await transaction.session.findFirst({
          where: {
            id: actor.sessionId,
            userId: actor.userId,
            revokedAt: null,
            expiresAt: { gt: now },
            absoluteExpiresAt: { gt: now },
            user: { status: "ACTIVE" },
          },
          select: {
            contextVersion: true,
            user: { select: { role: true } },
          },
        });
        if (
          session === null ||
          session.contextVersion !== actor.contextVersion ||
          session.user.role !== actor.identityRole
        ) {
          return { ok: false as const, code: "STALE_CONTEXT" as const };
        }

        const assignment = await transaction.personaAssignment.findUnique({
          where: {
            userId_kind: {
              userId: actor.userId,
              kind: "CANDIDATE",
            },
          },
          select: { id: true, status: true },
        });
        const profile = await transaction.candidateProfile.findUnique({
          where: { userId: actor.userId },
          select: { id: true },
        });
        if (assignment?.status === "SUSPENDED") {
          return { ok: false as const, code: "PERSONA_SUSPENDED" as const };
        }
        if (assignment?.status === "REVOKED") {
          return { ok: false as const, code: "PERSONA_REVOKED" as const };
        }
        if (assignment !== null && profile !== null) {
          return { ok: false as const, code: "ALREADY_EXISTS" as const };
        }
        if (assignment !== null || profile !== null) {
          return { ok: false as const, code: "CONFLICT" as const };
        }
        const authorized = await consumeStepUpGrant(transaction, {
          evidenceId: parsed.data.stepUpEvidenceId,
          grantToken: parsed.data.stepUpGrantToken,
          actor: {
            userId: actor.userId,
            sessionId: actor.sessionId,
            role: actor.identityRole,
            status: "ACTIVE",
          },
          purpose: "IDENTITY_PERSONA",
          action: "PERSONA_CANDIDATE_CREATE",
          tenantId: null,
          resourceId: actor.userId,
          correlationId: dependencies.request.correlationId,
          now,
        });
        if (!authorized) {
          return { ok: false as const, code: "STEP_UP_REQUIRED" as const };
        }
        const candidateProfile = await transaction.candidateProfile.create({
          data: {
            userId: actor.userId,
            onboardingStatus: "DRAFT",
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        await transaction.candidateOnboardingEvent.create({
          data: {
            candidateProfileId: candidateProfile.id,
            kind: "DRAFT_CREATED",
            actorUserId: actor.userId,
            reasonCode: "PERSONA_ACTIVATION",
            correlationId: dependencies.request.correlationId,
            createdAt: now,
          },
          select: { id: true },
        });
        const persona = await ensurePersonaAssignment(transaction, {
          userId: actor.userId,
          kind: "CANDIDATE",
          source: "SELF_SERVICE",
          actorUserId: actor.userId,
          correlationId: dependencies.request.correlationId,
          now,
        });
        if (!persona.ok) {
          return { ok: false as const, code: persona.code };
        }
        return Object.freeze({
          ok: true as const,
          assignmentId: persona.assignmentId,
          candidateProfileId: candidateProfile.id,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
}

export async function ensurePersonaAssignment(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    userId: string;
    kind: PersonaKindV2;
    source:
      | "REGISTRATION"
      | "COMPANY_INVITATION"
      | "SELF_SERVICE"
      | "SUPPORT_LINK";
    actorUserId?: string | null;
    correlationId: string;
    now: Date;
  }>,
): Promise<
  | Readonly<{ ok: true; assignmentId: string; created: boolean }>
  | Readonly<{ ok: false; code: "PERSONA_SUSPENDED" | "PERSONA_REVOKED" }>
> {
  const existing = await transaction.personaAssignment.findUnique({
    where: { userId_kind: { userId: input.userId, kind: input.kind } },
    select: { id: true, status: true },
  });
  if (existing?.status === "SUSPENDED") {
    return { ok: false, code: "PERSONA_SUSPENDED" };
  }
  if (existing?.status === "REVOKED") {
    return { ok: false, code: "PERSONA_REVOKED" };
  }
  if (existing !== null) {
    return Object.freeze({
      ok: true,
      assignmentId: existing.id,
      created: false,
    });
  }
  const assignment = await transaction.personaAssignment.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      status: "ACTIVE",
      source: input.source,
      version: 1,
      activatedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      events: {
        create: {
          kind: "CREATED",
          toStatus: "ACTIVE",
          source: input.source,
          actorUserId: input.actorUserId ?? input.userId,
          reasonCode: input.source,
          correlationId: input.correlationId,
          createdAt: input.now,
        },
      },
    },
    select: { id: true },
  });
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "PERSONA_ASSIGNMENT_CHANGED",
    actorKind: "USER",
    actorUserId: input.actorUserId ?? input.userId,
    capability: "IDENTITY_PERSONA_ASSIGN",
    portalContext: input.kind,
    correlationId: input.correlationId,
    metadata: {
      kind: input.kind,
      fromStatus: null,
      toStatus: "ACTIVE",
      version: 1,
    },
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + 400 * 86_400_000),
    targetId: assignment.id,
    targetType: "PERSONA_ASSIGNMENT",
  });
  return Object.freeze({
    ok: true,
    assignmentId: assignment.id,
    created: true,
  });
}

export async function changePersonaAssignmentStatus(
  database: DatabaseClient,
  input: Readonly<{
    assignmentId: string;
    expectedVersion: number;
    toStatus: "ACTIVE" | "SUSPENDED" | "REVOKED";
    actorUserId: string;
    reasonCode: string;
    correlationId: string;
    now: Date;
  }>,
) {
  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
        FROM "PersonaAssignment"
       WHERE "id" = ${input.assignmentId}::uuid
       FOR UPDATE
    `;
    const assignment = await transaction.personaAssignment.findUnique({
      where: { id: input.assignmentId },
      select: {
        id: true,
        userId: true,
        kind: true,
        status: true,
        source: true,
        version: true,
      },
    });
    if (
      assignment === null ||
      assignment.version !== input.expectedVersion ||
      assignment.status === "REVOKED" ||
      assignment.status === input.toStatus ||
      (assignment.status === "ACTIVE" && input.toStatus === "ACTIVE")
    ) {
      return Object.freeze({ ok: false as const, code: "STALE_OR_INVALID" });
    }
    if (
      assignment.status === "ACTIVE" &&
      input.toStatus !== "SUSPENDED" &&
      input.toStatus !== "REVOKED"
    ) {
      return Object.freeze({ ok: false as const, code: "INVALID_TRANSITION" });
    }
    if (
      assignment.status === "SUSPENDED" &&
      input.toStatus !== "ACTIVE" &&
      input.toStatus !== "REVOKED"
    ) {
      return Object.freeze({ ok: false as const, code: "INVALID_TRANSITION" });
    }
    const nextVersion = assignment.version + 1;
    const changed = await transaction.personaAssignment.updateMany({
      where: { id: assignment.id, version: assignment.version },
      data: {
        status: input.toStatus,
        version: nextVersion,
        suspendedAt: input.toStatus === "SUSPENDED" ? input.now : null,
        revokedAt: input.toStatus === "REVOKED" ? input.now : null,
        updatedAt: input.now,
      },
    });
    if (changed.count !== 1) {
      return Object.freeze({ ok: false as const, code: "STALE_OR_INVALID" });
    }
    await transaction.personaAssignmentEvent.create({
      data: {
        personaAssignmentId: assignment.id,
        kind:
          input.toStatus === "ACTIVE"
            ? "REACTIVATED"
            : input.toStatus === "SUSPENDED"
              ? "SUSPENDED"
              : "REVOKED",
        fromStatus: assignment.status,
        toStatus: input.toStatus,
        source: assignment.source,
        actorUserId: input.actorUserId,
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        createdAt: input.now,
      },
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "PERSONA_ASSIGNMENT_CHANGED",
      actorKind: "USER",
      actorUserId: input.actorUserId,
      capability: "IDENTITY_PERSONA_STATUS_WRITE",
      portalContext: assignment.kind,
      correlationId: input.correlationId,
      metadata: {
        kind: assignment.kind,
        fromStatus: assignment.status,
        toStatus: input.toStatus,
        version: nextVersion,
      },
      result: "SUCCEEDED",
      retainUntil: new Date(input.now.getTime() + 400 * 86_400_000),
      targetId: assignment.id,
      targetType: "PERSONA_ASSIGNMENT",
    });
    return Object.freeze({
      ok: true as const,
      assignmentId: assignment.id,
      userId: assignment.userId,
      version: nextVersion,
      status: input.toStatus,
    });
  });
}

function isPortalSwitchEnabled(environment: ServerEnvironment) {
  return (
    environment.PERSONA_PORTAL_SWITCH &&
    environment.IDENTITY_PERSONA_V2 !== "disabled" &&
    environment.IDENTITY_PERSONA_V2 !== "dual_read"
  );
}

async function authorizeTargetContext(
  transaction: Prisma.TransactionClient,
  userId: string,
  identityRole: LegacyIdentityRole,
  portal: PortalContextV2,
  requestedCompanyId: string | null,
): Promise<
  | Readonly<{ ok: true; companyId: string | null }>
  | Readonly<{
      ok: false;
      code: "CONTEXT_UNAVAILABLE" | "COMPANY_SELECTION_REQUIRED";
    }>
> {
  if (portal === "ADMIN") {
    return identityRole === "ADMIN" && requestedCompanyId === null
      ? { ok: true, companyId: null }
      : { ok: false, code: "CONTEXT_UNAVAILABLE" };
  }
  const assignment = await transaction.personaAssignment.findUnique({
    where: { userId_kind: { userId, kind: portal } },
    select: { status: true },
  });
  if (assignment?.status !== "ACTIVE") {
    return { ok: false, code: "CONTEXT_UNAVAILABLE" };
  }
  if (portal === "CANDIDATE") {
    if (
      requestedCompanyId !== null ||
      (await transaction.candidateProfile.count({ where: { userId } })) !== 1
    ) {
      return { ok: false, code: "CONTEXT_UNAVAILABLE" };
    }
    return { ok: true, companyId: null };
  }
  const memberships = await transaction.companyMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      company: { status: { in: ["DRAFT", "ACTIVE"] } },
    },
    orderBy: { id: "asc" },
    select: { companyId: true },
  });
  if (requestedCompanyId !== null) {
    return memberships.some(({ companyId }) => companyId === requestedCompanyId)
      ? { ok: true, companyId: requestedCompanyId }
      : { ok: false, code: "CONTEXT_UNAVAILABLE" };
  }
  if (memberships.length > 1) {
    return { ok: false, code: "COMPANY_SELECTION_REQUIRED" };
  }
  return { ok: true, companyId: memberships[0]?.companyId ?? null };
}

function portalLabel(portal: PortalContextV2) {
  if (portal === "CANDIDATE") return "Kandidatenportal";
  if (portal === "EMPLOYER") return "Arbeitgeberportal";
  return "Administration";
}
