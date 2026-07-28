import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import type {
  PersonaContextActor,
  PersonaContextDependencies,
} from "@/lib/auth/persona-context";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { hashInvitationToken } from "@/lib/employer/team";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

export const PHASE27_NOW = new Date("2026-07-28T16:30:00.000Z");
const DAY = 86_400_000;
const APP_URL = "http://phase27-persona.test";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
export type Phase27Role = "ADMIN" | "CANDIDATE" | "EMPLOYER" | "RECRUITER";
export type Phase27Actor = Readonly<{
  email: string;
  identityRole: Phase27Role;
  sessionId: string;
  userId: string;
}>;

export type Phase27PersonaFixture = Readonly<{
  database: DatabaseClient;
  migrated: Migrated;
  environment: ServerEnvironment;
  now: Date;
  companyAId: string;
  companyBId: string;
  candidate: Phase27Actor;
  employer: Phase27Actor;
  dual: Phase27Actor;
  admin: Phase27Actor;
  request: () => AuthRequestContext;
  dependencies: () => PersonaContextDependencies;
  contextActor: (actor: Phase27Actor) => Promise<PersonaContextActor>;
  issueGrant: (
    actor: Phase27Actor,
    binding: Readonly<{
      purpose: string;
      action: string;
      tenantId?: string | null;
      resourceId: string;
    }>,
  ) => Promise<Readonly<{ evidenceId: string; grantToken: string }>>;
  createInvitation: (
    input: Readonly<{
      companyId: string;
      inviteeEmail: string;
      inviterUserId?: string;
      intendedRole?: "ADMIN" | "OWNER" | "RECRUITER" | "VIEWER";
      createdAt?: Date;
      expiresAt?: Date;
      status?: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
    }>,
  ) => Promise<Readonly<{ invitationId: string; rawToken: string }>>;
  dispose: () => Promise<void>;
}>;

export async function createPhase27PersonaFixture(
  purpose: string,
): Promise<Phase27PersonaFixture> {
  const migrated = await createMigratedTestDatabase(`phase27_${purpose}`);
  const database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const environment = parseEnvironment(
    createValidEnvironment({
      APP_URL,
      DATABASE_URL: migrated.connectionString,
      IDENTITY_PERSONA_V2: "internal",
      EXISTING_IDENTITY_INVITATION: "true",
      PERSONA_PORTAL_SWITCH: "true",
      PERSONA_PRIVACY_V2: "true",
    }),
  );
  await seedDefaultPlan(database);
  const canton = await database.canton.create({
    data: {
      code: "PX",
      name: "Phase 27 Test Canton",
      slug: `phase27-canton-${randomUUID()}`,
      language: "DE",
    },
  });
  const city = await database.city.create({
    data: {
      cantonId: canton.id,
      name: "Phase 27 Test City",
      slug: `phase27-city-${randomUUID()}`,
    },
  });
  const [companyA, companyB] = await Promise.all([
    database.company.create({
      data: {
        name: "Phase 27 Company A",
        slug: `phase27-company-a-${randomUUID()}`,
        industry: "Technology",
        size: "10-49",
        website: "https://phase27-company-a.example.test",
        about:
          "A complete isolated company used for Phase 27 authorization tests.",
        values: [],
        benefits: [],
        status: "DRAFT",
        dataProvenance: "TEST",
      },
      select: { id: true },
    }),
    database.company.create({
      data: {
        name: "Phase 27 Company B",
        slug: `phase27-company-b-${randomUUID()}`,
        industry: "Professional Services",
        size: "10-49",
        website: "https://phase27-company-b.example.test",
        about:
          "A second complete company used for Phase 27 tenant-isolation tests.",
        values: [],
        benefits: [],
        status: "DRAFT",
        dataProvenance: "TEST",
      },
      select: { id: true },
    }),
  ]);
  await database.companyLocation.createMany({
    data: [
      {
        companyId: companyA.id,
        cantonId: canton.id,
        cityId: city.id,
        isPrimary: true,
      },
      {
        companyId: companyB.id,
        cantonId: canton.id,
        cityId: city.id,
        isPrimary: true,
      },
    ],
  });

  const candidate = await createActor(database, {
    label: "candidate",
    role: "CANDIDATE",
    activePortal: "CANDIDATE",
    personas: ["CANDIDATE"],
  });
  const employer = await createActor(database, {
    label: "employer",
    role: "EMPLOYER",
    activePortal: "EMPLOYER",
    activeCompanyId: companyA.id,
    personas: ["EMPLOYER"],
  });
  const dual = await createActor(database, {
    label: "dual",
    role: "EMPLOYER",
    activePortal: "EMPLOYER",
    activeCompanyId: companyA.id,
    personas: ["CANDIDATE", "EMPLOYER"],
  });
  const admin = await createActor(database, {
    label: "admin",
    role: "ADMIN",
    activePortal: "ADMIN",
    personas: [],
  });

  await Promise.all([
    createMembership(
      database,
      companyA.id,
      employer.userId,
      "OWNER",
      employer.userId,
    ),
    createMembership(
      database,
      companyA.id,
      dual.userId,
      "ADMIN",
      employer.userId,
    ),
    createMembership(
      database,
      companyB.id,
      dual.userId,
      "OWNER",
      dual.userId,
    ),
  ]);
  await Promise.all([
    database.company.update({
      where: { id: companyA.id },
      data: { status: "ACTIVE" },
    }),
    database.company.update({
      where: { id: companyB.id },
      data: { status: "ACTIVE" },
    }),
  ]);

  const request = (): AuthRequestContext =>
    Object.freeze({
      correlationId: randomUUID(),
      expectedOrigin: APP_URL,
      origin: APP_URL,
      production: false,
      sourceIp: "127.0.0.1",
      userAgent: "SwissTalentHub Phase 27 integration test",
    });

  const contextActor = async (
    actor: Phase27Actor,
  ): Promise<PersonaContextActor> => {
    const session = await database.session.findUniqueOrThrow({
      where: { id: actor.sessionId },
      select: {
        activePortal: true,
        activeCompanyId: true,
        contextVersion: true,
      },
    });
    if (session.activePortal === null) {
      throw new Error("Phase 27 fixture session has no active portal.");
    }
    return Object.freeze({
      userId: actor.userId,
      identityRole: actor.identityRole,
      sessionId: actor.sessionId,
      currentPortal: session.activePortal,
      activeCompanyId: session.activeCompanyId,
      contextVersion: session.contextVersion,
    });
  };

  const issueGrant: Phase27PersonaFixture["issueGrant"] = async (
    actor,
    binding,
  ) => {
    const dependencies = {
      actor: {
        userId: actor.userId,
        sessionId: actor.sessionId,
        role: actor.identityRole,
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      database,
      now: PHASE27_NOW,
    } as const;
    const challenge = await beginStepUpChallenge(binding, dependencies);
    if (!challenge.ok) {
      throw new Error(`Phase 27 challenge failed: ${challenge.code}`);
    }
    const completed = await completeStepUpChallenge(
      {
        challengeId: challenge.value.challengeId,
        challengeToken: challenge.value.challengeToken,
      },
      dependencies,
    );
    if (!completed.ok) {
      throw new Error(`Phase 27 grant failed: ${completed.code}`);
    }
    return Object.freeze({
      evidenceId: completed.value.evidenceId,
      grantToken: completed.value.grantToken,
    });
  };

  const createInvitation: Phase27PersonaFixture["createInvitation"] = async (
    input,
  ) => {
    const rawToken = randomBytes(32).toString("base64url");
    const createdAt = input.createdAt ?? PHASE27_NOW;
    const invitation = await database.companyInvitation.create({
      data: {
        companyId: input.companyId,
        inviterUserId: input.inviterUserId ?? employer.userId,
        inviteeEmailNormalized: input.inviteeEmail.trim().toLowerCase(),
        intendedRole: input.intendedRole ?? "VIEWER",
        tokenHash: hashInvitationToken(rawToken),
        status: input.status ?? "PENDING",
        expiresAt:
          input.expiresAt ?? new Date(PHASE27_NOW.getTime() + 7 * DAY),
        createdAt,
        events: {
          create: {
            kind: "CREATED",
            actorUserId: input.inviterUserId ?? employer.userId,
            correlationId: randomUUID(),
            createdAt,
          },
        },
      },
      select: { id: true },
    });
    return Object.freeze({
      invitationId: invitation.id,
      rawToken,
    });
  };

  return Object.freeze({
    database,
    migrated,
    environment,
    now: PHASE27_NOW,
    companyAId: companyA.id,
    companyBId: companyB.id,
    candidate,
    employer,
    dual,
    admin,
    request,
    dependencies: () =>
      Object.freeze({
        database,
        environment,
        request: request(),
        now: PHASE27_NOW,
      }),
    contextActor,
    issueGrant,
    createInvitation,
    async dispose() {
      await database.$disconnect().catch(() => undefined);
      await migrated.dispose();
    },
  });
}

async function createActor(
  database: DatabaseClient,
  input: Readonly<{
    label: string;
    role: Phase27Role;
    activePortal: "ADMIN" | "CANDIDATE" | "EMPLOYER";
    activeCompanyId?: string;
    personas: readonly ("CANDIDATE" | "EMPLOYER")[];
  }>,
): Promise<Phase27Actor> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `${input.label}-${suffix}@phase27.example`;
  const user = await database.user.create({
    data: {
      email,
      emailNormalized: email,
      name: `Phase 27 ${input.label}`,
      role: input.role,
      status: "ACTIVE",
      emailVerifiedAt: PHASE27_NOW,
      identityAssurance: "VERIFIED_EMAIL",
      dataProvenance: "TEST",
    },
    select: { id: true },
  });
  for (const kind of input.personas) {
    await database.personaAssignment.create({
      data: {
        userId: user.id,
        kind,
        source: "LEGACY_BACKFILL",
        status: "ACTIVE",
        version: 1,
        activatedAt: PHASE27_NOW,
        createdAt: PHASE27_NOW,
        updatedAt: PHASE27_NOW,
        events: {
          create: {
            kind: "MIGRATED",
            toStatus: "ACTIVE",
            source: "LEGACY_BACKFILL",
            reasonCode: "PHASE27_TEST_FIXTURE",
            correlationId: randomUUID(),
            createdAt: PHASE27_NOW,
          },
        },
      },
    });
  }
  if (input.personas.includes("CANDIDATE")) {
    await database.candidateProfile.create({
      data: {
        userId: user.id,
        onboardingStatus: "DRAFT",
        createdAt: PHASE27_NOW,
        updatedAt: PHASE27_NOW,
      },
    });
  }
  const session = await database.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256")
        .update(`${user.id}:${randomUUID()}`)
        .digest("hex"),
      activePortal: input.activePortal,
      activeCompanyId: input.activeCompanyId ?? null,
      contextVersion: 1,
      contextChangedAt: PHASE27_NOW,
      createdAt: new Date(PHASE27_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE27_NOW.getTime() + DAY),
      absoluteExpiresAt: new Date(PHASE27_NOW.getTime() + 7 * DAY),
    },
    select: { id: true },
  });
  await database.sessionAssurance.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      level: "AAL2",
      method: "WEBAUTHN",
      policyVersion: "ADMIN_MFA_POLICY_V1",
      verifiedAt: new Date(PHASE27_NOW.getTime() - 30_000),
      expiresAt: new Date(PHASE27_NOW.getTime() + 12 * 60 * 60_000),
      createdAt: PHASE27_NOW,
    },
  });
  return Object.freeze({
    email,
    identityRole: input.role,
    sessionId: session.id,
    userId: user.id,
  });
}

async function createMembership(
  database: DatabaseClient,
  companyId: string,
  userId: string,
  role: "ADMIN" | "OWNER" | "RECRUITER" | "VIEWER",
  actorUserId: string,
) {
  return database.companyMembership.create({
    data: {
      companyId,
      userId,
      role,
      status: "ACTIVE",
      joinedAt: PHASE27_NOW,
      createdAt: PHASE27_NOW,
      events: {
        create: {
          kind: "CREATED",
          toRole: role,
          actorUserId,
          reasonCode: "PHASE27_TEST_FIXTURE",
          correlationId: randomUUID(),
          createdAt: PHASE27_NOW,
        },
      },
    },
  });
}

async function seedDefaultPlan(database: DatabaseClient) {
  const plan = await database.plan.create({
    data: {
      code: `PHASE27_FREE_${randomUUID()}`,
      name: "Phase 27 free plan",
      isDefaultFree: true,
    },
  });
  const version = await database.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 0,
      monthlyEquivalentRappen: 0,
      validFrom: new Date(PHASE27_NOW.getTime() - DAY),
    },
  });
  await database.planEntitlement.createMany({
    data: [
      integerEntitlement(version.id, "ACTIVE_JOB_LIMIT", 10),
      integerEntitlement(version.id, "SEAT_LIMIT", 20),
      booleanEntitlement(version.id, "TALENT_RADAR_ACCESS", false),
      integerEntitlement(version.id, "TALENT_CONTACT_ALLOWANCE", 0),
      integerEntitlement(version.id, "JOB_BOOST_ALLOWANCE", 0),
      {
        planVersionId: version.id,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "NONE",
      },
      booleanEntitlement(version.id, "ENHANCED_COMPANY_PROFILE", false),
      booleanEntitlement(version.id, "EMPLOYER_IMPORT_ACCESS", false),
    ],
  });
  await database.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
}

function integerEntitlement(
  planVersionId: string,
  key:
    | "ACTIVE_JOB_LIMIT"
    | "JOB_BOOST_ALLOWANCE"
    | "SEAT_LIMIT"
    | "TALENT_CONTACT_ALLOWANCE",
  integerValue: number,
) {
  return {
    planVersionId,
    key,
    valueType: "INTEGER" as const,
    integerValue,
  };
}

function booleanEntitlement(
  planVersionId: string,
  key:
    | "EMPLOYER_IMPORT_ACCESS"
    | "ENHANCED_COMPANY_PROFILE"
    | "TALENT_RADAR_ACCESS",
  booleanValue: boolean,
) {
  return {
    planVersionId,
    key,
    valueType: "BOOLEAN" as const,
    booleanValue,
  };
}
