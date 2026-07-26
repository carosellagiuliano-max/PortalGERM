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
  loginWithPassword,
  requestPasswordReset,
} from "@/lib/auth/auth-service";
import { requestEmailVerification } from "@/lib/auth/email-verification-service";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import {
  PHASE20_SANDBOX_REPLAY_CONFIRMATION,
  replayDeadLetterNotification,
} from "@/lib/notifications/replay";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
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

const noDeliveryProvider: EmailProvider = Object.freeze({
  async send() {
    throw new Error("Identity abuse tests must not perform direct delivery.");
  },
});

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase20_identity_abuse");
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

describe.sequential("Phase 20 identity abuse and enumeration controls", () => {
  it("returns the same resend result for known and unknown addresses and blocks exactly after five", async () => {
    const known = await createPhase20User(db(), {
      email: "identity-abuse-known@example.test",
    });
    const knownResult = await requestEmailVerification(
      known.emailNormalized,
      dependencies(10),
    );
    const unknownEmail = "identity-abuse-unknown@example.test";
    const unknownResult = await requestEmailVerification(
      unknownEmail,
      dependencies(11),
    );
    expect(knownResult).toEqual({ ok: true, rateLimited: false });
    expect(unknownResult).toEqual(knownResult);

    const limitedEmail = "identity-abuse-resend-limit@example.test";
    const limitedUser = await createPhase20User(db(), { email: limitedEmail });
    const decisions = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      decisions.push(
        await requestEmailVerification(
          limitedUser.emailNormalized,
          dependencies(20),
        ),
      );
    }
    expect(
      decisions.filter(({ rateLimited }) => rateLimited === false),
    ).toHaveLength(5);
    expect(
      decisions.filter(({ rateLimited }) => rateLimited === true),
    ).toHaveLength(1);
    expect(decisions[5]).toMatchObject({
      ok: true,
      rateLimited: true,
      retryAfterSeconds: 3_600,
    });
    expect(
      await db().authSecurityEvent.count({
        where: {
          kind: "VERIFICATION_RATE_LIMITED",
          outcomeCode: "RATE_LIMITED",
        },
      }),
    ).toBe(1);
  });

  it("makes known/unknown invalid login indistinguishable and enforces the tenth-attempt boundary", async () => {
    const known = await createPhase20User(db(), {
      email: "identity-abuse-login@example.test",
      verified: true,
    });
    const knownFailure = await loginWithPassword(
      {
        email: known.emailNormalized,
        password: "WrongPassword!42",
      },
      dependencies(30),
    );
    const unknownFailure = await loginWithPassword(
      {
        email: "identity-abuse-login-unknown@example.test",
        password: "WrongPassword!42",
      },
      dependencies(31),
    );
    expect(knownFailure).toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
    expect(unknownFailure).toEqual(knownFailure);

    const decisions = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      decisions.push(
        await loginWithPassword(
          {
            email: "identity-abuse-login-limit@example.test",
            password: "WrongPassword!42",
          },
          dependencies(40),
        ),
      );
    }
    expect(
      decisions.filter(
        (decision) =>
          !decision.ok && decision.code === "INVALID_CREDENTIALS",
      ),
    ).toHaveLength(10);
    expect(
      decisions.filter(
        (decision) => !decision.ok && decision.code === "RATE_LIMITED",
      ),
    ).toHaveLength(1);
    expect(
      await db().authSecurityEvent.count({
        where: { kind: "LOGIN_RATE_LIMITED" },
      }),
    ).toBe(1);
  });

  it("keeps password recovery generic, durable when known, and bounded at five requests", async () => {
    const known = await createPhase20User(db(), {
      email: "identity-abuse-recovery-known@example.test",
      verified: true,
    });
    const knownResult = await requestPasswordReset(
      { email: known.emailNormalized },
      {
        ...dependencies(50),
        emailProvider: noDeliveryProvider,
      },
    );
    expect(knownResult).toEqual({ ok: true, rateLimited: false });
    expect(
      await db().notificationOutbox.count({
        where: {
          recipientUserId: known.id,
          purpose: "PASSWORD_RESET",
          status: "PENDING",
        },
      }),
    ).toBe(1);

    const unknownEmail = "identity-abuse-recovery-unknown@example.test";
    const unknownResult = await requestPasswordReset(
      { email: unknownEmail },
      {
        ...dependencies(51),
        emailProvider: noDeliveryProvider,
      },
    );
    expect(unknownResult).toEqual(knownResult);

    const decisions = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      decisions.push(
        await requestPasswordReset(
          { email: "identity-abuse-recovery-limit@example.test" },
          {
            ...dependencies(60),
            emailProvider: noDeliveryProvider,
          },
        ),
      );
    }
    expect(
      decisions.filter(({ rateLimited }) => rateLimited === false),
    ).toHaveLength(5);
    expect(
      decisions.filter(({ rateLimited }) => rateLimited === true),
    ).toHaveLength(1);
    expect(
      await db().authSecurityEvent.count({
        where: { kind: "PASSWORD_RECOVERY_RATE_LIMITED" },
      }),
    ).toBe(1);
  });

  it("denies Support replay before payload lookup and persists only hashes in security/audit records", async () => {
    const support = await db().user.create({
      data: {
        email: "identity-abuse-support@example.test",
        emailNormalized: "identity-abuse-support@example.test",
        role: "EMPLOYER",
        dataProvenance: "TEST",
        emailVerifiedAt: PHASE20_NOW,
        identityAssurance: "VERIFIED_EMAIL",
      },
      select: { id: true },
    });
    await expect(
      replayDeadLetterNotification(
        {
          outboxId: "payload-read-canary",
          reasonCode: "SUPPORT_REPLAY",
          sandboxConfirmation: PHASE20_SANDBOX_REPLAY_CONFIRMATION,
        },
        {
          actor: {
            userId: support.id,
            email: "identity-abuse-support@example.test",
            role: "SUPPORT",
            status: "ACTIVE",
          },
          correlationId: "phase20-support-replay-denied",
          database: db(),
          environment: env(),
          now: PHASE20_NOW,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    const serialized = JSON.stringify({
      security: await db().authSecurityEvent.findMany(),
      audits: await db().auditLog.findMany({
        where: {
          OR: [
            { capability: { startsWith: "AUTH_" } },
            { action: "RATE_LIMITED" },
          ],
        },
      }),
    });
    for (const forbidden of [
      "identity-abuse-known@example.test",
      "identity-abuse-unknown@example.test",
      "identity-abuse-login@example.test",
      "identity-abuse-recovery-known@example.test",
      PHASE20_PASSWORD,
      "WrongPassword!42",
      "payload-read-canary",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const targetHashes = await db().authSecurityEvent.findMany({
      where: { targetHash: { not: null } },
      select: { targetHash: true },
    });
    expect(targetHashes.length).toBeGreaterThan(0);
    expect(
      targetHashes.every(({ targetHash }) =>
        /^[a-z0-9._-]+:[a-f0-9]{64}$/u.test(targetHash ?? "") ||
        /^[a-f0-9]{64}$/u.test(targetHash ?? ""),
      ),
    ).toBe(true);
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
  if (environment === undefined) {
    throw new Error("Phase 20 environment unavailable.");
  }
  return environment;
}
