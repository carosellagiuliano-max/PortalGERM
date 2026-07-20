import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const CANTON_ID = "61000000-0000-4000-8000-000000000001";
const COMPANY_ID = "62000000-0000-4000-8000-000000000001";
let database: MigratedDatabase | undefined;

function pool(): Pool {
  if (!database) throw new Error("Phase 06 schema database is unavailable.");
  return database.pool;
}

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase06_auth_company_signals");
  await pool().query(
    `INSERT INTO "Canton" ("id","code","name","slug","language","updatedAt")
     VALUES ($1,'ZH','Zürich','zuerich','DE',now())`,
    [CANTON_ID],
  );
});

afterAll(async () => {
  await database?.dispose();
  database = undefined;
});

async function insertCompany(
  id: string,
  slug: string,
  overrides: Readonly<{
    domain?: string | null;
    normalizedName?: string | null;
    cantonId?: string | null;
  }> = {},
) {
  return pool().query(
    `INSERT INTO "Company" (
       "id","name","slug","registrationEmailDomainNormalized",
       "registrationNameNormalized","registrationCantonId","values","benefits","updatedAt"
     ) VALUES ($1,'Beispiel AG',$2,$3,$4,$5,'{}','{}',now())`,
    [
      id,
      slug,
      overrides.domain === undefined ? "example.ch" : overrides.domain,
      overrides.normalizedName === undefined
        ? "beispiel-ag"
        : overrides.normalizedName,
      overrides.cantonId === undefined ? CANTON_ID : overrides.cantonId,
    ],
  );
}

describe("Phase 06 company registration signal schema", () => {
  it("adds nullable bounded fields, a restrictive canton relation and lookup indexes", async () => {
    const columns = await pool().query<{
      character_maximum_length: number | null;
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>(
      `SELECT column_name,data_type,udt_name,is_nullable,character_maximum_length
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='Company'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [[
        "registrationCantonId",
        "registrationEmailDomainNormalized",
        "registrationNameNormalized",
      ]],
    );
    expect(columns.rows).toEqual([
      {
        column_name: "registrationCantonId",
        data_type: "uuid",
        udt_name: "uuid",
        is_nullable: "YES",
        character_maximum_length: null,
      },
      {
        column_name: "registrationEmailDomainNormalized",
        data_type: "character varying",
        udt_name: "varchar",
        is_nullable: "YES",
        character_maximum_length: 253,
      },
      {
        column_name: "registrationNameNormalized",
        data_type: "character varying",
        udt_name: "varchar",
        is_nullable: "YES",
        character_maximum_length: 200,
      },
    ]);

    const indexes = await pool().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND tablename='Company'
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [[
        "Company_registrationCantonId_idx",
        "Company_registrationEmailDomainNormalized_idx",
        "Company_registrationNameNormalized_registrationCantonId_idx",
      ]],
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "Company_registrationCantonId_idx",
      "Company_registrationEmailDomainNormalized_idx",
      "Company_registrationNameNormalized_registrationCantonId_idx",
    ]);

    const foreignKey = await pool().query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid='"Company"'::regclass
         AND conname='Company_registrationCantonId_fkey'`,
    );
    expect(foreignKey.rows).toEqual([
      {
        definition:
          'FOREIGN KEY ("registrationCantonId") REFERENCES "Canton"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
      },
    ]);
  });

  it("accepts canonical signals without creating any billing effect", async () => {
    await insertCompany(COMPANY_ID, "beispiel-ag");
    const company = await pool().query(
      `SELECT "registrationEmailDomainNormalized","registrationNameNormalized","registrationCantonId"
       FROM "Company" WHERE "id"=$1`,
      [COMPANY_ID],
    );
    expect(company.rows).toEqual([
      {
        registrationEmailDomainNormalized: "example.ch",
        registrationNameNormalized: "beispiel-ag",
        registrationCantonId: CANTON_ID,
      },
    ]);
    const billing = await pool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "CompanyBillingProfile" WHERE "companyId"=$1`,
      [COMPANY_ID],
    );
    expect(billing.rows).toEqual([{ count: "0" }]);
  });

  it("rejects unpaired name/canton and non-canonical domain/name values", async () => {
    await expect(
      insertCompany(
        "62000000-0000-4000-8000-000000000002",
        "missing-canton",
        { cantonId: null },
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "Company_registration_name_canton_pair_check",
    });
    await expect(
      insertCompany(
        "62000000-0000-4000-8000-000000000003",
        "raw-domain",
        { domain: "Example.CH" },
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "Company_registration_email_domain_normalized_check",
    });
    await expect(
      insertCompany(
        "62000000-0000-4000-8000-000000000004",
        "raw-name",
        { normalizedName: "Beispiel AG" },
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "Company_registration_name_normalized_check",
    });
  });
});
