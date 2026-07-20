import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyPassword } from "@/lib/auth/password";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import {
  DEMO_ACCOUNT_FIXTURES,
  DEMO_COMPANY_SLUG,
} from "@/prisma/seed/fixtures/companies-jobs";
import { stableSeedId } from "@/prisma/seed/ids";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const ANCHOR = new Date();
ANCHOR.setMilliseconds(0);

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (!database) throw new Error("Companies/jobs integration client is missing.");
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_05_companies_jobs");
  database = createDatabaseClient(isolated.connectionString);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-05 companies/jobs PostgreSQL seed", () => {
  it(
    "persists the trigger-safe graph and verifies an exact no-update second run",
    async () => {
      await seedReferenceCatalog(client());
      const first = await seedDemoAccountsCompaniesAndJobs(client(), ANCHOR);
      const beforeXmin = await loadSeedXmin(client());
      const second = await seedDemoAccountsCompaniesAndJobs(client(), ANCHOR);
      const afterXmin = await loadSeedXmin(client());

      expect(second.blockDigest).toEqual(first.blockDigest);
      expect(afterXmin).toEqual(beforeXmin);
      expect(await client().company.count({ where: { dataProvenance: "DEMO" } })).toBe(25);
      expect(await client().companyBillingProfile.count()).toBe(1);
      expect(await client().job.count({ where: { dataProvenance: "DEMO" } })).toBe(115);
      expect(await client().job.count({ where: { status: "PUBLISHED" } })).toBe(100);
      expect(await client().jobRevisionSkill.count()).toBe(230);
      expect(await client().jobRevisionLanguage.count()).toBe(155);
      expect(await client().jobScoreSnapshot.count()).toBe(105);
      expect(await client().jobReportingCheck.count()).toBe(115);

      expect(
        await client().job.count({
          where: {
            status: "PUBLISHED",
            publishedCantonId: stableSeedId("canton", "ZH"),
            publishedCategoryId: stableSeedId(
              "category",
              "engineering-technik",
            ),
          },
        }),
      ).toBe(50);

      const currentVerified = await client().company.findMany({
        where: { dataProvenance: "DEMO" },
        select: {
          verificationRequests: {
            where: { status: "VERIFIED", supersededBy: null },
            select: { id: true },
          },
        },
      });
      expect(
        currentVerified.every(
          (company) => company.verificationRequests.length === 1,
        ),
      ).toBe(true);

      const demoCompany = await client().company.findUniqueOrThrow({
        where: { slug: DEMO_COMPANY_SLUG },
        include: { memberships: { include: { user: true } } },
      });
      expect(
        demoCompany.memberships.map((membership) => [
          membership.user.emailNormalized,
          membership.role,
        ]),
      ).toEqual(
        expect.arrayContaining([
          ["employer@demo.ch", "OWNER"],
          ["recruiter@demo.ch", "RECRUITER"],
        ]),
      );

      for (const account of DEMO_ACCOUNT_FIXTURES) {
        const credential = await client().credential.findUniqueOrThrow({
          where: { userId: account.id },
        });
        await expect(
          verifyPassword("Demo12345!", credential.passwordHash),
        ).resolves.toBe(true);
        expect(credential.passwordHash).not.toContain("Demo12345!");
      }

      expect(
        await client().companyClaimRequest.count({ where: { status: "PENDING" } }),
      ).toBe(1);
    },
    180_000,
  );
});

async function loadSeedXmin(db: DatabaseClient) {
  return db.$queryRaw<Array<{ entity: string; id: string; xmin: string }>>`
    SELECT 'Company' AS entity, "id"::text AS id, xmin::text AS xmin
    FROM "Company"
    WHERE "dataProvenance" = 'DEMO'
    UNION ALL
    SELECT 'Job' AS entity, "id"::text AS id, xmin::text AS xmin
    FROM "Job"
    WHERE "dataProvenance" = 'DEMO'
    UNION ALL
    SELECT 'JobRevision' AS entity, revision."id"::text AS id, revision.xmin::text AS xmin
    FROM "JobRevision" AS revision
    JOIN "Job" AS job ON job."id" = revision."jobId"
    WHERE job."dataProvenance" = 'DEMO'
    ORDER BY entity, id
  `;
}
