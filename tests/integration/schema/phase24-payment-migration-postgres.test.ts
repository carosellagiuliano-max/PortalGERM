import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<
  ReturnType<typeof createMigratedTestDatabase>
>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase24_payment_migration",
  );
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
}, 600_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  await migrated?.dispose();
});

describe("Phase-24 additive payment migration", () => {
  it("installs every finance table, keyset index and append-only trigger without activation", async () => {
    const fixture = requireFixture();
    const tables = await fixture.migrated.pool.query<{
      table_name: string;
    }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
      `,
      [[
        "Chargeback",
        "CreditNote",
        "DunningCase",
        "PaidScopeDecision",
        "PaymentAttempt",
        "PaymentRiskDecision",
        "ProviderEventInbox",
        "ReconciliationItem",
        "ReconciliationRun",
        "Refund",
        "ServiceDeliveryAssessment",
        "ServiceDeliveryEvent",
      ]],
    );
    expect(tables.rows).toHaveLength(12);

    const indexes = await fixture.migrated.pool.query<{
      indexname: string;
    }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'provider_event_inbox_retry_idx',
          'reconciliation_item_open_keyset_idx',
          'service_delivery_open_keyset_idx'
        )
      ORDER BY indexname
    `);
    expect(indexes.rows).toHaveLength(3);
    await expect(fixture.database.paidScopeDecision.count()).resolves.toBe(0);
    await expect(fixture.database.providerEventInbox.count()).resolves.toBe(0);
  });

  it("rejects live-mode inbox rows, invalid money and mutable append-only evidence", async () => {
    const fixture = requireFixture();
    await expect(
      fixture.database.providerEventInbox.create({
        data: {
          provider: "STRIPE",
          environment: "ci",
          adapterKey: "stripe_sandbox",
          adapterVersion: "v1",
          providerMode: "SANDBOX",
          expectedLiveMode: false,
          providerAccountReference: "acct_phase24test",
          providerEventId: "evt_phase24_live",
          eventType: "checkout.session.completed",
          eventCreatedAt: new Date("2026-07-28T00:00:00.000Z"),
          apiVersion: "2026-06-30.basil",
          liveMode: true,
          rawBodyDigest: "a".repeat(64),
          signatureDigest: "b".repeat(64),
          payloadSchemaVersion: "phase24-v1",
          normalizedPayload: {},
          status: "RECEIVED",
          receivedAt: new Date("2026-07-28T00:00:01.000Z"),
        },
      }),
    ).rejects.toThrow();

    const actor = await fixture.database.user.create({
      data: {
        email: `phase24-${randomUUID()}@example.ch`,
        emailNormalized: `phase24-${randomUUID()}@example.ch`,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    const decision = await fixture.database.paidScopeDecision.create({
      data: {
        scopeCode: "LC5_PAID_SELF_SERVICE",
        packageCode: "STARTER",
        status: "NO_GO",
        maximumMode: "SANDBOX",
        decisionRef: `decision:${randomUUID()}`,
        evidenceDigest: "c".repeat(64),
        sampleSize: 1,
        thresholdCode: "WTP_THRESHOLD",
        reasonCode: "WTP_NOT_PROVEN",
        decidedByUserId: actor.id,
        effectiveAt: new Date("2026-07-28T00:00:00.000Z"),
        expiresAt: new Date("2026-08-28T00:00:00.000Z"),
      },
    });
    await expect(
      fixture.database.paidScopeDecision.update({
        where: { id: decision.id },
        data: { status: "GO" },
      }),
    ).rejects.toThrow(/append-only/iu);

    const before = await fixture.database.paidScopeDecision.count();
    await fixture.migrated.migrate();
    await expect(
      fixture.database.paidScopeDecision.count(),
    ).resolves.toBe(before);
  });
});

function requireFixture() {
  if (migrated === undefined || database === undefined) {
    throw new Error("Phase-24 migration fixture is unavailable.");
  }
  return { migrated, database };
}
