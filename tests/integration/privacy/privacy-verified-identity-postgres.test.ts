import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import { registerCandidate } from "@/lib/auth/auth-service";
import { consumeEmailVerification } from "@/lib/auth/email-verification-service";
import { createVerificationToken } from "@/lib/auth/verification-token";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { createPostgresPrivacyRequestRepository } from "@/lib/privacy/postgres-adapters";
import {
  createPostgresPrivacyCaseService,
  PRIVACY_CASE_SERVICE_POLICY_V1,
} from "@/lib/privacy/privacy-case-service";
import {
  createPrivacyRequest,
  PRIVACY_REQUEST_POLICY_V1,
} from "@/lib/privacy/requests";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  PHASE20_NOW,
  PHASE20_PASSWORD,
  createPhase20User,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: Migrated | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase20_privacy_verified_identity",
  );
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = phase20Environment(migrated.connectionString, {
    IDENTITY_VERIFICATION_ENFORCEMENT: "true",
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await migrated?.dispose();
});

describe.sequential("Phase 20 verified identity to Privacy challenge", () => {
  it("connects registration, verification, Privacy intake and the existing identity challenge", async () => {
    const email = "phase20-privacy-candidate@example.test";
    await expect(
      registerCandidate(
        {
          email,
          name: "Phase 20 Privacy Candidate",
          password: PHASE20_PASSWORD,
          passwordConfirmation: PHASE20_PASSWORD,
          acceptedTerms: true,
          marketingConsent: false,
        },
        authDependencies(1),
      ),
    ).resolves.toMatchObject({
      ok: true,
      destination: "/verify-email?registered=1",
    });
    const user = await db().user.findUniqueOrThrow({
      where: { emailNormalized: email },
      include: {
        emailVerificationChallenges: true,
      },
    });
    expect(user).toMatchObject({
      emailVerifiedAt: null,
      identityAssurance: "LOW_ASSURANCE",
    });

    const beforeVerify = await createPrivacyRequest(
      { userId: user.id, userStatus: "ACTIVE" },
      {
        type: "EXPORT",
        idempotencyKey: "phase20-before-verify",
        noticeVersion: PRIVACY_REQUEST_POLICY_V1.noticeVersion,
      },
      PHASE20_NOW,
      createPostgresPrivacyRequestRepository(db()),
    );
    expect(beforeVerify).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(
      await db().privacyRequest.count({
        where: { requesterUserId: user.id },
      }),
    ).toBe(0);

    const challenge = user.emailVerificationChallenges[0]!;
    const token = createVerificationToken(
      challenge.id,
      challenge.purpose,
      challenge.addressEpoch,
      env().secrets.session,
    );
    await expect(
      consumeEmailVerification(token, undefined, {
        database: db(),
        environment: env(),
        request: phase20Request(2),
        now: new Date(PHASE20_NOW.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ ok: true, status: "VERIFIED" });

    const intake = await createPrivacyRequest(
      { userId: user.id, userStatus: "ACTIVE" },
      {
        type: "EXPORT",
        idempotencyKey: "phase20-after-verify",
        noticeVersion: PRIVACY_REQUEST_POLICY_V1.noticeVersion,
      },
      new Date(PHASE20_NOW.getTime() + 2_000),
      createPostgresPrivacyRequestRepository(db()),
    );
    expect(intake).toMatchObject({
      ok: true,
      created: true,
      type: "EXPORT",
      status: "PENDING",
    });
    if (!intake.ok) throw new Error("Expected verified Privacy intake.");

    const admin = await createPhase20Admin(
      "phase20-privacy-admin@example.test",
    );
    const service = createPostgresPrivacyCaseService(db());
    const verifier = {
      userId: admin.id,
      capabilities: ["PRIVACY_CASE_VERIFY"] as const,
    };
    await expect(
      service.startIdentityCheck(
        verifier,
        {
          requestId: intake.requestId,
          version: 1,
          idempotencyKey: "phase20-privacy-start",
        },
        new Date(PHASE20_NOW.getTime() + 3_000),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "IDENTITY_CHECK",
      version: 2,
    });
    await expect(
      service.completeIdentityChallenge(
        { userId: user.id },
        {
          requestId: intake.requestId,
          version: 2,
          idempotencyKey: "phase20-privacy-owner-proof",
        },
        { credentialVerified: true },
        new Date(PHASE20_NOW.getTime() + 4_000),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "IDENTITY_CHECK",
      version: 3,
    });
    await expect(
      service.verifyIdentity(
        verifier,
        {
          requestId: intake.requestId,
          version: 3,
          idempotencyKey: "phase20-privacy-admin-verify",
        },
        new Date(PHASE20_NOW.getTime() + 5_000),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "IN_PROGRESS",
      version: 4,
    });
    expect(
      await db().privacyRequest.findUniqueOrThrow({
        where: { id: intake.requestId },
        include: { challenges: true },
      }),
    ).toMatchObject({
      requesterUserId: user.id,
      status: "IN_PROGRESS",
      version: 4,
      challenges: [
        {
          attempts: 1,
          verifiedAt: new Date(PHASE20_NOW.getTime() + 4_000),
          consumedAt: new Date(PHASE20_NOW.getTime() + 5_000),
        },
      ],
    });
  });

  it("denies foreign ownership and an expired challenge with zero foreign writes", async () => {
    const requester = await createPhase20User(db(), {
      email: "phase20-privacy-expired@example.test",
      verified: true,
    });
    const foreign = await createPhase20User(db(), {
      email: "phase20-privacy-foreign@example.test",
      verified: true,
    });
    const admin = await createPhase20Admin(
      "phase20-privacy-expiry-admin@example.test",
    );
    const intake = await createPrivacyRequest(
      { userId: requester.id, userStatus: "ACTIVE" },
      {
        type: "DELETE",
        deleteConfirmation:
          PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase,
        idempotencyKey: "phase20-privacy-expired",
        noticeVersion: PRIVACY_REQUEST_POLICY_V1.noticeVersion,
      },
      PHASE20_NOW,
      createPostgresPrivacyRequestRepository(db()),
    );
    if (!intake.ok) throw new Error("Expected Privacy expiry fixture.");
    const service = createPostgresPrivacyCaseService(db());
    await service.startIdentityCheck(
      {
        userId: admin.id,
        capabilities: ["PRIVACY_CASE_VERIFY"],
      },
      {
        requestId: intake.requestId,
        version: 1,
        idempotencyKey: "phase20-expiry-start",
      },
      PHASE20_NOW,
    );
    const before = await db().privacyIdentityChallenge.findFirstOrThrow({
      where: { privacyRequestId: intake.requestId },
    });
    await expect(
      service.completeIdentityChallenge(
        { userId: foreign.id },
        {
          requestId: intake.requestId,
          version: 2,
          idempotencyKey: "phase20-foreign-denied",
        },
        { credentialVerified: true },
        new Date(PHASE20_NOW.getTime() + 1_000),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      service.completeIdentityChallenge(
        { userId: requester.id },
        {
          requestId: intake.requestId,
          version: 2,
          idempotencyKey: "phase20-expired-denied",
        },
        { credentialVerified: true },
        new Date(
          PHASE20_NOW.getTime() +
            (PRIVACY_CASE_SERVICE_POLICY_V1.challengeLifetimeMinutes + 1) *
              60_000,
        ),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "CHALLENGE_UNAVAILABLE",
    });
    const after = await db().privacyIdentityChallenge.findFirstOrThrow({
      where: { privacyRequestId: intake.requestId },
    });
    expect(after).toMatchObject({
      attempts: before.attempts,
      verifiedAt: null,
      consumedAt: null,
    });
    expect(
      await db().privacyRequest.findUniqueOrThrow({
        where: { id: intake.requestId },
      }),
    ).toMatchObject({
      requesterUserId: requester.id,
      status: "IDENTITY_CHECK",
      version: 2,
    });
  });
});

async function createPhase20Admin(email: string) {
  return db().user.create({
    data: {
      email,
      emailNormalized: email,
      role: "ADMIN",
      dataProvenance: "TEST",
      status: "ACTIVE",
      emailVerifiedAt: PHASE20_NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
    select: { id: true },
  });
}

function authDependencies(index: number) {
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
  if (environment === undefined) {
    throw new Error("Phase 20 environment unavailable.");
  }
  return environment;
}
