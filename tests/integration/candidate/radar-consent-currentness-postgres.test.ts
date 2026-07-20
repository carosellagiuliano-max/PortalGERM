import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase09_radar_consent_currentness");
  database = createDatabaseClient(migrated.connectionString);
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
  database = undefined;
  migrated = undefined;
});

describe.sequential("Phase-09 Radar consent PostgreSQL currentness", () => {
  it("requires both the current notice version and its canonical hash for publication", async () => {
    const client = requireDatabase();
    const clock = new Date();
    const fixture = await createCompleteCandidate("notice-hash");

    await client.candidateConsent.create({
      data: {
        candidateProfileId: fixture.profileId,
        kind: "TALENT_RADAR_VISIBILITY",
        granted: true,
        noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
        noticeHash: "a".repeat(64),
        actorUserId: fixture.userId,
        effectiveAt: offset(clock, -120_000),
        createdAt: offset(clock, -120_000),
      },
    });

    await expect(createRadarProfile(fixture.profileId, "wrong-hash", clock))
      .rejects.toThrow(/not eligible for publication/iu);

    await client.candidateConsent.create({
      data: {
        candidateProfileId: fixture.profileId,
        kind: "TALENT_RADAR_VISIBILITY",
        granted: true,
        noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
        noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
        actorUserId: fixture.userId,
        effectiveAt: offset(clock, -60_000),
        createdAt: offset(clock, -60_000),
      },
    });

    await expect(createRadarProfile(fixture.profileId, "right-hash", clock))
      .resolves.toMatchObject({ candidateProfileId: fixture.profileId, withdrawnAt: null });
  });

  it("ignores stale and future denials but withdraws for the latest effective denial", async () => {
    const client = requireDatabase();
    const clock = new Date();
    const fixture = await createActiveRadar("consent-order", clock);

    await appendConsent(fixture, false, offset(clock, -180_000), "stale-denial");
    await appendConsent(fixture, false, offset(clock, 3_600_000), "future-denial");

    await expect(client.radarProfile.findUniqueOrThrow({
      where: { candidateProfileId: fixture.profileId },
      select: { withdrawnAt: true },
    })).resolves.toEqual({ withdrawnAt: null });

    await appendConsent(fixture, false, offset(clock, -30_000), "current-denial");

    const withdrawn = await client.radarProfile.findUniqueOrThrow({
      where: { candidateProfileId: fixture.profileId },
      select: { publishedAt: true, withdrawnAt: true, updatedAt: true },
    });
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(withdrawn.withdrawnAt!.getTime()).toBeGreaterThanOrEqual(
      withdrawn.publishedAt!.getTime(),
    );
    expect(withdrawn.updatedAt.getTime()).toBeGreaterThanOrEqual(
      withdrawn.withdrawnAt!.getTime(),
    );
  });

  it("reconciles legacy active rows with invalid consent, user or onboarding state", async () => {
    const client = requireDatabase();
    const clock = new Date();
    const invalidConsent = await createActiveRadar("legacy-consent", clock);
    const inactiveUser = await createActiveRadar("legacy-user", clock);
    const draftProfile = await createActiveRadar("legacy-profile", clock);

    await withTriggerDisabled(
      '"CandidateConsent"',
      "phase09_withdraw_radar_after_consent_trigger",
      () => appendConsent(invalidConsent, false, offset(clock, -30_000), "legacy-denial"),
    );
    await withTriggerDisabled(
      '"User"',
      "phase09_withdraw_radar_after_user_status_trigger",
      () => client.user.update({
        where: { id: inactiveUser.userId },
        data: { status: "SUSPENDED" },
      }),
    );
    await withTriggerDisabled(
      '"CandidateProfile"',
      "phase09_withdraw_radar_after_onboarding_trigger",
      () => client.candidateProfile.update({
        where: { id: draftProfile.profileId },
        data: { onboardingStatus: "DRAFT" },
      }),
    );

    const before = await client.radarProfile.count({
      where: {
        candidateProfileId: {
          in: [invalidConsent.profileId, inactiveUser.profileId, draftProfile.profileId],
        },
        publishedAt: { not: null },
        withdrawnAt: null,
      },
    });
    expect(before).toBe(3);

    const first = await requireMigrated().pool.query<{ reconciled: number }>(
      'SELECT phase09_reconcile_invalid_active_radar($1::timestamptz) AS "reconciled"',
      [clock],
    );
    expect(first.rows[0]?.reconciled).toBe(3);

    const after = await client.radarProfile.findMany({
      where: {
        candidateProfileId: {
          in: [invalidConsent.profileId, inactiveUser.profileId, draftProfile.profileId],
        },
      },
      select: { publishedAt: true, withdrawnAt: true, updatedAt: true },
    });
    expect(after).toHaveLength(3);
    expect(after.every((row) => row.withdrawnAt !== null)).toBe(true);
    expect(after.every((row) =>
      row.updatedAt.getTime() >= row.withdrawnAt!.getTime() &&
      row.withdrawnAt!.getTime() >= row.publishedAt!.getTime()
    )).toBe(true);

    const replay = await requireMigrated().pool.query<{ reconciled: number }>(
      'SELECT phase09_reconcile_invalid_active_radar($1::timestamptz) AS "reconciled"',
      [clock],
    );
    expect(replay.rows[0]?.reconciled).toBe(0);
  });
});

function requireDatabase() {
  if (database === undefined) throw new Error("Radar consent test database is unavailable.");
  return database;
}

function requireMigrated() {
  if (migrated === undefined) throw new Error("Radar consent test pool is unavailable.");
  return migrated;
}

async function createCompleteCandidate(suffix: string) {
  const client = requireDatabase();
  const user = await client.user.create({
    data: {
      email: `radar-currentness-${suffix}@example.test`,
      emailNormalized: `radar-currentness-${suffix}@example.test`,
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
    },
  });
  const profile = await client.candidateProfile.create({ data: { userId: user.id } });
  await withAllUserTriggersDisabled('"CandidateProfile"', () =>
    client.candidateProfile.update({
      where: { id: profile.id },
      data: { onboardingStatus: "COMPLETE" },
    })
  );
  return Object.freeze({ userId: user.id, profileId: profile.id });
}

async function createActiveRadar(suffix: string, clock: Date) {
  const fixture = await createCompleteCandidate(suffix);
  await appendConsent(fixture, true, offset(clock, -120_000), `${suffix}-grant`);
  await createRadarProfile(fixture.profileId, suffix, offset(clock, -60_000));
  return fixture;
}

async function appendConsent(
  fixture: Readonly<{ userId: string; profileId: string }>,
  granted: boolean,
  effectiveAt: Date,
  suffix: string,
) {
  return requireDatabase().candidateConsent.create({
    data: {
      candidateProfileId: fixture.profileId,
      kind: "TALENT_RADAR_VISIBILITY",
      granted,
      noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
      noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
      actorUserId: fixture.userId,
      effectiveAt,
      createdAt: effectiveAt,
      id: deterministicUuid(suffix),
    },
  });
}

function createRadarProfile(candidateProfileId: string, suffix: string, publishedAt: Date) {
  return requireDatabase().radarProfile.create({
    data: {
      candidateProfileId,
      displayLabel: `Radar ${suffix}`,
      cantonBucket: "ZH",
      categoryBucket: "informatik",
      languageCodes: ["de"],
      skillSlugs: ["typescript"],
      publishedAt,
      withdrawnAt: null,
      projectionVersion: "candidate-radar-v1",
      projectionHash: "c".repeat(64),
    },
  });
}

async function withTriggerDisabled<T>(
  table: '"CandidateConsent"' | '"CandidateProfile"' | '"User"',
  trigger: string,
  operation: () => Promise<T>,
) {
  const pool = requireMigrated().pool;
  await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER "${trigger}"`);
  try {
    return await operation();
  } finally {
    await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER "${trigger}"`);
  }
}

async function withAllUserTriggersDisabled<T>(
  table: '"CandidateProfile"',
  operation: () => Promise<T>,
) {
  const pool = requireMigrated().pool;
  await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  try {
    return await operation();
  } finally {
    await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
}

function offset(value: Date, milliseconds: number) {
  return new Date(value.getTime() + milliseconds);
}

function deterministicUuid(value: string) {
  const hex = Buffer.from(value, "utf8").toString("hex").padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
