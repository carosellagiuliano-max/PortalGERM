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
  cancelLoginEmailChange,
  requestLoginEmailChange,
} from "@/lib/auth/email-change-service";
import { consumeEmailVerification } from "@/lib/auth/email-verification-service";
import { createVerificationToken } from "@/lib/auth/verification-token";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  PHASE20_NOW,
  PHASE20_PASSWORD,
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
  migrated = await createMigratedTestDatabase("phase20_email_change");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = phase20Environment(migrated.connectionString, {
    IDENTITY_VERIFICATION_ENFORCEMENT: "true",
    LOGIN_EMAIL_CHANGE: "true",
  });
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await migrated?.dispose();
});

describe.sequential("Phase 20 login e-mail change", () => {
  it("keeps the old login authoritative until verify, then changes one epoch and rotates every session", async () => {
    const oldEmail = "email-change-old@example.test";
    const newEmail = "email-change-new@example.test";
    const user = await createPhase20User(db(), {
      email: oldEmail,
      verified: true,
    });
    const initiating = await issuePhase20Session(
      db(),
      env(),
      user.id,
      phase20Request(1),
    );
    const other = await issuePhase20Session(
      db(),
      env(),
      user.id,
      phase20Request(2),
    );

    const requested = await requestLoginEmailChange(
      {
        userId: user.id,
        sessionToken: initiating.token,
        targetEmail: newEmail,
        password: PHASE20_PASSWORD,
      },
      {
        database: db(),
        environment: env(),
        request: phase20Request(3),
        now: PHASE20_NOW,
      },
    );
    expect(requested).toMatchObject({ ok: true, status: "PENDING" });

    const beforeVerify = await db().user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        pendingEmailChanges: {
          include: { challenge: true },
        },
      },
    });
    expect(beforeVerify).toMatchObject({
      emailNormalized: oldEmail,
      emailAddressEpoch: 1,
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(beforeVerify.pendingEmailChanges).toHaveLength(1);
    const pending = beforeVerify.pendingEmailChanges[0]!;
    expect(pending).toMatchObject({
      targetEmailNormalized: newEmail,
      addressEpoch: 2,
      status: "PENDING",
      initiatedBySessionId: initiating.record.id,
    });
    expect(
      await db().notificationOutbox.count({
        where: {
          purpose: "LOGIN_EMAIL_CHANGE_VERIFICATION",
          recipientUserId: null,
        },
      }),
    ).toBe(1);

    const token = createVerificationToken(
      pending.challenge.id,
      pending.challenge.purpose,
      pending.challenge.addressEpoch,
      env().secrets.session,
    );
    const crossSession = await consumeEmailVerification(token, other.token, {
      database: db(),
      environment: env(),
      request: phase20Request(4),
      now: new Date(PHASE20_NOW.getTime() + 1_000),
    });
    expect(crossSession).toMatchObject({ ok: false, status: "INVALID" });
    expect(
      await db().user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ emailNormalized: oldEmail, emailAddressEpoch: 1 });

    const completed = await consumeEmailVerification(
      token,
      initiating.token,
      {
        database: db(),
        environment: env(),
        request: phase20Request(5),
        now: new Date(PHASE20_NOW.getTime() + 2_000),
      },
    );
    expect(completed).toMatchObject({
      ok: true,
      status: "VERIFIED",
      role: "CANDIDATE",
    });
    if (!completed.ok || completed.session === undefined) {
      throw new Error("Expected rotated Phase 20 session.");
    }
    const rotatedSession = completed.session;

    const [changed, sessions, evidence, notices] = await Promise.all([
      db().user.findUniqueOrThrow({ where: { id: user.id } }),
      db().session.findMany({ where: { userId: user.id } }),
      db().authAssuranceEvidence.findMany({
        where: { userId: user.id, purpose: "LOGIN_EMAIL_CHANGE" },
        orderBy: { createdAt: "asc" },
      }),
      db().notificationOutbox.findMany({
        where: {
          templateKey: "login_email_changed_notice",
          dedupeKey: `login-email-changed:${pending.id}`,
        },
      }),
    ]);
    expect(changed).toMatchObject({
      email: newEmail,
      emailNormalized: newEmail,
      emailAddressEpoch: 2,
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(changed.emailVerifiedAt).toEqual(
      new Date(PHASE20_NOW.getTime() + 2_000),
    );
    expect(sessions.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(
      1,
    );
    expect(
      sessions.find(({ id }) => id === initiating.record.id)?.revokedAt,
    ).not.toBeNull();
    expect(
      sessions.find(({ id }) => id === other.record.id)?.revokedAt,
    ).not.toBeNull();
    expect(
      sessions.find(({ id }) => id === rotatedSession.record.id),
    ).toMatchObject({ revokedAt: null });
    expect(evidence.map(({ action }) => action)).toEqual([
      "LOGIN_EMAIL_CHANGE_REQUEST",
      "LOGIN_EMAIL_CHANGE_COMMIT",
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      recipientUserId: null,
      purpose: "LOGIN_EMAIL_CHANGED_NOTICE",
      purposeClass: "MANDATORY",
    });
    expect(notices[0]?.recipientAddressCiphertext).not.toBeNull();

    await expect(
      consumeEmailVerification(token, rotatedSession.token, {
        database: db(),
        environment: env(),
        request: phase20Request(6),
        now: new Date(PHASE20_NOW.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({ ok: false, status: "INVALID" });
  });

  it("rejects wrong credentials and occupied targets without creating pending state", async () => {
    const user = await createPhase20User(db(), {
      email: "email-change-negative@example.test",
      verified: true,
    });
    const occupied = await createPhase20User(db(), {
      email: "email-change-occupied@example.test",
      verified: true,
    });
    const session = await issuePhase20Session(
      db(),
      env(),
      user.id,
      phase20Request(20),
    );

    await expect(
      requestLoginEmailChange(
        {
          userId: user.id,
          sessionToken: session.token,
          targetEmail: "unused-email-change@example.test",
          password: "DefinitelyWrong!42",
        },
        {
          database: db(),
          environment: env(),
          request: phase20Request(21),
          now: PHASE20_NOW,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: "INVALID_CREDENTIALS",
    });
    await expect(
      requestLoginEmailChange(
        {
          userId: user.id,
          sessionToken: session.token,
          targetEmail: occupied.emailNormalized,
          password: PHASE20_PASSWORD,
        },
        {
          database: db(),
          environment: env(),
          request: phase20Request(22),
          now: new Date(PHASE20_NOW.getTime() + 1_000),
        },
      ),
    ).resolves.toMatchObject({ ok: false, status: "CONFLICT" });
    expect(
      await db().pendingEmailChange.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("keeps login e-mail change locked for a low-assurance session", async () => {
    const user = await createPhase20User(db(), {
      email: "email-change-low-assurance@example.test",
      verified: false,
    });
    const session = await issuePhase20Session(
      db(),
      env(),
      user.id,
      phase20Request(25),
    );
    await expect(
      requestLoginEmailChange(
        {
          userId: user.id,
          sessionToken: session.token,
          targetEmail: "email-change-low-target@example.test",
          password: PHASE20_PASSWORD,
        },
        {
          database: db(),
          environment: env(),
          request: phase20Request(26),
          now: PHASE20_NOW,
        },
      ),
    ).resolves.toEqual({ ok: false, status: "LOCKED" });
    expect(
      await db().pendingEmailChange.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("cancels only from the bound live session and makes its token terminal", async () => {
    const user = await createPhase20User(db(), {
      email: "email-change-cancel@example.test",
      verified: true,
    });
    const ownerSession = await issuePhase20Session(
      db(),
      env(),
      user.id,
      phase20Request(30),
    );
    const foreignUser = await createPhase20User(db(), {
      email: "email-change-foreign@example.test",
      verified: true,
    });
    const foreignSession = await issuePhase20Session(
      db(),
      env(),
      foreignUser.id,
      phase20Request(31),
    );
    await expect(
      requestLoginEmailChange(
        {
          userId: user.id,
          sessionToken: ownerSession.token,
          targetEmail: "email-change-cancel-target@example.test",
          password: PHASE20_PASSWORD,
        },
        {
          database: db(),
          environment: env(),
          request: phase20Request(32),
          now: PHASE20_NOW,
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: "PENDING" });
    await expect(
      cancelLoginEmailChange(
        { userId: user.id, sessionToken: foreignSession.token },
        {
          database: db(),
          environment: env(),
          request: phase20Request(33),
          now: new Date(PHASE20_NOW.getTime() + 1_000),
        },
      ),
    ).resolves.toEqual({ ok: false });
    await expect(
      cancelLoginEmailChange(
        { userId: user.id, sessionToken: ownerSession.token },
        {
          database: db(),
          environment: env(),
          request: phase20Request(34),
          now: new Date(PHASE20_NOW.getTime() + 2_000),
        },
      ),
    ).resolves.toEqual({ ok: true });

    const pending = await db().pendingEmailChange.findFirstOrThrow({
      where: { userId: user.id },
      include: { challenge: true },
    });
    expect(pending).toMatchObject({
      status: "CANCELLED",
      completedAt: null,
    });
    expect(pending.cancelledAt).not.toBeNull();
    expect(pending.challenge.supersededAt).not.toBeNull();
  });
});

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
