import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CandidateProfileConflictError,
  CandidateProfileUnavailableError,
  TALENT_RADAR_VISIBILITY_NOTICE_V1,
  completeOwnedCandidateOnboarding,
  getOwnedCandidateProfileWorkspace,
  saveOwnedCandidateProfile,
  setOwnedTalentRadarVisibility,
} from "@/lib/candidate/profile";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockStorageProvider } from "@/lib/providers/storage";
import {
  swissJobPassSchema,
  type SwissJobPassInput,
} from "@/lib/validation/candidate";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const SAVE_AT = new Date("2026-07-20T08:00:00.000Z");
const COMPLETE_AT = new Date("2026-07-20T08:05:00.000Z");
const REOPEN_AT = new Date("2026-07-20T08:10:00.000Z");
const RESTORE_AT = new Date("2026-07-20T08:15:00.000Z");
const REPUBLISH_AT = new Date("2026-07-20T08:20:00.000Z");
const CORRELATION_SAVE = "11111111-1111-4111-8111-111111111111";
const CORRELATION_COMPLETE = "22222222-2222-4222-8222-222222222222";
const CORRELATION_REOPEN = "33333333-3333-4333-8333-333333333333";

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase09_candidate_profile");
  database = createDatabaseClient(isolated.connectionString);
});

afterAll(async () => {
  await database?.$disconnect();
  await isolated?.dispose();
});

describe("Phase-09 candidate profile PostgreSQL workflow", () => {
  it("persists a draft, completes it, publishes Radar, then reopens and withdraws atomically", async () => {
    const client = requireDatabase();
    const fixture = await createFixture(client, "lifecycle");
    const storage = new MockStorageProvider({
      keyFactory: () => "candidate-profile-cv",
    });

    const saved = await saveOwnedCandidateProfile(
      client,
      {
        actorUserId: fixture.user.id,
        correlationId: CORRELATION_SAVE,
        expectedUpdatedAt: fixture.profile.updatedAt,
        now: SAVE_AT,
        profile: profileInput(fixture, {
          radarVisible: true,
          cv: {
            fileName: "lebenslauf.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42_000,
          },
        }),
      },
      storage,
    );
    expect(saved).toMatchObject({
      outcome: "SAVED",
      onboardingStatus: "DRAFT",
      consentChanged: true,
      radarState: "INCOMPLETE",
    });

    const draft = await client.candidateProfile.findUniqueOrThrow({
      where: { id: fixture.profile.id },
      include: {
        skills: true,
        languages: true,
        preference: { include: { categories: true } },
        documents: true,
        radarConsents: true,
        radarProfile: true,
      },
    });
    expect(draft).toMatchObject({
      firstName: "Mira",
      lastName: "Muster",
      publicDisplayName: "Mira M.",
      cityLabel: "Zürich",
      workPermitType: "C",
      onboardingStatus: "DRAFT",
    });
    expect(draft.skills).toHaveLength(1);
    expect(draft.languages).toHaveLength(1);
    expect(draft.preference).toMatchObject({
      desiredTitles: ["Softwareentwicklerin"],
      desiredJobTypes: ["PERMANENT"],
      workloadMin: 60,
      workloadMax: 80,
      remotePreference: "HYBRID",
    });
    expect(draft.preference?.categories).toHaveLength(1);
    expect(draft.documents).toHaveLength(1);
    expect(draft.documents[0]).toMatchObject({
      safeFilename: "lebenslauf.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42_000,
      status: "ACTIVE",
    });
    expect(
      storage.getStoredMetadata(draft.documents[0]!.storageKey),
    ).toMatchObject({
      downloadable: false,
      safeFileName: "lebenslauf.pdf",
    });
    expect(draft.radarConsents).toHaveLength(1);
    expect(draft.radarConsents[0]).toMatchObject({ granted: true });
    expect(draft.radarProfile).toMatchObject({
      publishedAt: null,
      withdrawnAt: SAVE_AT,
      cantonBucket: "ZH",
      categoryBucket: "informatik-lifecycle",
    });

    await saveOwnedCandidateProfile(
      client,
      {
        actorUserId: fixture.user.id,
        correlationId: "12121212-1212-4212-8212-121212121212",
        expectedUpdatedAt: draft.updatedAt,
        now: new Date("2026-07-20T08:02:00.000Z"),
        profile: profileInput(fixture, { radarVisible: true }),
      },
      storage,
    );
    const stableRelations = await client.candidateProfile.findUniqueOrThrow({
      where: { id: fixture.profile.id },
      include: { skills: true, languages: true },
    });
    expect(stableRelations.skills[0]?.id).toBe(draft.skills[0]?.id);
    expect(stableRelations.languages[0]?.id).toBe(draft.languages[0]?.id);

    const completed = await completeOwnedCandidateOnboarding(client, {
      actorUserId: fixture.user.id,
      correlationId: CORRELATION_COMPLETE,
      now: COMPLETE_AT,
    });
    expect(completed).toMatchObject({
      outcome: "COMPLETED",
      radarState: "CURRENT",
    });

    const active = await client.candidateProfile.findUniqueOrThrow({
      where: { id: fixture.profile.id },
      include: { onboardingEvents: true, radarProfile: true },
    });
    expect(active.onboardingStatus).toBe("COMPLETE");
    expect(active.onboardingEvents.map(({ kind }) => kind)).toContain(
      "COMPLETED",
    );
    expect(active.radarProfile).toMatchObject({
      publishedAt: COMPLETE_AT,
      withdrawnAt: null,
    });

    const reopened = await saveOwnedCandidateProfile(
      client,
      {
        actorUserId: fixture.user.id,
        correlationId: CORRELATION_REOPEN,
        expectedUpdatedAt: active.updatedAt,
        now: REOPEN_AT,
        profile: profileInput(fixture, {
          skillIds: [],
          radarVisible: true,
        }),
      },
      storage,
    );
    expect(reopened).toMatchObject({
      outcome: "SAVED",
      onboardingStatus: "DRAFT",
      reopened: true,
      consentChanged: false,
      radarState: "INCOMPLETE",
    });

    const final = await client.candidateProfile.findUniqueOrThrow({
      where: { id: fixture.profile.id },
      include: {
        onboardingEvents: { orderBy: { createdAt: "asc" } },
        radarConsents: true,
        radarProfile: true,
      },
    });
    expect(final.onboardingStatus).toBe("DRAFT");
    expect(final.onboardingEvents.map(({ kind }) => kind)).toEqual([
      "COMPLETED",
      "REOPENED",
    ]);
    expect(final.radarConsents).toHaveLength(1);
    expect(final.radarProfile).toMatchObject({
      publishedAt: COMPLETE_AT,
      withdrawnAt: REOPEN_AT,
    });

    await saveOwnedCandidateProfile(
      client,
      {
        actorUserId: fixture.user.id,
        correlationId: "55555555-5555-4555-8555-555555555555",
        expectedUpdatedAt: final.updatedAt,
        now: RESTORE_AT,
        profile: profileInput(fixture, { radarVisible: true }),
      },
      storage,
    );
    const republished = await completeOwnedCandidateOnboarding(client, {
      actorUserId: fixture.user.id,
      correlationId: "66666666-6666-4666-8666-666666666666",
      now: REPUBLISH_AT,
    });
    expect(republished).toMatchObject({
      outcome: "COMPLETED",
      radarState: "CURRENT",
    });

    const republishedProfile = await client.candidateProfile.findUniqueOrThrow({
      where: { id: fixture.profile.id },
      include: {
        onboardingEvents: { orderBy: { createdAt: "asc" } },
        radarProfile: true,
      },
    });
    expect(republishedProfile.onboardingStatus).toBe("COMPLETE");
    expect(republishedProfile.onboardingEvents.map(({ kind }) => kind)).toEqual(
      ["COMPLETED", "REOPENED", "COMPLETED"],
    );
    expect(republishedProfile.radarProfile).toMatchObject({
      publishedAt: REPUBLISH_AT,
      withdrawnAt: null,
    });

    const [audits, analytics] = await Promise.all([
      client.auditLog.findMany({
        where: { actorUserId: fixture.user.id },
        orderBy: { createdAt: "asc" },
      }),
      client.analyticsEvent.findMany({
        where: { producer: "candidate-profile" },
        orderBy: { occurredAt: "asc" },
      }),
    ]);
    expect(audits.map(({ action }) => action).sort()).toEqual([
      "CANDIDATE_ONBOARDING_COMPLETED",
      "CANDIDATE_ONBOARDING_COMPLETED",
      "CANDIDATE_ONBOARDING_REOPENED",
      "RADAR_CONSENT_CHANGED",
    ]);
    expect(analytics.map(({ kind }) => kind)).toEqual([
      "RADAR_OPTED_IN",
      "CANDIDATE_PROFILE_COMPLETED",
    ]);
  });

  it("scopes every mutation to the actor-owned profile and keeps consent append-only", async () => {
    const client = requireDatabase();
    const owner = await createFixture(client, "owner");
    const stranger = await createFixture(client, "stranger");

    await expect(
      saveOwnedCandidateProfile(client, {
        actorUserId: stranger.user.id,
        correlationId: CORRELATION_SAVE,
        expectedUpdatedAt: stranger.profile.updatedAt,
        now: SAVE_AT,
        profile: profileInput(owner),
      }),
    ).resolves.toMatchObject({ outcome: "SAVED" });
    // The command can only mutate the stranger's own profile even when its
    // values were assembled from another fixture; no profile id is accepted.
    await expect(
      client.candidateProfile.findUnique({
        where: { id: owner.profile.id },
        select: { firstName: true },
      }),
    ).resolves.toEqual({ firstName: null });

    await client.candidateConsent.create({
      data: {
        candidateProfileId: owner.profile.id,
        kind: "TALENT_RADAR_VISIBILITY",
        granted: true,
        noticeVersion: "talent-radar-obsolete",
        noticeHash: "a".repeat(64),
        actorUserId: owner.user.id,
        effectiveAt: SAVE_AT,
      },
    });
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: owner.user.id,
      correlationId: CORRELATION_COMPLETE,
      granted: true,
      now: COMPLETE_AT,
    });
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: owner.user.id,
      correlationId: CORRELATION_REOPEN,
      granted: false,
      now: REOPEN_AT,
    });
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: owner.user.id,
      correlationId: "44444444-4444-4444-8444-444444444444",
      granted: false,
      now: new Date(REOPEN_AT.getTime() + 1_000),
    });
    const consent = await client.candidateConsent.findMany({
      where: { candidateProfileId: owner.profile.id },
      orderBy: { effectiveAt: "asc" },
    });
    expect(
      consent.map(({ granted, noticeVersion }) => ({
        granted,
        noticeVersion,
      })),
    ).toEqual([
      { granted: true, noticeVersion: "talent-radar-obsolete" },
      { granted: true, noticeVersion: "talent-radar-v1" },
      { granted: false, noticeVersion: "talent-radar-v1" },
    ]);
  });

  it("rejects a stale full-profile save after a newer Radar withdrawal", async () => {
    const client = requireDatabase();
    const fixture = await createFixture(client, "stale-consent");
    const grantAt = new Date("2026-07-20T09:00:00.000Z");
    const revokeAt = new Date("2026-07-20T09:01:00.000Z");

    await setOwnedTalentRadarVisibility(client, {
      actorUserId: fixture.user.id,
      correlationId: "77777777-7777-4777-8777-777777777777",
      granted: true,
      now: grantAt,
    });
    const stale = await client.candidateProfile.findUniqueOrThrow({
      where: { id: fixture.profile.id },
      select: { updatedAt: true },
    });

    await setOwnedTalentRadarVisibility(client, {
      actorUserId: fixture.user.id,
      correlationId: "88888888-8888-4888-8888-888888888888",
      granted: false,
      now: revokeAt,
    });

    await expect(
      saveOwnedCandidateProfile(client, {
        actorUserId: fixture.user.id,
        correlationId: "99999999-9999-4999-8999-999999999999",
        expectedUpdatedAt: stale.updatedAt,
        now: new Date("2026-07-20T09:02:00.000Z"),
        profile: profileInput(fixture, { radarVisible: true }),
      }),
    ).rejects.toBeInstanceOf(CandidateProfileConflictError);

    const [profile, consent] = await Promise.all([
      client.candidateProfile.findUniqueOrThrow({
        where: { id: fixture.profile.id },
        select: { firstName: true },
      }),
      client.candidateConsent.findMany({
        where: {
          candidateProfileId: fixture.profile.id,
          kind: "TALENT_RADAR_VISIBILITY",
        },
        orderBy: { effectiveAt: "asc" },
        select: { granted: true },
      }),
    ]);
    expect(profile.firstName).toBeNull();
    expect(consent.map(({ granted }) => granted)).toEqual([true, false]);
  });

  it("ignores a future consent event when loading or changing current Radar visibility", async () => {
    const client = requireDatabase();
    const fixture = await createFixture(client, "future-consent");
    const currentAt = new Date("2026-07-20T10:00:00.000Z");
    const futureAt = new Date("2026-07-21T10:00:00.000Z");
    await client.candidateConsent.createMany({
      data: [
        {
          candidateProfileId: fixture.profile.id,
          kind: "TALENT_RADAR_VISIBILITY",
          granted: true,
          noticeVersion: TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion,
          noticeHash: TALENT_RADAR_VISIBILITY_NOTICE_V1.hash,
          actorUserId: fixture.user.id,
          effectiveAt: currentAt,
        },
        {
          candidateProfileId: fixture.profile.id,
          kind: "TALENT_RADAR_VISIBILITY",
          granted: false,
          noticeVersion: TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion,
          noticeHash: TALENT_RADAR_VISIBILITY_NOTICE_V1.hash,
          actorUserId: fixture.user.id,
          effectiveAt: futureAt,
        },
      ],
    });

    const workspace = await getOwnedCandidateProfileWorkspace(
      client,
      fixture.user.id,
      new Date("2026-07-20T10:05:00.000Z"),
    );
    expect(workspace.radarConsentGranted).toBe(true);

    const unchanged = await setOwnedTalentRadarVisibility(client, {
      actorUserId: fixture.user.id,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      granted: true,
      now: new Date("2026-07-20T10:05:00.000Z"),
    });
    expect(unchanged).toMatchObject({ outcome: "UNCHANGED", granted: true });
    await expect(
      client.candidateConsent.count({
        where: { candidateProfileId: fixture.profile.id },
      }),
    ).resolves.toBe(2);
  });

  it("orders same-timestamp Radar grant and revoke commands by their persisted recording revision", async () => {
    const client = requireDatabase();
    const sameAt = new Date("2026-07-20T11:00:00.000Z");
    const grantThenRevoke = await createFixture(
      client,
      "same-time-grant-revoke",
    );

    await setOwnedTalentRadarVisibility(client, {
      actorUserId: grantThenRevoke.user.id,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      granted: true,
      now: sameAt,
    });
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: grantThenRevoke.user.id,
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      granted: false,
      now: sameAt,
    });

    const grantThenRevokeEvents = await client.candidateConsent.findMany({
      where: {
        candidateProfileId: grantThenRevoke.profile.id,
        kind: "TALENT_RADAR_VISIBILITY",
        effectiveAt: sameAt,
      },
      orderBy: { createdAt: "asc" },
      select: { granted: true, effectiveAt: true, createdAt: true },
    });
    expect(grantThenRevokeEvents.map(({ granted }) => granted)).toEqual([
      true,
      false,
    ]);
    expect(
      grantThenRevokeEvents[1]!.createdAt.getTime(),
    ).toBeGreaterThan(grantThenRevokeEvents[0]!.createdAt.getTime());
    expect(
      grantThenRevokeEvents.every(
        ({ effectiveAt }) => effectiveAt.getTime() === sameAt.getTime(),
      ),
    ).toBe(true);

    const [revokedWorkspace, revokedDatabaseState] = await Promise.all([
      getOwnedCandidateProfileWorkspace(
        client,
        grantThenRevoke.user.id,
        sameAt,
      ),
      client.$queryRaw<Array<{ current: boolean }>>`
        SELECT phase09_has_current_radar_visibility_consent(
          ${grantThenRevoke.profile.id}::uuid,
          ${sameAt}
        ) AS "current"
      `,
    ]);
    expect(revokedWorkspace.radarConsentGranted).toBe(false);
    expect(revokedDatabaseState[0]?.current).toBe(false);

    const revokeThenGrant = await createFixture(
      client,
      "same-time-revoke-grant",
    );
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: revokeThenGrant.user.id,
      correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      granted: true,
      now: new Date(sameAt.getTime() - 1_000),
    });
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: revokeThenGrant.user.id,
      correlationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      granted: false,
      now: sameAt,
    });
    await setOwnedTalentRadarVisibility(client, {
      actorUserId: revokeThenGrant.user.id,
      correlationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      granted: true,
      now: sameAt,
    });

    const revokeThenGrantEvents = await client.candidateConsent.findMany({
      where: {
        candidateProfileId: revokeThenGrant.profile.id,
        kind: "TALENT_RADAR_VISIBILITY",
        effectiveAt: sameAt,
      },
      orderBy: { createdAt: "asc" },
      select: { granted: true, effectiveAt: true, createdAt: true },
    });
    expect(revokeThenGrantEvents.map(({ granted }) => granted)).toEqual([
      false,
      true,
    ]);
    expect(
      revokeThenGrantEvents[1]!.createdAt.getTime(),
    ).toBeGreaterThan(revokeThenGrantEvents[0]!.createdAt.getTime());
    expect(
      revokeThenGrantEvents.every(
        ({ effectiveAt }) => effectiveAt.getTime() === sameAt.getTime(),
      ),
    ).toBe(true);

    const [grantedWorkspace, grantedDatabaseState] = await Promise.all([
      getOwnedCandidateProfileWorkspace(client, revokeThenGrant.user.id, sameAt),
      client.$queryRaw<Array<{ current: boolean }>>`
        SELECT phase09_has_current_radar_visibility_consent(
          ${revokeThenGrant.profile.id}::uuid,
          ${sameAt}
        ) AS "current"
      `,
    ]);
    expect(grantedWorkspace.radarConsentGranted).toBe(true);
    expect(grantedDatabaseState[0]?.current).toBe(true);
  });

  it("returns the same safe unavailable error when an actor has no candidate profile", async () => {
    const client = requireDatabase();
    const user = await client.user.create({
      data: {
        email: "profileless@example.test",
        emailNormalized: "profileless@example.test",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
    });
    await expect(
      completeOwnedCandidateOnboarding(client, {
        actorUserId: user.id,
        correlationId: CORRELATION_COMPLETE,
        now: COMPLETE_AT,
      }),
    ).rejects.toBeInstanceOf(CandidateProfileUnavailableError);
  });

  it("rejects malformed two-character language codes at the database boundary", async () => {
    const client = requireDatabase();
    const fixture = await createFixture(client, "language-code");
    await expect(
      client.candidateLanguage.create({
        data: {
          candidateProfileId: fixture.profile.id,
          code: "12",
          level: "C1",
        },
      }),
    ).rejects.toThrow();
  });
});

function requireDatabase() {
  if (database === undefined)
    throw new Error("Candidate profile database is unavailable.");
  return database;
}

async function createFixture(client: DatabaseClient, suffix: string) {
  const user = await client.user.create({
    data: {
      email: `candidate-profile-${suffix}@example.test`,
      emailNormalized: `candidate-profile-${suffix}@example.test`,
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
    },
  });
  const profile = await client.candidateProfile.create({
    data: { userId: user.id },
  });
  const canton = await client.canton.create({
    data: {
      code: cantonCode(suffix),
      name: `Kanton ${suffix}`,
      slug: `canton-${suffix}`,
      language: "DE",
    },
  });
  const category = await client.category.create({
    data: { name: `Informatik ${suffix}`, slug: `informatik-${suffix}` },
  });
  const skill = await client.skill.create({
    data: { name: `TypeScript ${suffix}`, slug: `typescript-${suffix}` },
  });
  return { user, profile, canton, category, skill };
}

function profileInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<SwissJobPassInput> = {},
) {
  return swissJobPassSchema.parse({
    firstName: "Mira",
    lastName: "Muster",
    phone: "+41 79 123 45 67",
    cantonId: fixture.canton.id,
    cityLabel: "Zürich",
    summary: "Erfahrene Fachperson mit klarem Kompetenzprofil.",
    desiredTitles: ["Softwareentwicklerin"],
    skillIds: [fixture.skill.id],
    languages: [{ code: "de", level: "C1" }],
    categoryIds: [fixture.category.id],
    workloadMin: 60,
    workloadMax: 80,
    desiredSalaryMin: 100_000,
    desiredSalaryMax: 120_000,
    desiredSalaryPeriod: "YEARLY",
    jobTypes: ["PERMANENT"],
    remotePreference: "HYBRID",
    mobilityRadiusKm: 30,
    availabilityDate: new Date("2026-08-01T00:00:00.000Z"),
    workPermitType: "C",
    radarVisible: false,
    ...overrides,
  });
}

function cantonCode(value: string) {
  return (
    {
      lifecycle: "ZH",
      owner: "BE",
      stranger: "VD",
      "stale-consent": "AG",
      "future-consent": "AI",
      "same-time-grant-revoke": "BL",
      "same-time-revoke-grant": "BS",
      "language-code": "AR",
    }[value] ?? "ZG"
  );
}
