import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import type { CanonicalJsonValue } from "@/prisma/seed/canonical-json";
import { createOrVerifySeedRecord } from "@/prisma/seed/create-or-verify";
import { createSeedBlockDigest } from "@/prisma/seed/manifest";
import {
  EMPLOYER_CORE_SEED_IDENTITIES,
  buildEmployerCoreSeedFixtures,
  type EmployerCoreSeedFixtures,
} from "@/prisma/seed/fixtures/employer-core";

type SeedTransaction = Prisma.TransactionClient;

export type EmployerCoreSeedResult = Readonly<{
  blockDigest: ReturnType<typeof createSeedBlockDigest>;
  identities: typeof EMPLOYER_CORE_SEED_IDENTITIES;
}>;

export async function seedEmployerCoreFixtures(
  database: PrismaClient,
  anchorAt: Date,
): Promise<EmployerCoreSeedResult> {
  const fixtures = buildEmployerCoreSeedFixtures(anchorAt);

  await database.$transaction(
    async (transaction) => {
      for (const principal of fixtures.principals) {
        await ensurePrincipal(transaction, principal);
      }
      for (const membership of fixtures.memberships) {
        await ensureMembership(transaction, membership);
      }
      await ensureInvitation(transaction, fixtures.invitation);
      for (const assignment of fixtures.assignments) {
        await ensureAssignment(transaction, assignment);
      }
    },
    { maxWait: 5_000, timeout: 20_000 },
  );

  return Object.freeze({
    blockDigest: buildEmployerCoreSeedBlockDigest(),
    identities: EMPLOYER_CORE_SEED_IDENTITIES,
  });
}

export function buildEmployerCoreSeedBlockDigest() {
  const fixtures = buildEmployerCoreSeedFixtures(
    new Date("2026-01-01T00:00:00.000Z"),
  );

  return createSeedBlockDigest(
    "employer-core",
    EMPLOYER_CORE_SEED_IDENTITIES.length,
    {
      principals: fixtures.principals.map((principal) => ({
        id: principal.id,
        profileId: principal.profileId,
        email: principal.email,
        role: principal.role,
        status: principal.status,
      })),
      memberships: fixtures.memberships.map((membership) => ({
        id: membership.id,
        companyId: membership.companyId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        eventId: membership.event.id,
      })),
      invitation: {
        id: fixtures.invitation.id,
        companyId: fixtures.invitation.companyId,
        inviteeEmailNormalized: fixtures.invitation.inviteeEmailNormalized,
        intendedRole: fixtures.invitation.intendedRole,
        generation: fixtures.invitation.tokenVersion,
        status: fixtures.invitation.status,
        eventId: fixtures.invitation.event.id,
      },
      assignments: fixtures.assignments.map((assignment) => ({
        id: assignment.id,
        membershipId: assignment.membershipId,
        companyId: assignment.companyId,
        jobId: assignment.jobId,
        userId: assignment.userId,
        role: assignment.role,
        status: assignment.status,
        eventId: assignment.event.id,
      })),
      overLimitScenario: fixtures.overLimitScenario,
      verificationScenario: fixtures.verificationScenario,
    } satisfies CanonicalJsonValue,
  );
}

async function ensurePrincipal(
  transaction: SeedTransaction,
  principal: EmployerCoreSeedFixtures["principals"][number],
): Promise<void> {
  const userExpected = {
    id: principal.id,
    email: principal.email,
    emailNormalized: principal.email,
    role: principal.role,
    name: principal.name,
    status: principal.status,
    dataProvenance: "DEMO" as const,
    emailVerifiedAt: principal.emailVerifiedAt.toISOString(),
    createdAt: principal.createdAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "User",
    naturalKey: principal.email,
    findExisting: () =>
      transaction.user.findUnique({ where: { id: principal.id } }),
    create: () =>
      transaction.user.create({
        data: {
          ...userExpected,
          emailVerifiedAt: principal.emailVerifiedAt,
          createdAt: principal.createdAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      email: row.email,
      emailNormalized: row.emailNormalized,
      role: row.role,
      name: row.name,
      status: row.status,
      dataProvenance: row.dataProvenance,
      emailVerifiedAt: iso(row.emailVerifiedAt),
      createdAt: row.createdAt.toISOString(),
    }),
    expected: userExpected,
  });

  const profileExpected = {
    id: principal.profileId,
    userId: principal.id,
    displayName: principal.name,
    phone: null,
    createdAt: principal.createdAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "EmployerProfile",
    naturalKey: principal.email,
    findExisting: () =>
      transaction.employerProfile.findUnique({
        where: { id: principal.profileId },
      }),
    create: () =>
      transaction.employerProfile.create({
        data: {
          ...profileExpected,
          createdAt: principal.createdAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      phone: row.phone,
      createdAt: row.createdAt.toISOString(),
    }),
    expected: profileExpected,
  });
}

async function ensureMembership(
  transaction: SeedTransaction,
  membership: EmployerCoreSeedFixtures["memberships"][number],
): Promise<void> {
  const expected = {
    id: membership.id,
    companyId: membership.companyId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    removedAt: null,
    createdAt: membership.joinedAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "CompanyMembership",
    naturalKey: membership.naturalKey,
    findExisting: () =>
      transaction.companyMembership.findUnique({
        where: { id: membership.id },
      }),
    create: () =>
      transaction.companyMembership.create({
        data: {
          ...expected,
          joinedAt: membership.joinedAt,
          removedAt: null,
          createdAt: membership.joinedAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt.toISOString(),
      removedAt: iso(row.removedAt),
      createdAt: row.createdAt.toISOString(),
    }),
    expected,
  });

  const event = membership.event;
  const eventExpected = {
    id: event.id,
    membershipId: membership.id,
    kind: event.kind,
    fromRole: null,
    toRole: membership.role,
    actorUserId: event.actorUserId,
    reasonCode: event.reasonCode,
    correlationId: event.correlationId,
    createdAt: event.createdAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "CompanyMembershipEvent",
    naturalKey: event.naturalKey,
    findExisting: () =>
      transaction.companyMembershipEvent.findUnique({
        where: { id: event.id },
      }),
    create: () =>
      transaction.companyMembershipEvent.create({
        data: { ...eventExpected, createdAt: event.createdAt },
      }),
    project: (row) => ({
      id: row.id,
      membershipId: row.membershipId,
      kind: row.kind,
      fromRole: row.fromRole,
      toRole: row.toRole,
      actorUserId: row.actorUserId,
      reasonCode: row.reasonCode,
      correlationId: row.correlationId,
      createdAt: row.createdAt.toISOString(),
    }),
    expected: eventExpected,
  });
}

async function ensureInvitation(
  transaction: SeedTransaction,
  invitation: EmployerCoreSeedFixtures["invitation"],
): Promise<void> {
  const expected = {
    id: invitation.id,
    companyId: invitation.companyId,
    inviterUserId: invitation.inviterUserId,
    acceptedByUserId: null,
    inviteeEmailNormalized: invitation.inviteeEmailNormalized,
    intendedRole: invitation.intendedRole,
    tokenHash: invitation.tokenHash,
    tokenVersion: invitation.tokenVersion,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdAt: invitation.createdAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "CompanyInvitation",
    naturalKey: invitation.naturalKey,
    findExisting: () =>
      transaction.companyInvitation.findUnique({
        where: { id: invitation.id },
      }),
    create: () =>
      transaction.companyInvitation.create({
        data: {
          ...expected,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      companyId: row.companyId,
      inviterUserId: row.inviterUserId,
      acceptedByUserId: row.acceptedByUserId,
      inviteeEmailNormalized: row.inviteeEmailNormalized,
      intendedRole: row.intendedRole,
      tokenHash: row.tokenHash,
      tokenVersion: row.tokenVersion,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: iso(row.acceptedAt),
      revokedAt: iso(row.revokedAt),
      createdAt: row.createdAt.toISOString(),
    }),
    expected,
  });

  const event = invitation.event;
  const eventExpected = {
    id: event.id,
    invitationId: invitation.id,
    kind: event.kind,
    actorUserId: event.actorUserId,
    reasonCode: event.reasonCode,
    correlationId: event.correlationId,
    createdAt: event.createdAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "CompanyInvitationEvent",
    naturalKey: event.naturalKey,
    findExisting: () =>
      transaction.companyInvitationEvent.findUnique({
        where: { id: event.id },
      }),
    create: () =>
      transaction.companyInvitationEvent.create({
        data: { ...eventExpected, createdAt: event.createdAt },
      }),
    project: (row) => ({
      id: row.id,
      invitationId: row.invitationId,
      kind: row.kind,
      actorUserId: row.actorUserId,
      reasonCode: row.reasonCode,
      correlationId: row.correlationId,
      createdAt: row.createdAt.toISOString(),
    }),
    expected: eventExpected,
  });
}

async function ensureAssignment(
  transaction: SeedTransaction,
  assignment: EmployerCoreSeedFixtures["assignments"][number],
): Promise<void> {
  const expected = {
    id: assignment.id,
    membershipId: assignment.membershipId,
    companyId: assignment.companyId,
    jobId: assignment.jobId,
    userId: assignment.userId,
    role: assignment.role,
    status: assignment.status,
    assignedByUserId: assignment.assignedByUserId,
    validFrom: assignment.validFrom.toISOString(),
    expiresAt: null,
    revokedAt: null,
    createdAt: assignment.validFrom.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "JobAssignment",
    naturalKey: assignment.naturalKey,
    findExisting: () =>
      transaction.jobAssignment.findUnique({ where: { id: assignment.id } }),
    create: () =>
      transaction.jobAssignment.create({
        data: {
          ...expected,
          validFrom: assignment.validFrom,
          expiresAt: assignment.expiresAt,
          revokedAt: null,
          createdAt: assignment.validFrom,
        },
      }),
    project: (row) => ({
      id: row.id,
      membershipId: row.membershipId,
      companyId: row.companyId,
      jobId: row.jobId,
      userId: row.userId,
      role: row.role,
      status: row.status,
      assignedByUserId: row.assignedByUserId,
      validFrom: row.validFrom.toISOString(),
      expiresAt: iso(row.expiresAt),
      revokedAt: iso(row.revokedAt),
      createdAt: row.createdAt.toISOString(),
    }),
    expected,
  });

  const event = assignment.event;
  const eventExpected = {
    id: event.id,
    jobAssignmentId: assignment.id,
    kind: event.kind,
    fromRole: null,
    toRole: assignment.role,
    actorUserId: event.actorUserId,
    reasonCode: event.reasonCode,
    correlationId: event.correlationId,
    createdAt: event.createdAt.toISOString(),
  };
  await createOrVerifySeedRecord({
    entity: "JobAssignmentEvent",
    naturalKey: event.naturalKey,
    findExisting: () =>
      transaction.jobAssignmentEvent.findUnique({
        where: { id: event.id },
      }),
    create: () =>
      transaction.jobAssignmentEvent.create({
        data: { ...eventExpected, createdAt: event.createdAt },
      }),
    project: (row) => ({
      id: row.id,
      jobAssignmentId: row.jobAssignmentId,
      kind: row.kind,
      fromRole: row.fromRole,
      toRole: row.toRole,
      actorUserId: row.actorUserId,
      reasonCode: row.reasonCode,
      correlationId: row.correlationId,
      createdAt: row.createdAt.toISOString(),
    }),
    expected: eventExpected,
  });
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
