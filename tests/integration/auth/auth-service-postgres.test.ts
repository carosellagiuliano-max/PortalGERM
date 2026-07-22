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

import { candidateAnalyticsSubjectV1 } from "@/lib/analytics/pseudonyms";
import {
  hashPasswordResetToken,
  loginWithPassword,
  registerCandidate,
  registerEmployer,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/auth-service";
import {
  resolveEmployerContextSelection,
  type EmployerMembershipContext,
} from "@/lib/auth/employer-context";
import { hashPassword, PASSWORD_HASH_POLICY_V1 } from "@/lib/auth/password";
import { REGISTRATION_CONSENT_NOTICES_V1 } from "@/lib/auth/registration-consent";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { hashSessionToken } from "@/lib/auth/session";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { LocalMockMailbox } from "@/lib/providers/email/local-mock-mailbox-core";
import { MockEmailProvider } from "@/lib/providers/email/mock-email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const APP_URL = "http://phase06-auth.test";
const CANTON_ID = "06000000-0000-4000-8000-000000000001";
const LOGIN_FIXTURE_ID = "06000000-0000-4000-8000-000000000002";
const LOGIN_FIXTURE_EMAIL = "demo.phase06@fixture.example.test";
const LOGIN_FIXTURE_PASSWORD = "Phase06!DemoSicher42";
const CANDIDATE_EMAIL = "candidate.phase06@example.test";
const CANDIDATE_PASSWORD = "Phase06!Candidate42";
const RESET_PASSWORD = "Phase06!ResetNeu43";
const MAILBOX_SECRET = "phase06-integration-mailbox-secret-material";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase 06 auth test database is not initialized.");
  }
  return database;
}

function runtimeEnvironment(): ServerEnvironment {
  if (environment === undefined) {
    throw new Error("The Phase 06 auth test environment is not initialized.");
  }
  return environment;
}

function requestContext(
  sourceIp: string,
  overrides: Partial<AuthRequestContext> = {},
): AuthRequestContext {
  return Object.freeze({
    correlationId: randomUUID(),
    expectedOrigin: APP_URL,
    origin: APP_URL,
    production: false,
    sourceIp,
    userAgent: "SwissTalentHub Phase 06 integration test",
    ...overrides,
  });
}

function dependencies(request: AuthRequestContext, now = NOW) {
  return Object.freeze({
    database: client(),
    environment: runtimeEnvironment(),
    request,
    now,
  });
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase06_auth_service");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = parseEnvironment(
    createValidEnvironment({
      APP_URL,
      DATABASE_URL: migrated.connectionString,
      RATE_LIMIT_BACKEND: "postgres",
    }),
  );

  await database.canton.create({
    data: {
      id: CANTON_ID,
      code: "ZH",
      name: "Zürich",
      slug: "zuerich-phase06-auth",
      language: "DE",
    },
  });
  await database.user.create({
    data: {
      id: LOGIN_FIXTURE_ID,
      email: LOGIN_FIXTURE_EMAIL,
      emailNormalized: LOGIN_FIXTURE_EMAIL,
      name: "Phase 06 Demo Candidate",
      role: "CANDIDATE",
      dataProvenance: "DEMO",
      credential: {
        create: {
          passwordHash: await hashPassword(LOGIN_FIXTURE_PASSWORD),
          algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
          algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
          passwordChangedAt: NOW,
        },
      },
    },
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 06 PostgreSQL auth service", () => {
  it("registers a candidate as one complete draft aggregate without billing or raw secrets", async () => {
    const request = requestContext("192.0.2.10");
    const result = await registerCandidate(
      {
        email: CANDIDATE_EMAIL,
        name: "Candidate Phase 06",
        password: CANDIDATE_PASSWORD,
        passwordConfirmation: CANDIDATE_PASSWORD,
        acceptedTerms: true,
        marketingConsent: true,
      },
      dependencies(request),
    );

    expect(result).toMatchObject({
      ok: true,
      branch: "CANDIDATE",
      destination: "/candidate/jobpass",
    });
    if (!result.ok) throw new Error("Candidate registration unexpectedly failed.");

    const user = await client().user.findUniqueOrThrow({
      where: { emailNormalized: CANDIDATE_EMAIL },
      select: {
        id: true,
        role: true,
        status: true,
        credential: {
          select: {
            passwordHash: true,
            algorithm: true,
            algorithmVersion: true,
            passwordChangedAt: true,
          },
        },
        candidateProfile: {
          select: {
            onboardingStatus: true,
            onboardingEvents: {
              select: {
                kind: true,
                reasonCode: true,
                correlationId: true,
              },
            },
          },
        },
        sessions: {
          select: {
            id: true,
            tokenHash: true,
            ipHash: true,
            userAgent: true,
          },
        },
        userConsents: {
          orderBy: { kind: "asc" },
          select: {
            kind: true,
            granted: true,
            purpose: true,
            noticeVersion: true,
            noticeHash: true,
            actorUserId: true,
            effectiveAt: true,
          },
        },
      },
    });
    const registrationAudit = await client().auditLog.findMany({
      where: { actorUserId: user.id },
      orderBy: { createdAt: "asc" },
    });
    const registrationAnalytics = await client().analyticsEvent.findUnique({
      where: {
        producer_dedupeKey: {
          producer: "auth-registration",
          dedupeKey: `candidate-registered:${user.id}`,
        },
      },
    });

    expect(user).toMatchObject({
      role: "CANDIDATE",
      status: "ACTIVE",
      credential: {
        algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
        algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
        passwordChangedAt: NOW,
      },
      candidateProfile: {
        onboardingStatus: "DRAFT",
        onboardingEvents: [
          {
            kind: "DRAFT_CREATED",
            reasonCode: "REGISTRATION",
            correlationId: request.correlationId,
          },
        ],
      },
      sessions: [
        {
          id: result.session.record.id,
          tokenHash: hashSessionToken(result.session.token),
          userAgent: request.userAgent,
        },
      ],
    });
    expect(user.credential?.passwordHash).toMatch(/^\$2[aby]\$12\$/u);
    expect(user.credential?.passwordHash).not.toBe(CANDIDATE_PASSWORD);
    expect(user.userConsents).toEqual([
      {
        actorUserId: user.id,
        effectiveAt: NOW,
        granted: true,
        kind: "TERMS",
        noticeHash: REGISTRATION_CONSENT_NOTICES_V1.TERMS.noticeHash,
        noticeVersion: REGISTRATION_CONSENT_NOTICES_V1.TERMS.noticeVersion,
        purpose: REGISTRATION_CONSENT_NOTICES_V1.TERMS.purpose,
      },
      {
        actorUserId: user.id,
        effectiveAt: NOW,
        granted: true,
        kind: "MARKETING",
        noticeHash: REGISTRATION_CONSENT_NOTICES_V1.MARKETING.noticeHash,
        noticeVersion:
          REGISTRATION_CONSENT_NOTICES_V1.MARKETING.noticeVersion,
        purpose: REGISTRATION_CONSENT_NOTICES_V1.MARKETING.purpose,
      },
    ]);
    expect(registrationAudit).toHaveLength(1);
    expect(registrationAudit[0]).toMatchObject({
      action: "USER_REGISTERED",
      actorKind: "USER",
      actorUserId: user.id,
      capability: "AUTH_REGISTER_CANDIDATE",
      correlationId: request.correlationId,
      metadata: { role: "CANDIDATE" },
      result: "SUCCEEDED",
      targetId: user.id,
      targetType: "USER",
    });
    expect(registrationAudit[0]?.ipHash).toMatch(/^audit-v1:[a-f0-9]{64}$/u);
    expect(registrationAudit[0]?.ipHash).not.toContain(request.sourceIp);
    expect(registrationAnalytics).toMatchObject({
      kind: "CANDIDATE_REGISTERED",
      purpose: "ESSENTIAL_OPERATIONAL",
      occurredAt: NOW,
      pseudonymousActorId: candidateAnalyticsSubjectV1(user.id),
      actorProvenanceSnapshot: "LIVE",
      properties: {
        onboardingRuleVersion: "candidate-registration-v1",
      },
    });
    expect(registrationAnalytics?.pseudonymousActorId).not.toContain(user.id);
    expect(JSON.stringify(registrationAudit)).not.toContain(CANDIDATE_EMAIL);
    expect(result.session.cookie).toMatchObject({
      name: "session",
      value: result.session.token,
      options: { httpOnly: true, sameSite: "lax", secure: false, path: "/" },
    });
    expect(JSON.stringify({ user, registrationAudit })).not.toContain(
      CANDIDATE_PASSWORD,
    );
    expect(JSON.stringify({ user, registrationAudit })).not.toContain(
      result.session.token,
    );
    await expect(client().candidateConsent.count()).resolves.toBe(0);
    await expectBillingRowsToBeAbsent();
  });

  it("rolls back the candidate aggregate when its required audit cannot be persisted", async () => {
    const rollbackEmail = "candidate.rollback@example.test";
    const result = await registerCandidate(
      {
        email: rollbackEmail,
        name: "Rollback Candidate",
        password: CANDIDATE_PASSWORD,
        passwordConfirmation: CANDIDATE_PASSWORD,
        acceptedTerms: true,
        marketingConsent: false,
      },
      dependencies(
        requestContext("192.0.2.11", { correlationId: "not-a-valid-uuid" }),
      ),
    );

    expect(result).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    await expect(
      client().user.findUnique({ where: { emailNormalized: rollbackEmail } }),
    ).resolves.toBeNull();
    await expect(
      client().auditLog.count({
        where: { capability: "AUTH_REGISTER_CANDIDATE", targetType: "USER" },
      }),
    ).resolves.toBe(1);
  });

  it("creates no account aggregate when a direct caller forges missing Terms", async () => {
    const candidateEmail = "candidate.no-terms@example.test";
    const employerEmail = "owner@no-terms-company.test";
    const candidate = await registerCandidate(
      {
        email: candidateEmail,
        name: "No Terms Candidate",
        password: CANDIDATE_PASSWORD,
        passwordConfirmation: CANDIDATE_PASSWORD,
        acceptedTerms: false,
        marketingConsent: true,
      } as never,
      dependencies(requestContext("192.0.2.12")),
    );
    const employer = await registerEmployer(
      {
        email: employerEmail,
        name: "No Terms Employer",
        companyName: "No Terms Company AG",
        cantonCode: "ZH",
        companySize: "1-9",
        password: "Phase06!EmployerNoTerms42",
        passwordConfirmation: "Phase06!EmployerNoTerms42",
        acceptedTerms: false,
        marketingConsent: true,
      } as never,
      dependencies(requestContext("192.0.2.13")),
    );

    expect(candidate).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    expect(employer).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    await expect(
      client().user.count({
        where: { emailNormalized: { in: [candidateEmail, employerEmail] } },
      }),
    ).resolves.toBe(0);
  });

  it("creates a DRAFT company with its owner, then routes a collision to a claim without membership", async () => {
    const ownerInput = {
      email: "owner@helvetia-phase06.ch",
      name: "Helvetia Owner",
      companyName: "Helvetia Phase 06 AG",
      uid: "CHE-106.060.001",
      cantonCode: "ZH" as const,
      companySize: "11-50",
      password: "Phase06!Employer42",
      passwordConfirmation: "Phase06!Employer42",
      acceptedTerms: true as const,
      marketingConsent: false,
    };
    const ownerRequest = requestContext("192.0.2.20");
    const owner = await registerEmployer(ownerInput, dependencies(ownerRequest));

    expect(owner).toMatchObject({
      ok: true,
      branch: "COMPANY_CREATED",
      destination: "/employer/dashboard",
    });
    if (!owner.ok) throw new Error("Employer owner registration failed.");

    const company = await client().company.findUniqueOrThrow({
      where: { uid: ownerInput.uid },
      include: {
        memberships: { include: { events: true, user: true } },
        statusEvents: true,
        claimRequests: true,
      },
    });
    expect(company).toMatchObject({
      name: ownerInput.companyName,
      status: "DRAFT",
      registrationEmailDomainNormalized: "helvetia-phase06.ch",
      registrationNameNormalized: "helvetia-phase-06-ag",
      registrationCantonId: CANTON_ID,
      statusEvents: [
        {
          kind: "DRAFT_CREATED",
          toStatus: "DRAFT",
          reasonCode: "REGISTRATION",
          correlationId: ownerRequest.correlationId,
        },
      ],
      claimRequests: [],
    });
    expect(company.memberships).toHaveLength(1);
    expect(company.memberships[0]).toMatchObject({
      role: "OWNER",
      status: "ACTIVE",
      events: [
        {
          kind: "CREATED",
          toRole: "OWNER",
          reasonCode: "REGISTRATION",
          correlationId: ownerRequest.correlationId,
        },
      ],
      user: { emailNormalized: ownerInput.email, role: "EMPLOYER" },
    });

    const companyCountBeforeClaim = await client().company.count();
    const claimInput = {
      ...ownerInput,
      email: "claimant@helvetia-phase06.ch",
      name: "Helvetia Claimant",
      password: "Phase06!Claimant42",
      passwordConfirmation: "Phase06!Claimant42",
      marketingConsent: true,
    };
    const claimRequest = requestContext("192.0.2.21");
    const claimant = await registerEmployer(
      claimInput,
      dependencies(claimRequest),
    );

    expect(claimant).toMatchObject({
      ok: true,
      branch: "COMPANY_CLAIM",
      destination: "/employer/company/claim-pending",
    });
    if (!claimant.ok) throw new Error("Employer claim registration failed.");
    expect(await client().company.count()).toBe(companyCountBeforeClaim);

    const missingTargetEmail = "missing-target@phase07-claim.test";
    const missingTarget = await registerEmployer(
      {
        ...ownerInput,
        email: missingTargetEmail,
        name: "Missing Target Claimant",
        companyName: "Missing Target Phase 07 AG",
        uid: "CHE-107.070.099",
        password: "Phase07!MissingTarget42",
        passwordConfirmation: "Phase07!MissingTarget42",
      },
      {
        ...dependencies(requestContext("192.0.2.22")),
        claimedCompanyId: randomUUID(),
      },
    );
    expect(missingTarget).toEqual({
      ok: false,
      code: "REGISTRATION_FAILED",
    });
    expect(await client().company.count()).toBe(companyCountBeforeClaim);
    expect(
      await client().user.findUnique({
        where: { emailNormalized: missingTargetEmail },
        select: { id: true },
      }),
    ).toBeNull();

    const claimantUser = await client().user.findUniqueOrThrow({
      where: { emailNormalized: claimInput.email },
      include: {
        employerProfile: true,
        companyMemberships: true,
        claimRequests: { include: { events: true } },
        userConsents: true,
      },
    });
    expect(claimantUser.employerProfile).toMatchObject({
      displayName: claimInput.name,
    });
    expect(claimantUser.companyMemberships).toEqual([]);
    expect(claimantUser.claimRequests).toHaveLength(1);
    expect(claimantUser.claimRequests[0]).toMatchObject({
      candidateCompanyId: company.id,
      requestedRole: "OWNER",
      status: "PENDING",
      matchSignals: ["UID", "EMAIL_DOMAIN", "NAME_CANTON"],
      events: [
        {
          kind: "CREATED",
          reasonCode: "REGISTRATION_SIGNAL_MATCH",
          correlationId: claimRequest.correlationId,
        },
      ],
    });
    expect(claimantUser.userConsents).toHaveLength(2);

    const companyAudits = await client().auditLog.findMany({
      where: {
        action: { in: ["COMPANY_CREATED_WITH_OWNER", "COMPANY_CLAIM_REQUESTED"] },
        companyId: company.id,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(companyAudits).toHaveLength(2);
    expect(companyAudits.map(({ action, metadata }) => ({ action, metadata })))
      .toEqual(expect.arrayContaining([
        {
          action: "COMPANY_CREATED_WITH_OWNER",
          metadata: { signalCodes: ["UID", "EMAIL_DOMAIN", "NAME_CANTON"] },
        },
        {
          action: "COMPANY_CLAIM_REQUESTED",
          metadata: { signalCodes: ["UID", "EMAIL_DOMAIN", "NAME_CANTON"] },
        },
      ]));
    expect(JSON.stringify(companyAudits)).not.toContain(ownerInput.email);
    expect(JSON.stringify(companyAudits)).not.toContain(claimInput.email);
    expect(JSON.stringify(companyAudits)).not.toContain(ownerInput.password);
    expect(JSON.stringify(companyAudits)).not.toContain(ownerInput.uid);
    expect(JSON.stringify(companyAudits)).not.toContain("helvetia-phase06.ch");
    await expectBillingRowsToBeAbsent(company.id);
  });

  it("serializes parallel matching employer registrations into exactly one company and one pending claim", async () => {
    const inputs = [
      {
        email: "parallel.one@collision-phase06.ch",
        name: "Parallel Owner One",
      },
      {
        email: "parallel.two@collision-phase06.ch",
        name: "Parallel Owner Two",
      },
    ].map((identity) => ({
      ...identity,
      companyName: "Parallel Collision Phase 06 AG",
      uid: "CHE-106.060.002",
      cantonCode: "ZH" as const,
      companySize: "51-200",
      password: "Phase06!Parallel42",
      passwordConfirmation: "Phase06!Parallel42",
      acceptedTerms: true as const,
      marketingConsent: false,
    }));

    const results = await Promise.all([
      registerEmployer(inputs[0]!, dependencies(requestContext("192.0.2.30"))),
      registerEmployer(inputs[1]!, dependencies(requestContext("192.0.2.31"))),
    ]);

    expect(results.every(({ ok }) => ok)).toBe(true);
    expect(results.filter((result) => result.ok && result.branch === "COMPANY_CREATED"))
      .toHaveLength(1);
    expect(results.filter((result) => result.ok && result.branch === "COMPANY_CLAIM"))
      .toHaveLength(1);

    const companies = await client().company.findMany({
      where: { uid: "CHE-106.060.002" },
      include: {
        memberships: { include: { user: true } },
        claimRequests: { include: { requester: true, events: true } },
      },
    });
    expect(companies).toHaveLength(1);
    const company = companies[0]!;
    expect(company.status).toBe("DRAFT");
    expect(company.memberships).toHaveLength(1);
    expect(company.memberships[0]).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect(company.claimRequests).toHaveLength(1);
    expect(company.claimRequests[0]).toMatchObject({
      requestedRole: "OWNER",
      status: "PENDING",
      matchSignals: ["UID", "EMAIL_DOMAIN", "NAME_CANTON"],
      events: [{ kind: "CREATED" }],
    });
    const participatingEmails = [
      company.memberships[0]!.user.emailNormalized,
      company.claimRequests[0]!.requester.emailNormalized,
    ].sort();
    expect(participatingEmails).toEqual(inputs.map(({ email }) => email).sort());
    expect(company.memberships[0]!.userId).not.toBe(
      company.claimRequests[0]!.requesterEmployerUserId,
    );
    await expectBillingRowsToBeAbsent(company.id);
  });

  it("logs a demo fixture in and returns one generic audited failure contract without raw identifiers", async () => {
    const successRequest = requestContext("192.0.2.40");
    const success = await loginWithPassword(
      {
        email: LOGIN_FIXTURE_EMAIL,
        password: LOGIN_FIXTURE_PASSWORD,
        next: "/candidate/jobpass?step=2",
      },
      dependencies(successRequest),
    );
    expect(success).toMatchObject({
      ok: true,
      role: "CANDIDATE",
      destination: "/candidate/jobpass?step=2",
    });
    if (!success.ok) throw new Error("Demo fixture login unexpectedly failed.");
    expect(success.session.record.tokenHash).toBe(
      hashSessionToken(success.session.token),
    );

    const knownRequest = requestContext("192.0.2.41");
    const unknownRequest = requestContext("192.0.2.42");
    const [knownFailure, unknownFailure] = await Promise.all([
      loginWithPassword(
        {
          email: LOGIN_FIXTURE_EMAIL,
          password: "Definitely!Wrong42",
        },
        dependencies(knownRequest),
      ),
      loginWithPassword(
        {
          email: "unknown.phase06@fixture.example",
          password: "Definitely!Wrong42",
        },
        dependencies(unknownRequest),
      ),
    ]);
    expect(knownFailure).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(unknownFailure).toEqual(knownFailure);

    const failureAudits = await client().auditLog.findMany({
      where: {
        correlationId: { in: [knownRequest.correlationId, unknownRequest.correlationId] },
      },
      orderBy: { correlationId: "asc" },
    });
    expect(failureAudits).toHaveLength(2);
    expect(failureAudits.every(({ action }) => action === "USER_LOGIN_FAILED"))
      .toBe(true);
    expect(failureAudits.every(({ result }) => result === "DENIED")).toBe(true);
    expect(
      failureAudits.every(
        ({ metadata }) =>
          typeof metadata === "object" &&
          metadata !== null &&
          "identifierHash" in metadata &&
          typeof metadata.identifierHash === "string" &&
          /^audit-v1:[a-f0-9]{64}$/u.test(metadata.identifierHash),
      ),
    ).toBe(true);
    const serializedAudits = JSON.stringify(failureAudits);
    expect(serializedAudits).not.toContain(LOGIN_FIXTURE_EMAIL);
    expect(serializedAudits).not.toContain("unknown.phase06@fixture.example");
    expect(serializedAudits).not.toContain("Definitely!Wrong42");
    expect(serializedAudits).not.toContain(knownRequest.sourceIp);
    expect(serializedAudits).not.toContain(unknownRequest.sourceIp);
  });

  it("never keeps a company-context selection after its active membership disappears", () => {
    const first = membershipContext(
      "11111111-1111-4111-8111-111111111111",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Alpha AG",
    );
    const second = membershipContext(
      "22222222-2222-4222-8222-222222222222",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "Beta AG",
    );
    const third = membershipContext(
      "33333333-3333-4333-8333-333333333333",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "Gamma AG",
    );

    expect(resolveEmployerContextSelection([first, second], second.companyId))
      .toBe(second);
    expect(resolveEmployerContextSelection([second], first.companyId)).toBe(
      second,
    );
    expect(
      resolveEmployerContextSelection([second, third], first.companyId),
    ).toBeNull();
    expect(resolveEmployerContextSelection([], first.companyId)).toBeNull();
    expect(resolveEmployerContextSelection([first, second], undefined)).toBeNull();
  });

  it("stores only a reset hash and allows exactly one parallel reset while revoking every session", async () => {
    const secondLogin = await loginWithPassword(
      { email: LOGIN_FIXTURE_EMAIL, password: LOGIN_FIXTURE_PASSWORD },
      dependencies(requestContext("192.0.2.50"), new Date(NOW.getTime() + 1_000)),
    );
    expect(secondLogin.ok).toBe(true);
    expect(
      await client().session.count({
        where: { userId: LOGIN_FIXTURE_ID, revokedAt: null },
      }),
    ).toBeGreaterThanOrEqual(2);

    const mailbox = new LocalMockMailbox({
      allowedOrigin: APP_URL,
      secret: MAILBOX_SECRET,
      now: () => NOW,
    });
    const emailProvider = new MockEmailProvider(
      new PrismaEmailLogRepository(client()),
      {
        mailbox: {
          validate: (input) => {
            mailbox.validate(input);
          },
          capture: (input) => {
            mailbox.capture(input);
          },
        },
      },
    );
    const resetRequest = requestContext("192.0.2.51");
    await expect(
      requestPasswordReset(
        { email: LOGIN_FIXTURE_EMAIL },
        { ...dependencies(resetRequest), emailProvider },
      ),
    ).resolves.toEqual({ ok: true, rateLimited: false });

    const delivered = mailbox.consume(`Bearer ${MAILBOX_SECRET}`);
    expect(delivered.status).toBe("delivered");
    if (delivered.status !== "delivered") {
      throw new Error("The local reset mailbox did not receive the reset link.");
    }
    const resetUrl = new URL(delivered.envelope.actionUrl);
    expect(resetUrl.search).toBe("");
    const rawToken = new URLSearchParams(resetUrl.hash.slice(1)).get("token");
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    if (rawToken === null) throw new Error("The reset link has no token.");

    const persistedToken = await client().passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashPasswordResetToken(rawToken) },
    });
    const emailLog = await client().emailLog.findFirstOrThrow({
      where: {
        recipient: LOGIN_FIXTURE_EMAIL,
        templateKey: "password_reset_mock",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(persistedToken).toMatchObject({
      userId: LOGIN_FIXTURE_ID,
      tokenHash: hashPasswordResetToken(rawToken),
      usedAt: null,
      requestedUserAgent: resetRequest.userAgent,
    });
    expect(persistedToken.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(emailLog)).not.toContain(rawToken);
    expect(JSON.stringify(emailLog)).not.toContain(delivered.envelope.actionUrl);
    expect(JSON.stringify(emailLog)).not.toContain(RESET_PASSWORD);

    const resetInput = {
      token: rawToken,
      password: RESET_PASSWORD,
      passwordConfirmation: RESET_PASSWORD,
    };
    const results = await Promise.all([
      resetPassword(
        resetInput,
        dependencies(requestContext("192.0.2.52"), new Date(NOW.getTime() + 2_000)),
      ),
      resetPassword(
        resetInput,
        dependencies(requestContext("192.0.2.53"), new Date(NOW.getTime() + 2_000)),
      ),
    ]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.filter(({ ok }) => !ok)).toEqual([
      { ok: false, code: "INVALID_RESET_TOKEN" },
    ]);

    const sessions = await client().session.findMany({
      where: { userId: LOGIN_FIXTURE_ID },
      select: { revokedAt: true },
    });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true);
    await expect(
      client().passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: persistedToken.tokenHash },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: new Date(NOW.getTime() + 2_000) });
    const resetAudits = await client().auditLog.findMany({
      where: {
        action: "PASSWORD_RESET_COMPLETED",
        targetId: LOGIN_FIXTURE_ID,
      },
      select: { result: true, reasonCode: true },
    });
    expect(resetAudits).toEqual(
      expect.arrayContaining([
        { result: "SUCCEEDED", reasonCode: null },
        { result: "DENIED", reasonCode: "INVALID_RESET_TOKEN" },
      ]),
    );
    expect(resetAudits).toHaveLength(2);

    const completedLogin = await loginWithPassword(
      { email: LOGIN_FIXTURE_EMAIL, password: RESET_PASSWORD },
      dependencies(requestContext("192.0.2.54"), new Date(NOW.getTime() + 3_000)),
    );
    expect(completedLogin.ok).toBe(true);
    const resetPersistence = JSON.stringify({
      persistedToken,
      emailLog,
      audits: await client().auditLog.findMany({
        where: {
          action: { in: ["PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED"] },
          targetId: LOGIN_FIXTURE_ID,
        },
      }),
    });
    expect(resetPersistence).not.toContain(rawToken);
    expect(resetPersistence).not.toContain(RESET_PASSWORD);

    const unknownEmailCountBefore = await client().emailLog.count();
    await expect(
      requestPasswordReset(
        { email: "unknown.reset@fixture.example" },
        {
          ...dependencies(requestContext("192.0.2.55"), new Date(NOW.getTime() + 4_000)),
          emailProvider,
        },
      ),
    ).resolves.toEqual({ ok: true, rateLimited: false });
    await expect(client().emailLog.count()).resolves.toBe(unknownEmailCountBefore);
  });
});

async function expectBillingRowsToBeAbsent(companyId?: string) {
  const where = companyId === undefined ? undefined : { companyId };
  const counts = await Promise.all([
    client().companyBillingProfile.count({ where }),
    client().employerSubscription.count({ where }),
    client().order.count({ where }),
    client().invoice.count({ where }),
    client().entitlementGrant.count({ where }),
    client().creditAccount.count({ where }),
  ]);
  expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
}

function membershipContext(
  membershipId: string,
  companyId: string,
  companyName: string,
): EmployerMembershipContext {
  return Object.freeze({
    membershipId,
    membershipRole: "OWNER",
    companyId,
    companyName,
    companySlug: companyName.toLowerCase().replaceAll(" ", "-"),
    companyStatus: "ACTIVE",
  });
}
