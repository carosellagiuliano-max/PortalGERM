import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  buildRadarOpaqueLookup,
  type RadarOpaqueKey,
} from "@/lib/privacy/radar-opaque";
import {
  createPrismaRadarCandidateListRepository,
} from "@/lib/talentradar/list-candidates";
import { getRadarOpaqueEpoch } from "@/lib/talentradar/opaque-id";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<
  ReturnType<typeof createMigratedTestDatabase>
>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const CONCURRENT_USER_ID = "44444444-4444-4444-8444-444444444444";
const CONCURRENT_CANDIDATE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-08-23T12:00:00.000Z");
const LOOKUP_KEYS = Object.freeze([
  Object.freeze({
    version: "lookup-v1",
    secret: Buffer.alloc(32, 0x31).toString("base64"),
  }),
]) satisfies readonly RadarOpaqueKey[];
const ENCRYPTION_KEYS = Object.freeze([
  Object.freeze({
    version: "encryption-v1",
    secret: Buffer.alloc(32, 0x32).toString("base64"),
  }),
]) satisfies readonly RadarOpaqueKey[];

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase17_radar_opaque_mapping");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  await database.user.create({
    data: {
      id: USER_ID,
      email: "phase17-radar-mapping@example.test",
      emailNormalized: "phase17-radar-mapping@example.test",
      role: "CANDIDATE",
    },
  });
  await database.candidateProfile.create({
    data: {
      id: CANDIDATE_ID,
      userId: USER_ID,
    },
  });
  await database.user.create({
    data: {
      id: CONCURRENT_USER_ID,
      email: "phase17-radar-concurrent@example.test",
      emailNormalized: "phase17-radar-concurrent@example.test",
      role: "CANDIDATE",
    },
  });
  await database.candidateProfile.create({
    data: {
      id: CONCURRENT_CANDIDATE_ID,
      userId: CONCURRENT_USER_ID,
    },
  });
  await database.company.create({
    data: {
      id: COMPANY_ID,
      name: "Phase 17 Radar Mapping AG",
      slug: "phase17-radar-mapping",
    },
  });
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 17 Radar opaque PostgreSQL roundtrip", () => {
  it("returns the same decryptable token after a freshly persisted epoch mapping", async () => {
    const repository = createPrismaRadarCandidateListRepository(db());
    const input = {
      companyId: COMPANY_ID,
      candidateProfileId: CANDIDATE_ID,
      now: NOW,
      lookupKeyring: LOOKUP_KEYS,
      encryptionKeyring: ENCRYPTION_KEYS,
    };

    const first = await repository.getOrCreateOpaqueId(input);
    const persisted = await db().radarOpaqueMapping.findUniqueOrThrow({
      where: {
        candidateProfileId_companyId_epoch: {
          candidateProfileId: CANDIDATE_ID,
          companyId: COMPANY_ID,
          epoch: getRadarOpaqueEpoch(NOW).epoch,
        },
      },
    });
    expect(persisted.epoch).toEqual(getRadarOpaqueEpoch(NOW).epoch);
    expect(
      buildRadarOpaqueLookup(first, LOOKUP_KEYS, {
        companyId: COMPANY_ID,
        epoch: persisted.epoch,
      }),
    ).toEqual({
      lookupHmac: persisted.lookupHmac,
      lookupKeyVersion: persisted.lookupKeyVersion,
    });

    await expect(repository.getOrCreateOpaqueId(input)).resolves.toBe(first);
    await expect(
      db().radarOpaqueMapping.count({
        where: {
          candidateProfileId: CANDIDATE_ID,
          companyId: COMPANY_ID,
        },
      }),
    ).resolves.toBe(1);
  });

  it("converges concurrent first reads on one row-id-bound token", async () => {
    const repository = createPrismaRadarCandidateListRepository(db());
    const input = {
      companyId: COMPANY_ID,
      candidateProfileId: CONCURRENT_CANDIDATE_ID,
      now: NOW,
      lookupKeyring: LOOKUP_KEYS,
      encryptionKeyring: ENCRYPTION_KEYS,
    };

    const tokens = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.getOrCreateOpaqueId(input),
      ),
    );
    expect(new Set(tokens)).toEqual(new Set([tokens[0]]));
    await expect(repository.getOrCreateOpaqueId(input)).resolves.toBe(tokens[0]);
    await expect(
      db().radarOpaqueMapping.count({
        where: {
          candidateProfileId: CONCURRENT_CANDIDATE_ID,
          companyId: COMPANY_ID,
        },
      }),
    ).resolves.toBe(1);
  });
});

function db() {
  if (database === undefined) {
    throw new Error("Phase 17 Radar mapping database is not initialized.");
  }
  return database;
}
