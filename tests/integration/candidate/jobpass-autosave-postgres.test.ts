import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CandidateProfileConflictError,
  saveOwnedCandidateProfile,
} from "@/lib/candidate/profile";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { swissJobPassSchema } from "@/lib/validation/candidate";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase29_jobpass_autosave");
  database = createDatabaseClient(isolated.connectionString);
});

afterAll(async () => {
  await database?.$disconnect();
  await isolated?.dispose();
});

describe("Phase-29 SwissJobPass autosave PostgreSQL contract", () => {
  it("resumes from each returned revision and rejects a stale second tab", async () => {
    const client = requireDatabase();
    const fixture = await createFixture(client);
    const tabOneRevision = fixture.profile.updatedAt;
    const tabTwoStaleRevision = fixture.profile.updatedAt;

    const firstAutosave = await saveOwnedCandidateProfile(client, {
      actorUserId: fixture.user.id,
      correlationId: "29000000-0000-4000-8000-000000000001",
      expectedUpdatedAt: tabOneRevision,
      now: new Date("2026-07-29T09:00:00.000Z"),
      profile: profileInput(fixture, "Mira"),
    });
    expect(firstAutosave.revision).toBeInstanceOf(Date);

    const secondAutosave = await saveOwnedCandidateProfile(client, {
      actorUserId: fixture.user.id,
      correlationId: "29000000-0000-4000-8000-000000000002",
      expectedUpdatedAt: firstAutosave.revision,
      now: new Date("2026-07-29T09:01:00.000Z"),
      profile: profileInput(fixture, "Mirjam"),
    });
    expect(secondAutosave.revision.getTime()).toBeGreaterThan(
      firstAutosave.revision.getTime(),
    );

    await expect(
      saveOwnedCandidateProfile(client, {
        actorUserId: fixture.user.id,
        correlationId: "29000000-0000-4000-8000-000000000003",
        expectedUpdatedAt: tabTwoStaleRevision,
        now: new Date("2026-07-29T09:02:00.000Z"),
        profile: profileInput(fixture, "Veraltet"),
      }),
    ).rejects.toBeInstanceOf(CandidateProfileConflictError);

    await expect(
      client.candidateProfile.findUniqueOrThrow({
        where: { id: fixture.profile.id },
        select: { firstName: true, updatedAt: true },
      }),
    ).resolves.toEqual({
      firstName: "Mirjam",
      updatedAt: secondAutosave.revision,
    });
  });
});

function requireDatabase() {
  if (database === undefined) {
    throw new Error("Phase-29 autosave database is unavailable.");
  }
  return database;
}

async function createFixture(client: DatabaseClient) {
  const user = await client.user.create({
    data: {
      email: "phase29-autosave@example.test",
      emailNormalized: "phase29-autosave@example.test",
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
    },
  });
  const [profile, canton, category, skill] = await Promise.all([
    client.candidateProfile.create({ data: { userId: user.id } }),
    client.canton.create({
      data: {
        code: "ZH",
        name: "Zürich",
        slug: "phase29-zuerich",
        language: "DE",
      },
    }),
    client.category.create({
      data: { name: "Phase 29 Informatik", slug: "phase29-informatik" },
    }),
    client.skill.create({
      data: { name: "Phase 29 TypeScript", slug: "phase29-typescript" },
    }),
  ]);
  return { user, profile, canton, category, skill };
}

function profileInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  firstName: string,
) {
  return swissJobPassSchema.parse({
    firstName,
    lastName: "Muster",
    cantonId: fixture.canton.id,
    cityLabel: "Zürich",
    desiredTitles: ["Softwareentwicklerin"],
    skillIds: [fixture.skill.id],
    languages: [{ code: "de", level: "C1" }],
    categoryIds: [fixture.category.id],
    workloadMin: 60,
    workloadMax: 80,
    jobTypes: ["PERMANENT"],
    remotePreference: "HYBRID",
    mobilityRadiusKm: 30,
    workPermitType: "C",
    radarVisible: false,
  });
}
