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
  consumeEmailVerification,
  createInitialEmailVerification,
  requestEmailVerification,
} from "@/lib/auth/email-verification-service";
import { createVerificationToken } from "@/lib/auth/verification-token";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  PHASE20_NOW,
  createPhase20User,
  issuePhase20Session,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: Migrated | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase20_email_verification_races",
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

describe.sequential("Phase 20 verification races", () => {
  it("allows exactly one of twenty concurrent consumes and rotates the matching session", async () => {
    const user = await createPhase20User(db(), {
      email: "race.phase20@example.test",
    });
    const initial = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: user.id,
        emailNormalized: user.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(1).correlationId,
        environment: env(),
      }),
    );
    const oldSession = await issuePhase20Session(
      db(),
      env(),
      user.id,
      phase20Request(2),
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        consumeEmailVerification(initial.rawToken, oldSession.token, {
          database: db(),
          environment: env(),
          request: phase20Request(index + 10),
          now: PHASE20_NOW,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(19);

    const [persistedUser, challenge, sessions] = await Promise.all([
      db().user.findUniqueOrThrow({ where: { id: user.id } }),
      db().emailVerificationChallenge.findUniqueOrThrow({
        where: { id: initial.challengeId },
      }),
      db().session.findMany({ where: { userId: user.id } }),
    ]);
    expect(persistedUser).toMatchObject({
      emailVerifiedAt: PHASE20_NOW,
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(challenge.usedAt).toEqual(PHASE20_NOW);
    expect(sessions.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(
      1,
    );
    expect(
      sessions.find(({ id }) => id === oldSession.record.id)?.revokedAt,
    ).toEqual(PHASE20_NOW);
  });

  it("supersedes resend tokens and rejects expired, replayed and cross-purpose tokens", async () => {
    const user = await createPhase20User(db(), {
      email: "supersession.phase20@example.test",
    });
    const initial = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: user.id,
        emailNormalized: user.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(40).correlationId,
        environment: env(),
      }),
    );
    await requestEmailVerification(user.emailNormalized, {
      database: db(),
      environment: env(),
      request: phase20Request(41),
      now: new Date(PHASE20_NOW.getTime() + 1_000),
    });
    const current = await db().emailVerificationChallenge.findFirstOrThrow({
      where: {
        userId: user.id,
        usedAt: null,
        supersededAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    const currentToken = createVerificationToken(
      current.id,
      current.purpose,
      current.addressEpoch,
      env().secrets.session,
    );
    await expect(
      consumeEmailVerification(initial.rawToken, undefined, {
        database: db(),
        environment: env(),
        request: phase20Request(42),
        now: new Date(PHASE20_NOW.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({ ok: false, status: "INVALID" });
    const success = await consumeEmailVerification(currentToken, undefined, {
      database: db(),
      environment: env(),
      request: phase20Request(43),
      now: new Date(PHASE20_NOW.getTime() + 2_000),
    });
    expect(success).toMatchObject({ ok: true, status: "VERIFIED" });
    await expect(
      consumeEmailVerification(currentToken, undefined, {
        database: db(),
        environment: env(),
        request: phase20Request(44),
        now: new Date(PHASE20_NOW.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({ ok: false, status: "INVALID" });

    const expiredUser = await createPhase20User(db(), {
      email: "expired.phase20@example.test",
    });
    const expired = await db().$transaction((transaction) =>
      createInitialEmailVerification(transaction, {
        userId: expiredUser.id,
        emailNormalized: expiredUser.emailNormalized,
        now: PHASE20_NOW,
        correlationId: phase20Request(45).correlationId,
        environment: env(),
      }),
    );
    await expect(
      consumeEmailVerification(expired.rawToken, undefined, {
        database: db(),
        environment: env(),
        request: phase20Request(46),
        now: new Date(PHASE20_NOW.getTime() + 31 * 60_000),
      }),
    ).resolves.toMatchObject({ ok: false, status: "INVALID" });

    const crossPurpose = createVerificationToken(
      current.id,
      "INVITATION",
      current.addressEpoch,
      env().secrets.session,
    );
    await expect(
      consumeEmailVerification(crossPurpose, undefined, {
        database: db(),
        environment: env(),
        request: phase20Request(47),
        now: new Date(PHASE20_NOW.getTime() + 4_000),
      }),
    ).resolves.toMatchObject({ ok: false, status: "INVALID" });
  });
});

function db() {
  if (database === undefined) throw new Error("Phase 20 database unavailable.");
  return database;
}

function env() {
  if (environment === undefined) throw new Error("Phase 20 environment unavailable.");
  return environment;
}
