import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { runDemoSeed } from "@/prisma/seed/orchestrator";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const COMPANY_ID = "73000000-0000-4000-8000-000000000001";
const RESOLUTION_TIME = new Date("2026-07-23T19:00:00.000Z");

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase17_demo_entitlements");
  await runDemoSeed({
    APP_ENV: "local",
    DATABASE_URL: isolated.connectionString,
    ENABLE_DEMO_SEED: "true",
  });
  database = createDatabaseClient(isolated.connectionString);
  await client().company.create({
    data: {
      id: COMPANY_ID,
      name: "Phase 17 Free Company",
      slug: "phase-17-free-company",
      status: "DRAFT",
    },
  });
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

it("resolves the seeded Free catalog for a newly registered company", async () => {
  await expect(
    getPrismaEffectiveEntitlements(COMPANY_ID, RESOLUTION_TIME, client()),
  ).resolves.toMatchObject({
    ok: true,
    value: {
      companyId: COMPANY_ID,
      source: { kind: "DEFAULT_FREE" },
      rights: { ENHANCED_COMPANY_PROFILE: false },
    },
  });
});

function client() {
  if (database === undefined) {
    throw new Error("The isolated Phase 17 entitlement database is missing.");
  }
  return database;
}
