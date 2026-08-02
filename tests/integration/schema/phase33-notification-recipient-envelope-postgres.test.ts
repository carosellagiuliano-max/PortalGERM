import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const PRE_PHASE33_MIGRATION = "20260730120000_phase_31_commercial_validation";
const LEGACY_OUTBOX_ID = "63a032bb-46c1-4fd6-970b-f627ea01a547";
const LEGACY_ATTEMPT_ID = "361b763c-36e7-4c12-95ac-c968275774f7";
const LEGACY_SUPPRESSION_ID = "b4f0884e-a72d-43e8-85c3-5cfb037da305";
const LEGACY_SUPPRESSION_HASH = "f".repeat(64);
const LEGACY_CREATED_AT = new Date("2026-07-01T00:00:00.000Z");
const LEGACY_CAPPED_EXPIRY = new Date("2026-08-01T00:00:00.000Z");

let migrated: MigratedDatabase | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase33_notification_recipient_envelope",
    { throughMigration: PRE_PHASE33_MIGRATION },
  );
  await migrated.pool.query(
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
        'phase33:recipient:legacy', 'sth-phase33-recipient-legacy', 'PENDING',
        '9999-12-31T00:00:00.000Z', $5, $5
      )
    `,
    [
      LEGACY_OUTBOX_ID,
      Buffer.from("legacy-recipient@example.test", "utf8"),
      Buffer.alloc(12, 1),
      Buffer.alloc(16, 2),
      LEGACY_CREATED_AT,
    ],
  );
  await migrated.pool.query(
    `
      INSERT INTO "NotificationDeliveryAttempt" (
        "id", "outboxId", "attemptNumber", "leaseOwner", "leaseExpiresAt",
        "providerClass", "outcome", "startedAt", "completedAt"
      ) VALUES (
        $1, $2, 1, 'legacy-phase20-worker',
        '2026-07-01T00:01:00.000Z', 'legacy-mock', 'ACCEPTED',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:01.000Z'
      )
    `,
    [LEGACY_ATTEMPT_ID, LEGACY_OUTBOX_ID],
  );
  await migrated.pool.query(
    `
      INSERT INTO "NotificationSuppression" (
        "id", "recipientHash", "reason", "source"
      ) VALUES ($1, $2, 'MANUAL_SECURITY', 'phase33-upgrade-fixture')
    `,
    [LEGACY_SUPPRESSION_ID, LEGACY_SUPPRESSION_HASH],
  );
  await migrated.migrate();
}, 600_000);

afterAll(async () => {
  await migrated?.dispose();
});

describe("Phase-33 NotificationOutbox recipient-envelope database contract", () => {
  it("installs the strict shape, guard and retention index and finitely backfills legacy rows", async () => {
    const fixture = requireFixture();
    const catalog = await fixture.pool.query<{ name: string }>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname = 'notification_outbox_recipient_shape'
      UNION ALL
      SELECT tgname AS name
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'phase33_email_provider_event_identity_guard',
          'phase33_notification_attempt_append_only_guard',
          'phase33_notification_attempt_insert_guard',
          'phase33_notification_recipient_envelope_guard',
          'phase33_notification_suppression_guard'
        )
      UNION ALL
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'NotificationOutbox_recipientAddressDestroyedAt_status_createdAt_idx',
          'notification_suppression_active_recipient_unique'
        )
      UNION ALL
      SELECT table_name || '.' || column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'recipientHashKeyVersion'
        AND table_name IN (
          'NotificationDeliveryAttempt',
          'NotificationSuppression'
        )
      ORDER BY name
    `);
    expect(new Set(catalog.rows.map(({ name }) => name))).toEqual(
      new Set([
        "NotificationDeliveryAttempt.recipientHashKeyVersion",
        "NotificationOutbox_recipientAddressDestroyedAt_status_createdAt",
        "NotificationSuppression.recipientHashKeyVersion",
        "notification_outbox_recipient_shape",
        "notification_suppression_active_recipient_unique",
        "phase33_email_provider_event_identity_guard",
        "phase33_notification_attempt_append_only_guard",
        "phase33_notification_attempt_insert_guard",
        "phase33_notification_recipient_envelope_guard",
        "phase33_notification_suppression_guard",
      ]),
    );

    const legacy = await fixture.pool.query<{
      bindingVersion: string | null;
      destroyedAt: Date | null;
      digest: string | null;
      digestKeyVersion: string | null;
      expiresAt: Date;
      finite: boolean;
    }>(
      `
        SELECT
          "recipientAddressBindingVersion" AS "bindingVersion",
          "recipientAddressDigest" AS digest,
          "recipientAddressDigestKeyVersion" AS "digestKeyVersion",
          "recipientAddressExpiresAt" AS "expiresAt",
          "recipientAddressDestroyedAt" AS "destroyedAt",
          isfinite("recipientAddressExpiresAt") AS finite
        FROM "NotificationOutbox"
        WHERE "id" = $1
      `,
      [LEGACY_OUTBOX_ID],
    );
    expect(legacy.rows).toEqual([
      {
        bindingVersion: null,
        destroyedAt: null,
        digest: null,
        digestKeyVersion: null,
        expiresAt: LEGACY_CAPPED_EXPIRY,
        finite: true,
      },
    ]);

    const legacyAttempt = await fixture.pool.query<{
      providerActivationId: string | null;
      providerRequestDigest: string | null;
      recipientHash: string | null;
      recipientHashKeyVersion: string | null;
    }>(
      `
        SELECT
          "providerActivationId", "providerRequestDigest", "recipientHash",
          "recipientHashKeyVersion"
        FROM "NotificationDeliveryAttempt"
        WHERE "id" = $1
      `,
      [LEGACY_ATTEMPT_ID],
    );
    expect(legacyAttempt.rows).toEqual([
      {
        providerActivationId: null,
        providerRequestDigest: null,
        recipientHash: null,
        recipientHashKeyVersion: null,
      },
    ]);

    const legacySuppression = await fixture.pool.query<{
      recipientHash: string;
      recipientHashKeyVersion: string | null;
    }>(
      `
        SELECT "recipientHash", "recipientHashKeyVersion"
        FROM "NotificationSuppression"
        WHERE "id" = $1
      `,
      [LEGACY_SUPPRESSION_ID],
    );
    expect(legacySuppression.rows).toEqual([
      {
        recipientHash: LEGACY_SUPPRESSION_HASH,
        recipientHashKeyVersion: null,
      },
    ]);
  });

  it("requires complete immutable provider evidence for every new accepted attempt", async () => {
    const fixture = requireFixture();
    const outbox = validEnvelope();
    await insertExplicitEnvelope(fixture, outbox);

    await expectPgConstraint(
      insertAcceptedAttempt(fixture, {
        outboxId: outbox.id,
        providerActivationId: null,
        providerReceipt: null,
        providerRequestDigest: null,
        recipientHash: null,
        recipientHashKeyVersion: null,
      }),
      "notification_delivery_attempt_accepted_evidence_required",
    );

    const activationId = await createProviderActivation(fixture);
    await expectPgConstraint(
      insertAcceptedAttempt(fixture, {
        outboxId: outbox.id,
        providerActivationId: activationId,
        providerReceipt: `email_${randomUUID()}`,
        providerRequestDigest: "b".repeat(64),
        recipientHash: "c".repeat(64),
        recipientHashKeyVersion: null,
      }),
      "notification_delivery_attempt_accepted_evidence_required",
    );
    await expect(
      insertAcceptedAttempt(fixture, {
        outboxId: outbox.id,
        providerActivationId: activationId,
        providerReceipt: `email_${randomUUID()}`,
        providerRequestDigest: "b".repeat(64),
        recipientHash: "c".repeat(64),
        recipientHashKeyVersion: "recipient-hmac-v1",
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("makes every delivery attempt fully append-only after insertion", async () => {
    const fixture = requireFixture();
    const outbox = validEnvelope();
    await insertExplicitEnvelope(fixture, outbox);
    const activationId = await createProviderActivation(fixture);
    const attemptId = randomUUID();
    await insertAcceptedAttempt(
      fixture,
      {
        outboxId: outbox.id,
        providerActivationId: activationId,
        providerReceipt: `email_${randomUUID()}`,
        providerRequestDigest: "b".repeat(64),
        recipientHash: "c".repeat(64),
        recipientHashKeyVersion: "recipient-hmac-v1",
      },
      attemptId,
    );

    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationDeliveryAttempt" SET "errorCode" = 'MUTATED' WHERE "id" = $1`,
        [attemptId],
      ),
      "notification_delivery_attempt_append_only",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `DELETE FROM "NotificationDeliveryAttempt" WHERE "id" = $1`,
        [attemptId],
      ),
      "notification_delivery_attempt_append_only",
    );
  });

  it("requires versioned HMAC suppressions and enforces one active row per hash", async () => {
    const fixture = requireFixture();
    await expectPgConstraint(
      fixture.pool.query(
        `
          INSERT INTO "NotificationSuppression" (
            "id", "recipientHash", "reason", "source"
          ) VALUES ($1, $2, 'MANUAL_SECURITY', 'raw-sql-test')
        `,
        [randomUUID(), "2".repeat(64)],
      ),
      "notification_suppression_recipient_hash_version_required",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `
          INSERT INTO "NotificationSuppression" (
            "id", "recipientHash", "recipientHashKeyVersion", "reason", "source"
          ) VALUES (
            $1, $2, 'unsafe version', 'MANUAL_SECURITY', 'raw-sql-test'
          )
        `,
        [randomUUID(), "2".repeat(64)],
      ),
      "notification_suppression_recipient_hash_version_required",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `
          INSERT INTO "NotificationSuppression" (
            "id", "recipientHash", "recipientHashKeyVersion", "reason", "source"
          ) VALUES (
            $1, 'cleartext@example.test', 'recipient-hmac-v1',
            'MANUAL_SECURITY', 'raw-sql-test'
          )
        `,
        [randomUUID()],
      ),
      "notification_suppression_recipient_hash_version_required",
    );

    const recipientHash = "2".repeat(64);
    const suppressionId = randomUUID();
    await expect(
      insertNotificationSuppression(fixture, {
        id: suppressionId,
        recipientHash,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expectPgConstraint(
      insertNotificationSuppression(fixture, {
        id: randomUUID(),
        recipientHash,
      }),
      "notification_suppression_active_recipient_unique",
      "23505",
    );

    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationSuppression" SET "source" = 'mutated' WHERE "id" = $1`,
        [suppressionId],
      ),
      "notification_suppression_identity_immutable",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationSuppression" SET "releasedAt" = 'infinity' WHERE "id" = $1`,
        [suppressionId],
      ),
      "notification_suppression_release_transition_required",
    );

    const releasedAt = new Date("2026-08-02T01:00:00.000Z");
    await expect(
      fixture.pool.query(
        `UPDATE "NotificationSuppression" SET "releasedAt" = $2 WHERE "id" = $1`,
        [suppressionId, releasedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationSuppression" SET "releasedAt" = NULL WHERE "id" = $1`,
        [suppressionId],
      ),
      "notification_suppression_released_immutable",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationSuppression" SET "releasedAt" = $2 WHERE "id" = $1`,
        [suppressionId, new Date("2026-08-02T02:00:00.000Z")],
      ),
      "notification_suppression_released_immutable",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `DELETE FROM "NotificationSuppression" WHERE "id" = $1`,
        [suppressionId],
      ),
      "notification_suppression_delete_forbidden",
    );

    await expect(
      insertNotificationSuppression(fixture, {
        id: randomUUID(),
        recipientHash,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rejects cleartext recipient PII at the provider-event boundary", async () => {
    const fixture = requireFixture();

    const activationId = await createProviderActivation(fixture);
    await expectPgConstraint(
      insertEmailProviderEvent(fixture, activationId, [
        "cleartext@example.test",
      ]),
      "email_provider_event_inbox_envelope_check",
    );
    await expect(
      insertEmailProviderEvent(fixture, activationId, [
        "0".repeat(64),
        "1".repeat(64),
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it.each(["PROJECTED", "IGNORED", "FAILED"] as const)(
    "allows exactly one RECEIVED -> %s transition with an atomic recipient-hash wipe",
    async (terminalStatus) => {
      const fixture = requireFixture();
      const activationId = await createProviderActivation(fixture);
      const eventId = randomUUID();
      await insertEmailProviderEvent(
        fixture,
        activationId,
        ["3".repeat(64)],
        eventId,
      );

      await expectPgConstraint(
        fixture.pool.query(
          `UPDATE "EmailProviderEventInbox" SET "providerReceipt" = $2 WHERE "id" = $1`,
          [eventId, `email_${randomUUID()}`],
        ),
        "email_provider_event_inbox_identity_immutable",
      );
      await expectPgConstraint(
        fixture.pool.query(
          `UPDATE "EmailProviderEventInbox" SET "updatedAt" = "updatedAt" + interval '1 millisecond' WHERE "id" = $1`,
          [eventId],
        ),
        "email_provider_event_inbox_terminal_transition_required",
      );

      const processedAt = new Date("2026-08-02T00:01:00.000Z");
      await expectPgConstraint(
        fixture.pool.query(
          `
            UPDATE "EmailProviderEventInbox"
            SET "status" = $2, "processedAt" = $3, "updatedAt" = $3
            WHERE "id" = $1
          `,
          [eventId, terminalStatus, processedAt],
        ),
        "email_provider_event_inbox_terminal_transition_required",
      );
      await expect(
        fixture.pool.query(
          `
            UPDATE "EmailProviderEventInbox"
            SET "status" = $2,
                "processedAt" = $3,
                "recipientHashes" = ARRAY[]::TEXT[],
                "recipientHashesWipedAt" = $3,
                "updatedAt" = $3
            WHERE "id" = $1
          `,
          [eventId, terminalStatus, processedAt],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      await expectPgConstraint(
        fixture.pool.query(
          `UPDATE "EmailProviderEventInbox" SET "updatedAt" = "updatedAt" + interval '1 millisecond' WHERE "id" = $1`,
          [eventId],
        ),
        "email_provider_event_inbox_terminal_immutable",
      );
      await expectPgConstraint(
        fixture.pool.query(
          `DELETE FROM "EmailProviderEventInbox" WHERE "id" = $1`,
          [eventId],
        ),
        "email_provider_event_inbox_delete_forbidden",
      );
    },
  );

  it("rejects partial, malformed and non-finite recipient shapes", async () => {
    const fixture = requireFixture();
    const partial = validEnvelope({ digestKeyVersion: null });
    await expectPgConstraint(
      insertExplicitEnvelope(fixture, partial),
      "notification_recipient_v2_insert_required",
    );

    const malformedDigest = validEnvelope({ digest: "A".repeat(64) });
    await expectPgConstraint(
      insertExplicitEnvelope(fixture, malformedDigest),
      "notification_outbox_recipient_shape",
    );

    const infinity = validEnvelope({ expiresAt: "infinity" });
    await expectPgConstraint(
      insertExplicitEnvelope(fixture, infinity),
      "notification_recipient_v2_insert_required",
    );

    await expectPgConstraint(
      fixture.pool.query(
        `
          INSERT INTO "NotificationOutbox" (
            "id", "recipientUserId", "recipientAddressExpiresAt", "purpose",
            "purposeClass", "channel", "templateKey", "payloadSchemaVersion",
            "payload", "dedupeKey", "providerDedupeKey", "status",
            "availableAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, 'PRIVACY_REQUEST', 'MANDATORY', 'EMAIL',
            'privacy-erasure-success', 'phase33-v1', '{}'::jsonb, $4, $5,
            'PENDING', $6, $6, $6
          )
        `,
        [
          randomUUID(),
          randomUUID(),
          new Date("2026-08-03T00:00:00.000Z"),
          uniqueKey("invalid-user-shape"),
          uniqueKey("provider-invalid-user-shape"),
          new Date("2026-08-02T00:00:00.000Z"),
        ],
      ),
      "notification_outbox_recipient_shape",
    );
  });

  it("allows only v2 inserts and rejects expired, year-9999 and over-horizon deadlines", async () => {
    const fixture = requireFixture();
    await expectPgConstraint(
      insertLegacyEnvelope(fixture),
      "notification_recipient_v2_insert_required",
    );

    const createdAt = new Date("2026-08-02T00:00:00.000Z");
    for (const expiresAt of [
      new Date("2026-08-01T23:59:59.999Z"),
      new Date("2026-09-02T00:00:00.001Z"),
      new Date("9999-12-31T00:00:00.000Z"),
    ]) {
      await expectPgConstraint(
        insertExplicitEnvelope(
          fixture,
          validEnvelope({ createdAt, expiresAt }),
        ),
        "notification_recipient_v2_insert_required",
      );
    }

    await expect(
      insertExplicitEnvelope(
        fixture,
        validEnvelope({
          createdAt,
          expiresAt: new Date("2026-09-02T00:00:00.000Z"),
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("makes recipient identity, payload and AAD deadline immutable", async () => {
    const fixture = requireFixture();
    const row = validEnvelope();
    await insertExplicitEnvelope(fixture, row);

    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationOutbox" SET "dedupeKey" = $2 WHERE "id" = $1`,
        [row.id, uniqueKey("mutated-dedupe")],
      ),
      "notification_recipient_identity_immutable",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationOutbox" SET "payload" = '{"changed":true}'::jsonb WHERE "id" = $1`,
        [row.id],
      ),
      "notification_recipient_identity_immutable",
    );
    await expectPgConstraint(
      fixture.pool.query(
        `UPDATE "NotificationOutbox" SET "recipientAddressExpiresAt" = "recipientAddressExpiresAt" + interval '1 millisecond' WHERE "id" = $1`,
        [row.id],
      ),
      "notification_recipient_identity_immutable",
    );
  });

  it("rejects ciphertext transplantation between active rows", async () => {
    const fixture = requireFixture();
    const target = validEnvelope({
      ciphertextByte: 11,
      nonceByte: 12,
      tagByte: 13,
    });
    const source = validEnvelope({
      ciphertextByte: 21,
      nonceByte: 22,
      tagByte: 23,
    });
    await insertExplicitEnvelope(fixture, target);
    await insertExplicitEnvelope(fixture, source);

    await expectPgConstraint(
      fixture.pool.query(
        `
          UPDATE "NotificationOutbox" AS target
          SET "recipientAddressCiphertext" = source."recipientAddressCiphertext",
              "recipientAddressNonce" = source."recipientAddressNonce",
              "recipientAddressTag" = source."recipientAddressTag"
          FROM "NotificationOutbox" AS source
          WHERE target."id" = $1 AND source."id" = $2
        `,
        [target.id, source.id],
      ),
      "notification_recipient_envelope_immutable",
    );
  });

  it("permits exactly one active-to-wiped transition and forbids restore or delete", async () => {
    const fixture = requireFixture();
    const row = validEnvelope();
    await insertExplicitEnvelope(fixture, row);
    const destroyedAt = new Date(row.createdAt.getTime() + 60_000);

    await expect(
      fixture.pool.query(
        `
          UPDATE "NotificationOutbox"
          SET "recipientAddressCiphertext" = NULL,
              "recipientAddressNonce" = NULL,
              "recipientAddressTag" = NULL,
              "recipientAddressKeyVersion" = NULL,
              "recipientAddressBindingVersion" = NULL,
              "recipientAddressDigest" = NULL,
              "recipientAddressDigestKeyVersion" = NULL,
              "recipientAddressDestroyedAt" = $2
          WHERE "id" = $1
        `,
        [row.id, destroyedAt],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    const wiped = await fixture.pool.query<{
      destroyedAt: Date;
      materialCount: number;
    }>(
      `
        SELECT
          "recipientAddressDestroyedAt" AS "destroyedAt",
          num_nonnulls(
            "recipientAddressCiphertext", "recipientAddressNonce",
            "recipientAddressTag", "recipientAddressKeyVersion",
            "recipientAddressBindingVersion", "recipientAddressDigest",
            "recipientAddressDigestKeyVersion"
          ) AS "materialCount"
        FROM "NotificationOutbox"
        WHERE "id" = $1
      `,
      [row.id],
    );
    expect(wiped.rows).toEqual([{ destroyedAt, materialCount: 0 }]);

    await expectPgConstraint(
      fixture.pool.query(
        `
          UPDATE "NotificationOutbox"
          SET "recipientAddressCiphertext" = $2,
              "recipientAddressNonce" = $3,
              "recipientAddressTag" = $4,
              "recipientAddressKeyVersion" = 'test-v1',
              "recipientAddressBindingVersion" = 'v2',
              "recipientAddressDigest" = $5,
              "recipientAddressDigestKeyVersion" = 'test-v1',
              "recipientAddressDestroyedAt" = NULL
          WHERE "id" = $1
        `,
        [row.id, row.ciphertext, row.nonce, row.tag, row.digest],
      ),
      "notification_recipient_destroyed",
    );
    await expectPgConstraint(
      fixture.pool.query(`DELETE FROM "NotificationOutbox" WHERE "id" = $1`, [
        row.id,
      ]),
      "notification_recipient_envelope_delete_forbidden",
    );
  });

  it("fails the upgrade preflight before installing an active-suppression uniqueness contract over duplicates", async () => {
    const duplicateDatabase = await createMigratedTestDatabase(
      "phase33_notification_suppression_duplicate_preflight",
      { throughMigration: PRE_PHASE33_MIGRATION },
    );
    try {
      await duplicateDatabase.pool.query(
        `DROP INDEX "notification_suppression_active_recipient_unique"`,
      );
      const duplicateHash = "4".repeat(64);
      await duplicateDatabase.pool.query(
        `
            INSERT INTO "NotificationSuppression" (
              "id", "recipientHash", "reason", "source", "createdAt"
            ) VALUES
              ($1, $3, 'MANUAL_SECURITY', 'upgrade-preflight', $4),
              ($2, $3, 'MANUAL_SECURITY', 'upgrade-preflight', $4)
          `,
        [
          randomUUID(),
          randomUUID(),
          duplicateHash,
          new Date("2026-08-02T00:00:00.000Z"),
        ],
      );

      const migrationSql = await readFile(
        resolve(
          process.cwd(),
          "prisma/migrations/20260801090000_phase_33_payment_provider_bindings/migration.sql",
        ),
        "utf8",
      );
      await expectPgConstraint(
        duplicateDatabase.pool.query(migrationSql),
        "notification_suppression_active_recipient_upgrade",
        "23505",
      );
      await duplicateDatabase.pool.query("ROLLBACK");
    } finally {
      await duplicateDatabase.dispose();
    }
  }, 600_000);
});

type ExplicitEnvelope = Readonly<{
  bindingVersion: "v2";
  ciphertext: Buffer;
  createdAt: Date;
  dedupeKey: string;
  digest: string;
  digestKeyVersion: string | null;
  expiresAt: Date | string;
  id: string;
  nonce: Buffer;
  providerDedupeKey: string;
  tag: Buffer;
}>;

function validEnvelope(
  override: Readonly<{
    ciphertextByte?: number;
    createdAt?: Date;
    digest?: string;
    digestKeyVersion?: string | null;
    expiresAt?: Date | string;
    nonceByte?: number;
    tagByte?: number;
  }> = {},
): ExplicitEnvelope {
  const token = randomUUID();
  const createdAt = override.createdAt ?? new Date("2026-08-02T00:00:00.000Z");
  return {
    bindingVersion: "v2",
    ciphertext: Buffer.alloc(32, override.ciphertextByte ?? 3),
    createdAt,
    dedupeKey: `phase33:recipient:${token}`,
    digest: override.digest ?? "a".repeat(64),
    digestKeyVersion:
      override.digestKeyVersion === undefined
        ? "test-v1"
        : override.digestKeyVersion,
    expiresAt:
      override.expiresAt ?? new Date(createdAt.getTime() + 23 * 60 * 60_000),
    id: randomUUID(),
    nonce: Buffer.alloc(12, override.nonceByte ?? 4),
    providerDedupeKey: `sth-phase33-recipient-${token}`,
    tag: Buffer.alloc(16, override.tagByte ?? 5),
  };
}

async function insertExplicitEnvelope(
  fixture: MigratedDatabase,
  row: ExplicitEnvelope,
) {
  return fixture.pool.query(
    `
      INSERT INTO "NotificationOutbox" (
        "id", "recipientAddressCiphertext", "recipientAddressNonce",
        "recipientAddressTag", "recipientAddressKeyVersion",
        "recipientAddressBindingVersion", "recipientAddressDigest",
        "recipientAddressDigestKeyVersion", "recipientAddressExpiresAt",
        "purpose", "purposeClass", "channel", "templateKey",
        "payloadSchemaVersion", "payload", "dedupeKey",
        "providerDedupeKey", "status", "availableAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, 'test-v1', $5, $6, $7, $8,
        'PRIVACY_REQUEST', 'MANDATORY', 'EMAIL', 'privacy-erasure-success',
        'phase33-v1', '{}'::jsonb, $9, $10, 'PENDING', $11, $11, $11
      )
      RETURNING "id"
    `,
    [
      row.id,
      row.ciphertext,
      row.nonce,
      row.tag,
      row.bindingVersion,
      row.digest,
      row.digestKeyVersion,
      row.expiresAt,
      row.dedupeKey,
      row.providerDedupeKey,
      row.createdAt,
    ],
  );
}

async function insertLegacyEnvelope(fixture: MigratedDatabase) {
  const token = randomUUID();
  const createdAt = new Date("2026-08-02T00:00:00.000Z");
  return fixture.pool.query(
    `
      INSERT INTO "NotificationOutbox" (
        "id", "recipientAddressCiphertext", "recipientAddressNonce",
        "recipientAddressTag", "recipientAddressKeyVersion",
        "recipientAddressExpiresAt", "purpose", "purposeClass", "channel",
        "templateKey", "payloadSchemaVersion", "payload", "dedupeKey",
        "providerDedupeKey", "status", "availableAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, 'legacy-v1', $5, 'PRIVACY_REQUEST', 'MANDATORY',
        'EMAIL', 'privacy-erasure-success', 'phase33-v1', '{}'::jsonb,
        $6, $7, 'PENDING', $8, $8, $8
      )
    `,
    [
      randomUUID(),
      Buffer.alloc(32, 6),
      Buffer.alloc(12, 7),
      Buffer.alloc(16, 8),
      new Date(createdAt.getTime() + 23 * 60 * 60_000),
      `phase33:recipient:legacy-insert:${token}`,
      `sth-phase33-recipient-legacy-insert-${token}`,
      createdAt,
    ],
  );
}

async function createProviderActivation(fixture: MigratedDatabase) {
  const id = randomUUID();
  const token = randomUUID();
  await fixture.pool.query(
    `
      INSERT INTO "ProviderActivation" (
        "id", "environment", "useCase", "adapterKey", "adapterVersion",
        "mode", "configurationDigest", "evidenceDigest", "owner",
        "runbookRef", "health", "killSwitchEngaged", "updatedAt"
      ) VALUES (
        $1, 'ci', $2, 'resend_contract', 'v1', 'DISABLED', $3, $4,
        'Phase 33 recipient-envelope test',
        'codex-plan/runbooks/worker-operations.md', 'UNKNOWN', true,
        '2026-08-02T00:00:00.000Z'
      )
    `,
    [id, `email.delivery.test.${token}`, "d".repeat(64), "e".repeat(64)],
  );
  return id;
}

async function insertAcceptedAttempt(
  fixture: MigratedDatabase,
  evidence: Readonly<{
    outboxId: string;
    providerActivationId: string | null;
    providerReceipt: string | null;
    providerRequestDigest: string | null;
    recipientHash: string | null;
    recipientHashKeyVersion: string | null;
  }>,
  attemptId = randomUUID(),
) {
  return fixture.pool.query(
    `
      INSERT INTO "NotificationDeliveryAttempt" (
        "id", "outboxId", "attemptNumber", "leaseOwner", "leaseExpiresAt",
        "providerClass", "outcome", "providerReceipt",
        "providerActivationId", "providerRequestDigest", "recipientHash",
        "recipientHashKeyVersion", "recipientEvidenceRetainUntil",
        "startedAt", "completedAt"
      ) VALUES (
        $1, $2, 1, 'phase33-contract-worker',
        '2026-08-02T00:01:00.000Z', 'resend-contract', 'ACCEPTED',
        $3, $4, $5, $6, $7,
        '2026-08-02T00:00:01.000Z'::timestamptz + interval '9600 hours',
        '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:01.000Z'
      )
    `,
    [
      attemptId,
      evidence.outboxId,
      evidence.providerReceipt,
      evidence.providerActivationId,
      evidence.providerRequestDigest,
      evidence.recipientHash,
      evidence.recipientHashKeyVersion,
    ],
  );
}

async function insertNotificationSuppression(
  fixture: MigratedDatabase,
  input: Readonly<{
    id: string;
    recipientHash: string;
  }>,
) {
  return fixture.pool.query(
    `
      INSERT INTO "NotificationSuppression" (
        "id", "recipientHash", "recipientHashKeyVersion", "reason", "source",
        "createdAt"
      ) VALUES (
        $1, $2, 'recipient-hmac-v1', 'MANUAL_SECURITY', 'raw-sql-test',
        '2026-08-02T00:00:00.000Z'
      )
    `,
    [input.id, input.recipientHash],
  );
}

async function insertEmailProviderEvent(
  fixture: MigratedDatabase,
  providerActivationId: string,
  recipientHashes: readonly string[],
  eventId = randomUUID(),
) {
  const token = randomUUID();
  const eventTime = new Date("2026-08-02T00:00:00.000Z");
  return fixture.pool.query(
    `
      INSERT INTO "EmailProviderEventInbox" (
        "id", "environment", "adapterKey", "adapterVersion",
        "providerActivationId", "svixId", "providerReceipt",
        "recipientHashes", "eventType", "eventCreatedAt", "payloadDigest",
        "receivedAt", "status", "updatedAt"
      ) VALUES (
        $1, 'ci', 'resend_contract', 'v1', $2, $3, $4, $5,
        'email.delivered', $6, $7, $6, 'RECEIVED', $6
      )
    `,
    [
      eventId,
      providerActivationId,
      `svix_${token}`,
      `email_${token}`,
      recipientHashes,
      eventTime,
      "9".repeat(64),
    ],
  );
}

async function expectPgConstraint(
  operation: Promise<unknown>,
  constraint: string,
  code = "23514",
) {
  await expect(operation).rejects.toMatchObject({ code, constraint });
}

function uniqueKey(scope: string) {
  return `phase33:${scope}:${randomUUID()}`;
}

function requireFixture() {
  if (migrated === undefined) {
    throw new Error("Phase-33 recipient-envelope fixture is unavailable.");
  }
  return migrated;
}
