import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const uuid = (sequence: number) =>
  `e1400000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const IDS = Object.freeze({
  employerUser: uuid(1),
  company: uuid(2),
  membership: uuid(3),
});

const CREATED_AT = "2048-01-15T10:00:00.000Z";
const EXPIRES_AT = "2048-01-15T10:15:00.000Z";

let migrated: MigratedDatabase | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase14_radar_cohort_contract");
  const target = requireDatabase().pool;

  await target.query(
    `INSERT INTO "User" (
       "id", "email", "emailNormalized", "role", "dataProvenance", "updatedAt"
     ) VALUES (
       $1, 'phase14-cohort-employer@example.test',
       'phase14-cohort-employer@example.test', 'EMPLOYER', 'TEST', $2
     )`,
    [IDS.employerUser, CREATED_AT],
  );
  await target.query(
    `INSERT INTO "Company" (
       "id", "name", "slug", "values", "benefits", "status",
       "dataProvenance", "updatedAt"
     ) VALUES (
       $1, 'Phase 14 Cohort Contract AG', 'phase14-cohort-contract-ag',
       ARRAY[]::text[], ARRAY[]::text[], 'DRAFT', 'TEST', $2
     )`,
    [IDS.company, CREATED_AT],
  );
  await target.query(
    `INSERT INTO "CompanyMembership" (
       "id", "companyId", "userId", "role", "status", "updatedAt"
     ) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4)`,
    [IDS.membership, IDS.company, IDS.employerUser, CREATED_AT],
  );
});

afterAll(async () => {
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-14 Radar cohort PostgreSQL contract", () => {
  it.each([10, 24, 25, 50, 100])(
    "accepts the complete eligible cohort size %i independently of the card sample",
    async (resultCount) => {
      const sessionId = uuid(100 + resultCount);
      await insertSession({
        id: sessionId,
        resultCount,
        filterHash: resultCount.toString(16).padStart(64, "0"),
      });

      const persisted = await requireDatabase().pool.query<{
        resultCount: number;
      }>(
        `SELECT "resultCount" FROM "RadarSearchSession" WHERE "id" = $1`,
        [sessionId],
      );
      expect(persisted.rows).toEqual([{ resultCount }]);
    },
  );

  it("keeps the persisted card sample at positions 0 through 19", async () => {
    const sessionId = uuid(300);
    await insertSession({
      id: sessionId,
      resultCount: 100,
      filterHash: "a".repeat(64),
    });

    const candidateUserIds = Array.from({ length: 21 }, (_, index) =>
      uuid(400 + index),
    );
    const candidateProfileIds = Array.from({ length: 21 }, (_, index) =>
      uuid(500 + index),
    );
    const emails = candidateUserIds.map(
      (_, index) => `phase14-cohort-candidate-${index}@example.test`,
    );
    const target = requireDatabase().pool;

    await target.query(
      `INSERT INTO "User" (
         "id", "email", "emailNormalized", "role", "dataProvenance", "updatedAt"
       )
       SELECT source."id"::uuid, source."email", source."email",
              'CANDIDATE', 'TEST', $3::timestamptz
       FROM unnest($1::text[], $2::text[]) AS source("id", "email")`,
      [candidateUserIds, emails, CREATED_AT],
    );
    await target.query(
      `INSERT INTO "CandidateProfile" ("id", "userId", "updatedAt")
       SELECT source."profileId"::uuid, source."userId"::uuid, $3::timestamptz
       FROM unnest($1::text[], $2::text[]) AS source("profileId", "userId")`,
      [candidateProfileIds, candidateUserIds, CREATED_AT],
    );
    await target.query(
      `INSERT INTO "RadarSearchSessionCandidate" (
         "id", "radarSearchSessionId", "candidateProfileId", "position"
       )
       SELECT source."id"::uuid, $3::uuid,
              source."candidateProfileId"::uuid, source."position"::integer
       FROM unnest($1::text[], $2::text[], $4::integer[])
            AS source("id", "candidateProfileId", "position")`,
      [
        Array.from({ length: 20 }, (_, index) => uuid(600 + index)),
        candidateProfileIds.slice(0, 20),
        sessionId,
        Array.from({ length: 20 }, (_, index) => index),
      ],
    );

    await expect(
      target.query(
        `SELECT count(*)::integer AS "sampleCount"
           FROM "RadarSearchSessionCandidate"
          WHERE "radarSearchSessionId" = $1`,
        [sessionId],
      ),
    ).resolves.toMatchObject({ rows: [{ sampleCount: 20 }] });
    await expectCheckViolation(
      () =>
        target.query(
          `INSERT INTO "RadarSearchSessionCandidate" (
             "id", "radarSearchSessionId", "candidateProfileId", "position"
           ) VALUES ($1, $2, $3, 20)`,
          [uuid(620), sessionId, candidateProfileIds[20]],
        ),
      "radar_search_session_position_check",
    );
  });

  it("rejects a negative complete cohort count through the named session constraint", async () => {
    await expectCheckViolation(
      () =>
        insertSession({
          id: uuid(700),
          resultCount: -1,
          filterHash: "b".repeat(64),
        }),
      "radar_search_session_result_check",
    );
  });

  it.each([
    ["equal", CREATED_AT],
    ["later", "2048-01-15T09:59:59.999Z"],
  ])(
    "rejects createdAt %s expiresAt through the named session constraint",
    async (_, expiresAt) => {
      await expectCheckViolation(
        () =>
          insertSession({
            id: uuid(expiresAt === CREATED_AT ? 701 : 702),
            resultCount: 25,
            filterHash: (expiresAt === CREATED_AT ? "c" : "d").repeat(64),
            expiresAt,
          }),
        "radar_search_session_result_check",
      );
    },
  );
});

function requireDatabase(): MigratedDatabase {
  if (migrated === undefined) {
    throw new Error("Phase-14 Radar cohort test database is unavailable.");
  }
  return migrated;
}

async function insertSession(input: Readonly<{
  id: string;
  resultCount: number;
  filterHash: string;
  expiresAt?: string;
}>) {
  await requireDatabase().pool.query(
    `INSERT INTO "RadarSearchSession" (
       "id", "companyId", "membershipId", "requestingUserId",
       "filterHash", "calendarDate", "policyVersion", "normalizedFilters",
       "resultCount", "expiresAt", "createdAt"
     ) VALUES (
       $1, $2, $3, $4, $5, '2048-01-15', 'radar-privacy-v1',
       '{}'::jsonb, $6, $7, $8
     )`,
    [
      input.id,
      IDS.company,
      IDS.membership,
      IDS.employerUser,
      input.filterHash,
      input.resultCount,
      input.expiresAt ?? EXPIRES_AT,
      CREATED_AT,
    ],
  );
}

async function expectCheckViolation(
  operation: () => Promise<unknown>,
  constraint: string,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, `Expected PostgreSQL constraint ${constraint} to reject`).toEqual(
    expect.objectContaining({ code: "23514", constraint }),
  );
}
