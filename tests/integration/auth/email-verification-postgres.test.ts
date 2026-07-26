import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import {
  createInitialEmailVerification,
} from "@/lib/auth/email-verification-service";
import { createCompanyInvitationToken } from "@/lib/auth/invitation-token";
import {
  registerCandidate,
  registerEmployer,
} from "@/lib/auth/auth-service";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  registerAndAcceptCompanyInvitation,
  sendCompanyInvitation,
} from "@/lib/employer/team";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  PHASE20_NOW,
  PHASE20_PASSWORD,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: Migrated | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;
let cantonId = "";
let cityId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase20_email_verification");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = phase20Environment(migrated.connectionString, {
    IDENTITY_VERIFICATION_ENFORCEMENT: "true",
  });
  const canton = await database.canton.create({
    data: {
      code: "ZH",
      name: "Zürich",
      slug: "phase20-zuerich",
      language: "DE",
    },
  });
  cantonId = canton.id;
  const city = await database.city.create({
    data: {
      cantonId,
      name: "Zürich Phase 20",
      slug: `phase20-zuerich-${randomUUID()}`,
    },
  });
  cityId = city.id;
  const plan = await database.plan.create({
    data: {
      code: `PHASE20_INVITE_${randomUUID()}`,
      name: "Phase 20 invitation plan",
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
      validFrom: new Date(PHASE20_NOW.getTime() - 86_400_000),
    },
  });
  await database.planEntitlement.createMany({
    data: [
      integerEntitlement(version.id, "ACTIVE_JOB_LIMIT", 10),
      integerEntitlement(version.id, "SEAT_LIMIT", 2),
      integerEntitlement(version.id, "TALENT_CONTACT_ALLOWANCE", 0),
      integerEntitlement(version.id, "JOB_BOOST_ALLOWANCE", 0),
      booleanEntitlement(version.id, "TALENT_RADAR_ACCESS", false),
      booleanEntitlement(version.id, "ENHANCED_COMPANY_PROFILE", false),
      booleanEntitlement(version.id, "EMPLOYER_IMPORT_ACCESS", false),
      {
        planVersionId: version.id,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "NONE",
      },
    ],
  });
  await database.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await migrated?.dispose();
});

describe.sequential("Phase 20 registration verification outbox", () => {
  it("commits Candidate and Employer as low assurance with exactly one challenge/outbox", async () => {
    const candidateEmail = "candidate.phase20@example.test";
    const candidate = await registerCandidate(
      {
        email: candidateEmail,
        name: "Candidate Phase 20",
        password: PHASE20_PASSWORD,
        passwordConfirmation: PHASE20_PASSWORD,
        acceptedTerms: true,
        marketingConsent: false,
      },
      dependencies(1),
    );
    expect(candidate).toMatchObject({
      ok: true,
      branch: "CANDIDATE",
      destination: "/verify-email?registered=1",
    });
    const candidateUser = await db().user.findUniqueOrThrow({
      where: { emailNormalized: candidateEmail },
      include: {
        emailVerificationChallenges: true,
        notificationOutbox: true,
      },
    });
    expect(candidateUser).toMatchObject({
      emailVerifiedAt: null,
      identityAssurance: "LOW_ASSURANCE",
      emailAddressEpoch: 1,
    });
    expect(candidateUser.emailVerificationChallenges).toHaveLength(1);
    expect(candidateUser.notificationOutbox).toHaveLength(1);
    expect(candidateUser.notificationOutbox[0]).toMatchObject({
      purpose: "IDENTITY_VERIFICATION",
      purposeClass: "MANDATORY",
      status: "PENDING",
      templateKey: "identity_verification",
    });

    const employerEmail = "owner@phase20-company.test";
    const employer = await registerEmployer(
      {
        email: employerEmail,
        name: "Employer Phase 20",
        companyName: "Phase 20 AG",
        cantonCode: "ZH",
        companySize: "1-9",
        password: PHASE20_PASSWORD,
        passwordConfirmation: PHASE20_PASSWORD,
        acceptedTerms: true,
        marketingConsent: false,
      },
      dependencies(2),
    );
    expect(employer).toMatchObject({
      ok: true,
      branch: "COMPANY_CREATED",
      destination: "/verify-email?registered=1",
    });
    const employerUser = await db().user.findUniqueOrThrow({
      where: { emailNormalized: employerEmail },
      include: {
        emailVerificationChallenges: true,
        notificationOutbox: true,
      },
    });
    expect(employerUser.identityAssurance).toBe("LOW_ASSURANCE");
    expect(employerUser.emailVerificationChallenges).toHaveLength(1);
    expect(employerUser.notificationOutbox).toHaveLength(1);
  });

  it("registers and accepts a real Invitation with atomic outbox and verified identity", async () => {
    const email = "invitee.phase20@example.test";
    const company = await createInvitationCompany();
    const sent = await sendCompanyInvitation(
      company.id,
      {
        userId: company.ownerUserId,
        membershipId: company.ownerMembershipId,
        role: "OWNER",
      },
      { email, role: "RECRUITER" },
      dependencies(3),
    );
    expect(sent).toMatchObject({ ok: true, emailRecorded: true });
    if (!sent.ok) throw new Error("Invitation fixture failed.");
    const invitation = await db().companyInvitation.findUniqueOrThrow({
      where: { id: sent.invitationId },
      select: { id: true, tokenVersion: true },
    });
    const rawToken = createCompanyInvitationToken(
      invitation.id,
      invitation.tokenVersion,
      env().secrets.session,
    );
    const accepted = await registerAndAcceptCompanyInvitation(
      rawToken,
      {
        email,
        name: "Invited Recruiter",
        password: PHASE20_PASSWORD,
        acceptedTerms: true,
        marketingConsent: false,
      },
      dependencies(4),
    );
    expect(accepted).toMatchObject({ ok: true, companyId: company.id });
    const user = await db().user.findUniqueOrThrow({
      where: { emailNormalized: email },
      include: { authAssuranceEvidence: true, authSecurityEvents: true },
    });
    const [outbox, acceptedInvitation] = await Promise.all([
      db().notificationOutbox.findFirstOrThrow({
        where: { dedupeKey: `company-invitation:${invitation.id}:1` },
      }),
      db().companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      }),
    ]);
    expect(user).toMatchObject({
      emailVerifiedAt: PHASE20_NOW,
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(user.authAssuranceEvidence).toHaveLength(1);
    expect(user.authSecurityEvents).toHaveLength(1);
    expect(acceptedInvitation.status).toBe("ACCEPTED");
    expect(outbox).toMatchObject({
      purpose: "COMPANY_INVITATION",
      purposeClass: "MANDATORY",
      recipientUserId: null,
      templateKey: "company_invitation",
      payloadSchemaVersion: "company-invitation-v2",
    });
    expect(outbox.recipientAddressCiphertext).not.toBeNull();
    expect(JSON.stringify({ user, outbox, acceptedInvitation })).not.toContain(
      rawToken,
    );
  });

  it("rolls back identity and outbox together and deduplicates duplicate registration", async () => {
    const email = "rollback.phase20@example.test";
    const outboxCountBefore = await db().notificationOutbox.count({
      where: { dedupeKey: { startsWith: "email-verification:" } },
    });
    await expect(
      db().$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email,
            emailNormalized: email,
            role: "CANDIDATE",
            dataProvenance: "TEST",
          },
          select: { id: true },
        });
        await createInitialEmailVerification(transaction, {
          userId: user.id,
          emailNormalized: email,
          now: PHASE20_NOW,
          correlationId: phase20Request(4).correlationId,
          environment: env(),
        });
        throw new Error("ROLLBACK_PROBE");
      }),
    ).rejects.toThrow("ROLLBACK_PROBE");
    expect(
      await db().user.count({ where: { emailNormalized: email } }),
    ).toBe(0);
    expect(
      await db().notificationOutbox.count({
        where: { dedupeKey: { startsWith: "email-verification:" } },
      }),
    ).toBe(outboxCountBefore);

    const duplicate = await registerCandidate(
      {
        email: "candidate.phase20@example.test",
        name: "Duplicate",
        password: PHASE20_PASSWORD,
        passwordConfirmation: PHASE20_PASSWORD,
        acceptedTerms: true,
        marketingConsent: false,
      },
      dependencies(5),
    );
    expect(duplicate).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    expect(
      await db().notificationOutbox.count({
        where: {
          recipient: {
            emailNormalized: "candidate.phase20@example.test",
          },
        },
      }),
    ).toBe(1);
  });
});

function dependencies(index: number) {
  return Object.freeze({
    database: db(),
    environment: env(),
    request: phase20Request(index),
    now: PHASE20_NOW,
  });
}

function db() {
  if (database === undefined) throw new Error("Phase 20 database unavailable.");
  return database;
}

function env() {
  if (environment === undefined) throw new Error("Phase 20 environment unavailable.");
  return environment;
}

async function createInvitationCompany() {
  const ownerEmail = `owner-${randomUUID()}@phase20-invitation.test`;
  const owner = await db().user.create({
    data: {
      email: ownerEmail,
      emailNormalized: ownerEmail,
      name: "Phase 20 invitation owner",
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: PHASE20_NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
  });
  const company = await db().company.create({
    data: {
      name: "Phase 20 Invitation AG",
      slug: `phase20-invitation-${randomUUID()}`,
      industry: "Technology",
      size: "10-49",
      website: "https://phase20-invitation.example.test",
      about: "Isolated company for the Phase 20 invitation identity contract.",
      values: [],
      benefits: [],
      status: "DRAFT",
      dataProvenance: "TEST",
    },
  });
  await db().companyLocation.create({
    data: {
      companyId: company.id,
      cantonId,
      cityId,
      isPrimary: true,
    },
  });
  await db().company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  const membership = await db().companyMembership.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: PHASE20_NOW,
      createdAt: PHASE20_NOW,
    },
  });
  return Object.freeze({
    id: company.id,
    ownerUserId: owner.id,
    ownerMembershipId: membership.id,
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
