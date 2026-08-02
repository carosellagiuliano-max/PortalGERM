import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  maintainNotificationPrivacyRetention,
  notificationAttemptEvidenceRetainUntil,
  NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS,
} from "@/lib/notifications/retention";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const PRE_PHASE33_MIGRATION = "20260730120000_phase_31_commercial_validation";
const DAY_MILLISECONDS = 24 * 60 * 60_000;
const FIXTURE_CREATED_AT = new Date();
const LEGACY_RECENT_COMPLETED_AT = new Date(
  FIXTURE_CREATED_AT.getTime() - DAY_MILLISECONDS,
);
const LEGACY_EXPIRED_COMPLETED_AT = new Date(
  FIXTURE_CREATED_AT.getTime() -
    NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS -
    DAY_MILLISECONDS,
);
const LEGACY_RECENT_OUTBOX_ID = randomUUID();
const LEGACY_EXPIRED_OUTBOX_ID = randomUUID();
const DUE_OUTBOX_ID = randomUUID();
const LOCKED_OUTBOX_ID = randomUUID();
const FUTURE_OUTBOX_ID = randomUUID();
const RESTORE_OUTBOX_ID = randomUUID();
const LEGACY_RECENT_ATTEMPT_ID = randomUUID();
const LEGACY_EXPIRED_ATTEMPT_ID = randomUUID();

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let providerActivationId: string | undefined;
let migrationStartedAt: Date | undefined;
let migrationFinishedAt: Date | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase33_notification_attempt_retention",
    { throughMigration: PRE_PHASE33_MIGRATION },
  );
  for (const outboxId of [
    LEGACY_RECENT_OUTBOX_ID,
    LEGACY_EXPIRED_OUTBOX_ID,
    DUE_OUTBOX_ID,
    LOCKED_OUTBOX_ID,
    FUTURE_OUTBOX_ID,
    RESTORE_OUTBOX_ID,
  ]) {
    await insertLegacyOutbox(migrated, outboxId);
  }
  await insertLegacyAttempt(migrated, {
    attemptId: LEGACY_RECENT_ATTEMPT_ID,
    completedAt: LEGACY_RECENT_COMPLETED_AT,
    outboxId: LEGACY_RECENT_OUTBOX_ID,
    providerReceipt: "legacy_recent_receipt",
  });
  await insertLegacyAttempt(migrated, {
    attemptId: LEGACY_EXPIRED_ATTEMPT_ID,
    completedAt: LEGACY_EXPIRED_COMPLETED_AT,
    outboxId: LEGACY_EXPIRED_OUTBOX_ID,
    providerReceipt: "legacy_expired_receipt",
  });

  migrationStartedAt = new Date();
  await migrated.migrate();
  migrationFinishedAt = new Date();
  database = createDatabaseClient(migrated.connectionString);
  providerActivationId = await createProviderActivation(migrated);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase-33 notification-attempt evidence retention", () => {
  it("finitely backfills exactly 400 days and compacts already-expired upgrade evidence", async () => {
    const fixture = requireFixture();
    const catalog = await fixture.pool.query<{ name: string }>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname = 'notification_attempt_evidence_retention_check'
      UNION ALL
      SELECT tgname AS name
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'phase33_notification_attempt_insert_guard',
          'phase33_notification_attempt_append_only_guard'
        )
      UNION ALL
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'notification_attempt_evidence_retention_idx'
      ORDER BY name
    `);
    expect(new Set(catalog.rows.map(({ name }) => name))).toEqual(
      new Set([
        "notification_attempt_evidence_retention_check",
        "notification_attempt_evidence_retention_idx",
        "phase33_notification_attempt_append_only_guard",
        "phase33_notification_attempt_insert_guard",
      ]),
    );

    const attempts = await fixture.pool.query<AttemptEvidenceRow>(
      `
        SELECT
          "id", "outboxId", "providerClass", "outcome"::text,
          "providerReceipt", "providerRequestDigest", "recipientHash",
          "recipientHashKeyVersion", "recipientEvidenceRetainUntil",
          "recipientEvidenceWipedAt"
        FROM "NotificationDeliveryAttempt"
        WHERE "id" = ANY($1::uuid[])
        ORDER BY "id"
      `,
      [[LEGACY_RECENT_ATTEMPT_ID, LEGACY_EXPIRED_ATTEMPT_ID]],
    );
    const byId = new Map(attempts.rows.map((row) => [row.id, row]));
    expect(byId.get(LEGACY_RECENT_ATTEMPT_ID)).toMatchObject({
      outboxId: LEGACY_RECENT_OUTBOX_ID,
      outcome: "ACCEPTED",
      providerClass: "legacy-mock",
      providerReceipt: "legacy_recent_receipt",
      providerRequestDigest: null,
      recipientHash: null,
      recipientHashKeyVersion: null,
      recipientEvidenceRetainUntil: notificationAttemptEvidenceRetainUntil(
        LEGACY_RECENT_COMPLETED_AT,
      ),
      recipientEvidenceWipedAt: null,
    });

    const expired = byId.get(LEGACY_EXPIRED_ATTEMPT_ID);
    expect(expired).toMatchObject({
      outboxId: LEGACY_EXPIRED_OUTBOX_ID,
      outcome: "ACCEPTED",
      providerClass: "legacy-mock",
      providerReceipt: null,
      providerRequestDigest: null,
      recipientHash: null,
      recipientHashKeyVersion: null,
      recipientEvidenceRetainUntil: notificationAttemptEvidenceRetainUntil(
        LEGACY_EXPIRED_COMPLETED_AT,
      ),
    });
    expect(expired?.recipientEvidenceWipedAt?.getTime()).toBeGreaterThanOrEqual(
      requireMigrationTime(migrationStartedAt).getTime(),
    );
    expect(expired?.recipientEvidenceWipedAt?.getTime()).toBeLessThanOrEqual(
      requireMigrationTime(migrationFinishedAt).getTime(),
    );
  });

  it("requires an exact finite 400-day contract on every new attempt", async () => {
    const fixture = requireFixture();
    const completedAt = new Date();
    const exactDeadline = notificationAttemptEvidenceRetainUntil(completedAt);

    await expectPgConstraint(
      insertAcceptedAttempt(fixture, {
        attemptId: randomUUID(),
        completedAt,
        outboxId: FUTURE_OUTBOX_ID,
        retainUntil: new Date(exactDeadline.getTime() + 1),
      }),
      "notification_delivery_attempt_retention_contract_required",
    );
    await expectPgConstraint(
      insertAcceptedAttempt(fixture, {
        attemptId: randomUUID(),
        completedAt,
        outboxId: FUTURE_OUTBOX_ID,
        retainUntil: exactDeadline,
        wipedAt: completedAt,
      }),
      "notification_delivery_attempt_retention_contract_required",
    );

    const attemptId = randomUUID();
    await expect(
      insertAcceptedAttempt(fixture, {
        attemptId,
        completedAt,
        outboxId: FUTURE_OUTBOX_ID,
        retainUntil: exactDeadline,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationDeliveryAttempt" SET "recipientHash" = NULL WHERE "id" = $1`,
        [attemptId],
      ),
      "notification_delivery_attempt_append_only",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `
          UPDATE "NotificationDeliveryAttempt"
          SET "providerReceipt" = NULL,
              "providerRequestDigest" = NULL,
              "recipientHash" = NULL,
              "recipientHashKeyVersion" = NULL,
              "recipientEvidenceWipedAt" = CURRENT_TIMESTAMP
          WHERE "id" = $1
        `,
        [attemptId],
      ),
      "notification_delivery_attempt_append_only",
    );
  });

  it("does not wipe before the deadline, then atomically compacts once and preserves the audit chain", async () => {
    const fixture = requireFixture();
    const client = requireDatabase();
    const completedAt = new Date(
      Date.now() -
        NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS -
        60_000,
    );
    const retainUntil = notificationAttemptEvidenceRetainUntil(completedAt);
    const attemptId = randomUUID();
    await insertAcceptedAttempt(fixture, {
      attemptId,
      completedAt,
      outboxId: DUE_OUTBOX_ID,
      retainUntil,
    });

    const beforeDeadline = await maintainNotificationPrivacyRetention(
      client,
      new Date(retainUntil.getTime() - 1),
    );
    expect(beforeDeadline.attemptEvidenceWiped).toBe(0);
    await expect(readAttempt(fixture, attemptId)).resolves.toMatchObject({
      providerReceipt: expect.any(String),
      providerRequestDigest: "b".repeat(64),
      recipientHash: "c".repeat(64),
      recipientHashKeyVersion: "recipient-hmac-v1",
      recipientEvidenceWipedAt: null,
    });

    const afterDeadline = new Date();
    const first = await maintainNotificationPrivacyRetention(
      client,
      afterDeadline,
    );
    const sweepFinishedAt = new Date();
    expect(first.attemptEvidenceWiped).toBe(1);
    const wiped = await readAttempt(fixture, attemptId);
    expect(wiped).toMatchObject({
      id: attemptId,
      outboxId: DUE_OUTBOX_ID,
      outcome: "ACCEPTED",
      providerActivationId: requireActivationId(),
      providerClass: "resend-contract",
      providerReceipt: null,
      providerRequestDigest: null,
      recipientHash: null,
      recipientHashKeyVersion: null,
      recipientEvidenceRetainUntil: retainUntil,
    });
    expect(wiped?.recipientEvidenceWipedAt?.getTime()).toBeGreaterThanOrEqual(
      afterDeadline.getTime(),
    );
    expect(wiped?.recipientEvidenceWipedAt?.getTime()).toBeLessThanOrEqual(
      sweepFinishedAt.getTime(),
    );

    const second = await maintainNotificationPrivacyRetention(
      client,
      new Date(afterDeadline.getTime() + 1),
    );
    expect(second.attemptEvidenceWiped).toBe(0);
  });

  it("prioritizes unknown-provider reconciliation when an explicit recipient expires after a request was frozen", async () => {
    const fixture = requireFixture();
    const client = requireDatabase();
    const now = new Date();
    const createdAt = new Date(now.getTime() - 120_000);
    const recipientExpiresAt = new Date(now.getTime() - 60_000);
    const outboxId = randomUUID();
    const token = randomUUID();
    await fixture.pool.query(
      `
        INSERT INTO "NotificationOutbox" (
          "id", "recipientAddressCiphertext", "recipientAddressNonce",
          "recipientAddressTag", "recipientAddressKeyVersion",
          "recipientAddressBindingVersion", "recipientAddressDigest",
          "recipientAddressDigestKeyVersion", "recipientAddressExpiresAt",
          "purpose", "purposeClass", "channel", "templateKey",
          "payloadSchemaVersion", "payload", "dedupeKey",
          "providerDedupeKey", "providerRequestActivationId",
          "providerRequestCiphertext", "providerRequestNonce",
          "providerRequestTag", "providerRequestKeyVersion",
          "providerRequestDigest", "providerRequestCreatedAt", "status",
          "availableAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, 'delivery-v1', 'v2', $5, 'recipient-hmac-v1',
          $6, 'PRIVACY_REQUEST', 'MANDATORY', 'EMAIL',
          'privacy-erasure-success', 'phase33-v1', '{}'::jsonb, $7, $8,
          $9, $10, $11, $12, 'delivery-v1', $13, $14, 'PENDING', $15, $15,
          $15
        )
      `,
      [
        outboxId,
        Buffer.alloc(32, 10),
        Buffer.alloc(12, 11),
        Buffer.alloc(16, 12),
        "a".repeat(64),
        recipientExpiresAt,
        `phase33:recipient-provider-expiry:${token}`,
        `sth-phase33-recipient-provider-expiry-${token}`,
        requireActivationId(),
        Buffer.alloc(64, 13),
        Buffer.alloc(12, 14),
        Buffer.alloc(16, 15),
        "b".repeat(64),
        createdAt,
        createdAt,
      ],
    );

    const result = await maintainNotificationPrivacyRetention(client, now);
    expect(result).toMatchObject({
      pausedRequests: 1,
      suppressedRecipients: 0,
    });
    await expect(
      fixture.pool.query<{
        lastErrorCode: string;
        providerRequestCiphertext: Buffer | null;
        recipientAddressCiphertext: Buffer | null;
        status: string;
      }>(
        `
          SELECT
            "status"::text, "lastErrorCode", "providerRequestCiphertext",
            "recipientAddressCiphertext"
          FROM "NotificationOutbox"
          WHERE "id" = $1
        `,
        [outboxId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          lastErrorCode: "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
          providerRequestCiphertext: null,
          recipientAddressCiphertext: null,
          status: "PAUSED",
        },
      ],
    });
  });

  it("skips a concurrently claimed/live lease and compacts after lease expiry", async () => {
    const fixture = requireFixture();
    const client = requireDatabase();
    const completedAt = new Date(
      Date.now() -
        NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS -
        60_000,
    );
    const attemptId = randomUUID();
    await insertAcceptedAttempt(fixture, {
      attemptId,
      completedAt,
      outboxId: LOCKED_OUTBOX_ID,
      retainUntil: notificationAttemptEvidenceRetainUntil(completedAt),
    });

    const claim = await fixture.pool.connect();
    try {
      await claim.query("BEGIN");
      await claim.query(
        `
          UPDATE "NotificationOutbox"
          SET "status" = 'LEASED', "leaseOwner" = 'concurrent-worker',
              "leaseExpiresAt" = $2, "updatedAt" = $1
          WHERE "id" = $3
        `,
        [new Date(), new Date(Date.now() + 60_000), LOCKED_OUTBOX_ID],
      );
      const whileClaimLocked = await maintainNotificationPrivacyRetention(
        client,
        new Date(),
      );
      expect(whileClaimLocked.attemptEvidenceWiped).toBe(0);
      await claim.query("COMMIT");
    } finally {
      await claim.query("ROLLBACK").catch(() => undefined);
      claim.release();
    }

    await expect(readAttempt(fixture, attemptId)).resolves.toMatchObject({
      providerReceipt: expect.any(String),
      recipientEvidenceWipedAt: null,
    });
    const reclaimedAt = new Date();
    await fixture.pool.query(
      `
        UPDATE "NotificationOutbox"
        SET "leaseExpiresAt" = $2, "updatedAt" = $2
        WHERE "id" = $1
      `,
      [LOCKED_OUTBOX_ID, new Date(reclaimedAt.getTime() - 1)],
    );
    const afterLease = await maintainNotificationPrivacyRetention(
      client,
      reclaimedAt,
    );
    const reclaimedFinishedAt = new Date();
    expect(afterLease.attemptEvidenceWiped).toBe(1);
    const reclaimed = await readAttempt(fixture, attemptId);
    expect(reclaimed).toMatchObject({
      providerReceipt: null,
      recipientHash: null,
    });
    expect(
      reclaimed?.recipientEvidenceWipedAt?.getTime(),
    ).toBeGreaterThanOrEqual(reclaimedAt.getTime());
    expect(reclaimed?.recipientEvidenceWipedAt?.getTime()).toBeLessThanOrEqual(
      reclaimedFinishedAt.getTime(),
    );
  });

  it("forbids restoration, later mutation and deletion after compaction", async () => {
    const fixture = requireFixture();
    const client = requireDatabase();
    const completedAt = new Date(
      Date.now() -
        NOTIFICATION_ATTEMPT_EVIDENCE_RETENTION_MILLISECONDS -
        60_000,
    );
    const attemptId = randomUUID();
    await insertAcceptedAttempt(fixture, {
      attemptId,
      completedAt,
      outboxId: RESTORE_OUTBOX_ID,
      retainUntil: notificationAttemptEvidenceRetainUntil(completedAt),
    });
    await maintainNotificationPrivacyRetention(client, new Date());

    await expectPgConstraint(
      fixture.pool.query(
        `
          UPDATE "NotificationDeliveryAttempt"
          SET "providerReceipt" = 'restored-receipt',
              "providerRequestDigest" = $2,
              "recipientHash" = $3,
              "recipientHashKeyVersion" = 'recipient-hmac-v1',
              "recipientEvidenceWipedAt" = NULL
          WHERE "id" = $1
        `,
        [attemptId, "b".repeat(64), "c".repeat(64)],
      ),
      "notification_delivery_attempt_evidence_destroyed",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationDeliveryAttempt" SET "providerClass" = 'mutated' WHERE "id" = $1`,
        [attemptId],
      ),
      "notification_delivery_attempt_evidence_destroyed",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `DELETE FROM "NotificationDeliveryAttempt" WHERE "id" = $1`,
        [attemptId],
      ),
      "notification_delivery_attempt_append_only",
    );
  });

  it("fails an upgrade instead of inventing a finite deadline for non-finite legacy evidence", async () => {
    const invalid = await createMigratedTestDatabase(
      "phase33_notification_attempt_nonfinite_upgrade",
      { throughMigration: PRE_PHASE33_MIGRATION },
    );
    try {
      const outboxId = randomUUID();
      await insertLegacyOutbox(invalid, outboxId);
      await invalid.pool.query(
        `
          INSERT INTO "NotificationDeliveryAttempt" (
            "id", "outboxId", "attemptNumber", "leaseOwner",
            "leaseExpiresAt", "providerClass", "outcome", "providerReceipt",
            "startedAt", "completedAt"
          ) VALUES (
            $1, $2, 1, 'legacy-worker', CURRENT_TIMESTAMP, 'legacy-mock',
            'ACCEPTED', 'nonfinite-receipt', CURRENT_TIMESTAMP, 'infinity'
          )
        `,
        [randomUUID(), outboxId],
      );
      const migrationSql = await readFile(
        resolve(
          process.cwd(),
          "prisma/migrations/20260801090000_phase_33_payment_provider_bindings/migration.sql",
        ),
        "utf8",
      );
      await expectPgConstraint(
        invalid.pool.query(migrationSql),
        "notification_delivery_attempt_retention_upgrade",
      );
    } finally {
      await invalid.dispose();
    }
  }, 600_000);
});

type AttemptEvidenceRow = Readonly<{
  id: string;
  outboxId: string;
  outcome: string;
  providerActivationId?: string;
  providerClass: string;
  providerReceipt: string | null;
  providerRequestDigest: string | null;
  recipientHash: string | null;
  recipientHashKeyVersion: string | null;
  recipientEvidenceRetainUntil: Date;
  recipientEvidenceWipedAt: Date | null;
}>;

async function insertLegacyOutbox(fixture: MigratedDatabase, outboxId: string) {
  const token = randomUUID();
  await fixture.pool.query(
    `
      INSERT INTO "NotificationOutbox" (
        "id", "recipientAddressCiphertext", "recipientAddressNonce",
        "recipientAddressTag", "recipientAddressKeyVersion", "purpose",
        "purposeClass", "channel", "templateKey", "payloadSchemaVersion",
        "payload", "dedupeKey", "providerDedupeKey", "status",
        "availableAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, 'legacy-v1', 'PRIVACY_REQUEST', 'MANDATORY',
        'EMAIL', 'privacy-erasure-success', 'phase33-v1', '{}'::jsonb,
        $5, $6, 'PENDING', $7, $7, $7
      )
    `,
    [
      outboxId,
      Buffer.alloc(32, 1),
      Buffer.alloc(12, 2),
      Buffer.alloc(16, 3),
      `phase33:attempt-retention:${token}`,
      `sth-phase33-attempt-retention-${token}`,
      FIXTURE_CREATED_AT,
    ],
  );
}

async function insertLegacyAttempt(
  fixture: MigratedDatabase,
  input: Readonly<{
    attemptId: string;
    completedAt: Date;
    outboxId: string;
    providerReceipt: string;
  }>,
) {
  await fixture.pool.query(
    `
      INSERT INTO "NotificationDeliveryAttempt" (
        "id", "outboxId", "attemptNumber", "leaseOwner", "leaseExpiresAt",
        "providerClass", "outcome", "providerReceipt", "startedAt",
        "completedAt"
      ) VALUES (
        $1, $2, 1, 'legacy-worker', $3, 'legacy-mock', 'ACCEPTED', $4,
        $5, $6
      )
    `,
    [
      input.attemptId,
      input.outboxId,
      new Date(input.completedAt.getTime() + 60_000),
      input.providerReceipt,
      new Date(input.completedAt.getTime() - 1_000),
      input.completedAt,
    ],
  );
}

async function createProviderActivation(fixture: MigratedDatabase) {
  const id = randomUUID();
  await fixture.pool.query(
    `
      INSERT INTO "ProviderActivation" (
        "id", "environment", "useCase", "adapterKey", "adapterVersion",
        "mode", "configurationDigest", "evidenceDigest", "owner",
        "runbookRef", "health", "killSwitchEngaged", "updatedAt"
      ) VALUES (
        $1, 'ci', $2, 'resend_contract', 'v1', 'DISABLED', $3, $4,
        'Phase 33 attempt-retention test',
        'codex-plan/runbooks/worker-operations.md', 'UNKNOWN', true,
        CURRENT_TIMESTAMP
      )
    `,
    [
      id,
      `email.delivery.attempt-retention.${randomUUID()}`,
      "d".repeat(64),
      "e".repeat(64),
    ],
  );
  return id;
}

async function insertAcceptedAttempt(
  fixture: MigratedDatabase,
  input: Readonly<{
    attemptId: string;
    completedAt: Date;
    outboxId: string;
    retainUntil: Date;
    wipedAt?: Date;
  }>,
) {
  return fixture.pool.query(
    `
      INSERT INTO "NotificationDeliveryAttempt" (
        "id", "outboxId", "attemptNumber", "leaseOwner", "leaseExpiresAt",
        "providerClass", "outcome", "providerReceipt",
        "providerActivationId", "providerRequestDigest", "recipientHash",
        "recipientHashKeyVersion", "recipientEvidenceRetainUntil",
        "recipientEvidenceWipedAt", "startedAt", "completedAt"
      ) VALUES (
        $1, $2, 1, 'phase33-retention-worker', $3, 'resend-contract',
        'ACCEPTED', $4, $5, $6, $7, 'recipient-hmac-v1', $8, $9, $10, $11
      )
    `,
    [
      input.attemptId,
      input.outboxId,
      new Date(input.completedAt.getTime() + 60_000),
      `email_${input.attemptId}`,
      requireActivationId(),
      "b".repeat(64),
      "c".repeat(64),
      input.retainUntil,
      input.wipedAt ?? null,
      new Date(input.completedAt.getTime() - 1_000),
      input.completedAt,
    ],
  );
}

async function readAttempt(fixture: MigratedDatabase, attemptId: string) {
  const result = await fixture.pool.query<AttemptEvidenceRow>(
    `
      SELECT
        "id", "outboxId", "providerClass", "outcome"::text,
        "providerActivationId", "providerReceipt", "providerRequestDigest",
        "recipientHash", "recipientHashKeyVersion",
        "recipientEvidenceRetainUntil", "recipientEvidenceWipedAt"
      FROM "NotificationDeliveryAttempt"
      WHERE "id" = $1
    `,
    [attemptId],
  );
  return result.rows[0];
}

async function expectPgConstraint(
  operation: Promise<unknown>,
  constraint: string,
  code = "23514",
) {
  await expect(operation).rejects.toMatchObject({ code, constraint });
}

function requireFixture() {
  if (migrated === undefined) {
    throw new Error("Phase-33 attempt-retention fixture is unavailable.");
  }
  return migrated;
}

function requireDatabase() {
  if (database === undefined) {
    throw new Error("Phase-33 attempt-retention database is unavailable.");
  }
  return database;
}

function requireActivationId() {
  if (providerActivationId === undefined) {
    throw new Error("Phase-33 attempt-retention activation is unavailable.");
  }
  return providerActivationId;
}

function requireMigrationTime(value: Date | undefined) {
  if (value === undefined) {
    throw new Error(
      "Phase-33 attempt-retention migration time is unavailable.",
    );
  }
  return value;
}
