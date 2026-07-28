import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { SeedDataDriftError } from "@/prisma/seed/create-or-verify";
import { stableSeedId } from "@/prisma/seed/ids";

type SeedTransaction = Prisma.TransactionClient;
type PersonaKind = "CANDIDATE" | "EMPLOYER";
type PersonaStatus = "ACTIVE" | "SUSPENDED";

export type PersonaCompatibilitySeedResult = Readonly<{
  assignmentCount: number;
  eventCount: number;
  identityCount: number;
}>;

/**
 * The Phase-27 migration backfills identities that already exist when it is
 * deployed. A fresh environment applies migrations before the versioned demo
 * seed, so its subsequently inserted legacy identities need the same derived
 * compatibility projection. This does not grant tenant or Admin authority:
 * CompanyMembership and AdminRoleAssignment remain the respective sources of
 * truth.
 *
 * The projection is intentionally excluded from the historical Phase-06 seed
 * manifest. It is derived from already sealed legacy evidence and must also be
 * safe to add to an existing sealed dataset without rotating that dataset.
 */
export async function reconcileDemoPersonaCompatibility(
  database: PrismaClient,
  anchorAt: Date,
): Promise<PersonaCompatibilitySeedResult> {
  if (Number.isNaN(anchorAt.getTime())) {
    throw new TypeError("Persona compatibility anchor must be a valid date.");
  }

  return database.$transaction(
    async (transaction) => {
      const identities = await transaction.user.findMany({
        where: { dataProvenance: "DEMO" },
        orderBy: { id: "asc" },
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          candidateProfile: { select: { id: true } },
          companyMemberships: {
            orderBy: { id: "asc" },
            take: 1,
            select: { id: true },
          },
        },
      });

      let assignmentCount = 0;
      let eventCount = 0;
      for (const identity of identities) {
        const kinds = desiredPersonaKinds(identity);
        const status: PersonaStatus =
          identity.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED";
        for (const kind of kinds) {
          const ensured = await ensureCompatibilityAssignment(transaction, {
            userId: identity.id,
            kind,
            status,
            activatedAt: identity.createdAt,
            suspendedAt: status === "SUSPENDED" ? anchorAt : null,
            createdAt: anchorAt,
          });
          assignmentCount += 1;
          if (ensured.eventPresent) eventCount += 1;
        }
      }

      return Object.freeze({
        assignmentCount,
        eventCount,
        identityCount: identities.length,
      });
    },
    { maxWait: 5_000, timeout: 60_000 },
  );
}

function desiredPersonaKinds(
  identity: Readonly<{
    role: "ADMIN" | "CANDIDATE" | "EMPLOYER" | "RECRUITER";
    candidateProfile: Readonly<{ id: string }> | null;
    companyMemberships: readonly Readonly<{ id: string }>[];
  }>,
): readonly PersonaKind[] {
  const kinds: PersonaKind[] = [];
  if (identity.role === "CANDIDATE" || identity.candidateProfile !== null) {
    kinds.push("CANDIDATE");
  }
  if (
    identity.role === "EMPLOYER" ||
    identity.role === "RECRUITER" ||
    identity.companyMemberships.length > 0
  ) {
    kinds.push("EMPLOYER");
  }
  return Object.freeze(kinds);
}

async function ensureCompatibilityAssignment(
  transaction: SeedTransaction,
  input: Readonly<{
    userId: string;
    kind: PersonaKind;
    status: PersonaStatus;
    activatedAt: Date;
    suspendedAt: Date | null;
    createdAt: Date;
  }>,
): Promise<Readonly<{ eventPresent: true }>> {
  const naturalKey = `${input.userId}:${input.kind}`;
  let assignment = await transaction.personaAssignment.findUnique({
    where: {
      userId_kind: { userId: input.userId, kind: input.kind },
    },
    select: {
      id: true,
      userId: true,
      kind: true,
      status: true,
      source: true,
      version: true,
      activatedAt: true,
      suspendedAt: true,
      revokedAt: true,
    },
  });
  if (assignment === null) {
    assignment = await transaction.personaAssignment.create({
      data: {
        id: stableSeedId("persona-assignment", naturalKey),
        userId: input.userId,
        kind: input.kind,
        status: input.status,
        source: "LEGACY_BACKFILL",
        version: 1,
        activatedAt: input.activatedAt,
        suspendedAt: input.suspendedAt,
        revokedAt: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
      select: {
        id: true,
        userId: true,
        kind: true,
        status: true,
        source: true,
        version: true,
        activatedAt: true,
        suspendedAt: true,
        revokedAt: true,
      },
    });
  }
  assertAssignmentProjection(assignment, input, naturalKey);

  let event = await transaction.personaAssignmentEvent.findFirst({
    where: {
      personaAssignmentId: assignment.id,
      kind: "MIGRATED",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      personaAssignmentId: true,
      kind: true,
      fromStatus: true,
      toStatus: true,
      source: true,
      actorUserId: true,
      reasonCode: true,
    },
  });
  if (event === null) {
    event = await transaction.personaAssignmentEvent.create({
      data: {
        id: stableSeedId("persona-assignment-event", naturalKey),
        personaAssignmentId: assignment.id,
        kind: "MIGRATED",
        fromStatus: null,
        toStatus: input.status,
        source: "LEGACY_BACKFILL",
        actorUserId: null,
        reasonCode: "LEGACY_ROLE_BACKFILL",
        correlationId: `phase27-seed-${assignment.id}`,
        createdAt: input.createdAt,
      },
      select: {
        personaAssignmentId: true,
        kind: true,
        fromStatus: true,
        toStatus: true,
        source: true,
        actorUserId: true,
        reasonCode: true,
      },
    });
  }
  if (
    event.personaAssignmentId !== assignment.id ||
    event.kind !== "MIGRATED" ||
    event.fromStatus !== null ||
    event.toStatus !== input.status ||
    event.source !== "LEGACY_BACKFILL" ||
    event.actorUserId !== null ||
    event.reasonCode !== "LEGACY_ROLE_BACKFILL"
  ) {
    throw new SeedDataDriftError("PersonaAssignmentEvent", naturalKey);
  }

  return Object.freeze({ eventPresent: true });
}

function assertAssignmentProjection(
  assignment: Readonly<{
    userId: string;
    kind: PersonaKind;
    status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    source:
      | "LEGACY_BACKFILL"
      | "REGISTRATION"
      | "COMPANY_INVITATION"
      | "SELF_SERVICE"
      | "SUPPORT_LINK";
    version: number;
    activatedAt: Date;
    suspendedAt: Date | null;
    revokedAt: Date | null;
  }>,
  input: Readonly<{
    userId: string;
    kind: PersonaKind;
    status: PersonaStatus;
    activatedAt: Date;
  }>,
  naturalKey: string,
): void {
  if (
    assignment.userId !== input.userId ||
    assignment.kind !== input.kind ||
    assignment.status !== input.status ||
    assignment.source !== "LEGACY_BACKFILL" ||
    assignment.version !== 1 ||
    assignment.activatedAt.getTime() !== input.activatedAt.getTime() ||
    (input.status === "ACTIVE"
      ? assignment.suspendedAt !== null
      : assignment.suspendedAt === null) ||
    assignment.revokedAt !== null
  ) {
    throw new SeedDataDriftError("PersonaAssignment", naturalKey);
  }
}
