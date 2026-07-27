import { createHash, randomUUID } from "node:crypto";

import type { AdminSecurityDependencies } from "@/lib/admin/security-governance";
import type { AdminRoleCode } from "@/lib/admin/role-policy";
import type { StepUpDependencies } from "@/lib/auth/assurance/step-up-service";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

export const PHASE25_NOW = new Date("2026-07-28T14:00:00.000Z");

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type ActorRole = "ADMIN" | "CANDIDATE" | "EMPLOYER";

export type Phase25Actor = Readonly<{
  email: string;
  role: ActorRole;
  sessionId: string;
  userId: string;
}>;

export type Phase25SecurityFixture = Readonly<{
  database: DatabaseClient;
  migrated: MigratedDatabase;
  now: Date;
  requester: Phase25Actor;
  approver: Phase25Actor;
  trustReviewer: Phase25Actor;
  trustApprover: Phase25Actor;
  targetAdmin: Phase25Actor;
  candidate: Phase25Actor;
  employer: Phase25Actor;
  adminDependencies: (
    actor: Phase25Actor,
    overrides?: Partial<AdminSecurityDependencies>,
  ) => AdminSecurityDependencies;
  stepUpDependencies: (
    actor: Phase25Actor,
    now?: Date,
  ) => StepUpDependencies;
  assignRole: (actor: Phase25Actor, roleCode: AdminRoleCode) => Promise<string>;
  issueAal2: (actor: Phase25Actor, verifiedAt?: Date) => Promise<string>;
  dispose: () => Promise<void>;
}>;

export async function createPhase25SecurityFixture(
  purpose: string,
): Promise<Phase25SecurityFixture> {
  const migrated = await createMigratedTestDatabase(purpose);
  const database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const requester = await createActor(database, suffix, "requester", "ADMIN");
  const approver = await createActor(database, suffix, "approver", "ADMIN");
  const trustReviewer = await createActor(
    database,
    suffix,
    "trust-reviewer",
    "ADMIN",
  );
  const trustApprover = await createActor(
    database,
    suffix,
    "trust-approver",
    "ADMIN",
  );
  const targetAdmin = await createActor(
    database,
    suffix,
    "target-admin",
    "ADMIN",
  );
  const candidate = await createActor(
    database,
    suffix,
    "candidate",
    "CANDIDATE",
  );
  const employer = await createActor(
    database,
    suffix,
    "employer",
    "EMPLOYER",
  );

  const assignRole = async (actor: Phase25Actor, roleCode: AdminRoleCode) => {
    const role = await database.adminRole.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true },
    });
    const assignment = await database.adminRoleAssignment.create({
      data: {
        userId: actor.userId,
        adminRoleId: role.id,
        reasonCode: "PHASE25_TEST_ROLE",
        validFrom: new Date(PHASE25_NOW.getTime() - 60_000),
        validTo: new Date(PHASE25_NOW.getTime() + 86_400_000),
        createdAt: PHASE25_NOW,
      },
    });
    return assignment.id;
  };

  await Promise.all([
    assignRole(requester, "SECURITY_ADMIN"),
    assignRole(approver, "SECURITY_ADMIN"),
    assignRole(trustReviewer, "TRUST_SAFETY_REVIEWER"),
    assignRole(trustApprover, "TRUST_SAFETY_APPROVER"),
  ]);

  const issueAal2 = async (
    actor: Phase25Actor,
    verifiedAt = new Date(PHASE25_NOW.getTime() - 30_000),
  ) => {
    const assurance = await database.sessionAssurance.create({
      data: {
        sessionId: actor.sessionId,
        userId: actor.userId,
        level: "AAL2",
        method: "WEBAUTHN",
        policyVersion: "ADMIN_MFA_POLICY_V1",
        verifiedAt,
        expiresAt: new Date(PHASE25_NOW.getTime() + 12 * 60 * 60_000),
        createdAt: PHASE25_NOW,
      },
    });
    return assurance.id;
  };
  await Promise.all([
    issueAal2(requester),
    issueAal2(approver),
    issueAal2(trustReviewer),
    issueAal2(trustApprover),
    issueAal2(candidate),
    issueAal2(employer),
  ]);

  return Object.freeze({
    database,
    migrated,
    now: PHASE25_NOW,
    requester,
    approver,
    trustReviewer,
    trustApprover,
    targetAdmin,
    candidate,
    employer,
    assignRole,
    issueAal2,
    adminDependencies(
      actor: Phase25Actor,
      overrides: Partial<AdminSecurityDependencies> = {},
    ): AdminSecurityDependencies {
      const base = {
        actor: {
          userId: actor.userId,
          email: actor.email,
          role: actor.role,
          status: "ACTIVE",
          sessionId: actor.sessionId,
        },
        correlationId: randomUUID(),
        database,
        environment: { BREAK_GLASS_ENABLED: true },
        now: PHASE25_NOW,
      } satisfies AdminSecurityDependencies;
      return Object.freeze({ ...base, ...overrides });
    },
    stepUpDependencies(
      actor: Phase25Actor,
      now = PHASE25_NOW,
    ): StepUpDependencies {
      return Object.freeze({
        actor: {
          userId: actor.userId,
          sessionId: actor.sessionId,
          role: actor.role,
          status: "ACTIVE",
        },
        correlationId: randomUUID(),
        database,
        now,
      });
    },
    async dispose() {
      await database.$disconnect().catch(() => undefined);
      await migrated.dispose();
    },
  });
}

async function createActor(
  database: DatabaseClient,
  suffix: string,
  label: string,
  role: ActorRole,
): Promise<Phase25Actor> {
  const email = `${label}-${suffix}@phase25.example`;
  const user = await database.user.create({
    data: {
      email,
      emailNormalized: email,
      name: `Phase 25 ${label}`,
      role,
      status: "ACTIVE",
      emailVerifiedAt: PHASE25_NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
  });
  const session = await database.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256")
        .update(`${user.id}:${randomUUID()}`)
        .digest("hex"),
      createdAt: new Date(PHASE25_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE25_NOW.getTime() + 24 * 60 * 60_000),
      absoluteExpiresAt: new Date(
        PHASE25_NOW.getTime() + 7 * 24 * 60 * 60_000,
      ),
    },
  });
  return Object.freeze({
    email,
    role,
    sessionId: session.id,
    userId: user.id,
  });
}
