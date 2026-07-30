import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_CAPABILITIES_V1 } from "@/lib/admin/capabilities";
import {
  decideImportItem,
  parseLicensedImport,
} from "@/lib/admin/imports";
import {
  buildManagedImportEvidenceDigests,
  commitManagedImportRun,
} from "@/lib/commercial/managed-import-service";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-30T12:00:00.000Z");

describe.sequential("Phase 31 managed import PostgreSQL boundary", () => {
  let migrated: MigratedDatabase;
  let database: DatabaseClient;
  let adminUserId = "";

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase31_managed_import");
    database = createDatabaseClient(migrated.connectionString);
    await seedImportFixture();
  }, 600_000);

  afterAll(async () => {
    await database.$disconnect();
    await migrated.dispose();
  });

  it("keeps the paid managed wrapper disabled by default", async () => {
    const prepared = await preparePreview("disabled");
    await expect(
      commitManagedImportRun(prepared.commitInput, {
        ...dependencies("disabled"),
        commercialManagedImportEnabled: false,
      }),
    ).resolves.toEqual({ ok: false, code: "DISABLED" });
    await expect(
      database.job.count({
        where: { importSourceId: prepared.importSourceId },
      }),
    ).resolves.toBe(0);
  });

  it("rejects a stale/tampered preview digest before any write", async () => {
    const prepared = await preparePreview("tamper");
    await expect(
      commitManagedImportRun(
        {
          ...prepared.commitInput,
          expectedPreviewDigest: "f".repeat(64),
        },
        {
          ...dependencies("tamper"),
          commercialManagedImportEnabled: true,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      database.job.count({
        where: { importSourceId: prepared.importSourceId },
      }),
    ).resolves.toBe(0);
  });

  it("commits a rights-bound preview only as Draft and never starts sync or publication", async () => {
    const prepared = await preparePreview("draft-only");
    const committed = await commitManagedImportRun(prepared.commitInput, {
      ...dependencies("draft-only"),
      commercialManagedImportEnabled: true,
    });
    expect(committed).toMatchObject({
      ok: true,
      value: { status: "COMMITTED", committed: 1 },
    });
    const jobs = await database.job.findMany({
      where: { importSourceId: prepared.importSourceId },
      select: { status: true, origin: true, publishedAt: true },
    });
    expect(jobs).toEqual([
      { status: "DRAFT", origin: "IMPORT", publishedAt: null },
    ]);
    await expect(
      database.importRun.count({
        where: {
          importSourceId: prepared.importSourceId,
          status: { in: ["PENDING", "PARSING"] },
        },
      }),
    ).resolves.toBe(0);
  });

  async function preparePreview(suffix: string) {
    const source = await database.importSource.findFirstOrThrow({
      where: {
        isActive: true,
        format: "JSON",
        companyRights: {
          some: {
            revokedAt: null,
            validFrom: { lte: NOW },
            OR: [{ validTo: null }, { validTo: { gt: NOW } }],
          },
        },
      },
      select: {
        id: true,
        companyRights: {
          where: {
            revokedAt: null,
            validFrom: { lte: NOW },
            OR: [{ validTo: null }, { validTo: { gt: NOW } }],
          },
          take: 1,
          select: {
            companyId: true,
            rightsEvidence: true,
            validFrom: true,
            validTo: true,
          },
        },
      },
    });
    const right = source.companyRights[0];
    if (right === undefined) throw new Error("Expected import source right.");
    const city = await database.city.findFirstOrThrow({
      where: { isActive: true, canton: { isActive: true } },
      orderBy: [{ id: "asc" }],
      select: {
        name: true,
        canton: { select: { code: true } },
      },
    });
    const payload = JSON.stringify([
      {
        id: `phase31-${suffix}-${randomUUID()}`,
        company: "Phase 31 Importkunde AG",
        title: "Pflegefachperson HF",
        workplace_country: "CH",
        zip: "6300",
        city: city.name,
        canton: city.canton.code,
        description:
          "Betreuter Importdatensatz mit dokumentierter Quelle und sicherer Vorschau.",
        requirements: ["HF-Abschluss"],
        offer: "Klare Arbeitsbedingungen.",
        contact: "jobs@example.ch",
        type: "PERMANENT",
        workload_min: 80,
        workload_max: 100,
        keywords: ["Pflege"],
      },
    ]);
    const parsed = await parseLicensedImport(
      {
        importSourceId: source.id,
        inputSource: "PASTE",
        format: "JSON",
        payload,
        idempotencyKey: randomUUID(),
      },
      dependencies(`parse-${suffix}`),
    );
    if (!parsed.ok) throw new Error(`Preview failed: ${parsed.code}`);
    const item = await database.importItem.findFirstOrThrow({
      where: { runId: parsed.value.runId, status: "OK" },
      select: { id: true },
    });
    const decision = await decideImportItem(
      {
        itemId: item.id,
        decision: "APPROVE",
        companyId: right.companyId,
        reasonCode: "SOURCE_RIGHTS_VERIFIED",
        idempotencyKey: randomUUID(),
      },
      dependencies(`decision-${suffix}`),
    );
    if (!decision.ok) throw new Error(`Decision failed: ${decision.code}`);
    const run = await database.importRun.findUniqueOrThrow({
      where: { id: parsed.value.runId },
      select: {
        importSourceId: true,
        items: {
          where: { decision: { kind: "APPROVE" } },
          select: {
            id: true,
            normalizedChecksum: true,
            status: true,
            decision: { select: { selectedCompanyId: true } },
          },
        },
      },
    });
    const digests = buildManagedImportEvidenceDigests({
      companyId: right.companyId,
      importSourceId: run.importSourceId,
      items: run.items.map((runItem) => ({
        id: runItem.id,
        normalizedChecksum: runItem.normalizedChecksum,
        selectedCompanyId: runItem.decision?.selectedCompanyId ?? null,
        status: runItem.status,
      })),
      right,
    });
    return {
      importSourceId: source.id,
      commitInput: {
        companyId: right.companyId,
        explicitCommitConfirmed: true as const,
        expectedMappingDigest: digests.mappingDigest,
        expectedPreviewDigest: digests.previewDigest,
        expectedRightsDigest: digests.rightsDigest,
        idempotencyKey: randomUUID(),
        runId: parsed.value.runId,
      },
    };
  }

  function dependencies(_correlationId: string) {
    return {
      actor: {
        userId: adminUserId,
        email: "phase31-import-admin@example.ch",
        role: "ADMIN" as const,
        status: "ACTIVE" as const,
        capabilities: ADMIN_CAPABILITIES_V1,
      },
      correlationId: randomUUID(),
      database,
      now: NOW,
    };
  }

  async function seedImportFixture() {
    adminUserId = randomUUID();
    const companyId = randomUUID();
    const sourceId = randomUUID();
    const cantonId = randomUUID();
    await database.user.create({
      data: {
        id: adminUserId,
        email: "phase31-import-admin@example.ch",
        emailNormalized: "phase31-import-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
    });
    await database.company.create({
      data: {
        id: companyId,
        name: "Phase 31 Import Buyer AG",
        slug: "phase31-import-buyer",
        status: "DRAFT",
        dataProvenance: "TEST",
      },
    });
    await database.canton.create({
      data: {
        id: cantonId,
        code: "LU",
        name: "Luzern",
        slug: "phase31-import-luzern",
        language: "DE",
        isActive: true,
      },
    });
    await database.city.create({
      data: {
        id: randomUUID(),
        cantonId,
        name: "Luzern",
        slug: "phase31-import-luzern-city",
        isActive: true,
      },
    });
    await database.category.create({
      data: {
        id: randomUUID(),
        name: "Phase 31 Import Pflege",
        slug: "phase31-import-pflege",
        isActive: true,
      },
    });
    await database.importSource.create({
      data: {
        id: sourceId,
        name: "Phase 31 licensed managed feed",
        sourceReference: "test://phase31-managed-source",
        licenseReference: "test://phase31-source-rights-contract",
        provenance: "TEST",
        format: "JSON",
        isActive: true,
      },
    });
    await database.importSourceCompanyRight.create({
      data: {
        id: randomUUID(),
        importSourceId: sourceId,
        companyId,
        rightsEvidence: "TEST-ONLY documented source-rights fixture",
        grantedByUserId: adminUserId,
        validFrom: new Date(NOW.getTime() - 86_400_000),
        validTo: new Date(NOW.getTime() + 30 * 86_400_000),
      },
    });
  }
});
