import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const PRE_PHASE34_MIGRATION =
  "20260801090000_phase_33_payment_provider_bindings";
const PHASE34_MIGRATIONS = Object.freeze([
  "20260806200000_phase_34_provider_inbox_health",
  "20260806210000_phase_34_public_search_trigram",
  "20260806220000_phase_34_company_closure",
  "20260806230000_phase_34_job_revision_generated_column_immutability",
  "20260806240000_phase_34_talent_radar_legal_gate_serialization",
  "20260806250000_phase_34_public_intake_privacy_evidence",
]);
const TALENT_RADAR_LEGAL_GATE_MIGRATION = resolve(
  process.cwd(),
  "prisma",
  "migrations",
  "20260806240000_phase_34_talent_radar_legal_gate_serialization",
  "migration.sql",
);
const PUBLIC_INTAKE_PRIVACY_MIGRATION = resolve(
  process.cwd(),
  "prisma",
  "migrations",
  "20260806250000_phase_34_public_intake_privacy_evidence",
  "migration.sql",
);
const COMPANY_ID = "34000000-0000-4000-8000-000000000001";
const USER_ID = "34000000-0000-4000-8000-000000000002";
const CATEGORY_ID = "34000000-0000-4000-8000-000000000003";
const JOB_ID = "34000000-0000-4000-8000-000000000004";
const REVISION_ID = "34000000-0000-4000-8000-000000000005";
const INVENTORY_ID = "34000000-0000-4000-8000-000000000006";
const RADAR_APPROVAL_ID = "34000000-0000-4000-8000-000000000007";
const CONVERSATION_APPROVAL_ID = "34000000-0000-4000-8000-000000000008";
const LEGAL_REVIEWER_ID = "34000000-0000-4000-8000-000000000009";
const LEGAL_PUBLISHER_ID = "34000000-0000-4000-8000-000000000010";
const LEGAL_DOCUMENT_ID = "34000000-0000-4000-8000-000000000011";
const LEGAL_REVISION_ID = "34000000-0000-4000-8000-000000000012";
const LEGAL_PUBLICATION_ID = "34000000-0000-4000-8000-000000000013";
const INVENTORY_ENTRY_ID = "34000000-0000-4000-8000-000000000014";
const LEGACY_REPORT_ID = "34000000-0000-4000-8000-000000000015";
const LEGACY_LEAD_ID = "34000000-0000-4000-8000-000000000016";
const LEGACY_ACTIVITY_ID = "34000000-0000-4000-8000-000000000017";
const LEGACY_INTAKE_ID = "34000000-0000-4000-8000-000000000018";
const EXPECTED_COMPANY_SEARCH = "arzte zurich gmbh";
const EXPECTED_JOB_SEARCH = [
  "ubergrossen-entwicklerin",
  "lost komplexe argernisse.",
  "pruft qualitat",
  "schreibt losungen",
  "erfahrung mit zurich",
  "funf wochen ferien",
].join("\n");

const EXPECTED_INDEX_DEFINITIONS = Object.freeze({
  EmailProviderEventInbox_environment_status_receivedAt_id_idx:
    "CREATE INDEX EmailProviderEventInbox_environment_status_receivedAt_id_idx ON public.EmailProviderEventInbox USING btree (environment, status, receivedAt, id)",
  ProviderEventInbox_environment_status_nextRetryAt_id_idx:
    "CREATE INDEX ProviderEventInbox_environment_status_nextRetryAt_id_idx ON public.ProviderEventInbox USING btree (environment, status, nextRetryAt, id)",
  ProviderEventInbox_environment_status_receivedAt_id_idx:
    "CREATE INDEX ProviderEventInbox_environment_status_receivedAt_id_idx ON public.ProviderEventInbox USING btree (environment, status, receivedAt, id)",
  company_phase34_search_document_trgm_idx:
    "CREATE INDEX company_phase34_search_document_trgm_idx ON public.Company USING gin (searchDocument gin_trgm_ops)",
  job_revision_phase34_search_document_trgm_idx:
    "CREATE INDEX job_revision_phase34_search_document_trgm_idx ON public.JobRevision USING gin (searchDocument gin_trgm_ops)",
});

let migrated: MigratedDatabase | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase34_migration_upgrade", {
    throughMigration: PRE_PHASE34_MIGRATION,
  });
}, 600_000);

afterAll(async () => {
  await migrated?.dispose();
});

describe("Phase-34 additive migration upgrade and restart", () => {
  it("resumes a partial pre-application, preserves existing data and becomes an idempotent no-op", async () => {
    const fixture = requireFixture();
    await insertPreExistingBusinessData(fixture);
    await installPartialSearchState(fixture);

    const partial = await fixture.pool.query<{
      company_search: string;
      company_search_index: string | null;
      job_search_column: boolean;
      normalize_function: string | null;
      revision_function: string | null;
    }>(
      `
        SELECT
          (SELECT "searchDocument" FROM "Company" WHERE "id" = $1) AS company_search,
          to_regclass('company_phase34_search_document_trgm_idx')::text AS company_search_index,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'JobRevision'
              AND column_name = 'searchDocument'
          ) AS job_search_column,
          to_regprocedure('phase34_normalize_search_text(text)')::text AS normalize_function,
          to_regprocedure(
            'phase34_job_revision_search_document(text,text,text[],text[],text)'
          )::text AS revision_function
      `,
      [COMPANY_ID],
    );
    expect(partial.rows).toEqual([
      {
        company_search: EXPECTED_COMPANY_SEARCH,
        company_search_index: "company_phase34_search_document_trgm_idx",
        job_search_column: false,
        normalize_function: "phase34_normalize_search_text(text)",
        revision_function:
          "phase34_job_revision_search_document(text,text,text[],text[],text)",
      },
    ]);

    // migrate() starts a separate Prisma process after the partial client has
    // disconnected, reproducing a deploy restart rather than one transaction.
    await fixture.migrate();

    const generated = await loadGeneratedValues(fixture);
    expect(generated).toEqual({
      company_search: EXPECTED_COMPANY_SEARCH,
      job_search: EXPECTED_JOB_SEARCH,
    });

    const indexes = await loadPhase34Indexes(fixture);
    expect(indexes).toHaveLength(5);
    for (const index of indexes) {
      expect(index.indisvalid).toBe(true);
      expect(index.indisready).toBe(true);
      expect(index.indislive).toBe(true);
      expect(index.indisunique).toBe(false);
      expect(canonicalIndexDefinition(index.definition)).toBe(
        EXPECTED_INDEX_DEFINITIONS[
          index.name as keyof typeof EXPECTED_INDEX_DEFINITIONS
        ],
      );
    }

    const closureEnum = await fixture.pool.query<{ values: string }>(
      `SELECT enum_range(NULL::"AuditAction")::text AS values`,
    );
    expect(closureEnum.rows[0]?.values).toContain("COMPANY_CLOSED");

    const triggerFunction = await fixture.pool.query<{ definition: string }>(
      `
        SELECT pg_get_functiondef(
          'enforce_job_revision_immutable()'::regprocedure
        ) AS definition
      `,
    );
    expect(triggerFunction.rows[0]?.definition).toContain("searchDocument");

    const legalGateSchema = await loadLegalGateSchemaState(fixture);
    expect(legalGateSchema).toMatchObject({
      approvalIndexUnique: true,
      inventoryInsertTriggerEnabled: "O",
    });
    expect(legalGateSchema.approvalIndexPredicate).toContain("APPROVED");
    expect(legalGateSchema.inventoryInsertFunction).toContain("DRAFT");
    expect(legalGateSchema.queryIndexDefinition).toContain(
      "ProcessingApproval_scope_region_processor_status_created_idx",
    );
    await verifyLegalGateConstraints(fixture);

    const publicIntakeSchema = await loadPublicIntakeSchemaState(fixture);
    expect(publicIntakeSchema).toMatchObject({
      abuseConstraintValidated: true,
      abuseTriggerEnabled: "O",
      currentPublicationIndexUnique: true,
      intakeConstraintValidated: true,
      intakeTriggerEnabled: "O",
      legacyAbuseMode: "LEGACY_UNBOUND",
      legacyIntakeMode: "LEGACY_UNBOUND",
    });

    // A deployment can be restarted after the SQL reached PostgreSQL but
    // before the migration runner persisted its bookkeeping. Replaying the
    // exact migration file must deterministically reinstall the function and
    // trigger without weakening either database invariant.
    const legalGateMigrationSql = await readFile(
      TALENT_RADAR_LEGAL_GATE_MIGRATION,
      "utf8",
    );
    await expect(
      fixture.pool.query(legalGateMigrationSql),
    ).resolves.toBeDefined();
    expect(await loadLegalGateSchemaState(fixture)).toEqual(legalGateSchema);
    await verifyLegalGateConstraintsAfterReplay(fixture);

    const publicIntakeMigrationSql = await readFile(
      PUBLIC_INTAKE_PRIVACY_MIGRATION,
      "utf8",
    );
    await expect(
      fixture.pool.query(publicIntakeMigrationSql),
    ).resolves.toBeDefined();
    expect(await loadPublicIntakeSchemaState(fixture)).toEqual(
      publicIntakeSchema,
    );

    await fixture.pool.query(
      `
        UPDATE "JobRevision"
        SET "approvedAt" = '2026-08-06T10:00:00.000Z',
            "version" = "version" + 1,
            "updatedAt" = '2026-08-06T10:00:00.000Z'
        WHERE "id" = $1
      `,
      [REVISION_ID],
    );
    await expect(
      fixture.pool.query(
        `UPDATE "JobRevision" SET "title" = 'Unzulässige Änderung' WHERE "id" = $1`,
        [REVISION_ID],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await loadGeneratedValues(fixture)).toEqual(generated);

    const migrationRecordsBeforeNoOp = await loadMigrationRecords(fixture);
    expect(migrationRecordsBeforeNoOp).toHaveLength(6);
    expect(
      migrationRecordsBeforeNoOp.map(({ migration_name }) => migration_name),
    ).toEqual(PHASE34_MIGRATIONS);
    for (const record of migrationRecordsBeforeNoOp) {
      expect(record.finished_at).toBeInstanceOf(Date);
      expect(record.rolled_back_at).toBeNull();
      expect(record.applied_steps_count).toBe(1);
    }

    await expect(fixture.migrate()).resolves.toBeUndefined();

    expect(await loadMigrationRecords(fixture)).toEqual(
      migrationRecordsBeforeNoOp,
    );
    expect(await loadPhase34Indexes(fixture)).toEqual(indexes);
    expect(await loadLegalGateSchemaState(fixture)).toEqual(legalGateSchema);
    expect(await loadGeneratedValues(fixture)).toEqual(generated);
    const preserved = await fixture.pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM "Company" company
        JOIN "Job" job ON job."companyId" = company."id"
        JOIN "JobRevision" revision ON revision."jobId" = job."id"
        WHERE company."id" = $1 AND revision."id" = $2
      `,
      [COMPANY_ID, REVISION_ID],
    );
    expect(preserved.rows).toEqual([{ count: "1" }]);
  });
});

async function insertPreExistingBusinessData(fixture: MigratedDatabase) {
  await fixture.pool.query(
    `
      INSERT INTO "User" (
        "id", "email", "emailNormalized", "role", "name",
        "status", "dataProvenance", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'phase34-upgrade@example.test',
        'phase34-upgrade@example.test', 'EMPLOYER',
        'Phase 34 Migration Owner', 'ACTIVE', 'TEST',
        '2026-08-01T08:00:00.000Z', '2026-08-01T08:00:00.000Z'
      )
    `,
    [USER_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "Company" (
        "id", "name", "slug", "industry", "about", "status",
        "dataProvenance", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'Ärzte Zürich GmbH', 'phase34-upgrade-company',
        'Gesundheit', 'Bestehende realistische Firma vor Phase 34.',
        'DRAFT', 'TEST', '2026-08-01T08:00:00.000Z',
        '2026-08-01T08:00:00.000Z'
      )
    `,
    [COMPANY_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "Category" (
        "id", "name", "slug", "isActive", "sortOrder",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, 'Technologie', 'phase34-upgrade-technologie', true, 34,
        '2026-08-01T08:00:00.000Z', '2026-08-01T08:00:00.000Z'
      )
    `,
    [CATEGORY_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "Job" (
        "id", "companyId", "slug", "status", "origin",
        "sourceReference", "version", "dataProvenance",
        "createdByUserId", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'phase34-upgrade-job', 'DRAFT', 'MANUAL',
        'phase34-upgrade-fixture', 1, 'TEST', $3,
        '2026-08-01T08:00:00.000Z', '2026-08-01T08:00:00.000Z'
      )
    `,
    [JOB_ID, COMPANY_ID, USER_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "JobRevision" (
        "id", "jobId", "revisionNumber", "contentLanguage", "title",
        "description", "tasks", "requirements", "niceToHave", "offer",
        "applicationProcessSteps", "requiredDocumentKinds", "jobType",
        "remoteType", "remoteCountryCode", "categoryId", "locationLabel", "workloadMin",
        "workloadMax", "salaryPeriod", "salaryMin", "salaryMax",
        "responseTargetDays", "applicationEffort",
        "applicationContactKind", "applicationContactValue",
        "authoredByUserId", "contentChecksum", "submittedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 1, 'DE', 'Übergrössen-Entwicklerin',
        'Löst komplexe Ärgernisse.',
        ARRAY['Prüft Qualität', 'Schreibt Lösungen']::text[],
        ARRAY['Erfahrung mit Zürich']::text[], ARRAY[]::text[],
        'Fünf Wochen Ferien', ARRAY['Bewerbung', 'Gespräch']::text[],
        ARRAY['CV']::"RequiredDocumentKind"[], 'PERMANENT', 'REMOTE', 'CH',
        $3, 'Schweiz', 80, 100, 'YEARLY', 110000, 130000, 7,
        'SIMPLE', 'EMAIL', 'jobs@phase34-upgrade.example.test', $4,
        $5, '2026-08-01T09:00:00.000Z',
        '2026-08-01T08:30:00.000Z', '2026-08-01T09:00:00.000Z'
      )
    `,
    [REVISION_ID, JOB_ID, CATEGORY_ID, USER_ID, "a".repeat(64)],
  );
  await fixture.pool.query(
    `UPDATE "Job" SET "currentRevisionId" = $2 WHERE "id" = $1`,
    [JOB_ID, REVISION_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "AbuseReport" (
        "id", "targetType", "targetId", "reasonCode", "description",
        "severity", "status", "dueAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'JOB', $2, 'PRE_PHASE34_LEGACY',
        'Historische Meldung ohne nachträglich erfundene Datenschutzevidenz.',
        'MEDIUM', 'OPEN', '2026-08-02T08:00:00.000Z',
        '2026-08-01T08:00:00.000Z', '2026-08-01T08:00:00.000Z'
      )
    `,
    [LEGACY_REPORT_ID, JOB_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "SalesLead" (
        "id", "emailNormalized", "organizationNormalized", "organizationName",
        "contactName", "companySizeCode", "hiringNeedCode", "interestCode",
        "purpose", "consentSource", "message", "noticeVersion", "noticeHash",
        "slaPolicyVersion", "dueAt", "retainUntil", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'legacy-phase34@example.test', 'legacy phase 34 ag',
        'Legacy Phase 34 AG', 'Historischer Kontakt', '10_49', 'ONE_ROLE',
        'GENERAL', 'EMPLOYER_DEMO', 'legacy-public-intake',
        'Historische Anfrage mit ausreichender Beschreibung.', 'legacy-v1', $2,
        'sla-v1', '2026-08-02T08:00:00.000Z', '2027-08-01T08:00:00.000Z',
        '2026-08-01T08:00:00.000Z', '2026-08-01T08:00:00.000Z'
      )
    `,
    [LEGACY_LEAD_ID, "c".repeat(64)],
  );
  await fixture.pool.query(
    `
      INSERT INTO "SalesActivity" (
        "id", "salesLeadId", "kind", "outcomeCode", "idempotencyKey",
        "payloadHash", "correlationId", "createdAt"
      ) VALUES (
        $1, $2, 'INTAKE_RECEIVED', 'PUBLIC_INTAKE',
        'phase34-legacy-intake-key', $3, 'phase34-legacy-correlation',
        '2026-08-01T08:00:00.000Z'
      )
    `,
    [LEGACY_ACTIVITY_ID, LEGACY_LEAD_ID, "d".repeat(64)],
  );
  await fixture.pool.query(
    `
      INSERT INTO "SalesLeadIntake" (
        "id", "salesLeadId", "salesActivityId", "organizationName",
        "contactName", "companySizeCode", "hiringNeedCode", "interestCode",
        "message", "noticeVersion", "noticeHash", "slaPolicyVersion",
        "dueAt", "retainUntil", "createdAt"
      ) VALUES (
        $1, $2, $3, 'Legacy Phase 34 AG', 'Historischer Kontakt',
        '10_49', 'ONE_ROLE', 'GENERAL',
        'Historische Anfrage mit ausreichender Beschreibung.', 'legacy-v1', $4,
        'sla-v1', '2026-08-02T08:00:00.000Z', '2027-08-01T08:00:00.000Z',
        '2026-08-01T08:00:00.000Z'
      )
    `,
    [LEGACY_INTAKE_ID, LEGACY_LEAD_ID, LEGACY_ACTIVITY_ID, "c".repeat(64)],
  );
}

async function installPartialSearchState(fixture: MigratedDatabase) {
  const client = await fixture.pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await client.query(`
      CREATE OR REPLACE FUNCTION phase34_normalize_search_text(input text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      RETURNS NULL ON NULL INPUT
      AS $$
        SELECT regexp_replace(
          normalize(lower(input), NFKD),
          '[\\u0300-\\u036f]',
          '',
          'g'
        );
      $$
    `);
    await client.query(`
      CREATE OR REPLACE FUNCTION phase34_job_revision_search_document(
        title text,
        description text,
        tasks text[],
        requirements text[],
        offer text
      )
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
        SELECT phase34_normalize_search_text(
          COALESCE(title, '') || E'\\n' ||
          COALESCE(description, '') || E'\\n' ||
          COALESCE(array_to_string(tasks, E'\\n'), '') || E'\\n' ||
          COALESCE(array_to_string(requirements, E'\\n'), '') || E'\\n' ||
          COALESCE(offer, '')
        );
      $$
    `);
    await client.query(`
      ALTER TABLE "Company"
        ADD COLUMN "searchDocument" text
        GENERATED ALWAYS AS (phase34_normalize_search_text("name")) STORED
    `);
    await client.query(`
      CREATE INDEX "company_phase34_search_document_trgm_idx"
        ON "Company" USING GIN ("searchDocument" gin_trgm_ops)
    `);
  } finally {
    client.release();
  }
}

async function loadGeneratedValues(fixture: MigratedDatabase) {
  const result = await fixture.pool.query<{
    company_search: string;
    job_search: string;
  }>(
    `
      SELECT
        company."searchDocument" AS company_search,
        revision."searchDocument" AS job_search
      FROM "Company" company
      JOIN "Job" job ON job."companyId" = company."id"
      JOIN "JobRevision" revision ON revision."jobId" = job."id"
      WHERE company."id" = $1 AND revision."id" = $2
    `,
    [COMPANY_ID, REVISION_ID],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("Phase-34 migration canary is missing.");
  return row;
}

async function loadPhase34Indexes(fixture: MigratedDatabase) {
  const result = await fixture.pool.query<{
    definition: string;
    indislive: boolean;
    indisready: boolean;
    indisunique: boolean;
    indisvalid: boolean;
    name: string;
  }>(
    `
      SELECT
        index_class.relname AS name,
        pg_get_indexdef(index_state.indexrelid) AS definition,
        index_state.indisvalid,
        index_state.indisready,
        index_state.indislive,
        index_state.indisunique
      FROM pg_index index_state
      JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
      WHERE index_class.relname = ANY($1::text[])
      ORDER BY index_class.relname
    `,
    [Object.keys(EXPECTED_INDEX_DEFINITIONS)],
  );
  return result.rows;
}

async function loadLegalGateSchemaState(fixture: MigratedDatabase) {
  const result = await fixture.pool.query<{
    approval_index_predicate: string;
    approval_index_unique: boolean;
    inventory_insert_function: string;
    inventory_insert_trigger_enabled: string;
    query_index_definition: string;
  }>(
    `
      SELECT
        approval_index.indisunique AS approval_index_unique,
        pg_get_expr(
          approval_index.indpred,
          approval_index.indrelid
        ) AS approval_index_predicate,
        pg_get_indexdef(query_index.indexrelid) AS query_index_definition,
        inventory_trigger.tgenabled AS inventory_insert_trigger_enabled,
        pg_get_functiondef(inventory_trigger.tgfoid) AS inventory_insert_function
      FROM pg_index approval_index
      JOIN pg_class approval_index_class
        ON approval_index_class.oid = approval_index.indexrelid
      JOIN pg_index query_index
        ON query_index.indexrelid =
          '"ProcessingApproval_scope_region_processor_status_created_idx"'::regclass
      JOIN pg_trigger inventory_trigger
        ON inventory_trigger.tgname = 'phase34_inventory_entry_draft_only_insert'
       AND inventory_trigger.tgrelid = '"PrivacyDataInventoryEntry"'::regclass
      WHERE approval_index_class.relname =
        'processing_approval_one_approved_scope'
        AND NOT inventory_trigger.tgisinternal
    `,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Phase-34 legal gate index/trigger contract is missing.");
  }
  return Object.freeze({
    approvalIndexUnique: row.approval_index_unique,
    approvalIndexPredicate: row.approval_index_predicate,
    queryIndexDefinition: row.query_index_definition,
    inventoryInsertTriggerEnabled: row.inventory_insert_trigger_enabled,
    inventoryInsertFunction: row.inventory_insert_function,
  });
}

async function loadPublicIntakeSchemaState(fixture: MigratedDatabase) {
  const result = await fixture.pool.query<{
    abuse_constraint_validated: boolean;
    abuse_function: string;
    abuse_trigger_enabled: string;
    current_publication_index_predicate: string;
    current_publication_index_unique: boolean;
    intake_constraint_validated: boolean;
    intake_function: string;
    intake_trigger_enabled: string;
    legacy_abuse_mode: string;
    legacy_intake_mode: string;
  }>(
    `
      SELECT
        abuse_constraint.convalidated AS abuse_constraint_validated,
        intake_constraint.convalidated AS intake_constraint_validated,
        abuse_trigger.tgenabled AS abuse_trigger_enabled,
        intake_trigger.tgenabled AS intake_trigger_enabled,
        pg_get_functiondef(abuse_trigger.tgfoid) AS abuse_function,
        pg_get_functiondef(intake_trigger.tgfoid) AS intake_function,
        current_index.indisunique AS current_publication_index_unique,
        pg_get_expr(current_index.indpred, current_index.indrelid)
          AS current_publication_index_predicate,
        (SELECT "privacyEvidenceMode"::text FROM "AbuseReport" WHERE "id" = $1)
          AS legacy_abuse_mode,
        (SELECT "privacyEvidenceMode"::text FROM "SalesLeadIntake" WHERE "id" = $2)
          AS legacy_intake_mode
      FROM pg_constraint abuse_constraint
      JOIN pg_constraint intake_constraint
        ON intake_constraint.conname = 'SalesLeadIntake_privacy_evidence_shape_check'
       AND intake_constraint.conrelid = '"SalesLeadIntake"'::regclass
      JOIN pg_trigger abuse_trigger
        ON abuse_trigger.tgname = 'AbuseReport_privacy_evidence_guard'
       AND abuse_trigger.tgrelid = '"AbuseReport"'::regclass
       AND NOT abuse_trigger.tgisinternal
      JOIN pg_trigger intake_trigger
        ON intake_trigger.tgname = 'SalesLeadIntake_privacy_evidence_insert_guard'
       AND intake_trigger.tgrelid = '"SalesLeadIntake"'::regclass
       AND NOT intake_trigger.tgisinternal
      JOIN pg_index current_index
        ON current_index.indexrelid = '"legal_publication_one_current"'::regclass
      WHERE abuse_constraint.conname = 'AbuseReport_privacy_evidence_shape_check'
        AND abuse_constraint.conrelid = '"AbuseReport"'::regclass
    `,
    [LEGACY_REPORT_ID, LEGACY_INTAKE_ID],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Phase-34 public-intake privacy schema contract is missing.");
  }
  return Object.freeze({
    abuseConstraintValidated: row.abuse_constraint_validated,
    abuseFunction: row.abuse_function,
    abuseTriggerEnabled: row.abuse_trigger_enabled,
    currentPublicationIndexPredicate:
      row.current_publication_index_predicate,
    currentPublicationIndexUnique: row.current_publication_index_unique,
    intakeConstraintValidated: row.intake_constraint_validated,
    intakeFunction: row.intake_function,
    intakeTriggerEnabled: row.intake_trigger_enabled,
    legacyAbuseMode: row.legacy_abuse_mode,
    legacyIntakeMode: row.legacy_intake_mode,
  });
}

async function verifyLegalGateConstraints(fixture: MigratedDatabase) {
  await fixture.pool.query(
    `
      INSERT INTO "User" (
        "id", "email", "emailNormalized", "role", "name",
        "status", "dataProvenance", "createdAt", "updatedAt"
      ) VALUES
        ($1, 'phase34-legal-reviewer@example.test',
         'phase34-legal-reviewer@example.test', 'ADMIN',
         'Phase 34 Legal Reviewer', 'ACTIVE', 'TEST', now(), now()),
        ($2, 'phase34-legal-publisher@example.test',
         'phase34-legal-publisher@example.test', 'ADMIN',
         'Phase 34 Legal Publisher', 'ACTIVE', 'TEST', now(), now())
    `,
    [LEGAL_REVIEWER_ID, LEGAL_PUBLISHER_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "LegalDocument" (
        "id", "type", "locale", "slug", "title", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'PRIVACY', 'de-CH', 'phase34-upgrade-privacy',
        'Phase 34 Upgrade Privacy', now(), now()
      )
    `,
    [LEGAL_DOCUMENT_ID],
  );
  await fixture.pool.query(
    `
      INSERT INTO "LegalRevision" (
        "id", "legalDocumentId", "revisionNumber", "status", "versionLabel",
        "contentMarkdown", "contentHash", "changeSummary",
        "requiresReconsent", "createdByUserId", "reviewedByUserId",
        "reviewedAt", "createdAt"
      ) VALUES (
        $1, $2, 1, 'APPROVED', 'phase34-v1',
        'Phase 34 migration upgrade privacy contract with sufficient content.',
        $3, 'Phase 34 legal serialization migration', false,
        $4, $5, now(), now()
      )
    `,
    [
      LEGAL_REVISION_ID,
      LEGAL_DOCUMENT_ID,
      "b".repeat(64),
      USER_ID,
      LEGAL_REVIEWER_ID,
    ],
  );
  await fixture.pool.query(
    `
      INSERT INTO "LegalPublication" (
        "id", "legalDocumentId", "legalRevisionId", "status",
        "publicationHash", "publishedByUserId", "effectiveAt", "createdAt"
      ) VALUES ($1, $2, $3, 'CURRENT', $4, $5, now(), now())
    `,
    [
      LEGAL_PUBLICATION_ID,
      LEGAL_DOCUMENT_ID,
      LEGAL_REVISION_ID,
      "b".repeat(64),
      LEGAL_PUBLISHER_ID,
    ],
  );

  await fixture.pool.query(
    `
      INSERT INTO "PrivacyDataInventoryVersion" (
        "id", "version", "status", "contentHash", "owner", "reviewRef"
      ) VALUES (
        $1, 'phase34-upgrade-v1', 'DRAFT', $2,
        'Phase 34 Privacy Owner', 'counsel:phase34:upgrade:v1'
      )
    `,
    [INVENTORY_ID, "c".repeat(64)],
  );
  await fixture.pool.query(
    `
      INSERT INTO "PrivacyDataInventoryEntry" (
        "id", "inventoryVersionId", "entityKey", "fieldScope",
        "subjectClass", "purposeCode", "legalBasisCode", "processorKey",
        "storageRegion", "retentionDays", "exportOutcome",
        "correctionOutcome", "erasureOutcome", "holdRuleCode", "owner"
      ) VALUES (
        $1, $2, 'RADAR_PROFILE', 'anonymous projection', 'CANDIDATE',
        'TALENT_RADAR', 'COUNSEL_APPROVED_RADAR', 'postgres-primary',
        'ch-sandbox', 180, 'INCLUDE', 'CORRECT', 'DELETE',
        'PHASE34_RADAR_HOLD_V1', 'Phase 34 Privacy Owner'
      )
    `,
    [INVENTORY_ENTRY_ID, INVENTORY_ID],
  );
  await fixture.pool.query(
    `
      UPDATE "PrivacyDataInventoryVersion"
      SET "status" = 'ACTIVE', "effectiveAt" = now()
      WHERE "id" = $1
    `,
    [INVENTORY_ID],
  );
  await expect(
    fixture.pool.query(
      `
      INSERT INTO "PrivacyDataInventoryEntry" (
        "id", "inventoryVersionId", "entityKey", "fieldScope",
        "subjectClass", "purposeCode", "legalBasisCode", "processorKey",
        "storageRegion", "retentionDays", "exportOutcome",
        "correctionOutcome", "erasureOutcome", "holdRuleCode", "owner"
      ) VALUES (
        '34000000-0000-4000-8000-000000000015', $1,
        'MESSAGE', 'late forbidden insert', 'CANDIDATE',
        'RECRUITING_CONVERSATION', 'COUNSEL_APPROVED_CONVERSATION',
        'postgres-primary', 'ch-sandbox', 400, 'INCLUDE', 'CORRECT',
        'DELETE', 'PHASE34_CONVERSATION_HOLD_V1', 'Phase 34 Privacy Owner'
      )
    `,
      [INVENTORY_ID],
    ),
  ).rejects.toMatchObject({ code: "23514" });

  for (const [scope, approvalId] of [
    ["TALENT_RADAR", RADAR_APPROVAL_ID],
    ["RECRUITING_CONVERSATION", CONVERSATION_APPROVAL_ID],
  ] as const) {
    await fixture.pool.query(
      `
        INSERT INTO "ProcessingApproval" (
          "id", "scope", "region", "processorKey", "version", "status",
          "legalPublicationId", "legalBasisRef", "avgDecisionRef",
          "dsfaDecision", "dsfaDecisionRef", "owner", "approvedBy",
          "effectiveAt", "expiresAt", "reviewAt", "createdAt"
        ) VALUES (
          $1, $2, 'ch-sandbox', 'postgres-primary', $3, 'APPROVED',
          $4, $5, $6, 'NOT_REQUIRED', $7,
          'Phase 34 Privacy Owner', 'Phase 34 Independent Reviewer',
          now() - interval '1 minute', now() + interval '1 day',
          now() + interval '12 hours', now() - interval '2 minutes'
        )
      `,
      [
        approvalId,
        scope,
        scope === "TALENT_RADAR" ? "phase34-radar" : "phase34-conversation",
        LEGAL_PUBLICATION_ID,
        `counsel:${scope.toLowerCase()}:v1`,
        `seco:avg:${scope.toLowerCase()}:v1`,
        `dsfa:${scope.toLowerCase()}:v1`,
      ],
    );
    await expect(
      fixture.pool.query(
        `
        INSERT INTO "ProcessingApproval" (
          "id", "scope", "region", "processorKey", "version", "status",
          "legalPublicationId", "legalBasisRef", "avgDecisionRef",
          "dsfaDecision", "dsfaDecisionRef", "owner", "approvedBy",
          "effectiveAt", "reviewAt"
        ) VALUES (
          $1, $2, 'ch-sandbox', 'postgres-primary', $3, 'APPROVED',
          $4, 'counsel:duplicate:v1', 'seco:avg:duplicate:v1',
          'NOT_REQUIRED', 'dsfa:duplicate:v1', 'Phase 34 Privacy Owner',
          'Phase 34 Independent Reviewer', now() - interval '1 minute',
          now() + interval '12 hours'
        )
      `,
        [
          scope === "TALENT_RADAR"
            ? "34000000-0000-4000-8000-000000000016"
            : "34000000-0000-4000-8000-000000000017",
          scope,
          scope === "TALENT_RADAR"
            ? "phase34-radar-2"
            : "phase34-conversation-2",
          LEGAL_PUBLICATION_ID,
        ],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  }
}

async function verifyLegalGateConstraintsAfterReplay(
  fixture: MigratedDatabase,
) {
  await expect(
    fixture.pool.query(
      `
        INSERT INTO "PrivacyDataInventoryEntry" (
          "id", "inventoryVersionId", "entityKey", "fieldScope",
          "subjectClass", "purposeCode", "legalBasisCode", "processorKey",
          "storageRegion", "retentionDays", "exportOutcome",
          "correctionOutcome", "erasureOutcome", "holdRuleCode", "owner"
        ) VALUES (
          '34000000-0000-4000-8000-000000000018', $1,
          'MESSAGE', 'restart forbidden insert', 'CANDIDATE',
          'RECRUITING_CONVERSATION', 'COUNSEL_APPROVED_CONVERSATION',
          'postgres-primary', 'ch-sandbox', 400, 'INCLUDE', 'CORRECT',
          'DELETE', 'PHASE34_CONVERSATION_HOLD_V1', 'Phase 34 Privacy Owner'
        )
      `,
      [INVENTORY_ID],
    ),
  ).rejects.toMatchObject({ code: "23514" });

  for (const [scope, duplicateId, version] of [
    [
      "TALENT_RADAR",
      "34000000-0000-4000-8000-000000000019",
      "phase34-radar-restart",
    ],
    [
      "RECRUITING_CONVERSATION",
      "34000000-0000-4000-8000-000000000020",
      "phase34-conversation-restart",
    ],
  ] as const) {
    await expect(
      fixture.pool.query(
        `
          INSERT INTO "ProcessingApproval" (
            "id", "scope", "region", "processorKey", "version", "status",
            "legalPublicationId", "legalBasisRef", "avgDecisionRef",
            "dsfaDecision", "dsfaDecisionRef", "owner", "approvedBy",
            "effectiveAt", "reviewAt"
          ) VALUES (
            $1, $2, 'ch-sandbox', 'postgres-primary', $3, 'APPROVED',
            $4, 'counsel:restart:v1', 'seco:avg:restart:v1',
            'NOT_REQUIRED', 'dsfa:restart:v1', 'Phase 34 Privacy Owner',
            'Phase 34 Independent Reviewer', now() - interval '1 minute',
            now() + interval '12 hours'
          )
        `,
        [duplicateId, scope, version, LEGAL_PUBLICATION_ID],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  }
}

async function loadMigrationRecords(fixture: MigratedDatabase) {
  const result = await fixture.pool.query<{
    applied_steps_count: number;
    checksum: string;
    finished_at: Date | null;
    migration_name: string;
    rolled_back_at: Date | null;
  }>(
    `
      SELECT
        migration_name,
        checksum,
        finished_at,
        rolled_back_at,
        applied_steps_count
      FROM _prisma_migrations
      WHERE migration_name = ANY($1::text[])
      ORDER BY migration_name
    `,
    [PHASE34_MIGRATIONS],
  );
  return result.rows;
}

function canonicalIndexDefinition(definition: string) {
  return definition.replaceAll('"', "").replaceAll(/\s+/gu, " ").trim();
}

function requireFixture() {
  if (migrated === undefined) {
    throw new Error("Phase-34 migration upgrade fixture is unavailable.");
  }
  return migrated;
}
