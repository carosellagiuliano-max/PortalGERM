import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { orchestrateDemoSeed } from "@/prisma/seed/orchestrator";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client() {
  if (database === undefined) {
    throw new Error("Phase-32 LC1 database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase32_lc1_isolation");
  database = createDatabaseClient(isolated.connectionString);
  await orchestrateDemoSeed(database);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-32 LC1 local-demo isolation", () => {
  it("keeps indexing, live providers, real payment and external capabilities fail-closed", async () => {
    const environment = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "local",
        DATABASE_URL: isolated?.connectionString,
        TEST_DATABASE_URL: undefined,
      }),
    );

    expect(environment).toMatchObject({
      APP_ENV: "local",
      EMAIL_PROVIDER_MODE: "disabled",
      PAYMENT_PROVIDER_MODE: "disabled",
      REAL_PAYMENT_INGESTION: false,
      REAL_PAYMENT_PROJECTION: false,
      PAID_SELF_SERVICE: false,
      DOCUMENT_STORAGE_MODE: "disabled",
      DOCUMENT_SCANNER_MODE: "disabled",
      PRIVACY_PROCESSING_MODE: "disabled",
      WORKER_RUNTIME: "paused",
      EXTERNAL_APPLICATION_TRACKER: "disabled",
      INTERVIEW_SCHEDULER: "disabled",
      COMMERCIAL_PRODUCTION_OFFERS: false,
      COMMERCIAL_MANAGED_IMPORT: false,
      COMMERCIAL_BOOST: false,
      COMMERCIAL_PAID_RADAR: false,
      COMMERCIAL_SALARY: false,
    });

    vi.doMock("@/lib/config/env", () => ({
      getServerEnvironment: () => environment,
    }));
    const { getPublicDataContext } = await import("@/lib/public/environment");
    expect(getPublicDataContext()).toEqual({
      eligibilityEnvironment: "non-production",
      liveOnly: false,
      publicIndexingAllowed: false,
      showDemoBanner: true,
    });
    vi.doUnmock("@/lib/config/env");
  });

  it("contains only synthetic identities and no live activation in the sealed demo dataset", async () => {
    const users = await client().user.findMany({
      select: { emailNormalized: true },
      orderBy: { emailNormalized: "asc" },
    });
    expect(users.length).toBeGreaterThan(0);
    const unexpectedIdentities = users
      .map(({ emailNormalized }) => emailNormalized)
      .filter(
        (emailNormalized) =>
          !/@(?:demo\.ch|demo\.swisstalenthub\.(?:test|invalid)|[^@]+\.demo\.invalid|example\.invalid)$/u.test(
            emailNormalized,
          ),
      );
    expect(unexpectedIdentities).toEqual([]);

    const [
      liveProviders,
      publicOffers,
      publicCommercialClusters,
      activatedSearchClusters,
      nonDemoPublishedJobs,
    ] = await Promise.all([
      client().providerActivation.count({ where: { mode: "LIVE" } }),
      client().commercialOfferRelease.count({
        where: { status: "PUBLIC_ACTIVE" },
      }),
      client().commercialClusterDecision.count({
        where: { status: "PUBLIC_ACTIVE" },
      }),
      client().clusterLaunchAssessment.count({
        where: { status: "ACTIVATED" },
      }),
      client().job.count({
        where: {
          status: "PUBLISHED",
          dataProvenance: { not: "DEMO" },
        },
      }),
    ]);

    expect({
      activatedSearchClusters,
      liveProviders,
      nonDemoPublishedJobs,
      publicCommercialClusters,
      publicOffers,
    }).toEqual({
      activatedSearchClusters: 0,
      liveProviders: 0,
      nonDemoPublishedJobs: 0,
      publicCommercialClusters: 0,
      publicOffers: 0,
    });
  });
});
