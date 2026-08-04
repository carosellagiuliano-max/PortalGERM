import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const PRE_PHASE33_MIGRATION = "20260730120000_phase_31_commercial_validation";
const LEGACY_EVENT_ID = "evt_phase33_upgrade_legacy";
const LEGACY_USER_ID = "33000000-0000-4000-8000-000000000001";
const LEGACY_SESSION_ID = "33000000-0000-4000-8000-000000000002";
const LEGACY_SESSION_HASH = "1".repeat(64);

let migrated: MigratedDatabase | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase33_payment_upgrade", {
    throughMigration: PRE_PHASE33_MIGRATION,
  });
}, 600_000);

afterAll(async () => {
  await migrated?.dispose();
});

describe("Phase-33 additive payment upgrade migration", () => {
  it("backfills legacy payment evidence and installs recurring bindings without data loss", async () => {
    const fixture = requireFixture();
    const before = await fixture.pool.query<{
      payment_mode: string | null;
      price_binding: string | null;
    }>(`
      SELECT
        to_regtype('"PaymentRuntimeMode"')::text AS payment_mode,
        to_regclass('"PaymentPriceBinding"')::text AS price_binding
    `);
    expect(before.rows[0]).toEqual({
      payment_mode: null,
      price_binding: null,
    });

    await fixture.pool.query(
      `
        INSERT INTO "ProviderEventInbox" (
          "provider", "environment", "providerAccountReference",
          "providerEventId", "eventType", "eventCreatedAt", "apiVersion",
          "liveMode", "rawBodyDigest", "signatureDigest",
          "payloadSchemaVersion", "normalizedPayload", "status",
          "receivedAt", "updatedAt"
        ) VALUES (
          'STRIPE', 'ci', 'acct_phase33upgrade', $1,
          'checkout.session.completed', '2026-07-31T10:00:00.000Z',
          '2026-06-30.basil', false, $2, $3, 'phase24-v1', '{}'::jsonb,
          'RECEIVED', '2026-07-31T10:00:01.000Z',
          '2026-07-31T10:00:01.000Z'
        )
      `,
      [LEGACY_EVENT_ID, "a".repeat(64), "b".repeat(64)],
    );
    await fixture.pool.query(
      `
        INSERT INTO "User" (
          "id", "email", "emailNormalized", "role", "updatedAt"
        ) VALUES (
          $1, 'phase33-session-upgrade@example.test',
          'phase33-session-upgrade@example.test', 'CANDIDATE',
          '2026-07-31T10:00:00.000Z'
        )
      `,
      [LEGACY_USER_ID],
    );
    await fixture.pool.query(
      `
        INSERT INTO "Session" (
          "id", "userId", "tokenHash", "createdAt", "expiresAt",
          "absoluteExpiresAt"
        ) VALUES (
          $2, $1, $3, '2026-07-31T10:00:00.000Z',
          '2026-08-07T10:00:00.000Z', '2026-08-30T10:00:00.000Z'
        )
      `,
      [LEGACY_USER_ID, LEGACY_SESSION_ID, LEGACY_SESSION_HASH],
    );

    const migrationPath = resolve(
      process.cwd(),
      "prisma/migrations/20260801090000_phase_33_payment_provider_bindings/migration.sql",
    );
    const migrationSql = await readFile(migrationPath, "utf8");
    expect(migrationSql).toMatch(/^--[\s\S]*\nBEGIN;/u);
    expect(migrationSql).toMatch(/COMMIT;\s*$/u);
    const interruptedSql = migrationSql.replace(
      /COMMIT;\s*$/u,
      "SELECT 1 / 0;\nCOMMIT;\n",
    );
    expect(interruptedSql).not.toBe(migrationSql);
    const interruptedClient = await fixture.pool.connect();
    try {
      await expect(
        interruptedClient.query(interruptedSql),
      ).rejects.toMatchObject({ code: "22012" });
      await interruptedClient.query("ROLLBACK");
    } finally {
      interruptedClient.release();
    }
    const afterInterruptedDeploy = await fixture.pool.query<{
      event_count: string;
      payment_mode: string | null;
      price_binding: string | null;
      session_count: string;
      session_pending_column: boolean;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM "ProviderEventInbox" WHERE "providerEventId" = $1) AS event_count,
          to_regtype('"PaymentRuntimeMode"')::text AS payment_mode,
          to_regclass('"PaymentPriceBinding"')::text AS price_binding,
          (SELECT COUNT(*)::text FROM "Session" WHERE "id" = $2) AS session_count,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Session'
              AND column_name = 'pendingTokenHash'
          ) AS session_pending_column
      `,
      [LEGACY_EVENT_ID, LEGACY_SESSION_ID],
    );
    expect(afterInterruptedDeploy.rows).toEqual([
      {
        event_count: "1",
        payment_mode: null,
        price_binding: null,
        session_count: "1",
        session_pending_column: false,
      },
    ]);

    await fixture.migrate();

    const legacy = await fixture.pool.query<{
      adapterKey: string;
      adapterVersion: string;
      expectedLiveMode: boolean;
      providerMode: string;
    }>(
      `
        SELECT "adapterKey", "adapterVersion", "expectedLiveMode", "providerMode"::text
        FROM "ProviderEventInbox"
        WHERE "providerEventId" = $1
      `,
      [LEGACY_EVENT_ID],
    );
    expect(legacy.rows).toEqual([
      {
        adapterKey: "stripe_sandbox",
        adapterVersion: "v1",
        expectedLiveMode: false,
        providerMode: "SANDBOX",
      },
    ]);

    const installed = await fixture.pool.query<{
      email_inbox: string | null;
      event_kind: string;
      payment_mode: string | null;
      price_binding: string | null;
      provider_invoice: string | null;
      provider_invoice_status: string | null;
    }>(`
      SELECT
        to_regclass('"EmailProviderEventInbox"')::text AS email_inbox,
        enum_range(NULL::"PaymentEventKind")::text AS event_kind,
        to_regtype('"PaymentRuntimeMode"')::text AS payment_mode,
        to_regclass('"PaymentPriceBinding"')::text AS price_binding,
        to_regclass('"SubscriptionProviderInvoice"')::text AS provider_invoice,
        to_regtype('"SubscriptionProviderInvoiceStatus"')::text AS provider_invoice_status
    `);
    expect(installed.rows[0]).toMatchObject({
      email_inbox: '"EmailProviderEventInbox"',
      payment_mode: '"PaymentRuntimeMode"',
      price_binding: '"PaymentPriceBinding"',
      provider_invoice: '"SubscriptionProviderInvoice"',
      provider_invoice_status: '"SubscriptionProviderInvoiceStatus"',
    });
    expect(installed.rows[0]!.event_kind).toContain("RENEWAL_PAID");
    expect(installed.rows[0]!.event_kind).toContain("RENEWAL_FAILED");

    const upgradedSession = await fixture.pool.query<{
      pendingTokenExpiresAt: Date | null;
      pendingTokenHash: string | null;
      previousTokenExpiresAt: Date | null;
      previousTokenHash: string | null;
      tokenHash: string;
    }>(
      `
        SELECT "tokenHash", "pendingTokenHash", "pendingTokenExpiresAt",
               "previousTokenHash", "previousTokenExpiresAt"
        FROM "Session"
        WHERE "id" = $1
      `,
      [LEGACY_SESSION_ID],
    );
    expect(upgradedSession.rows).toEqual([
      {
        tokenHash: LEGACY_SESSION_HASH,
        pendingTokenHash: null,
        pendingTokenExpiresAt: null,
        previousTokenHash: null,
        previousTokenExpiresAt: null,
      },
    ]);

    const sessionBackstops = await fixture.pool.query<{ name: string }>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid = '"Session"'::regclass
        AND conname IN (
          'session_current_token_hash_shape_check',
          'session_pending_token_shape_check',
          'session_previous_token_shape_check'
        )
      UNION ALL
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'Session'
        AND indexname IN (
          'session_pending_token_hash_key',
          'session_previous_token_hash_key',
          'Session_pendingTokenHash_pendingTokenExpiresAt_idx',
          'Session_previousTokenHash_previousTokenExpiresAt_idx'
        )
      ORDER BY name
    `);
    expect(sessionBackstops.rows.map(({ name }) => name)).toEqual([
      "Session_pendingTokenHash_pendingTokenExpiresAt_idx",
      "Session_previousTokenHash_previousTokenExpiresAt_idx",
      "session_current_token_hash_shape_check",
      "session_pending_token_hash_key",
      "session_pending_token_shape_check",
      "session_previous_token_hash_key",
      "session_previous_token_shape_check",
    ]);

    await expect(
      fixture.pool.query(
        `UPDATE "Session" SET "pendingTokenHash" = $2 WHERE "id" = $1`,
        [LEGACY_SESSION_ID, "2".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      fixture.pool.query(
        `
          UPDATE "Session"
          SET "pendingTokenHash" = "tokenHash",
              "pendingTokenExpiresAt" = "expiresAt"
          WHERE "id" = $1
        `,
        [LEGACY_SESSION_ID],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      fixture.pool.query(
        `
          UPDATE "Session"
          SET "pendingTokenHash" = $2,
              "pendingTokenExpiresAt" = "absoluteExpiresAt"
          WHERE "id" = $1
        `,
        [LEGACY_SESSION_ID, "2".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await fixture.pool.query(
      `
        UPDATE "Session"
        SET "pendingTokenHash" = $2,
            "pendingTokenExpiresAt" = "expiresAt"
        WHERE "id" = $1
      `,
      [LEGACY_SESSION_ID, "2".repeat(64)],
    );
    await fixture.pool.query(
      `
        INSERT INTO "Session" (
          "id", "userId", "tokenHash", "createdAt", "expiresAt",
          "absoluteExpiresAt"
        ) VALUES (
          '33000000-0000-4000-8000-000000000003', $1, $2,
          '2026-07-31T10:00:00.000Z', '2026-08-07T10:00:00.000Z',
          '2026-08-30T10:00:00.000Z'
        )
      `,
      [LEGACY_USER_ID, "3".repeat(64)],
    );
    await expect(
      fixture.pool.query(
        `
          UPDATE "Session"
          SET "pendingTokenHash" = $1,
              "pendingTokenExpiresAt" = "expiresAt"
          WHERE "id" = '33000000-0000-4000-8000-000000000003'
        `,
        ["2".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const orderingBackstops = await fixture.pool.query<{ name: string }>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname IN (
        'SubscriptionProviderInvoice_paymentAttemptId_companyId_fkey',
        'payment_attempt_provider_ordering_check',
        'subscription_provider_invoice_projection_check'
      )
      UNION ALL
      SELECT tgname AS name
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname = 'phase33_subscription_provider_invoice_guard'
      UNION ALL
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'PaymentAttempt_id_companyId_key',
          'subscription_provider_invoice_provider_scope_key'
        )
      ORDER BY name
    `);
    expect(orderingBackstops.rows.map(({ name }) => name)).toEqual([
      "PaymentAttempt_id_companyId_key",
      "SubscriptionProviderInvoice_paymentAttemptId_companyId_fkey",
      "payment_attempt_provider_ordering_check",
      "phase33_subscription_provider_invoice_guard",
      "subscription_provider_invoice_projection_check",
      "subscription_provider_invoice_provider_scope_key",
    ]);

    await expect(fixture.migrate()).resolves.toBeUndefined();
    const after = await fixture.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ProviderEventInbox" WHERE "providerEventId" = $1`,
      [LEGACY_EVENT_ID],
    );
    expect(after.rows).toEqual([{ count: "1" }]);
  });
});

function requireFixture() {
  if (migrated === undefined) {
    throw new Error("Phase-33 payment upgrade fixture is unavailable.");
  }
  return migrated;
}
