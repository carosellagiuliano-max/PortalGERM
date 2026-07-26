import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPhase22Harness,
  PHASE22_NOW,
  seedActiveInventory,
  seedPhase22Actors,
  seedPrivacyRequest,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase22_schema_contract");
  actors = await seedPhase22Actors(harness.client, "schema");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 privacy/legal migration contract", () => {
  it("installs all evidence tables, constraints and fail-closed triggers", async () => {
    const { client, users, pool } = requireFixture();
    const tableRows = await pool.query<{ table_name: string }>(
      `
        SELECT table_name
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name
      `,
      [
        [
          "AnalyticsConsentEvent",
          "ErasureProof",
          "LegalDocument",
          "LegalHold",
          "LegalPublication",
          "LegalRevision",
          "PrivacyDataInventoryEntry",
          "PrivacyDataInventoryVersion",
          "PrivacyExecution",
          "PrivacyExportArtifact",
          "PrivacyProcessorOutcome",
          "PrivacyTombstone",
          "ProcessingApproval",
        ],
      ],
    );
    expect(tableRows.rows.map(({ table_name }) => table_name)).toHaveLength(13);

    const triggerRows = await pool.query<{ name: string; definition: string }>(`
      SELECT
        tg.tgname AS name,
        pg_get_triggerdef(tg.oid) AS definition
      FROM pg_trigger tg
      JOIN pg_class relation ON relation.oid = tg.tgrelid
      WHERE NOT tg.tgisinternal
        AND tg.tgname LIKE 'phase22_%'
      ORDER BY tg.tgname
    `);
    expect(triggerRows.rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "phase22_analytics_consent_append_only",
        "phase22_erasure_proof_append_only_update",
        "phase22_execution_completion_guard_trigger",
        "phase22_export_single_use_guard_trigger",
        "phase22_inventory_entry_append_only",
        "phase22_legal_publication_scope_guard_trigger",
        "phase22_tombstone_append_only_delete",
      ]),
    );
    expect(
      triggerRows.rows.find(
        ({ name }) => name === "phase22_execution_completion_guard_trigger",
      )?.definition,
    ).toMatch(/BEFORE INSERT OR UPDATE/iu);

    const legal = await seedPublishedPrivacyNotice(client, users, "schema");
    const inventory = await seedActiveInventory(client, "schema", [
      "postgres-primary",
    ]);
    const approval = await seedProcessingApproval(
      client,
      legal.publication.id,
      {
        suffix: "schema",
        scope: "PRIVACY_CORRECTION",
        processorKey: "postgres-primary",
      },
    );
    const request = await seedPrivacyRequest(client, users, "CORRECT");

    await expect(
      client.privacyExecution.create({
        data: {
          privacyRequestId: request.id,
          inventoryVersionId: inventory.id,
          processingApprovalId: approval.id,
          kind: "CORRECTION",
          status: "COMPLETED",
          subjectClass: "CANDIDATE",
          subjectReferenceHash: createHash("sha256")
            .update(users.requester.id)
            .digest("hex"),
          policyVersion: "privacy-correction-v2",
          requiredProcessors: ["postgres-primary"],
          checkpoint: 1,
          approvedByUserId: users.approvalAdmin.id,
          approvalEvidenceRef: "sandbox:phase22-schema-approval",
          stepUpEvidenceRef: "sandbox:phase22-schema-step-up",
          completedAt: PHASE22_NOW,
          updatedAt: PHASE22_NOW,
        },
      }),
    ).rejects.toThrow(/open processor outcomes/iu);

    await expect(
      client.privacyDataInventoryEntry.update({
        where: { id: inventory.entries[0]!.id },
        data: { owner: "Mutated owner" },
      }),
    ).rejects.toThrow(/append-only/iu);

    await expect(
      client.privacyDataInventoryVersion.create({
        data: {
          version: "second-active",
          status: "ACTIVE",
          contentHash: "f".repeat(64),
          owner: "Conflicting active owner",
          reviewRef: "test-review:second-active",
          effectiveAt: PHASE22_NOW,
        },
      }),
    ).rejects.toThrow();
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 schema fixture is unavailable.");
  }
  return {
    client: harness.client,
    users: actors,
    pool: harness.migrated.pool,
  };
}
