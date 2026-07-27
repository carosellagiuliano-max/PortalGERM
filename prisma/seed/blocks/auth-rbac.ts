import {
  PASSWORD_HASH_POLICY_V1,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { createOrVerifySeedRecord, SeedDataDriftError } from "@/prisma/seed/create-or-verify";
import { createSeedBlockDigest } from "@/prisma/seed/manifest";
import {
  AUTH_RBAC_SEED_IDENTITIES,
  buildAuthRbacSeedFixtures,
} from "@/prisma/seed/fixtures/auth-rbac";
import { DEMO_LOGIN_PASSWORD } from "@/prisma/seed/fixtures/companies-jobs";

type SeedTransaction = Prisma.TransactionClient;

export type AuthRbacSeedResult = Readonly<{
  blockDigest: ReturnType<typeof createSeedBlockDigest>;
  identities: typeof AUTH_RBAC_SEED_IDENTITIES;
}>;

export async function seedAuthRbacFixtures(
  database: PrismaClient,
  anchorAt: Date,
): Promise<AuthRbacSeedResult> {
  const fixtures = buildAuthRbacSeedFixtures(anchorAt);
  const existing = await database.credential.findUnique({
    where: { id: fixtures.suspendedActor.credentialId },
    select: { passwordHash: true },
  });
  const passwordHash =
    existing?.passwordHash ?? (await hashPassword(DEMO_LOGIN_PASSWORD));

  await database.$transaction(
    async (transaction) => {
      await ensureSuspendedActor(transaction, fixtures, passwordHash);
      await ensureRecruiterMembership(transaction, fixtures);
      await ensureExpiredSession(transaction, fixtures);
      await ensureResetEvidence(transaction, fixtures.expiredReset);
      await ensureResetEvidence(transaction, fixtures.usedReset);
      await ensurePhase25AdminActors(transaction, fixtures, passwordHash);
      await ensureAdminRoleAssignments(transaction, fixtures);
    },
    { maxWait: 5_000, timeout: 20_000 },
  );

  const persistedCredential = await database.credential.findUniqueOrThrow({
    where: { id: fixtures.suspendedActor.credentialId },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(DEMO_LOGIN_PASSWORD, persistedCredential.passwordHash))) {
    throw new SeedDataDriftError(
      "Credential",
      fixtures.suspendedActor.email,
    );
  }
  for (const actor of fixtures.phase25AdminActors) {
    const credential = await database.credential.findUniqueOrThrow({
      where: { id: actor.credentialId },
      select: { passwordHash: true },
    });
    if (!(await verifyPassword(DEMO_LOGIN_PASSWORD, credential.passwordHash))) {
      throw new SeedDataDriftError("Credential", actor.email);
    }
  }

  return Object.freeze({
    identities: AUTH_RBAC_SEED_IDENTITIES,
    blockDigest: buildAuthRbacSeedBlockDigest(),
  });
}

export function buildAuthRbacSeedBlockDigest() {
  const fixtures = buildAuthRbacSeedFixtures(
    new Date("2026-01-01T00:00:00.000Z"),
  );
  return createSeedBlockDigest(
    "auth-rbac",
    AUTH_RBAC_SEED_IDENTITIES.length,
    {
      actor: {
        id: fixtures.suspendedActor.id,
        email: fixtures.suspendedActor.email,
        role: fixtures.suspendedActor.role,
        status: fixtures.suspendedActor.status,
      },
      evidence: [
        { id: fixtures.expiredSession.id, kind: "SESSION", state: "EXPIRED" },
        {
          id: fixtures.expiredReset.id,
          kind: "PASSWORD_RESET",
          state: "EXPIRED_UNUSED",
        },
        {
          id: fixtures.usedReset.id,
          kind: "PASSWORD_RESET",
          state: "USED",
        },
      ],
      membership: {
        companyId: fixtures.recruiterMembership.companyId,
        id: fixtures.recruiterMembership.id,
        role: fixtures.recruiterMembership.role,
        status: fixtures.recruiterMembership.status,
        userId: fixtures.recruiterMembership.userId,
      },
      adminRoleAssignments: fixtures.adminRoleAssignments.map(
        ({ id, naturalKey, roleCode }) => ({ id, naturalKey, roleCode }),
      ),
      phase25AdminActors: fixtures.phase25AdminActors.map(
        ({ id, email }) => ({ id, email }),
      ),
    },
  );
}

async function ensureSuspendedActor(
  transaction: SeedTransaction,
  fixtures: ReturnType<typeof buildAuthRbacSeedFixtures>,
  passwordHash: string,
): Promise<void> {
  const actor = fixtures.suspendedActor;
  await createOrVerifySeedRecord({
    entity: "User",
    naturalKey: actor.email,
    findExisting: () => transaction.user.findUnique({ where: { id: actor.id } }),
    create: () =>
      transaction.user.create({
        data: {
          id: actor.id,
          email: actor.email,
          emailNormalized: actor.email,
          name: actor.name,
          role: actor.role,
          status: actor.status,
          dataProvenance: "DEMO",
          emailVerifiedAt: actor.emailVerifiedAt,
          identityAssurance: "VERIFIED_EMAIL",
          createdAt: actor.createdAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      email: row.email,
      emailNormalized: row.emailNormalized,
      name: row.name,
      role: row.role,
      status: row.status,
      dataProvenance: row.dataProvenance,
      emailVerifiedAt: iso(row.emailVerifiedAt),
      identityAssurance: row.identityAssurance,
      createdAt: row.createdAt.toISOString(),
    }),
    expected: {
      id: actor.id,
      email: actor.email,
      emailNormalized: actor.email,
      name: actor.name,
      role: actor.role,
      status: actor.status,
      dataProvenance: "DEMO",
      emailVerifiedAt: actor.emailVerifiedAt.toISOString(),
      identityAssurance: "VERIFIED_EMAIL",
      createdAt: actor.createdAt.toISOString(),
    },
  });

  await createOrVerifySeedRecord({
    entity: "Credential",
    naturalKey: actor.email,
    findExisting: () =>
      transaction.credential.findUnique({ where: { id: actor.credentialId } }),
    create: () =>
      transaction.credential.create({
        data: {
          id: actor.credentialId,
          userId: actor.id,
          passwordHash,
          algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
          algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
          passwordChangedAt: actor.passwordChangedAt,
          createdAt: actor.passwordChangedAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      userId: row.userId,
      algorithm: row.algorithm,
      algorithmVersion: row.algorithmVersion,
      passwordChangedAt: row.passwordChangedAt.toISOString(),
    }),
    expected: {
      id: actor.credentialId,
      userId: actor.id,
      algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
      algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
      passwordChangedAt: actor.passwordChangedAt.toISOString(),
    },
  });
}

async function ensurePhase25AdminActors(
  transaction: SeedTransaction,
  fixtures: ReturnType<typeof buildAuthRbacSeedFixtures>,
  passwordHash: string,
): Promise<void> {
  for (const actor of fixtures.phase25AdminActors) {
    await createOrVerifySeedRecord({
      entity: "User",
      naturalKey: actor.email,
      findExisting: () =>
        transaction.user.findUnique({ where: { id: actor.id } }),
      create: () =>
        transaction.user.create({
          data: {
            id: actor.id,
            email: actor.email,
            emailNormalized: actor.email,
            name: actor.name,
            role: "ADMIN",
            status: "ACTIVE",
            dataProvenance: "DEMO",
            emailVerifiedAt: actor.createdAt,
            identityAssurance: "VERIFIED_EMAIL",
            createdAt: actor.createdAt,
          },
        }),
      project: (row) => ({
        id: row.id,
        email: row.email,
        emailNormalized: row.emailNormalized,
        name: row.name,
        role: row.role,
        status: row.status,
        dataProvenance: row.dataProvenance,
        emailVerifiedAt: iso(row.emailVerifiedAt),
        identityAssurance: row.identityAssurance,
        createdAt: row.createdAt.toISOString(),
      }),
      expected: {
        id: actor.id,
        email: actor.email,
        emailNormalized: actor.email,
        name: actor.name,
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "DEMO",
        emailVerifiedAt: actor.createdAt.toISOString(),
        identityAssurance: "VERIFIED_EMAIL",
        createdAt: actor.createdAt.toISOString(),
      },
    });
    await createOrVerifySeedRecord({
      entity: "Credential",
      naturalKey: actor.email,
      findExisting: () =>
        transaction.credential.findUnique({
          where: { id: actor.credentialId },
        }),
      create: () =>
        transaction.credential.create({
          data: {
            id: actor.credentialId,
            userId: actor.id,
            passwordHash,
            algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
            algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
            passwordChangedAt: actor.createdAt,
            createdAt: actor.createdAt,
          },
        }),
      project: (row) => ({
        id: row.id,
        userId: row.userId,
        algorithm: row.algorithm,
        algorithmVersion: row.algorithmVersion,
        passwordChangedAt: row.passwordChangedAt.toISOString(),
      }),
      expected: {
        id: actor.credentialId,
        userId: actor.id,
        algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
        algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
        passwordChangedAt: actor.createdAt.toISOString(),
      },
    });
  }
}

async function ensureRecruiterMembership(
  transaction: SeedTransaction,
  fixtures: ReturnType<typeof buildAuthRbacSeedFixtures>,
): Promise<void> {
  const membership = fixtures.recruiterMembership;
  await createOrVerifySeedRecord({
    entity: "CompanyMembership",
    naturalKey: membership.naturalKey,
    findExisting: () =>
      transaction.companyMembership.findUnique({ where: { id: membership.id } }),
    create: () =>
      transaction.companyMembership.create({
        data: {
          id: membership.id,
          companyId: membership.companyId,
          userId: membership.userId,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
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
    }),
    expected: {
      id: membership.id,
      companyId: membership.companyId,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joinedAt.toISOString(),
      removedAt: null,
    },
  });

  const event = membership.event;
  await createOrVerifySeedRecord({
    entity: "CompanyMembershipEvent",
    naturalKey: event.naturalKey,
    findExisting: () =>
      transaction.companyMembershipEvent.findUnique({ where: { id: event.id } }),
    create: () =>
      transaction.companyMembershipEvent.create({
        data: {
          id: event.id,
          membershipId: membership.id,
          kind: event.kind,
          fromRole: null,
          toRole: membership.role,
          actorUserId: event.actorUserId,
          reasonCode: event.reasonCode,
          correlationId: event.correlationId,
          createdAt: event.createdAt,
        },
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
    expected: {
      id: event.id,
      membershipId: membership.id,
      kind: event.kind,
      fromRole: null,
      toRole: membership.role,
      actorUserId: event.actorUserId,
      reasonCode: event.reasonCode,
      correlationId: event.correlationId,
      createdAt: event.createdAt.toISOString(),
    },
  });
}

async function ensureExpiredSession(
  transaction: SeedTransaction,
  fixtures: ReturnType<typeof buildAuthRbacSeedFixtures>,
): Promise<void> {
  const session = fixtures.expiredSession;
  await createOrVerifySeedRecord({
    entity: "Session",
    naturalKey: session.naturalKey,
    findExisting: () => transaction.session.findUnique({ where: { id: session.id } }),
    create: () =>
      transaction.session.create({
        data: {
          id: session.id,
          userId: session.userId,
          tokenHash: session.tokenHash,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          rotatedAt: session.rotatedAt,
          revokedAt: session.revokedAt,
          userAgent: session.userAgent,
          ipHash: null,
        },
      }),
    project: (row) => ({
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
      rotatedAt: iso(row.rotatedAt),
      revokedAt: iso(row.revokedAt),
      userAgent: row.userAgent,
      ipHash: row.ipHash,
    }),
    expected: {
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      rotatedAt: null,
      revokedAt: null,
      userAgent: session.userAgent,
      ipHash: null,
    },
  });
}

async function ensureResetEvidence(
  transaction: SeedTransaction,
  reset:
    | ReturnType<typeof buildAuthRbacSeedFixtures>["expiredReset"]
    | ReturnType<typeof buildAuthRbacSeedFixtures>["usedReset"],
): Promise<void> {
  await createOrVerifySeedRecord({
    entity: "PasswordResetToken",
    naturalKey: reset.naturalKey,
    findExisting: () =>
      transaction.passwordResetToken.findUnique({ where: { id: reset.id } }),
    create: () =>
      transaction.passwordResetToken.create({
        data: {
          id: reset.id,
          userId: reset.userId,
          tokenHash: reset.tokenHash,
          expiresAt: reset.expiresAt,
          usedAt: reset.usedAt,
          requestedIpHash: null,
          requestedUserAgent: reset.requestedUserAgent,
          createdAt: reset.createdAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: iso(row.usedAt),
      requestedIpHash: row.requestedIpHash,
      requestedUserAgent: row.requestedUserAgent,
      createdAt: row.createdAt.toISOString(),
    }),
    expected: {
      id: reset.id,
      userId: reset.userId,
      tokenHash: reset.tokenHash,
      expiresAt: reset.expiresAt.toISOString(),
      usedAt: iso(reset.usedAt),
      requestedIpHash: null,
      requestedUserAgent: reset.requestedUserAgent,
      createdAt: reset.createdAt.toISOString(),
    },
  });
}

async function ensureAdminRoleAssignments(
  transaction: SeedTransaction,
  fixtures: ReturnType<typeof buildAuthRbacSeedFixtures>,
): Promise<void> {
  for (const assignment of fixtures.adminRoleAssignments) {
    const role = await transaction.adminRole.findUnique({
      where: { id: assignment.adminRoleId },
      select: { id: true, code: true, active: true },
    });
    if (
      role === null ||
      role.code !== assignment.roleCode ||
      role.active !== true
    ) {
      throw new SeedDataDriftError("AdminRole", assignment.roleCode);
    }

    const compatibilityRows = await transaction.adminRoleAssignment.findMany({
      where: {
        userId: assignment.userId,
        adminRoleId: assignment.adminRoleId,
        revokedAt: null,
        id: { not: assignment.id },
      },
      orderBy: { id: "asc" },
      select: { id: true, validFrom: true },
    });
    for (const compatibility of compatibilityRows) {
      await transaction.adminRoleAssignment.update({
        where: { id: compatibility.id },
        data: {
          revokedAt: compatibility.validFrom,
          reasonCode: "PHASE25_DEMO_SEED_REPLACED_BOOTSTRAP",
        },
        select: { id: true },
      });
    }

    await createOrVerifySeedRecord({
      entity: "AdminRoleAssignment",
      naturalKey: assignment.naturalKey,
      findExisting: () =>
        transaction.adminRoleAssignment.findUnique({
          where: { id: assignment.id },
        }),
      create: () =>
        transaction.adminRoleAssignment.create({
          data: {
            id: assignment.id,
            userId: assignment.userId,
            adminRoleId: assignment.adminRoleId,
            grantedByUserId: null,
            revokedByUserId: null,
            approvalId: null,
            reasonCode: assignment.reasonCode,
            validFrom: assignment.validFrom,
            validTo: assignment.validTo,
            revokedAt: null,
            createdAt: assignment.validFrom,
          },
        }),
      project: (row) => ({
        id: row.id,
        userId: row.userId,
        adminRoleId: row.adminRoleId,
        reasonCode: row.reasonCode,
        validFrom: row.validFrom.toISOString(),
        validTo: row.validTo.toISOString(),
        revokedAt: iso(row.revokedAt),
      }),
      expected: {
        id: assignment.id,
        userId: assignment.userId,
        adminRoleId: assignment.adminRoleId,
        reasonCode: assignment.reasonCode,
        validFrom: assignment.validFrom.toISOString(),
        validTo: assignment.validTo.toISOString(),
        revokedAt: null,
      },
    });
  }
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
