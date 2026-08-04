import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SESSION_POLICY_V1,
  createSession,
  destroySession,
  hashSessionToken,
  readSession,
  rotateSession,
  type SessionStore,
} from "@/lib/auth/session";
import type { KeyringEntry, SecretHandle } from "@/lib/config/env-schema";
import { createPrismaSessionStore } from "@/lib/auth/session-store";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { hashIp } from "@/lib/utils/hash";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const USER_ID = "00000000-0000-4000-8000-000000003001";
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SESSION_SOURCE_IP = "2001:0db8:0:0:0:0:0:1";
const SESSION_IP_HASH_VERSION = "audit-test-v1";
const SESSION_IP_HASH_SECRET = "session-ip-hmac-test-secret";
const SESSION_IP_KEYRING = [
  {
    version: SESSION_IP_HASH_VERSION,
    key: {
      withValue: <T>(consumer: (value: string) => T) =>
        consumer(SESSION_IP_HASH_SECRET),
    },
  },
] as unknown as readonly KeyringEntry<"AUDIT_IP_HASH_KEYS">[];
const SESSION_ROTATION_KEY = {
  withValue: <T>(consumer: (value: string) => T) =>
    consumer(Buffer.alloc(32, 0x6b).toString("base64")),
} as unknown as SecretHandle<"SESSION_SECRET">;

let database: MigratedDatabase | undefined;
let databaseClient: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (!databaseClient) {
    throw new Error("The isolated session database client is not initialized");
  }

  return databaseClient;
}

function migratedDatabase(): MigratedDatabase {
  if (!database) {
    throw new Error("The isolated session database is not initialized");
  }

  return database;
}

function store() {
  return createPrismaSessionStore(client());
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase_03_session_store");
  databaseClient = createDatabaseClient(database.connectionString);
  await client().user.create({
    data: {
      id: USER_ID,
      email: "session-contract@example.test",
      emailNormalized: "session-contract@example.test",
      role: "CANDIDATE",
    },
  });
});

afterAll(async () => {
  await databaseClient?.$disconnect().catch(() => undefined);
  databaseClient = undefined;
  await database?.dispose();
  database = undefined;
});

describe.sequential("Prisma PostgreSQL session store", () => {
  it("persists only an opaque SHA-256 token hash", async () => {
    const now = new Date();
    const created = await createSession(
      {
        userId: USER_ID,
        userAgent: "SwissTalentHub integration test",
        ipContext: {
          sourceIp: SESSION_SOURCE_IP,
          keyring: SESSION_IP_KEYRING,
        },
        production: true,
      },
      { store: store(), clock: { now } },
    );
    const persisted = await migratedDatabase().pool.query<{
      tokenHash: string;
      userAgent: string | null;
      ipHash: string | null;
    }>(
      [
        'SELECT "tokenHash", "userAgent", "ipHash"',
        'FROM "Session" WHERE "id" = $1',
      ].join("\n"),
      [created.record.id],
    );

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.record.tokenHash).toBe(hashSessionToken(created.token));
    expect(created.record.tokenHash).toHaveLength(64);
    expect(created.record.tokenHash).not.toBe(created.token);
    expect(persisted.rows).toEqual([
      {
        tokenHash: hashSessionToken(created.token),
        userAgent: "SwissTalentHub integration test",
        ipHash: hashIp(SESSION_SOURCE_IP, {
          version: SESSION_IP_HASH_VERSION,
          secret: SESSION_IP_HASH_SECRET,
        }),
      },
    ]);
    expect(created.cookie).toMatchObject({
      name: SESSION_POLICY_V1.cookieName,
      value: created.token,
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
      },
    });
  });

  it("enforces the idle boundary and clamps rolling expiry to the absolute boundary", async () => {
    const now = new Date();
    const idleExpired = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );

    expect(
      await readSession(idleExpired.token, {
        store: store(),
        clock: { now: idleExpired.record.expiresAt },
      }),
    ).toBeNull();

    const rolling = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    let lastRead = rolling.record;

    for (const day of [6, 12, 18, 24, 29]) {
      const result = await readSession(rolling.token, {
        store: store(),
        clock: { now: addMilliseconds(now, day * DAY_IN_MILLISECONDS) },
      });

      expect(result).not.toBeNull();
      if (result) {
        lastRead = result;
      }
    }

    expect(lastRead.expiresAt).toEqual(rolling.record.absoluteExpiresAt);
    expect(
      await client().session.findUniqueOrThrow({
        where: { id: rolling.record.id },
        select: { expiresAt: true },
      }),
    ).toEqual({ expiresAt: rolling.record.absoluteExpiresAt });
    expect(
      await readSession(rolling.token, {
        store: store(),
        clock: { now: rolling.record.absoluteExpiresAt },
      }),
    ).toBeNull();
  });

  it("stages and promotes rotation while preserving a bounded overlap", async () => {
    const now = new Date();
    const created = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const rotatedAt = addMilliseconds(now, DAY_IN_MILLISECONDS);
    const rotated = await rotateSession(created.token, {
      store: store(),
      clock: { now: rotatedAt },
      rotationKey: SESSION_ROTATION_KEY,
    });

    expect(rotated).not.toBeNull();
    if (!rotated) {
      throw new Error("Expected the persisted session to rotate");
    }

    expect(rotated.token).not.toBe(created.token);
    expect(rotated.record).toMatchObject({
      tokenHash: hashSessionToken(created.token),
      pendingTokenHash: hashSessionToken(rotated.token),
      rotatedAt: null,
    });
    expect(
      await readSession(created.token, {
        store: store(),
        clock: { now: rotatedAt },
      }),
    ).not.toBeNull();
    expect(
      await readSession(rotated.token, {
        store: store(),
        clock: { now: rotatedAt },
      }),
    ).toMatchObject({ id: created.record.id, rotatedAt });
    expect(
      await client().session.findUniqueOrThrow({
        where: { id: created.record.id },
        select: {
          tokenHash: true,
          pendingTokenHash: true,
          previousTokenHash: true,
          rotatedAt: true,
        },
      }),
    ).toEqual({
      tokenHash: hashSessionToken(rotated.token),
      pendingTokenHash: null,
      previousTokenHash: hashSessionToken(created.token),
      rotatedAt,
    });
  });

  it("makes concurrent staging and promotion idempotent and refreshes a near-expiry pending hand-off", async () => {
    const now = new Date();
    const created = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const dueAt = addMilliseconds(now, DAY_IN_MILLISECONDS);
    const [firstStage, secondStage] = await Promise.all([
      rotateSession(created.token, {
        store: store(),
        clock: { now: dueAt },
        rotationKey: SESSION_ROTATION_KEY,
      }),
      rotateSession(created.token, {
        store: store(),
        clock: { now: dueAt },
        rotationKey: SESSION_ROTATION_KEY,
      }),
    ]);
    if (firstStage === null || secondStage === null) {
      throw new Error("Concurrent rotation did not produce a staged token.");
    }
    expect(hashSessionToken(firstStage.token)).toBe(
      hashSessionToken(secondStage.token),
    );

    const nearExpiry = addMilliseconds(dueAt, 5_000);
    await client().session.update({
      where: { id: created.record.id },
      data: { pendingTokenExpiresAt: nearExpiry },
    });
    const retryAt = addMilliseconds(nearExpiry, -1);
    const repeated = await rotateSession(created.token, {
      store: store(),
      clock: { now: retryAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    if (repeated === null) {
      throw new Error("Near-expiry rotation retry was not restaged.");
    }
    expect(hashSessionToken(repeated.token)).toBe(
      hashSessionToken(firstStage.token),
    );
    const refreshedStage = await client().session.findUniqueOrThrow({
      where: { id: created.record.id },
      select: { pendingTokenHash: true, pendingTokenExpiresAt: true },
    });
    expect(refreshedStage.pendingTokenHash).toBe(
      hashSessionToken(firstStage.token),
    );
    expect(refreshedStage.pendingTokenExpiresAt!.getTime()).toBeGreaterThan(
      nearExpiry.getTime(),
    );

    const promotedAt = addMilliseconds(retryAt, 1);
    const [firstRead, secondRead] = await Promise.all([
      readSession(firstStage.token, {
        store: store(),
        clock: { now: promotedAt },
      }),
      readSession(secondStage.token, {
        store: store(),
        clock: { now: promotedAt },
      }),
    ]);
    expect(firstRead).toMatchObject({ id: created.record.id });
    expect(secondRead).toMatchObject({ id: created.record.id });
    await expect(
      client().session.findUniqueOrThrow({
        where: { id: created.record.id },
        select: {
          tokenHash: true,
          pendingTokenHash: true,
          previousTokenHash: true,
        },
      }),
    ).resolves.toEqual({
      tokenHash: hashSessionToken(firstStage.token),
      pendingTokenHash: null,
      previousTokenHash: hashSessionToken(created.token),
    });
  });

  it("cannot revive a session when logout wins between pending lookup and promotion", async () => {
    const now = new Date();
    const created = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const dueAt = addMilliseconds(now, DAY_IN_MILLISECONDS);
    const staged = await rotateSession(created.token, {
      store: store(),
      clock: { now: dueAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    if (staged === null) throw new Error("Expected a staged token.");
    const persistedStore = store();
    const racingStore: SessionStore = {
      ...persistedStore,
      async promotePendingToken(
        id,
        pendingTokenHash,
        promotedAt,
        previousTokenExpiresAt,
        expiresAt,
      ) {
        await persistedStore.revokeByTokenHash(
          hashSessionToken(created.token),
          promotedAt,
        );
        return persistedStore.promotePendingToken(
          id,
          pendingTokenHash,
          promotedAt,
          previousTokenExpiresAt,
          expiresAt,
        );
      },
    };

    await expect(
      readSession(staged.token, {
        store: racingStore,
        clock: { now: dueAt },
      }),
    ).resolves.toBeNull();
    await expect(
      client().session.findUniqueOrThrow({
        where: { id: created.record.id },
        select: { tokenHash: true, pendingTokenHash: true, revokedAt: true },
      }),
    ).resolves.toEqual({
      tokenHash: hashSessionToken(created.token),
      pendingTokenHash: hashSessionToken(staged.token),
      revokedAt: dueAt,
    });
    await expect(
      readSession(created.token, {
        store: store(),
        clock: { now: dueAt },
      }),
    ).resolves.toBeNull();
  });

  it("enforces the previous-token half-open boundary and revokes through pending and previous lineage", async () => {
    const now = new Date();
    const created = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const dueAt = addMilliseconds(now, DAY_IN_MILLISECONDS);
    const staged = await rotateSession(created.token, {
      store: store(),
      clock: { now: dueAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    if (staged === null) throw new Error("Expected a staged token.");
    await readSession(staged.token, { store: store(), clock: { now: dueAt } });
    const previousBoundary = addMilliseconds(
      dueAt,
      SESSION_POLICY_V1.rotationTransitionMilliseconds,
    );
    await expect(
      readSession(created.token, {
        store: store(),
        clock: { now: addMilliseconds(previousBoundary, -1) },
      }),
    ).resolves.not.toBeNull();
    await expect(
      readSession(created.token, {
        store: store(),
        clock: { now: previousBoundary },
      }),
    ).resolves.toBeNull();

    const previousRevoked = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const previousStage = await rotateSession(previousRevoked.token, {
      store: store(),
      clock: { now: dueAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    if (previousStage === null) throw new Error("Expected a staged token.");
    await readSession(previousStage.token, {
      store: store(),
      clock: { now: dueAt },
    });
    await destroySession(previousRevoked.token, {
      store: store(),
      clock: { now: addMilliseconds(dueAt, 1) },
    });
    await expect(
      readSession(previousStage.token, {
        store: store(),
        clock: { now: addMilliseconds(dueAt, 1) },
      }),
    ).resolves.toBeNull();

    const pendingRevoked = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const pendingStage = await rotateSession(pendingRevoked.token, {
      store: store(),
      clock: { now: dueAt },
      rotationKey: SESSION_ROTATION_KEY,
    });
    if (pendingStage === null) throw new Error("Expected a staged token.");
    await destroySession(pendingStage.token, {
      store: store(),
      clock: { now: addMilliseconds(dueAt, 1) },
    });
    await expect(
      readSession(pendingRevoked.token, {
        store: store(),
        clock: { now: addMilliseconds(dueAt, 1) },
      }),
    ).resolves.toBeNull();
  });

  it("persists individual and user-wide revocation", async () => {
    const now = new Date();
    const first = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const second = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const firstRevokedAt = addMilliseconds(now, 60 * 60 * 1_000);
    const allRevokedAt = addMilliseconds(now, 2 * 60 * 60 * 1_000);

    await destroySession(first.token, {
      store: store(),
      clock: { now: firstRevokedAt },
    });
    expect(
      await readSession(first.token, {
        store: store(),
        clock: { now: firstRevokedAt },
      }),
    ).toBeNull();

    await store().revokeAllForUser(USER_ID, allRevokedAt);
    expect(
      await readSession(second.token, {
        store: store(),
        clock: { now: allRevokedAt },
      }),
    ).toBeNull();
    expect(
      await client().session.findMany({
        where: { id: { in: [first.record.id, second.record.id] } },
        orderBy: { id: "asc" },
        select: { id: true, revokedAt: true },
      }),
    ).toEqual(
      [
        { id: first.record.id, revokedAt: firstRevokedAt },
        { id: second.record.id, revokedAt: allRevokedAt },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("resolves a persisted session after recreating the Prisma client", async () => {
    const now = new Date();
    const created = await createSession(
      { userId: USER_ID, production: false },
      { store: store(), clock: { now } },
    );
    const previousClient = client();

    databaseClient = undefined;
    await previousClient.$disconnect();
    databaseClient = createDatabaseClient(migratedDatabase().connectionString);

    expect(
      await readSession(created.token, {
        store: store(),
        clock: { now: addMilliseconds(now, 60 * 60 * 1_000) },
      }),
    ).toMatchObject({
      id: created.record.id,
      userId: USER_ID,
      tokenHash: hashSessionToken(created.token),
    });
  });
});
