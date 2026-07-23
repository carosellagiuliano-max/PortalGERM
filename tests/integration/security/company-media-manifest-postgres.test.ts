import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: MigratedDatabase | undefined;

describe("company media manifest database backstop", () => {
  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase16_company_media");
  }, 120_000);

  afterAll(async () => {
    await migrated?.dispose();
  });

  it("accepts only null or exact reviewed manifest paths", async () => {
    const pool = requiredDatabase().pool;
    await expect(
      pool.query(
        `INSERT INTO "Company"
          ("id", "name", "slug", "logoStorageKey", "coverStorageKey", "values", "benefits", "updatedAt")
         VALUES
          ($1::uuid, 'Reviewed Media AG', 'reviewed-media-ag',
           '/assets/company-media/default-logo.svg',
           '/assets/company-media/alpine-cover.svg',
           ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP)`,
        ["63000000-0000-4000-8000-000000000001"],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      pool.query(
        `INSERT INTO "Company"
          ("id", "name", "slug", "logoStorageKey", "values", "benefits", "updatedAt")
         VALUES
          ($1::uuid, 'No Media AG', 'no-media-ag', NULL,
           ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP)`,
        ["63000000-0000-4000-8000-000000000002"],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      pool.query(
        `INSERT INTO "Company"
          ("id", "name", "slug", "logoStorageKey", "values", "benefits", "updatedAt")
         VALUES
          ($1::uuid, 'Tracking Media AG', 'tracking-media-ag',
           'https://tracking.example/pixel.png',
           ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP)`,
        ["63000000-0000-4000-8000-000000000003"],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      pool.query(
        `INSERT INTO "Company"
          ("id", "name", "slug", "coverStorageKey", "values", "benefits", "updatedAt")
         VALUES
          ($1::uuid, 'Unknown Media AG', 'unknown-media-ag',
           '/assets/company-media/not-reviewed.svg',
           ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP)`,
        ["63000000-0000-4000-8000-000000000004"],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

function requiredDatabase() {
  if (migrated === undefined) {
    throw new Error("The migrated test database is unavailable.");
  }
  return migrated;
}
