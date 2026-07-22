import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const uuid = (sequence: number) =>
  `ce120000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const IDS = Object.freeze({
  company: uuid(1),
  account: uuid(2),
  grant: uuid(3),
  expiryAtBoundary: uuid(4),
  expiryAfterBoundary: uuid(5),
  missingGrant: uuid(6),
});

const VALID_FROM = "2044-01-01T00:00:00.000Z";
const VALID_TO = "2044-02-01T00:00:00.000Z";
const BEFORE_VALID_TO = "2044-01-31T23:59:59.999Z";
const AFTER_VALID_TO = "2044-02-02T00:00:00.000Z";
const BOUNDARY_IDEMPOTENCY_KEY = "phase12-credit-expiry-boundary";

let migrated: MigratedDatabase | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_credit_expiry_boundary");
  await seedGrant();
}, 120_000);

afterAll(async () => {
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 12 PostgreSQL Credit expiry boundary", () => {
  it("denies pre-boundary expiry and permits the exact and later boundary with immutable idempotent lineage", async () => {
    await expectConstraint(
      () =>
        insertExpiry({
          id: IDS.expiryAtBoundary,
          amount: -1,
          consumedGrantEntryId: IDS.grant,
          createdAt: BEFORE_VALID_TO,
          idempotencyKey: BOUNDARY_IDEMPOTENCY_KEY,
        }),
      "23514",
      "credit_ledger_expiry_grant_boundary_check",
    );

    await expectConstraint(
      () =>
        insertExpiry({
          id: uuid(7),
          amount: -1,
          consumedGrantEntryId: IDS.missingGrant,
          createdAt: VALID_TO,
          idempotencyKey: "phase12-credit-expiry-missing-grant",
        }),
      "23514",
      "credit_ledger_expiry_grant_lineage_check",
    );

    await insertExpiry({
      id: IDS.expiryAtBoundary,
      amount: -1,
      consumedGrantEntryId: IDS.grant,
      createdAt: VALID_TO,
      idempotencyKey: BOUNDARY_IDEMPOTENCY_KEY,
    });

    await expectConstraint(
      () =>
        insertExpiry({
          id: uuid(8),
          amount: -1,
          consumedGrantEntryId: IDS.grant,
          createdAt: AFTER_VALID_TO,
          idempotencyKey: BOUNDARY_IDEMPOTENCY_KEY,
        }),
      "23505",
      "CreditLedgerEntry_accountId_idempotencyKey_key",
    );

    await expectConstraint(
      () =>
        pool().query(
          `UPDATE "CreditLedgerEntry"
              SET "consumedGrantEntryId" = NULL
            WHERE "id" = $1`,
          [IDS.expiryAtBoundary],
        ),
      "23514",
      "phase02_append_only",
    );

    await insertExpiry({
      id: IDS.expiryAfterBoundary,
      amount: -2,
      consumedGrantEntryId: IDS.grant,
      createdAt: AFTER_VALID_TO,
      idempotencyKey: "phase12-credit-expiry-after-boundary",
    });

    const ledger = await pool().query<{
      amount: number;
      consumedGrantEntryId: string | null;
      createdAt: Date;
      id: string;
      kind: string;
    }>(
      `SELECT "id", "kind"::text AS "kind", "amount",
              "consumedGrantEntryId", "createdAt"
         FROM "CreditLedgerEntry"
        WHERE "accountId" = $1
        ORDER BY "createdAt", "id"`,
      [IDS.account],
    );

    expect(ledger.rows).toEqual([
      {
        id: IDS.grant,
        kind: "GRANT",
        amount: 3,
        consumedGrantEntryId: null,
        createdAt: new Date(VALID_FROM),
      },
      {
        id: IDS.expiryAtBoundary,
        kind: "EXPIRE",
        amount: -1,
        consumedGrantEntryId: IDS.grant,
        createdAt: new Date(VALID_TO),
      },
      {
        id: IDS.expiryAfterBoundary,
        kind: "EXPIRE",
        amount: -2,
        consumedGrantEntryId: IDS.grant,
        createdAt: new Date(AFTER_VALID_TO),
      },
    ]);
  });
});

async function seedGrant() {
  await pool().query(
    `INSERT INTO "Company" (
       "id", "name", "slug", "values", "benefits", "status", "updatedAt"
     ) VALUES (
       $1, 'Credit Expiry Boundary AG', 'credit-expiry-boundary-ag',
       ARRAY[]::text[], ARRAY[]::text[], 'DRAFT', CURRENT_TIMESTAMP
     )`,
    [IDS.company],
  );
  await pool().query(
    `INSERT INTO "CreditAccount" (
       "id", "companyId", "creditType", "fundingSource",
       "periodStart", "periodEnd"
     ) VALUES ($1, $2, 'TALENT_CONTACT', 'ADMIN_GRANT', $3, $4)`,
    [IDS.account, IDS.company, VALID_FROM, VALID_TO],
  );
  await pool().query(
    `INSERT INTO "CreditLedgerEntry" (
       "id", "accountId", "fundingSource", "kind", "amount",
       "validFrom", "validTo", "idempotencyKey", "reasonCode", "createdAt"
     ) VALUES (
       $1, $2, 'ADMIN_GRANT', 'GRANT', 3, $3, $4,
       'phase12-credit-expiry-grant', 'TEST_GRANT', $3
     )`,
    [IDS.grant, IDS.account, VALID_FROM, VALID_TO],
  );
}

async function insertExpiry(input: Readonly<{
  amount: number;
  consumedGrantEntryId: string;
  createdAt: string;
  id: string;
  idempotencyKey: string;
}>) {
  await pool().query(
    `INSERT INTO "CreditLedgerEntry" (
       "id", "accountId", "fundingSource", "kind", "amount",
       "consumedGrantEntryId", "validFrom", "validTo",
       "idempotencyKey", "reasonCode", "createdAt"
     ) VALUES (
       $1, $2, 'ADMIN_GRANT', 'EXPIRE', $3, $4, $5, $6, $7,
       'PERIOD_ENDED', $8
     )`,
    [
      input.id,
      IDS.account,
      input.amount,
      input.consumedGrantEntryId,
      VALID_FROM,
      VALID_TO,
      input.idempotencyKey,
      input.createdAt,
    ],
  );
}

async function expectConstraint(
  operation: () => Promise<unknown>,
  code: string,
  constraint: string,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, `Expected PostgreSQL constraint ${constraint} to reject`).toEqual(
    expect.objectContaining({ code, constraint }),
  );
}

function pool() {
  if (migrated === undefined) {
    throw new Error("The isolated Credit expiry database is unavailable.");
  }
  return migrated.pool;
}
