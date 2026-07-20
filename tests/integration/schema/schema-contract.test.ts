import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<
  ReturnType<typeof createMigratedTestDatabase>
>;

type SqlStatement = Readonly<{
  text: string;
  values: ReadonlyArray<unknown>;
}>;

type WriteOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ error: unknown; ok: false }>;

const SQLSTATE = {
  checkViolation: "23514",
  exclusionViolation: "23P01",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
} as const;

const HALF_OPEN_EXCLUSION_CONSTRAINTS = [
  "plan_version_active_range_excl",
  "product_version_active_range_excl",
  "tax_rate_approved_range_excl",
  "salary_dataset_approved_range_excl",
  "subscription_effective_range_excl",
  "job_boost_effective_range_excl",
  "entitlement_grant_effective_range_excl",
] as const;

const CROSS_SCOPE_CONSTRAINTS = {
  application_id_submitted_revision_unique: "u",
  application_snapshot_revision_scope_fkey: "f",
  application_submitted_revision_job_fkey: "f",
  city_id_canton_unique: "u",
  company_location_city_canton_fkey: "f",
  company_membership_id_company_user_unique: "u",
  contact_request_scope_unique: "u",
  content_current_revision_scope_fkey: "f",
  content_event_revision_scope_fkey: "f",
  content_revision_id_page_unique: "u",
  conversation_id_company_unique: "u",
  conversation_participant_company_scope_fkey: "f",
  identity_reveal_request_scope_fkey: "f",
  invoice_order_company_fkey: "f",
  job_alert_digest_id_alert_unique: "u",
  job_alert_digest_item_scope_fkey: "f",
  job_alert_unsubscribe_token_scope_fkey: "f",
  job_assignment_job_company_fkey: "f",
  job_assignment_membership_scope_fkey: "f",
  job_boost_job_company_fkey: "f",
  job_current_revision_scope_fkey: "f",
  job_id_company_unique: "u",
  job_published_revision_scope_fkey: "f",
  job_revision_city_canton_scope_fkey: "f",
  job_revision_id_job_unique: "u",
  job_status_event_revision_scope_fkey: "f",
  order_id_company_unique: "u",
  radar_search_session_membership_scope_fkey: "f",
  subscription_change_current_scope_fkey: "f",
  subscription_change_successor_scope_fkey: "f",
  subscription_id_company_unique: "u",
  subscription_source_order_company_fkey: "f",
} as const;

const PARTIAL_UNIQUE_INDEXES = [
  "additional_job_permit_active_company_unique",
  "additional_job_permit_active_job_unique",
  "cluster_single_activated_unique",
  "company_active_invitation_unique",
  "company_open_claim_unique",
  "company_open_verification_unique",
  "company_single_primary_location_unique",
  "contact_request_pending_unique",
  "conversation_participant_company_unique",
  "conversation_participant_user_unique",
  "import_access_grant_active_source_unique",
  "job_active_assignment_unique",
  "plan_single_default_free_unique",
  "privacy_active_challenge_unique",
  "subscription_pending_change_unique",
] as const;

const PLAN_VERSION_INSERT = [
  'INSERT INTO "PlanVersion" (',
  '  "id", "planId", "version", "status", "priceMode",',
  '  "billingInterval", "termMonths", "netPriceRappen",',
  '  "monthlyEquivalentRappen", "currency", "isPublic",',
  '  "isSelfService", "validFrom", "validTo"',
  ") VALUES (",
  "  $1, $2, $3, $4, 'FIXED',",
  "  'MONTHLY', 1, 1000,",
  "  1000, 'CHF', false,",
  "  false, $5::timestamptz, $6::timestamptz",
  ")",
].join("\n");

const PRODUCT_VERSION_INSERT = [
  'INSERT INTO "ProductVersion" (',
  '  "id", "productId", "version", "status", "netPriceRappen",',
  '  "currency", "durationDays", "creditType", "creditAmount",',
  '  "isPublic", "isSelfService", "priority", "requiresLegalReview",',
  '  "validFrom", "validTo"',
  ") VALUES (",
  "  $1, $2, $3, $4, $5,",
  "  'CHF', $6, $7, $8,",
  "  false, false, 0, false,",
  "  $9::timestamptz, $10::timestamptz",
  ")",
].join("\n");

const ORDER_LINE_INSERT = [
  'INSERT INTO "OrderLine" (',
  '  "id", "orderId", "planVersionId", "productVersionId",',
  '  "taxRateVersionId", "quantity", "unitNetRappen", "netRappen",',
  '  "taxRateBasisPoints", "vatRappen", "totalRappen", "currency",',
  '  "descriptionSnapshot", "fulfillmentContext", "targetJobId",',
  '  "targetImportSourceId", "targetCreditType"',
  ") VALUES (",
  "  $1, $2, $3, $4,",
  "  $5, 1, 100, 100,",
  "  0, 0, 100, 'CHF',",
  "  'Schema contract line', $6, $7,",
  "  $8, $9",
  ")",
].join("\n");

const CREDIT_LEDGER_INSERT = [
  'INSERT INTO "CreditLedgerEntry" (',
  '  "id", "accountId", "fundingSource", "kind", "amount",',
  '  "sourcePlanVersionId", "sourceOrderLineId", "reversalOfEntryId",',
  '  "validFrom", "validTo", "idempotencyKey", "reasonCode",',
  '  "actorUserId", "createdAt"',
  ") VALUES (",
  "  $1, $2, $3, $4, $5,",
  "  $6, $7, $8,",
  "  $9::timestamptz, $10::timestamptz, $11, $12,",
  "  $13, $14::timestamptz",
  ")",
].join("\n");

let database: MigratedDatabase | undefined;

function pool() {
  if (!database) {
    throw new Error("The isolated Phase 02 database is not initialized");
  }

  return database.pool;
}

function explicitUuid(sequence: number) {
  return (
    "00000000-0000-4000-8000-" +
    sequence.toString(16).padStart(12, "0")
  );
}

async function expectConstraintViolation(
  operation: Promise<unknown>,
  code: string,
  constraint: string,
) {
  let caught: unknown;

  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({ code, constraint });
}

function expectConstraintError(
  error: unknown,
  code: string,
  constraint: string,
) {
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ code, constraint });
}

async function insertUser(
  target: Pool,
  id: string,
  email: string,
  emailNormalized = email.toLowerCase(),
) {
  await target.query(
    [
      'INSERT INTO "User" (',
      '  "id", "email", "emailNormalized", "role", "updatedAt"',
      ") VALUES ($1, $2, $3, 'EMPLOYER', $4::timestamptz)",
    ].join("\n"),
    [id, email, emailNormalized, "2030-01-01T00:00:00.000Z"],
  );
}

async function insertCompany(target: Pool, id: string, suffix: string) {
  await target.query(
    [
      'INSERT INTO "Company" (',
      '  "id", "name", "slug", "values", "benefits", "updatedAt"',
      ") VALUES ($1, $2, $3, ARRAY[]::text[], ARRAY[]::text[], $4::timestamptz)",
    ].join("\n"),
    [
      id,
      "Schema Company " + suffix,
      "schema-company-" + suffix,
      "2030-01-01T00:00:00.000Z",
    ],
  );
}

async function insertPlan(target: Pool, id: string, suffix: string) {
  await target.query(
    [
      'INSERT INTO "Plan" ("id", "code", "name", "updatedAt")',
      "VALUES ($1, $2, $3, $4::timestamptz)",
    ].join("\n"),
    [
      id,
      "SCHEMA_PLAN_" + suffix.toUpperCase(),
      "Schema Plan " + suffix,
      "2030-01-01T00:00:00.000Z",
    ],
  );
}

async function insertPlanVersion(
  target: Pool,
  input: Readonly<{
    id: string;
    planId: string;
    status?: "ACTIVE" | "DRAFT";
    validFrom: string;
    validTo: string | null;
    version: number;
  }>,
) {
  await target.query(PLAN_VERSION_INSERT, [
    input.id,
    input.planId,
    input.version,
    input.status ?? "DRAFT",
    input.validFrom,
    input.validTo,
  ]);
}

async function insertProduct(
  target: Pool,
  input: Readonly<{
    id: string;
    suffix: string;
    type: "CONTACT_PACK" | "FEATURED_EMPLOYER" | "JOB_BOOST";
  }>,
) {
  await target.query(
    [
      'INSERT INTO "Product" ("id", "code", "name", "type", "updatedAt")',
      "VALUES ($1, $2, $3, $4, $5::timestamptz)",
    ].join("\n"),
    [
      input.id,
      "SCHEMA_PRODUCT_" + input.suffix.toUpperCase(),
      "Schema Product " + input.suffix,
      input.type,
      "2030-01-01T00:00:00.000Z",
    ],
  );
}

async function insertProductVersion(
  target: Pool,
  input: Readonly<{
    creditAmount?: number | null;
    creditType?: "TALENT_CONTACT" | null;
    durationDays?: number | null;
    id: string;
    netPriceRappen?: number;
    productId: string;
    status?: "ACTIVE" | "DRAFT";
    validFrom: string;
    validTo: string | null;
    version: number;
  }>,
) {
  await target.query(PRODUCT_VERSION_INSERT, [
    input.id,
    input.productId,
    input.version,
    input.status ?? "DRAFT",
    input.netPriceRappen ?? 1000,
    input.durationDays ?? null,
    input.creditType ?? null,
    input.creditAmount ?? null,
    input.validFrom,
    input.validTo,
  ]);
}

async function insertTaxRate(
  target: Pool,
  input: Readonly<{
    id: string;
    jurisdiction: string;
    reviewStatus?: "APPROVED" | "DRAFT";
    validFrom: string;
    validTo: string | null;
  }>,
) {
  await target.query(
    [
      'INSERT INTO "TaxRateVersion" (',
      '  "id", "jurisdiction", "taxType", "rateBasisPoints",',
      '  "validFrom", "validTo", "source", "reviewStatus",',
      '  "reviewedByUserId", "reviewedAt"',
      ") VALUES (",
      "  $1, $2, 'VAT', 810,",
      "  $3::timestamptz, $4::timestamptz, 'Schema contract', $5,",
      "  $6, $7::timestamptz",
      ")",
    ].join("\n"),
    [
      input.id,
      input.jurisdiction,
      input.validFrom,
      input.validTo,
      input.reviewStatus ?? "DRAFT",
      (input.reviewStatus ?? "DRAFT") === "APPROVED"
        ? explicitUuid(9_000)
        : null,
      (input.reviewStatus ?? "DRAFT") === "APPROVED"
        ? input.validFrom
        : null,
    ],
  );
}

async function insertOrder(
  target: Pool,
  input: Readonly<{
    companyId: string;
    id: string;
    suffix: string;
    userId: string;
  }>,
) {
  await target.query(
    [
      'INSERT INTO "Order" (',
      '  "id", "companyId", "createdByUserId", "clientIdempotencyKey",',
      '  "billingLegalNameSnapshot", "billingContactEmailSnapshot",',
      '  "billingStreetSnapshot", "billingPostalCodeSnapshot",',
      '  "billingCitySnapshot", "billingCountryCodeSnapshot",',
      '  "netTotalRappen", "vatTotalRappen", "totalRappen", "updatedAt"',
      ") VALUES (",
      "  $1, $2, $3, $4,",
      "  'Schema AG', 'billing@schema.test',",
      "  'Teststrasse 1', '8000',",
      "  'Zürich', 'CH',",
      "  0, 0, 0, $5::timestamptz",
      ")",
    ].join("\n"),
    [
      input.id,
      input.companyId,
      input.userId,
      "schema-order-" + input.suffix,
      "2030-01-01T00:00:00.000Z",
    ],
  );
}

async function waitUntilBlocked(
  target: Pool,
  backendPid: number,
  isSettled: () => boolean,
) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (isSettled()) {
      throw new Error(
        "The competing write settled before PostgreSQL observed a lock wait",
      );
    }

    const activity = await target.query<{
      state: string;
      wait_event_type: string | null;
    }>(
      [
        "SELECT state, wait_event_type",
        "FROM pg_stat_activity",
        "WHERE pid = $1",
      ].join("\n"),
      [backendPid],
    );
    const row = activity.rows[0];

    if (row?.state === "active" && row.wait_event_type === "Lock") {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error("Timed out while waiting for the competing PostgreSQL write");
}

async function expectConcurrentConstraintConflict(
  target: Pool,
  firstStatement: SqlStatement,
  secondStatement: SqlStatement,
  code: string,
  constraint: string,
) {
  const first = await target.connect();
  const second = await target.connect();
  let competingWrite: Promise<WriteOutcome> | undefined;
  let competingSettled = false;

  try {
    await first.query("BEGIN");
    await second.query("BEGIN");

    const backend = await second.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const backendPid = backend.rows[0]?.pid;

    if (backendPid === undefined) {
      throw new Error("Could not resolve the competing PostgreSQL backend");
    }

    await first.query(firstStatement.text, [...firstStatement.values]);
    competingWrite = second
      .query(secondStatement.text, [...secondStatement.values])
      .then(
        (): WriteOutcome => ({ ok: true }),
        (error: unknown): WriteOutcome => ({ error, ok: false }),
      );
    void competingWrite.then(() => {
      competingSettled = true;
    });

    await waitUntilBlocked(target, backendPid, () => competingSettled);
    await first.query("COMMIT");

    const outcome = await competingWrite;
    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expectConstraintError(outcome.error, code, constraint);
    }
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);

    if (competingWrite) {
      await competingWrite;
    }

    await second.query("ROLLBACK").catch(() => undefined);
    first.release();
    second.release();
  }
}

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase_02_schema_contract");
  await insertUser(
    database.pool,
    explicitUuid(9_000),
    "tax-reviewer@example.test",
  );
});

afterAll(async () => {
  await database?.dispose();
  database = undefined;
});

describe("Phase 02 PostgreSQL schema contract", () => {
  it("deploys the complete migration and exposes the named schema contracts", async () => {
    const target = pool();
    const migrations = await target.query<{
      finished_at: Date | null;
      migration_name: string;
      rolled_back_at: Date | null;
    }>(
      [
        "SELECT migration_name, finished_at, rolled_back_at",
        'FROM "_prisma_migrations"',
        "ORDER BY migration_name",
      ].join("\n"),
    );

    expect(migrations.rows.map((row) => row.migration_name)).toEqual([
      "20260719000000_foundation_baseline",
      "20260719181200_phase_02_domain_schema",
      "20260719223000_phase_03_contract_corrections",
      "20260719224500_phase_03_score_input_snapshot",
      "20260719230000_phase_03_privacy_atomicity",
      "20260719231500_phase_03_remote_job_projection",
      "20260720120000_phase_05_seed_manifest_contract",
    ]);
    expect(
      migrations.rows.every(
        (row) => row.finished_at !== null && row.rolled_back_at === null,
      ),
    ).toBe(true);

    const namedConstraints = [
      ...HALF_OPEN_EXCLUSION_CONSTRAINTS,
      ...Object.keys(CROSS_SCOPE_CONSTRAINTS),
      "credit_ledger_sign_check",
      "job_origin_import_source_check",
      "job_reporting_code_snapshot_check",
      "job_reporting_code_version_scope_fkey",
      "order_line_catalog_reference_xor_check",
      "plan_entitlement_value_check",
      "privacy_challenge_request_user_scope_fkey",
      "privacy_correction_text_length_check",
      "privacy_request_type_outcome_check",
      "user_email_normalized_check",
    ];
    const constraints = await target.query<{
      constraint_name: string;
      constraint_type: string;
      definition: string;
    }>(
      [
        "SELECT conname AS constraint_name, contype AS constraint_type,",
        "       pg_get_constraintdef(oid) AS definition",
        "FROM pg_constraint",
        "WHERE conname = ANY($1::text[])",
      ].join("\n"),
      [namedConstraints],
    );
    const byName = new Map(
      constraints.rows.map((row) => [row.constraint_name, row]),
    );

    for (const name of HALF_OPEN_EXCLUSION_CONSTRAINTS) {
      expect(byName.get(name)).toMatchObject({ constraint_type: "x" });
      expect(byName.get(name)?.definition).toContain("'[)'");
    }

    for (const [name, type] of Object.entries(CROSS_SCOPE_CONSTRAINTS)) {
      expect(
        byName.get(name),
        "Missing or mistyped PostgreSQL scope constraint " + name,
      ).toMatchObject({ constraint_type: type });
    }

    for (const name of namedConstraints) {
      expect(
        byName.has(name),
        "Missing PostgreSQL constraint " + name,
      ).toBe(true);
    }

    const indexes = await target.query<{
      index_definition: string;
      index_name: string;
    }>(
      [
        "SELECT indexname AS index_name, indexdef AS index_definition",
        "FROM pg_indexes",
        "WHERE schemaname = 'public'",
        "  AND indexname = ANY($1::text[])",
      ].join("\n"),
      [PARTIAL_UNIQUE_INDEXES],
    );
    const indexesByName = new Map(
      indexes.rows.map((row) => [row.index_name, row.index_definition]),
    );

    for (const name of PARTIAL_UNIQUE_INDEXES) {
      expect(
        indexesByName.has(name),
        "Missing PostgreSQL index " + name,
      ).toBe(true);
      expect(indexesByName.get(name)).toContain("CREATE UNIQUE INDEX");
      expect(indexesByName.get(name)).toContain(" WHERE ");
    }

    const addedIndexes = await target.query<{ index_name: string }>(
      [
        "SELECT indexname AS index_name FROM pg_indexes",
        "WHERE schemaname = 'public'",
        "  AND indexname = ANY($1::text[])",
      ].join("\n"),
      [["candidate_single_active_cv_unique", "credit_ledger_purchased_grant_source_unique"]],
    );
    expect(addedIndexes.rows.map((row) => row.index_name).sort()).toEqual([
      "candidate_single_active_cv_unique",
      "credit_ledger_purchased_grant_source_unique",
    ]);

    const requiredColumns = await target.query<{
      column_name: string;
      table_name: string;
    }>(
      [
        "SELECT table_name, column_name FROM information_schema.columns",
        "WHERE table_schema = 'public'",
        "  AND (table_name, column_name) IN (",
        "    ('Job', 'importSourceId'),",
        "    ('JobAssignment', 'membershipId'),",
        "    ('JobReportingCheck', 'occupationCodeId'),",
        "    ('JobReportingCheck', 'occupationCodeSnapshot'),",
        "    ('JobReportingCheck', 'occupationLabelSnapshot'),",
        "    ('ApplicationSubmissionSnapshot', 'coverLetterSnapshot')",
        "  )",
      ].join("\n"),
    );
    expect(
      requiredColumns.rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .sort(),
    ).toEqual([
      "ApplicationSubmissionSnapshot.coverLetterSnapshot",
      "Job.importSourceId",
      "JobAssignment.membershipId",
      "JobReportingCheck.occupationCodeId",
      "JobReportingCheck.occupationCodeSnapshot",
      "JobReportingCheck.occupationLabelSnapshot",
    ]);

    const requiredTriggers = [
      "application_submission_immutable_trigger",
      "application_submission_snapshot_match_trigger",
      "candidate_preference_onboarding_guard_trigger",
      "company_location_onboarding_guard_trigger",
      "employer_subscription_snapshot_immutable_trigger",
      "identity_reveal_confirmation_scope_trigger",
      "identity_reveal_field_confirmation_guard_trigger",
      "identity_reveal_field_open_trigger",
      "identity_reveal_grant_confirmation_guard_trigger",
      "identity_reveal_grant_immutable_trigger",
      "import_decision_commit_once_trigger",
      "import_job_decision_traceability_trigger",
      "job_identity_provenance_immutable_trigger",
      "subscription_change_boundary_trigger",
      "subscription_change_snapshot_immutable_trigger",
    ];
    const triggers = await target.query<{ trigger_name: string }>(
      [
        "SELECT tgname AS trigger_name FROM pg_trigger",
        "WHERE NOT tgisinternal AND tgname = ANY($1::text[])",
      ].join("\n"),
      [requiredTriggers],
    );
    expect(triggers.rows.map((row) => row.trigger_name).sort()).toEqual(
      [...requiredTriggers].sort(),
    );
  });

  it("enforces normalized User email uniqueness at the database boundary", async () => {
    const target = pool();

    await insertUser(
      target,
      explicitUuid(1),
      "First.User@Example.test",
      "first.user@example.test",
    );

    await expectConstraintViolation(
      insertUser(
        target,
        explicitUuid(2),
        "FIRST.USER@example.test",
        "first.user@example.test",
      ),
      SQLSTATE.uniqueViolation,
      "User_emailNormalized_key",
    );

    await expectConstraintViolation(
      insertUser(
        target,
        explicitUuid(3),
        "Other.User@Example.test",
        "Other.User@Example.test",
      ),
      SQLSTATE.checkViolation,
      "user_email_normalized_check",
    );
  });

  it("enforces the OrderLine catalog XOR and typed fulfillment context", async () => {
    const target = pool();
    const userId = explicitUuid(100);
    const companyId = explicitUuid(101);
    const planId = explicitUuid(102);
    const planVersionId = explicitUuid(103);
    const productId = explicitUuid(104);
    const productVersionId = explicitUuid(105);
    const taxRateId = explicitUuid(106);
    const orderId = explicitUuid(107);

    await insertUser(target, userId, "order-owner@example.test");
    await insertCompany(target, companyId, "order");
    await insertPlan(target, planId, "order");
    await insertPlanVersion(target, {
      id: planVersionId,
      planId,
      validFrom: "2031-01-01T00:00:00.000Z",
      validTo: "2032-01-01T00:00:00.000Z",
      version: 1,
    });
    await insertProduct(target, {
      id: productId,
      suffix: "contact",
      type: "CONTACT_PACK",
    });
    await insertProductVersion(target, {
      creditAmount: 25,
      creditType: "TALENT_CONTACT",
      id: productVersionId,
      productId,
      validFrom: "2031-01-01T00:00:00.000Z",
      validTo: "2032-01-01T00:00:00.000Z",
      version: 1,
    });
    await insertTaxRate(target, {
      id: taxRateId,
      jurisdiction: "CH-order",
      validFrom: "2031-01-01T00:00:00.000Z",
      validTo: "2032-01-01T00:00:00.000Z",
    });
    await insertOrder(target, {
      companyId,
      id: orderId,
      suffix: "typed-context",
      userId,
    });

    await target.query(ORDER_LINE_INSERT, [
      explicitUuid(108),
      orderId,
      planVersionId,
      null,
      taxRateId,
      "SUBSCRIPTION",
      null,
      null,
      null,
    ]);
    await target.query(ORDER_LINE_INSERT, [
      explicitUuid(109),
      orderId,
      null,
      productVersionId,
      taxRateId,
      "CONTACT_PACK",
      null,
      null,
      "TALENT_CONTACT",
    ]);

    await expectConstraintViolation(
      target.query(ORDER_LINE_INSERT, [
        explicitUuid(110),
        orderId,
        null,
        null,
        taxRateId,
        "NONE",
        null,
        null,
        null,
      ]),
      SQLSTATE.checkViolation,
      "order_line_catalog_reference_xor_check",
    );
    await expectConstraintViolation(
      target.query(ORDER_LINE_INSERT, [
        explicitUuid(111),
        orderId,
        planVersionId,
        productVersionId,
        taxRateId,
        "SUBSCRIPTION",
        null,
        null,
        null,
      ]),
      SQLSTATE.checkViolation,
      "order_line_catalog_reference_xor_check",
    );
    await expectConstraintViolation(
      target.query(ORDER_LINE_INSERT, [
        explicitUuid(112),
        orderId,
        planVersionId,
        null,
        taxRateId,
        "NONE",
        null,
        null,
        null,
      ]),
      SQLSTATE.checkViolation,
      "order_line_fulfillment_context_check",
    );
    await expectConstraintViolation(
      target.query(ORDER_LINE_INSERT, [
        explicitUuid(113),
        orderId,
        null,
        productVersionId,
        taxRateId,
        "CONTACT_PACK",
        null,
        null,
        "JOB_BOOST",
      ]),
      SQLSTATE.checkViolation,
      "order_line_fulfillment_context_check",
    );

    const stored = await target.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "OrderLine" WHERE "orderId" = $1',
      [orderId],
    );
    expect(stored.rows[0]?.count).toBe("2");
  });

  it("funds a purchased Job Boost only from a paid OrderLine", async () => {
    const target = pool();
    const userId = explicitUuid(120);
    const companyId = explicitUuid(121);
    const jobId = explicitUuid(122);
    const productId = explicitUuid(123);
    const productVersionId = explicitUuid(124);
    const taxRateId = explicitUuid(125);
    const orderId = explicitUuid(126);
    const orderLineId = explicitUuid(127);
    const jobBoostId = explicitUuid(128);

    await insertUser(target, userId, "boost-owner@example.test");
    await insertCompany(target, companyId, "boost-funding");
    await target.query(
      [
        'INSERT INTO "Job" ("id", "companyId", "slug", "createdByUserId", "updatedAt")',
        "VALUES ($1, $2, 'schema-boost-funding', $3, $4::timestamptz)",
      ].join("\n"),
      [jobId, companyId, userId, "2031-01-01T00:00:00.000Z"],
    );
    await insertProduct(target, {
      id: productId,
      suffix: "boost-funding",
      type: "JOB_BOOST",
    });
    await insertProductVersion(target, {
      durationDays: 7,
      id: productVersionId,
      productId,
      validFrom: "2031-01-01T00:00:00.000Z",
      validTo: "2032-01-01T00:00:00.000Z",
      version: 1,
    });
    await insertTaxRate(target, {
      id: taxRateId,
      jurisdiction: "CH-boost-funding",
      validFrom: "2031-01-01T00:00:00.000Z",
      validTo: "2032-01-01T00:00:00.000Z",
    });
    await insertOrder(target, {
      companyId,
      id: orderId,
      suffix: "boost-funding",
      userId,
    });
    await target.query(ORDER_LINE_INSERT, [
      orderLineId,
      orderId,
      null,
      productVersionId,
      taxRateId,
      "JOB_BOOST",
      jobId,
      null,
      null,
    ]);

    const boostInsert = [
      'INSERT INTO "JobBoost" (',
      '  "id", "jobId", "companyId", "orderLineId", "idempotencyKey",',
      '  "startsAt", "endsAt", "status"',
      ") VALUES ($1, $2, $3, $4, 'schema-paid-boost',",
      "  $5::timestamptz, $6::timestamptz, 'SCHEDULED')",
    ].join("\n");
    const boostValues = [
      jobBoostId,
      jobId,
      companyId,
      orderLineId,
      "2031-02-01T00:00:00.000Z",
      "2031-02-08T00:00:00.000Z",
    ];

    await expectConstraintViolation(
      target.query(boostInsert, boostValues),
      SQLSTATE.checkViolation,
      "job_boost_order_funding_scope_check",
    );
    await target.query(
      'UPDATE "Order" SET "status" = \'PENDING\', "updatedAt" = $2 WHERE "id" = $1',
      [orderId, "2031-01-02T00:00:00.000Z"],
    );
    await target.query(
      'UPDATE "Order" SET "status" = \'PAID\', "paidAt" = $2, "updatedAt" = $2 WHERE "id" = $1',
      [orderId, "2031-01-03T00:00:00.000Z"],
    );
    await target.query(boostInsert, boostValues);

    const funded = await target.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "JobBoost" WHERE "id" = $1',
      [jobBoostId],
    );
    expect(funded.rows[0]?.count).toBe("1");
  });

  it("enforces the complete PlanEntitlement key-to-value-type matrix", async () => {
    const target = pool();
    const planId = explicitUuid(200);
    const planVersionId = explicitUuid(201);

    await insertPlan(target, planId, "entitlements");
    await insertPlanVersion(target, {
      id: planVersionId,
      planId,
      validFrom: "2032-01-01T00:00:00.000Z",
      validTo: "2033-01-01T00:00:00.000Z",
      version: 1,
    });

    const validMatrix = [
      ["ACTIVE_JOB_LIMIT", "INTEGER", null, 5, null],
      ["SEAT_LIMIT", "INTEGER", null, 3, null],
      ["TALENT_CONTACT_ALLOWANCE", "INTEGER", null, 10, null],
      ["JOB_BOOST_ALLOWANCE", "INTEGER", null, 2, null],
      ["TALENT_RADAR_ACCESS", "BOOLEAN", true, null, null],
      ["ENHANCED_COMPANY_PROFILE", "BOOLEAN", false, null, null],
      ["EMPLOYER_IMPORT_ACCESS", "BOOLEAN", false, null, null],
      ["ANALYTICS_LEVEL", "ANALYTICS_LEVEL", null, null, "ADVANCED"],
    ] as const;

    for (const [index, entitlement] of validMatrix.entries()) {
      await target.query(
        [
          'INSERT INTO "PlanEntitlement" (',
          '  "id", "planVersionId", "key", "valueType",',
          '  "booleanValue", "integerValue", "analyticsLevelValue"',
          ") VALUES ($1, $2, $3, $4, $5, $6, $7)",
        ].join("\n"),
        [explicitUuid(210 + index), planVersionId, ...entitlement],
      );
    }

    const count = await target.query<{ count: string }>(
      [
        'SELECT count(*)::text AS count FROM "PlanEntitlement"',
        'WHERE "planVersionId" = $1',
      ].join("\n"),
      [planVersionId],
    );
    expect(count.rows[0]?.count).toBe(String(validMatrix.length));

    const invalidPlanId = explicitUuid(220);
    const invalidPlanVersionId = explicitUuid(221);
    await insertPlan(target, invalidPlanId, "invalid-entitlements");
    await insertPlanVersion(target, {
      id: invalidPlanVersionId,
      planId: invalidPlanId,
      validFrom: "2032-01-01T00:00:00.000Z",
      validTo: "2033-01-01T00:00:00.000Z",
      version: 1,
    });

    await expectConstraintViolation(
      target.query(
        [
          'INSERT INTO "PlanEntitlement" (',
          '  "id", "planVersionId", "key", "valueType", "booleanValue"',
          ") VALUES ($1, $2, 'ACTIVE_JOB_LIMIT', 'BOOLEAN', true)",
        ].join("\n"),
        [explicitUuid(222), invalidPlanVersionId],
      ),
      SQLSTATE.checkViolation,
      "plan_entitlement_value_check",
    );
    await expectConstraintViolation(
      target.query(
        [
          'INSERT INTO "PlanEntitlement" (',
          '  "id", "planVersionId", "key", "valueType",',
          '  "booleanValue", "integerValue"',
          ") VALUES ($1, $2, 'TALENT_RADAR_ACCESS', 'BOOLEAN', true, 1)",
        ].join("\n"),
        [explicitUuid(223), invalidPlanVersionId],
      ),
      SQLSTATE.checkViolation,
      "plan_entitlement_value_check",
    );
    await expectConstraintViolation(
      target.query(
        [
          'INSERT INTO "PlanEntitlement" (',
          '  "id", "planVersionId", "key", "valueType", "integerValue"',
          ") VALUES ($1, $2, 'SEAT_LIMIT', 'INTEGER', -1)",
        ].join("\n"),
        [explicitUuid(224), invalidPlanVersionId],
      ),
      SQLSTATE.checkViolation,
      "plan_entitlement_value_check",
    );
  });

  it("enforces CreditLedger signs, nonnegative balances and exact reversals", async () => {
    const target = pool();
    const companyId = explicitUuid(300);
    const accountId = explicitUuid(301);
    const periodStart = "2035-01-01T00:00:00.000Z";
    const periodEnd = "2036-01-01T00:00:00.000Z";

    await insertCompany(target, companyId, "ledger");
    await target.query(
      [
        'INSERT INTO "CreditAccount" (',
        '  "id", "companyId", "creditType", "fundingSource",',
        '  "periodStart", "periodEnd"',
        ") VALUES (",
        "  $1, $2, 'TALENT_CONTACT', 'ADMIN_GRANT',",
        "  $3::timestamptz, $4::timestamptz",
        ")",
      ].join("\n"),
      [accountId, companyId, periodStart, periodEnd],
    );

    const ledgerValues = (
      id: string,
      kind: "CONSUME" | "GRANT" | "REVERSAL",
      amount: number,
      idempotencyKey: string,
      createdAt: string,
      reversalOfEntryId: string | null = null,
    ) => [
      id,
      accountId,
      "ADMIN_GRANT",
      kind,
      amount,
      null,
      null,
      reversalOfEntryId,
      periodStart,
      periodEnd,
      idempotencyKey,
      "SCHEMA_CONTRACT",
      null,
      createdAt,
    ];

    await target.query(
      CREDIT_LEDGER_INSERT,
      ledgerValues(
        explicitUuid(302),
        "GRANT",
        10,
        "ledger-grant-10",
        "2035-01-02T00:00:00.000Z",
      ),
    );

    await expectConstraintViolation(
      target.query(
        CREDIT_LEDGER_INSERT,
        ledgerValues(
          explicitUuid(303),
          "GRANT",
          -1,
          "ledger-invalid-sign",
          "2035-01-03T00:00:00.000Z",
        ),
      ),
      SQLSTATE.checkViolation,
      "credit_ledger_sign_check",
    );
    await expectConstraintViolation(
      target.query(
        CREDIT_LEDGER_INSERT,
        ledgerValues(
          explicitUuid(304),
          "CONSUME",
          -11,
          "ledger-overdraw",
          "2035-01-04T00:00:00.000Z",
        ),
      ),
      SQLSTATE.checkViolation,
      "credit_ledger_nonnegative_balance_check",
    );

    const consumeId = explicitUuid(305);
    await target.query(
      CREDIT_LEDGER_INSERT,
      ledgerValues(
        consumeId,
        "CONSUME",
        -4,
        "ledger-consume-4",
        "2035-01-05T00:00:00.000Z",
      ),
    );

    await expectConstraintViolation(
      target.query(
        CREDIT_LEDGER_INSERT,
        ledgerValues(
          explicitUuid(306),
          "REVERSAL",
          3,
          "ledger-wrong-reversal",
          "2035-01-06T00:00:00.000Z",
          consumeId,
        ),
      ),
      SQLSTATE.checkViolation,
      "credit_ledger_reversal_exact_check",
    );
    await target.query(
      CREDIT_LEDGER_INSERT,
      ledgerValues(
        explicitUuid(307),
        "REVERSAL",
        4,
        "ledger-exact-reversal",
        "2035-01-07T00:00:00.000Z",
        consumeId,
      ),
    );

    const balance = await target.query<{ balance: string }>(
      [
        'SELECT sum("amount")::text AS balance',
        'FROM "CreditLedgerEntry"',
        'WHERE "accountId" = $1',
      ].join("\n"),
      [accountId],
    );
    expect(balance.rows[0]?.balance).toBe("10");
  });

  it("permits adjacent half-open Plan, Product and approved Tax ranges but rejects overlap", async () => {
    const target = pool();
    const firstStart = "2037-01-01T00:00:00.000Z";
    const boundary = "2037-02-01T00:00:00.000Z";
    const secondEnd = "2037-03-01T00:00:00.000Z";
    const overlapStart = "2037-01-15T00:00:00.000Z";
    const overlapEnd = "2037-02-15T00:00:00.000Z";

    const planId = explicitUuid(400);
    const firstPlanVersionId = explicitUuid(401);
    const secondPlanVersionId = explicitUuid(402);
    await insertPlan(target, planId, "temporal");
    await insertPlanVersion(target, {
      id: firstPlanVersionId,
      planId,
      status: "ACTIVE",
      validFrom: firstStart,
      validTo: boundary,
      version: 1,
    });
    await insertPlanVersion(target, {
      id: secondPlanVersionId,
      planId,
      status: "ACTIVE",
      validFrom: boundary,
      validTo: secondEnd,
      version: 2,
    });
    await expectConstraintViolation(
      insertPlanVersion(target, {
        id: explicitUuid(403),
        planId,
        status: "ACTIVE",
        validFrom: overlapStart,
        validTo: overlapEnd,
        version: 3,
      }),
      SQLSTATE.exclusionViolation,
      "plan_version_active_range_excl",
    );

    const productId = explicitUuid(410);
    const firstProductVersionId = explicitUuid(411);
    const secondProductVersionId = explicitUuid(412);
    await insertProduct(target, {
      id: productId,
      suffix: "temporal",
      type: "FEATURED_EMPLOYER",
    });
    await insertProductVersion(target, {
      id: firstProductVersionId,
      productId,
      status: "ACTIVE",
      validFrom: firstStart,
      validTo: boundary,
      version: 1,
    });
    await insertProductVersion(target, {
      id: secondProductVersionId,
      productId,
      status: "ACTIVE",
      validFrom: boundary,
      validTo: secondEnd,
      version: 2,
    });
    await expectConstraintViolation(
      insertProductVersion(target, {
        id: explicitUuid(413),
        productId,
        status: "ACTIVE",
        validFrom: overlapStart,
        validTo: overlapEnd,
        version: 3,
      }),
      SQLSTATE.exclusionViolation,
      "product_version_active_range_excl",
    );

    const firstTaxRateId = explicitUuid(420);
    const secondTaxRateId = explicitUuid(421);
    await insertTaxRate(target, {
      id: firstTaxRateId,
      jurisdiction: "CH-temporal",
      reviewStatus: "APPROVED",
      validFrom: firstStart,
      validTo: boundary,
    });
    await insertTaxRate(target, {
      id: secondTaxRateId,
      jurisdiction: "CH-temporal",
      reviewStatus: "APPROVED",
      validFrom: boundary,
      validTo: secondEnd,
    });
    await expectConstraintViolation(
      insertTaxRate(target, {
        id: explicitUuid(422),
        jurisdiction: "CH-temporal",
        reviewStatus: "APPROVED",
        validFrom: overlapStart,
        validTo: overlapEnd,
      }),
      SQLSTATE.exclusionViolation,
      "tax_rate_approved_range_excl",
    );

    const selectedAtBoundary = await target.query<{
      plan_version_id: string;
      product_version_id: string;
      tax_rate_id: string;
    }>(
      [
        "SELECT",
        "  (SELECT id::text FROM \"PlanVersion\"",
        "   WHERE \"planId\" = $1 AND status = 'ACTIVE'",
        "     AND \"validFrom\" <= $4::timestamptz",
        "     AND (\"validTo\" IS NULL OR $4::timestamptz < \"validTo\"))",
        "    AS plan_version_id,",
        "  (SELECT id::text FROM \"ProductVersion\"",
        "   WHERE \"productId\" = $2 AND status = 'ACTIVE'",
        "     AND \"validFrom\" <= $4::timestamptz",
        "     AND (\"validTo\" IS NULL OR $4::timestamptz < \"validTo\"))",
        "    AS product_version_id,",
        "  (SELECT id::text FROM \"TaxRateVersion\"",
        "   WHERE jurisdiction = $3 AND \"taxType\" = 'VAT'",
        "     AND \"reviewStatus\" = 'APPROVED'",
        "     AND \"validFrom\" <= $4::timestamptz",
        "     AND (\"validTo\" IS NULL OR $4::timestamptz < \"validTo\"))",
        "    AS tax_rate_id",
      ].join("\n"),
      [planId, productId, "CH-temporal", boundary],
    );
    expect(selectedAtBoundary.rows[0]).toEqual({
      plan_version_id: secondPlanVersionId,
      product_version_id: secondProductVersionId,
      tax_rate_id: secondTaxRateId,
    });
  });

  it("resolves a real concurrent overlapping PlanVersion write through the exclusion constraint", async () => {
    const target = pool();
    const planId = explicitUuid(500);

    await insertPlan(target, planId, "race");

    await expectConcurrentConstraintConflict(
      target,
      {
        text: PLAN_VERSION_INSERT,
        values: [
          explicitUuid(501),
          planId,
          1,
          "ACTIVE",
          "2038-01-01T00:00:00.000Z",
          "2038-03-01T00:00:00.000Z",
        ],
      },
      {
        text: PLAN_VERSION_INSERT,
        values: [
          explicitUuid(502),
          planId,
          2,
          "ACTIVE",
          "2038-02-01T00:00:00.000Z",
          "2038-04-01T00:00:00.000Z",
        ],
      },
      SQLSTATE.exclusionViolation,
      "plan_version_active_range_excl",
    );

    const accepted = await target.query<{ count: string }>(
      [
        'SELECT count(*)::text AS count FROM "PlanVersion"',
        "WHERE \"planId\" = $1 AND status = 'ACTIVE'",
      ].join("\n"),
      [planId],
    );
    expect(accepted.rows[0]?.count).toBe("1");

  });

  it("resolves concurrent pending SubscriptionChangeSchedule writes through partial uniqueness", async () => {
    const target = pool();
    const userId = explicitUuid(600);
    const companyId = explicitUuid(601);
    const planId = explicitUuid(602);
    const planVersionId = explicitUuid(603);
    const subscriptionId = explicitUuid(604);
    const membershipId = explicitUuid(607);

    await insertUser(target, userId, "schedule-owner@example.test");
    await insertCompany(target, companyId, "schedule-race");
    await target.query(
      [
        'INSERT INTO "CompanyMembership" (',
        '  "id", "companyId", "userId", "role", "status", "updatedAt"',
        ") VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4::timestamptz)",
      ].join("\n"),
      [membershipId, companyId, userId, "2039-12-31T00:00:00.000Z"],
    );
    await insertPlan(target, planId, "schedule-race");
    await insertPlanVersion(target, {
      id: planVersionId,
      planId,
      validFrom: "2039-01-01T00:00:00.000Z",
      validTo: "2041-01-01T00:00:00.000Z",
      version: 1,
    });
    await target.query(
      [
        'INSERT INTO "EmployerSubscription" (',
        '  "id", "companyId", "planVersionId", "status",',
        '  "currentPeriodStart", "currentPeriodEnd",',
        '  "billingIntervalSnapshot", "termMonthsSnapshot",',
        '  "recurringNetRappenSnapshot", "monthlyEquivalentRappenSnapshot",',
        '  "currencySnapshot", "activatedAt", "updatedAt"',
        ") VALUES (",
        "  $1, $2, $3, 'ACTIVE',",
        "  $4::timestamptz, $5::timestamptz,",
        "  'MONTHLY', 1,",
        "  1000, 1000,",
        "  'CHF', $4::timestamptz, $6::timestamptz",
        ")",
      ].join("\n"),
      [
        subscriptionId,
        companyId,
        planVersionId,
        "2040-01-01T00:00:00.000Z",
        "2040-02-01T00:00:00.000Z",
        "2039-12-31T00:00:00.000Z",
      ],
    );

    const scheduleInsert = [
      'INSERT INTO "SubscriptionChangeSchedule" (',
      '  "id", "companyId", "currentSubscriptionId", "kind", "status",',
      '  "effectiveAt", "retainedMembershipIds", "retainedDefaultOwnerId",',
      '  "invitationRevocationScope", "actorUserId", "idempotencyKey",',
      '  "updatedAt"',
      ") VALUES (",
      "  $1, $2, $3, 'CANCEL', 'PENDING',",
        "  $4::timestamptz, ARRAY[$6]::text[], $5,",
        "  '{}'::jsonb, $5, $7,",
        "  $8::timestamptz",
      ")",
    ].join("\n");
    const commonScheduleValues = [
      companyId,
      subscriptionId,
      "2040-02-01T00:00:00.000Z",
      userId,
      membershipId,
    ] as const;

    await expectConcurrentConstraintConflict(
      target,
      {
        text: scheduleInsert,
        values: [
          explicitUuid(605),
          ...commonScheduleValues,
          "schedule-race-first",
          "2040-01-02T00:00:00.000Z",
        ],
      },
      {
        text: scheduleInsert,
        values: [
          explicitUuid(606),
          ...commonScheduleValues,
          "schedule-race-second",
          "2040-01-02T00:00:00.000Z",
        ],
      },
      SQLSTATE.uniqueViolation,
      "subscription_pending_change_unique",
    );

    const accepted = await target.query<{ count: string }>(
      [
        'SELECT count(*)::text AS count FROM "SubscriptionChangeSchedule"',
        "WHERE \"companyId\" = $1 AND status = 'PENDING'",
      ].join("\n"),
      [companyId],
    );
    expect(accepted.rows[0]?.count).toBe("1");

    await expectConstraintViolation(
      target.query(
        [
          'UPDATE "SubscriptionChangeSchedule"',
          'SET "retainedMembershipIds" = ARRAY[$2]::text[]',
          'WHERE "id" = $1',
        ].join("\n"),
        [explicitUuid(605), explicitUuid(6_099)],
      ),
      SQLSTATE.checkViolation,
      "subscription_change_retained_membership_check",
    );
    await expectConstraintViolation(
      target.query(
        [
          'UPDATE "SubscriptionChangeSchedule"',
          'SET "invitationRevocationScope" = \'{"changed":true}\'::jsonb',
          'WHERE "id" = $1',
        ].join("\n"),
        [explicitUuid(605)],
      ),
      SQLSTATE.checkViolation,
      "subscription_change_snapshot_immutable",
    );
    await expectConstraintViolation(
      target.query(
        'UPDATE "SubscriptionChangeSchedule" SET "status" = \'APPLIED\' WHERE "id" = $1',
        [explicitUuid(605)],
      ),
      SQLSTATE.checkViolation,
      "subscription_change_lifecycle_projection_check",
    );
    await target.query(
      [
        'UPDATE "SubscriptionChangeSchedule"',
        'SET "status" = \'APPLIED\', "appliedAt" = $2::timestamptz, "updatedAt" = $2::timestamptz',
        'WHERE "id" = $1',
      ].join("\n"),
      [explicitUuid(605), "2040-02-01T00:00:00.000Z"],
    );
    await expectConstraintViolation(
      target.query(
        [
          'UPDATE "SubscriptionChangeSchedule"',
          'SET "status" = \'PENDING\', "appliedAt" = NULL',
          'WHERE "id" = $1',
        ].join("\n"),
        [explicitUuid(605)],
      ),
      SQLSTATE.checkViolation,
      "subscription_change_snapshot_immutable",
    );
  });

  it("retains the last active Company Owner", async () => {
    const target = pool();
    const userId = explicitUuid(800);
    const companyId = explicitUuid(801);
    const membershipId = explicitUuid(802);

    await insertUser(target, userId, "last-owner@example.test");
    await insertCompany(target, companyId, "last-owner");
    await target.query(
      [
        'INSERT INTO "CompanyMembership" (',
        '  "id", "companyId", "userId", "role", "status", "updatedAt"',
        ") VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4::timestamptz)",
      ].join("\n"),
      [membershipId, companyId, userId, "2042-01-01T00:00:00.000Z"],
    );

    await expectConstraintViolation(
      target.query(
        'UPDATE "CompanyMembership" SET "role" = \'ADMIN\', "updatedAt" = $2 WHERE "id" = $1',
        [membershipId, "2042-01-02T00:00:00.000Z"],
      ),
      SQLSTATE.checkViolation,
      "company_last_owner_check",
    );
  });

  it("commits only exact additive Reveal field sets on an unrevoked Grant", async () => {
    const target = pool();
    const candidateUserId = explicitUuid(1_100);
    const candidateProfileId = explicitUuid(1_101);
    const employerUserId = explicitUuid(1_102);
    const companyId = explicitUuid(1_103);
    const creditAccountId = explicitUuid(1_104);
    const creditGrantId = explicitUuid(1_105);
    const creditConsumeId = explicitUuid(1_106);
    const contactRequestId = explicitUuid(1_107);
    const revealGrantId = explicitUuid(1_108);
    const firstFieldId = explicitUuid(1_109);
    const firstConfirmationId = explicitUuid(1_110);
    const secondFieldId = explicitUuid(1_111);
    const secondConfirmationId = explicitUuid(1_112);

    await target.query(
      [
        'INSERT INTO "User" (',
        '  "id", "email", "emailNormalized", "role", "updatedAt"',
        ") VALUES ($1, 'reveal-candidate@example.test',",
        "  'reveal-candidate@example.test', 'CANDIDATE', $2::timestamptz)",
      ].join("\n"),
      [candidateUserId, "2043-01-01T00:00:00.000Z"],
    );
    await target.query(
      [
        'INSERT INTO "CandidateProfile" ("id", "userId", "updatedAt")',
        "VALUES ($1, $2, $3::timestamptz)",
      ].join("\n"),
      [
        candidateProfileId,
        candidateUserId,
        "2043-01-01T00:00:00.000Z",
      ],
    );
    await insertUser(target, employerUserId, "reveal-employer@example.test");
    await insertCompany(target, companyId, "reveal-contract");
    await target.query(
      [
        'INSERT INTO "CreditAccount" (',
        '  "id", "companyId", "creditType", "fundingSource",',
        '  "periodStart", "periodEnd"',
        ") VALUES ($1, $2, 'TALENT_CONTACT', 'ADMIN_GRANT',",
        "  $3::timestamptz, $4::timestamptz)",
      ].join("\n"),
      [
        creditAccountId,
        companyId,
        "2043-01-01T00:00:00.000Z",
        "2044-01-01T00:00:00.000Z",
      ],
    );
    await target.query(CREDIT_LEDGER_INSERT, [
      creditGrantId,
      creditAccountId,
      "ADMIN_GRANT",
      "GRANT",
      1,
      null,
      null,
      null,
      "2043-01-01T00:00:00.000Z",
      "2044-01-01T00:00:00.000Z",
      "reveal-credit-grant",
      "SCHEMA_FIXTURE",
      employerUserId,
      "2043-01-02T00:00:00.000Z",
    ]);
    await target.query(CREDIT_LEDGER_INSERT, [
      creditConsumeId,
      creditAccountId,
      "ADMIN_GRANT",
      "CONSUME",
      -1,
      null,
      null,
      null,
      "2043-01-01T00:00:00.000Z",
      "2044-01-01T00:00:00.000Z",
      "reveal-credit-consume",
      "CONTACT_REQUEST",
      employerUserId,
      "2043-01-03T00:00:00.000Z",
    ]);
    await target.query(
      [
        'INSERT INTO "EmployerContactRequest" (',
        '  "id", "companyId", "candidateProfileId", "requestingUserId",',
        '  "creditLedgerEntryId", "messagePreview", "idempotencyKey",',
        '  "status", "fundingSource", "clusterPolicyVersion",',
        '  "cantonBucketSnapshot", "categoryBucketSnapshot",',
        '  "expiresAt", "createdAt", "updatedAt"',
        ") VALUES (",
        "  $1, $2, $3, $4,",
        "  $5, 'Schema contact preview', 'reveal-contact-request',",
        "  'ACCEPTED', 'ADMIN_GRANT', 'cluster-v1',",
        "  'ZH', 'technology',",
        "  $6::timestamptz, $7::timestamptz, $7::timestamptz",
        ")",
      ].join("\n"),
      [
        contactRequestId,
        companyId,
        candidateProfileId,
        employerUserId,
        creditConsumeId,
        "2043-01-17T00:00:00.000Z",
        "2043-01-03T00:00:00.000Z",
      ],
    );

    const first = await target.connect();
    try {
      await first.query("BEGIN");
      await first.query(
        [
          'INSERT INTO "IdentityRevealGrant" (',
          '  "id", "candidateProfileId", "companyId", "contactRequestId",',
          '  "noticeVersion", "confirmationSnapshotHash", "revealedAt"',
          ") VALUES ($1, $2, $3, $4, 'notice-v1', $5, $6::timestamptz)",
        ].join("\n"),
        [
          revealGrantId,
          candidateProfileId,
          companyId,
          contactRequestId,
          "a".repeat(64),
          "2043-01-04T00:00:00.000Z",
        ],
      );
      await first.query(
        [
          'INSERT INTO "IdentityRevealGrantField" (',
          '  "id", "grantId", "field", "ciphertext", "nonce", "authTag",',
          '  "encryptionKeyVersion", "schemaVersion", "integrityHmac"',
          ") VALUES (",
          "  $1, $2, 'DISPLAY_NAME', decode('01', 'hex'),",
          "  decode(repeat('02', 12), 'hex'), decode(repeat('03', 16), 'hex'),",
          "  'pii-v1', 'display-name-v1', $3",
          ")",
        ].join("\n"),
        [firstFieldId, revealGrantId, "b".repeat(64)],
      );
      await first.query(
        [
          'INSERT INTO "IdentityRevealConfirmation" (',
          '  "id", "grantId", "actorUserId", "contactRequestId",',
          '  "completeFieldSet", "newlyAddedFields", "noticeVersion",',
          '  "previewHmac", "idempotencyKey", "createdAt"',
          ") VALUES (",
          "  $1, $2, $3, $4,",
          "  ARRAY['DISPLAY_NAME']::\"RevealField\"[],",
          "  ARRAY['DISPLAY_NAME']::\"RevealField\"[],",
          "  'notice-v1', $5, 'reveal-confirm-first', $6::timestamptz",
          ")",
        ].join("\n"),
        [
          firstConfirmationId,
          revealGrantId,
          candidateUserId,
          contactRequestId,
          "c".repeat(64),
          "2043-01-04T00:00:00.000Z",
        ],
      );
      await first.query("COMMIT");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      first.release();
    }

    const unconfirmed = await target.connect();
    try {
      await unconfirmed.query("BEGIN");
      await unconfirmed.query(
        [
          'INSERT INTO "IdentityRevealGrantField" (',
          '  "id", "grantId", "field", "ciphertext", "nonce", "authTag",',
          '  "encryptionKeyVersion", "schemaVersion", "integrityHmac"',
          ") VALUES (",
          "  $1, $2, 'EMAIL', decode('04', 'hex'),",
          "  decode(repeat('05', 12), 'hex'), decode(repeat('06', 16), 'hex'),",
          "  'pii-v1', 'email-v1', $3",
          ")",
        ].join("\n"),
        [secondFieldId, revealGrantId, "d".repeat(64)],
      );
      await expectConstraintViolation(
        unconfirmed.query("COMMIT"),
        SQLSTATE.checkViolation,
        "identity_reveal_confirmed_field_set_check",
      );
    } finally {
      await unconfirmed.query("ROLLBACK").catch(() => undefined);
      unconfirmed.release();
    }

    const additive = await target.connect();
    try {
      await additive.query("BEGIN");
      await additive.query(
        [
          'INSERT INTO "IdentityRevealGrantField" (',
          '  "id", "grantId", "field", "ciphertext", "nonce", "authTag",',
          '  "encryptionKeyVersion", "schemaVersion", "integrityHmac"',
          ") VALUES (",
          "  $1, $2, 'EMAIL', decode('04', 'hex'),",
          "  decode(repeat('05', 12), 'hex'), decode(repeat('06', 16), 'hex'),",
          "  'pii-v1', 'email-v1', $3",
          ")",
        ].join("\n"),
        [secondFieldId, revealGrantId, "d".repeat(64)],
      );
      await additive.query(
        [
          'INSERT INTO "IdentityRevealConfirmation" (',
          '  "id", "grantId", "actorUserId", "contactRequestId",',
          '  "completeFieldSet", "newlyAddedFields", "noticeVersion",',
          '  "previewHmac", "idempotencyKey", "createdAt"',
          ") VALUES (",
          "  $1, $2, $3, $4,",
          "  ARRAY['DISPLAY_NAME', 'EMAIL']::\"RevealField\"[],",
          "  ARRAY['EMAIL']::\"RevealField\"[],",
          "  'notice-v1', $5, 'reveal-confirm-second', $6::timestamptz",
          ")",
        ].join("\n"),
        [
          secondConfirmationId,
          revealGrantId,
          candidateUserId,
          contactRequestId,
          "e".repeat(64),
          "2043-01-05T00:00:00.000Z",
        ],
      );
      await additive.query("COMMIT");
    } finally {
      await additive.query("ROLLBACK").catch(() => undefined);
      additive.release();
    }

    await target.query(
      [
        'UPDATE "IdentityRevealGrant"',
        'SET "revokedAt" = $2::timestamptz, "revokedByUserId" = $3,',
        '  "revokeReason" = \'PRIVACY_CHOICE\'',
        'WHERE "id" = $1',
      ].join("\n"),
      [
        revealGrantId,
        "2043-01-06T00:00:00.000Z",
        candidateUserId,
      ],
    );
    await expectConstraintViolation(
      target.query(
        [
          'INSERT INTO "IdentityRevealGrantField" (',
          '  "id", "grantId", "field", "ciphertext", "nonce", "authTag",',
          '  "encryptionKeyVersion", "schemaVersion", "integrityHmac"',
          ") VALUES (",
          "  $1, $2, 'PHONE', decode('07', 'hex'),",
          "  decode(repeat('08', 12), 'hex'), decode(repeat('09', 16), 'hex'),",
          "  'pii-v1', 'phone-v1', $3",
          ")",
        ].join("\n"),
        [explicitUuid(1_113), revealGrantId, "f".repeat(64)],
      ),
      SQLSTATE.checkViolation,
      "identity_reveal_field_unrevoked_grant_check",
    );
  });

  it("allows canonical release transitions while freezing commercial snapshots", async () => {
    const target = pool();
    const planId = explicitUuid(810);
    const planVersionId = explicitUuid(811);
    const userId = explicitUuid(812);
    const companyId = explicitUuid(813);
    const orderId = explicitUuid(814);
    const invoiceId = explicitUuid(815);

    await insertPlan(target, planId, "immutable-lifecycle");
    await insertPlanVersion(target, {
      id: planVersionId,
      planId,
      status: "ACTIVE",
      validFrom: "2042-01-01T00:00:00.000Z",
      validTo: "2043-01-01T00:00:00.000Z",
      version: 1,
    });
    await expectConstraintViolation(
      target.query(
        'UPDATE "PlanVersion" SET "netPriceRappen" = 2000 WHERE "id" = $1',
        [planVersionId],
      ),
      SQLSTATE.checkViolation,
      "plan_version_released_immutable",
    );
    await target.query(
      'UPDATE "PlanVersion" SET "status" = \'INACTIVE\' WHERE "id" = $1',
      [planVersionId],
    );

    await insertUser(target, userId, "billing-lifecycle@example.test");
    await insertCompany(target, companyId, "billing-lifecycle");
    await insertOrder(target, {
      companyId,
      id: orderId,
      suffix: "billing-lifecycle",
      userId,
    });
    await target.query(
      'UPDATE "Order" SET "status" = \'PENDING\', "updatedAt" = $2 WHERE "id" = $1',
      [orderId, "2042-02-01T00:00:00.000Z"],
    );
    await expectConstraintViolation(
      target.query(
        'UPDATE "Order" SET "billingLegalNameSnapshot" = \'Changed AG\', "updatedAt" = $2 WHERE "id" = $1',
        [orderId, "2042-02-02T00:00:00.000Z"],
      ),
      SQLSTATE.checkViolation,
      "order_released_immutable",
    );
    await target.query(
      'UPDATE "Order" SET "status" = \'PAID\', "paidAt" = $2, "updatedAt" = $2 WHERE "id" = $1',
      [orderId, "2042-02-03T00:00:00.000Z"],
    );

    await target.query(
      [
        'INSERT INTO "Invoice" (',
        '  "id", "orderId", "companyId", "number",',
        '  "billingLegalNameSnapshot", "billingContactEmailSnapshot",',
        '  "billingStreetSnapshot", "billingPostalCodeSnapshot",',
        '  "billingCitySnapshot", "billingCountryCodeSnapshot",',
        '  "currency", "netTotalRappen", "vatTotalRappen", "totalRappen", "dueAt"',
        ") VALUES (",
        "  $1, $2, $3, 'SCHEMA-LIFECYCLE-1',",
        "  'Schema AG', 'billing@schema.test', 'Teststrasse 1', '8000',",
        "  'Zürich', 'CH', 'CHF', 0, 0, 0, $4::timestamptz",
        ")",
      ].join("\n"),
      [invoiceId, orderId, companyId, "2042-03-01T00:00:00.000Z"],
    );
    await target.query(
      'UPDATE "Invoice" SET "status" = \'ISSUED\', "issuedAt" = $2 WHERE "id" = $1',
      [invoiceId, "2042-02-04T00:00:00.000Z"],
    );
    await expectConstraintViolation(
      target.query(
        'UPDATE "Invoice" SET "billingLegalNameSnapshot" = \'Changed AG\' WHERE "id" = $1',
        [invoiceId],
      ),
      SQLSTATE.checkViolation,
      "invoice_released_immutable",
    );
    await target.query(
      'UPDATE "Invoice" SET "status" = \'PAID\', "paidAt" = $2 WHERE "id" = $1',
      [invoiceId, "2042-02-05T00:00:00.000Z"],
    );
  });

  it("serializes the bounded typed Privacy correction set", async () => {
    const target = pool();
    const userId = explicitUuid(820);
    const requestId = explicitUuid(821);

    await insertUser(target, userId, "privacy-correction@example.test");
    await target.query(
      [
        'INSERT INTO "PrivacyRequest" (',
        '  "id", "requesterUserId", "type", "status", "dueAt",',
        '  "idempotencyKey", "deletionDependencies", "updatedAt"',
        ") VALUES (",
        "  $1, $2, 'CORRECT', 'PENDING', $3::timestamptz,",
        "  'privacy-correction-contract', ARRAY[]::\"PrivacyDeletionDependencyCode\"[], $4::timestamptz",
        ")",
      ].join("\n"),
      [
        requestId,
        userId,
        "2042-04-01T00:00:00.000Z",
        "2042-03-01T00:00:00.000Z",
      ],
    );
    for (const fieldCode of [
      "DISPLAY_NAME",
      "LEGAL_NAME",
      "EMAIL",
      "PHONE",
      "LOCATION",
    ]) {
      await target.query(
        [
          'INSERT INTO "PrivacyRequestCorrectionField" (',
          '  "privacyRequestId", "fieldCode", "correctionText"',
          ") VALUES ($1, $2, $3)",
        ].join("\n"),
        [requestId, fieldCode, "Verified correction text for " + fieldCode],
      );
    }
    await expectConstraintViolation(
      target.query(
        [
          'INSERT INTO "PrivacyRequestCorrectionField" (',
          '  "privacyRequestId", "fieldCode", "correctionText"',
          ") VALUES ($1, 'PROFILE_PREFERENCES', $2)",
        ].join("\n"),
        [requestId, "Verified sixth correction text"],
      ),
      SQLSTATE.checkViolation,
      "privacy_correction_field_limit_check",
    );
  });

  it("rejects an imported Job without its source-scoped Decision at commit", async () => {
    const target = pool();
    const userId = explicitUuid(830);
    const companyId = explicitUuid(831);
    const importSourceId = explicitUuid(832);
    const jobId = explicitUuid(833);
    const sourceRightId = explicitUuid(834);
    const importRunId = explicitUuid(835);
    const importItemId = explicitUuid(836);
    const importDecisionId = explicitUuid(837);
    const foreignCompanyId = explicitUuid(838);

    await insertUser(target, userId, "import-traceability@example.test");
    await insertCompany(target, companyId, "import-traceability");
    await insertCompany(target, foreignCompanyId, "import-foreign");
    await target.query(
      [
        'INSERT INTO "ImportSource" (',
        '  "id", "name", "sourceReference", "licenseReference",',
        '  "format", "updatedAt"',
        ") VALUES ($1, 'Schema source', 'schema-source', 'schema-license', 'JSON', $2::timestamptz)",
      ].join("\n"),
      [importSourceId, "2042-03-01T00:00:00.000Z"],
    );
    await target.query(
      [
        'INSERT INTO "ImportSourceCompanyRight" (',
        '  "id", "importSourceId", "companyId", "rightsEvidence",',
        '  "grantedByUserId", "validFrom", "validTo"',
        ") VALUES ($1, $2, $3, 'schema-rights-evidence', $4,",
        "  $5::timestamptz, $6::timestamptz)",
      ].join("\n"),
      [
        sourceRightId,
        importSourceId,
        companyId,
        userId,
        "2042-01-01T00:00:00.000Z",
        "2043-01-01T00:00:00.000Z",
      ],
    );
    await target.query(
      [
        'INSERT INTO "ImportRun" (',
        '  "id", "importSourceId", "actorUserId", "inputSource",',
        '  "format", "checksum", "status", "updatedAt"',
        ") VALUES ($1, $2, $3, 'PASTE', 'JSON', $4, 'PREVIEW_READY', $5::timestamptz)",
      ].join("\n"),
      [
        importRunId,
        importSourceId,
        userId,
        "a".repeat(64),
        "2042-03-01T00:00:00.000Z",
      ],
    );
    await target.query(
      [
        'INSERT INTO "ImportItem" (',
        '  "id", "runId", "sourceItemKey", "normalizedPreview",',
        '  "normalizedChecksum", "dedupeKey", "status", "updatedAt"',
        ") VALUES ($1, $2, 'source-item-1', '{}'::jsonb, $3, 'source-item-1', 'OK', $4::timestamptz)",
      ].join("\n"),
      [
        importItemId,
        importRunId,
        "b".repeat(64),
        "2042-03-01T00:00:00.000Z",
      ],
    );
    await target.query(
      [
        'INSERT INTO "ImportDecision" (',
        '  "id", "importItemId", "kind", "selectedCompanyId",',
        '  "actorUserId", "reasonCode", "idempotencyKey", "createdAt"',
        ") VALUES ($1, $2, 'APPROVE', $3, $4, 'RIGHTS_VERIFIED',",
        "  'schema-import-approve', $5::timestamptz)",
      ].join("\n"),
      [
        importDecisionId,
        importItemId,
        companyId,
        userId,
        "2042-03-01T00:00:00.000Z",
      ],
    );

    const client = await target.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        [
          'INSERT INTO "Job" (',
          '  "id", "companyId", "slug", "origin", "sourceReference",',
          '  "importSourceId", "createdByUserId", "updatedAt"',
          ") VALUES ($1, $2, 'import-without-decision', 'IMPORT', 'source-item-1', $3, $4, $5::timestamptz)",
        ].join("\n"),
        [
          jobId,
          companyId,
          importSourceId,
          userId,
          "2042-03-01T00:00:00.000Z",
        ],
      );
      await expectConstraintViolation(
        client.query("COMMIT"),
        SQLSTATE.checkViolation,
        "import_job_decision_traceability_check",
      );
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }

    const committed = await target.connect();
    try {
      await committed.query("BEGIN");
      await committed.query(
        [
          'INSERT INTO "Job" (',
          '  "id", "companyId", "slug", "origin", "sourceReference",',
          '  "importSourceId", "createdByUserId", "updatedAt"',
          ") VALUES ($1, $2, 'import-with-decision', 'IMPORT', 'source-item-1', $3, $4, $5::timestamptz)",
        ].join("\n"),
        [
          jobId,
          companyId,
          importSourceId,
          userId,
          "2042-03-01T00:00:00.000Z",
        ],
      );
      await committed.query(
        'UPDATE "ImportDecision" SET "committedJobId" = $2 WHERE "id" = $1',
        [importDecisionId, jobId],
      );
      await committed.query("COMMIT");
    } finally {
      await committed.query("ROLLBACK").catch(() => undefined);
      committed.release();
    }

    const linked = await target.query<{ committed_job_id: string | null }>(
      'SELECT "committedJobId" AS committed_job_id FROM "ImportDecision" WHERE "id" = $1',
      [importDecisionId],
    );
    expect(linked.rows[0]?.committed_job_id).toBe(jobId);
    await expectConstraintViolation(
      target.query(
        [
          'UPDATE "Job" SET "origin" = \'MANUAL\',',
          '  "sourceReference" = \'platform-manual\', "importSourceId" = NULL',
          'WHERE "id" = $1',
        ].join("\n"),
        [jobId],
      ),
      SQLSTATE.checkViolation,
      "job_identity_provenance_immutable",
    );
    await expectConstraintViolation(
      target.query('UPDATE "Job" SET "companyId" = $2 WHERE "id" = $1', [
        jobId,
        foreignCompanyId,
      ]),
      SQLSTATE.checkViolation,
      "job_identity_provenance_immutable",
    );
    await expectConstraintViolation(
      target.query(
        'UPDATE "ImportDecision" SET "reasonCode" = \'CHANGED\' WHERE "id" = $1',
        [importDecisionId],
      ),
      SQLSTATE.checkViolation,
      "import_decision_commit_once_check",
    );
  });

  it("rejects a valid foreign entity paired through the wrong company scope", async () => {
    const target = pool();
    const userId = explicitUuid(700);
    const orderCompanyId = explicitUuid(701);
    const foreignCompanyId = explicitUuid(702);
    const orderId = explicitUuid(703);

    await insertUser(target, userId, "scope-owner@example.test");
    await insertCompany(target, orderCompanyId, "scope-order");
    await insertCompany(target, foreignCompanyId, "scope-foreign");
    await insertOrder(target, {
      companyId: orderCompanyId,
      id: orderId,
      suffix: "foreign-scope",
      userId,
    });

    await expectConstraintViolation(
      target.query(
        [
          'INSERT INTO "Invoice" (',
          '  "id", "orderId", "companyId", "number",',
          '  "billingLegalNameSnapshot", "billingContactEmailSnapshot",',
          '  "billingStreetSnapshot", "billingPostalCodeSnapshot",',
          '  "billingCitySnapshot", "billingCountryCodeSnapshot",',
          '  "currency", "netTotalRappen", "vatTotalRappen", "totalRappen",',
          '  "dueAt"',
          ") VALUES (",
          "  $1, $2, $3, 'SCHEMA-SCOPE-1',",
          "  'Foreign Schema AG', 'foreign@schema.test',",
          "  'Fremdstrasse 1', '8001',",
          "  'Zürich', 'CH',",
          "  'CHF', 0, 0, 0,",
          "  $4::timestamptz",
          ")",
        ].join("\n"),
        [
          explicitUuid(704),
          orderId,
          foreignCompanyId,
          "2041-01-01T00:00:00.000Z",
        ],
      ),
      SQLSTATE.foreignKeyViolation,
      "invoice_order_company_fkey",
    );
  });
});
