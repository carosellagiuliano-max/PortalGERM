import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { getRadarOpaqueEpoch } from "@/lib/talentradar/opaque-id";
import {
  DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
  seedCandidateWorkflows,
} from "@/prisma/seed/blocks/candidate-workflows";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import { RADAR_COMPANY_SLOTS } from "@/prisma/seed/fixtures/candidate-workflows";
import { stableSeedId } from "@/prisma/seed/ids";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const EPOCH_BOUNDARY = new Date("2026-07-30T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
// This regression builds the complete demo company/candidate graph and then
// replays the candidate block to prove idempotency. Keep it bounded like the
// other full-graph seed regressions instead of inheriting the 60 s unit bound.
const FULL_GRAPH_SEED_REGRESSION_TIMEOUT_MS = 180_000;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Radar epoch boundary database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_31_radar_epoch_boundary");
  database = createDatabaseClient(isolated.connectionString);
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential(
  "Phase-31 Radar demo-seed epoch boundary regression",
  () => {
    it(
      "keeps the legacy compatibility mapping outside the canonical Phase-14 epoch",
      async () => {
        await seedReferenceCatalog(client());
        const dependencies = await seedDemoAccountsCompaniesAndJobs(
          client(),
          EPOCH_BOUNDARY,
        );
        const first = await seedCandidateWorkflows(
          client(),
          EPOCH_BOUNDARY,
          dependencies,
          DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
        );

        const company = dependencies.companies.find(
          ({ slug }) => slug === RADAR_COMPANY_SLOTS[0],
        );
        if (company === undefined) {
          throw new Error("The first Radar fixture company is missing.");
        }
        const candidate = first.candidates[0]!;
        const legacyCurrentId = stableSeedId(
          "radar-opaque-mapping",
          `${company.slug}:current:${candidate.key}`,
        );
        const phase14CurrentId = stableSeedId(
          "radar-opaque-mapping",
          `phase14:${company.slug}:current:${candidate.key}`,
        );
        const mappings = await client().radarOpaqueMapping.findMany({
          where: { id: { in: [legacyCurrentId, phase14CurrentId] } },
          orderBy: { epoch: "asc" },
          select: { id: true, epoch: true },
        });
        const canonicalEpoch = getRadarOpaqueEpoch(EPOCH_BOUNDARY).epoch;

        expect(mappings).toEqual([
          {
            id: legacyCurrentId,
            epoch: new Date(canonicalEpoch.getTime() - DAY_MS),
          },
          { id: phase14CurrentId, epoch: canonicalEpoch },
        ]);

        await expect(
          seedCandidateWorkflows(
            client(),
            EPOCH_BOUNDARY,
            dependencies,
            DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
          ),
        ).resolves.toEqual(first);
      },
      FULL_GRAPH_SEED_REGRESSION_TIMEOUT_MS,
    );
  },
);
