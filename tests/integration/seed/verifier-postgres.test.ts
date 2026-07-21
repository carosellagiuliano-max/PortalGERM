import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyPassword } from "@/lib/auth/password";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  SEED_COMPATIBILITY_BASE_VERSION,
  SEED_DATASET_VERSION,
  SEED_GOLDEN_COUNTS,
  SEED_MANIFEST_SCHEMA_VERSION,
  SEED_NAMESPACE,
} from "@/prisma/seed/contract";
import { buildAuthRbacSeedFixtures } from "@/prisma/seed/fixtures/auth-rbac";
import {
  DEMO_ACCOUNT_FIXTURES,
  DEMO_COMPANY_SLUG,
  DEMO_LOGIN_PASSWORD,
  RADAR_DEMO_COMPANY_SLUG,
} from "@/prisma/seed/fixtures/companies-jobs";
import {
  orchestrateDemoSeed,
  verifyPersistedDemoSeed,
} from "@/prisma/seed/orchestrator";
import { verifyDemoSeedDatabase } from "@/prisma/seed/verifier";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let parallelDatabase: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Verifier test database is not initialized.");
  }
  return database;
}

function parallelClient(): DatabaseClient {
  if (parallelDatabase === undefined) {
    throw new Error("The parallel seed test database is not initialized.");
  }
  return parallelDatabase;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_06_database_verifier");
  database = createDatabaseClient(isolated.connectionString);
  parallelDatabase = createDatabaseClient(isolated.connectionString);
}, 120_000);

afterAll(async () => {
  await parallelDatabase?.$disconnect().catch(() => undefined);
  parallelDatabase = undefined;
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-06 independent PostgreSQL verifier", () => {
  it("serializes two real parallel seed runs and verifies the sealed golden contract", async () => {
    const legacyManifest = await client().demoSeedManifest.create({
      data: {
        anchorAt: new Date("2026-07-19T10:00:00.000Z"),
        completedAt: new Date("2026-07-19T10:01:00.000Z"),
        contractHash: "a".repeat(64),
        manifestHash: "b".repeat(64),
        namespace: SEED_NAMESPACE,
        schemaVersion: SEED_MANIFEST_SCHEMA_VERSION,
        seedVersion: SEED_COMPATIBILITY_BASE_VERSION,
      },
    });
    const [firstRun, secondRun] = await Promise.all([
      orchestrateDemoSeed(client()),
      orchestrateDemoSeed(parallelClient()),
    ]);
    const seeded = firstRun.previouslyCompleted ? secondRun : firstRun;
    const concurrentRerun = firstRun.previouslyCompleted ? firstRun : secondRun;
    const persisted = await client().demoSeedManifest.findFirstOrThrow({
      where: {
        completedAt: { not: null },
        manifestHash: { not: null },
        namespace: SEED_NAMESPACE,
        seedVersion: SEED_DATASET_VERSION,
      },
    });
    await verifyPhase06AuthRbacMatrix(client(), persisted.anchorAt);
    const afterConcurrentRuns = await loadObservedVersions(client());
    const direct = await verifyDemoSeedDatabase(client(), persisted.anchorAt);
    const sealed = await verifyPersistedDemoSeed(client());
    const after = await loadObservedVersions(client());

    expect(
      [firstRun.previouslyCompleted, secondRun.previouslyCompleted].sort(),
    ).toEqual([false, true]);
    expect(concurrentRerun.envelope).toEqual(seeded.envelope);
    expect(direct.counts).toEqual(SEED_GOLDEN_COUNTS);
    expect(direct.report.checkCount).toBeGreaterThan(350);
    expect(direct.blockDigest).toEqual(
      seeded.envelope.manifest.blocks.find(
        (block) => block.name === "database-verification",
      ),
    );
    expect(sealed.envelope).toEqual(seeded.envelope);
    expect(sealed.verificationCheckCount).toBe(direct.report.checkCount);
    expect(after).toEqual(afterConcurrentRuns);
    expect(
      await client().demoSeedManifest.findUniqueOrThrow({
        where: {
          namespace_seedVersion: {
            namespace: SEED_NAMESPACE,
            seedVersion: SEED_COMPATIBILITY_BASE_VERSION,
          },
        },
      }),
    ).toEqual(legacyManifest);
  }, 600_000);

  it("rejects drift in a previously omitted Message body", async () => {
    const message = await client().message.findFirstOrThrow({
      orderBy: { id: "asc" },
    });
    await client().message.update({
      where: { id: message.id },
      data: { body: `${message.body} [drift]` },
    });

    await expect(verifyPersistedDemoSeed(client())).rejects.toThrow(
      "The observed demo seed database does not match its sealed manifest hash.",
    );
  }, 120_000);
});

async function verifyPhase06AuthRbacMatrix(
  db: DatabaseClient,
  anchorAt: Date,
): Promise<void> {
  for (const account of DEMO_ACCOUNT_FIXTURES) {
    const official = await db.user.findUniqueOrThrow({
      where: { id: account.id },
      select: {
        credential: { select: { passwordHash: true } },
        emailNormalized: true,
        role: true,
        status: true,
      },
    });
    expect(official).toMatchObject({
      emailNormalized: account.email,
      role: account.role,
      status: "ACTIVE",
    });
    expect(official.credential).not.toBeNull();
    await expect(
      verifyPassword(
        DEMO_LOGIN_PASSWORD,
        official.credential?.passwordHash ?? "",
      ),
    ).resolves.toBe(true);
  }

  const fixtures = buildAuthRbacSeedFixtures(anchorAt);
  const suspendedActor = await db.user.findUniqueOrThrow({
    where: { id: fixtures.suspendedActor.id },
    select: {
      credential: { select: { passwordHash: true } },
      emailNormalized: true,
      role: true,
      status: true,
    },
  });
  expect(suspendedActor).toMatchObject({
    emailNormalized: fixtures.suspendedActor.email,
    role: "CANDIDATE",
    status: "SUSPENDED",
  });
  expect(suspendedActor.credential).not.toBeNull();
  await expect(
    verifyPassword(
      DEMO_LOGIN_PASSWORD,
      suspendedActor.credential?.passwordHash ?? "",
    ),
  ).resolves.toBe(true);

  const recruiter = DEMO_ACCOUNT_FIXTURES.find(
    (account) => account.email === "recruiter@demo.ch",
  );
  expect(recruiter).toBeDefined();
  const memberships = await db.companyMembership.findMany({
    where: { status: "ACTIVE", userId: recruiter?.id },
    select: {
      company: { select: { slug: true } },
      role: true,
      status: true,
    },
  });
  expect(
    memberships
      .map((membership) => ({
        companySlug: membership.company.slug,
        role: membership.role,
        status: membership.status,
      }))
      .sort((left, right) => left.companySlug.localeCompare(right.companySlug)),
  ).toEqual([
    {
      companySlug: RADAR_DEMO_COMPANY_SLUG,
      role: "RECRUITER",
      status: "ACTIVE",
    },
    {
      companySlug: DEMO_COMPANY_SLUG,
      role: "RECRUITER",
      status: "ACTIVE",
    },
  ]);

  const expiredSession = await db.session.findUniqueOrThrow({
    where: { id: fixtures.expiredSession.id },
  });
  expect(expiredSession).toMatchObject({
    absoluteExpiresAt: fixtures.expiredSession.absoluteExpiresAt,
    expiresAt: fixtures.expiredSession.expiresAt,
    revokedAt: null,
    rotatedAt: null,
    tokenHash: fixtures.expiredSession.tokenHash,
    userId: fixtures.expiredSession.userId,
  });
  expect(expiredSession.expiresAt.getTime()).toBeLessThan(anchorAt.getTime());
  expect(expiredSession.tokenHash).toMatch(/^[0-9a-f]{64}$/u);

  const resetRows = await db.passwordResetToken.findMany({
    where: {
      id: { in: [fixtures.expiredReset.id, fixtures.usedReset.id] },
    },
  });
  expect(resetRows).toHaveLength(2);
  expect(
    resetRows.find((reset) => reset.id === fixtures.expiredReset.id),
  ).toMatchObject({
    expiresAt: fixtures.expiredReset.expiresAt,
    tokenHash: fixtures.expiredReset.tokenHash,
    usedAt: null,
    userId: fixtures.expiredReset.userId,
  });
  expect(
    resetRows.find((reset) => reset.id === fixtures.usedReset.id),
  ).toMatchObject({
    expiresAt: fixtures.usedReset.expiresAt,
    tokenHash: fixtures.usedReset.tokenHash,
    usedAt: fixtures.usedReset.usedAt,
    userId: fixtures.usedReset.userId,
  });
  expect(
    resetRows.every((reset) => /^[0-9a-f]{64}$/u.test(reset.tokenHash)),
  ).toBe(true);

  const serializedManifest = JSON.stringify(
    await db.demoSeedManifest.findUniqueOrThrow({
      where: {
        namespace_seedVersion: {
          namespace: SEED_NAMESPACE,
          seedVersion: SEED_DATASET_VERSION,
        },
      },
    }),
  );
  expect(serializedManifest).not.toContain(DEMO_LOGIN_PASSWORD);
  expect(serializedManifest).not.toContain(fixtures.expiredSession.tokenHash);
  expect(serializedManifest).not.toContain(fixtures.expiredReset.tokenHash);
  expect(serializedManifest).not.toContain(fixtures.usedReset.tokenHash);
}

async function loadObservedVersions(db: DatabaseClient) {
  const tables = await db.$queryRaw<Array<{ tableName: string }>>`
    SELECT c.relname AS "tableName"
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname
  `;
  const snapshot: Array<{ entity: string; id: string; version: string }> = [];

  for (const { tableName } of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName)) {
      throw new Error(`Unsafe public table identifier ${tableName}.`);
    }
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; version: string }>
    >(
      `SELECT ctid::text AS id, xmin::text AS version FROM "${tableName}" ORDER BY ctid`,
    );
    snapshot.push(
      ...rows.map((row) => ({
        entity: tableName,
        id: row.id,
        version: row.version,
      })),
    );
  }

  return snapshot;
}
