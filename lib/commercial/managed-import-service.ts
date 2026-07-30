import "server-only";

import { z } from "zod";

import { canRunLicensedSupplyImport } from "@/lib/admin/capabilities";
import { commitImportRun } from "@/lib/admin/imports";
import type { AdminDependencies } from "@/lib/admin/common";
import { evidenceDigest } from "@/lib/commercial/contracts";
import { evaluateManagedImportCommit } from "@/lib/commercial/managed-import";

const inputSchema = z.strictObject({
  companyId: z.uuid(),
  explicitCommitConfirmed: z.literal(true),
  expectedMappingDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedPreviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedRightsDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  idempotencyKey: z.uuid(),
  runId: z.uuid(),
});

type ManagedImportSnapshot = Readonly<{
  importSourceId: string;
  companyId: string;
  items: readonly Readonly<{
    id: string;
    normalizedChecksum: string;
    selectedCompanyId: string | null;
    status: string;
  }>[];
  right: Readonly<{
    rightsEvidence: string;
    validFrom: Date;
    validTo: Date | null;
  }>;
}>;

export function buildManagedImportEvidenceDigests(
  snapshot: ManagedImportSnapshot,
) {
  const sortedItems = [...snapshot.items].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return Object.freeze({
    mappingDigest: evidenceDigest({
      companyId: snapshot.companyId,
      mappings: sortedItems.map((item) => ({
        itemId: item.id,
        selectedCompanyId: item.selectedCompanyId,
      })),
    }),
    previewDigest: evidenceDigest({
      importSourceId: snapshot.importSourceId,
      items: sortedItems.map((item) => ({
        itemId: item.id,
        normalizedChecksum: item.normalizedChecksum,
        status: item.status,
      })),
    }),
    rightsDigest: evidenceDigest({
      companyId: snapshot.companyId,
      importSourceId: snapshot.importSourceId,
      rightsEvidence: snapshot.right.rightsEvidence,
      validFrom: snapshot.right.validFrom.toISOString(),
      validTo: snapshot.right.validTo?.toISOString() ?? null,
    }),
  });
}

/**
 * Packages the existing licensed parser/preview/Draft commit for a paid,
 * managed service. It does not introduce a second importer and never permits
 * recurring sync or publication.
 */
export async function commitManagedImportRun(
  raw: unknown,
  dependencies: AdminDependencies &
    Readonly<{ commercialManagedImportEnabled: boolean }>,
) {
  const input = inputSchema.safeParse(raw);
  if (!input.success) return { ok: false as const, code: "INVALID_INPUT" as const };
  const now = dependencies.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { ok: false as const, code: "INVALID_INPUT" as const };
  }
  const run = await dependencies.database.importRun.findUnique({
    where: { id: input.data.runId },
    select: {
      id: true,
      importSourceId: true,
      status: true,
      importSource: { select: { isActive: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          normalizedChecksum: true,
          normalizedPreview: true,
          status: true,
          decision: {
            select: { kind: true, selectedCompanyId: true },
          },
        },
      },
    },
  });
  if (run === null) return { ok: false as const, code: "NOT_FOUND" as const };
  const right = await dependencies.database.importSourceCompanyRight.findFirst({
    where: {
      importSourceId: run.importSourceId,
      companyId: input.data.companyId,
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    select: { rightsEvidence: true, validFrom: true, validTo: true },
  });
  if (right === null) return { ok: false as const, code: "FORBIDDEN" as const };
  const approvedItems = run.items.filter(
    (item) =>
      item.status === "OK" &&
      item.decision?.kind === "APPROVE" &&
      item.decision.selectedCompanyId === input.data.companyId,
  );
  if (
    approvedItems.length === 0 ||
    run.items.some(
      (item) =>
        item.decision?.kind === "APPROVE" &&
        item.decision.selectedCompanyId !== input.data.companyId,
    )
  ) {
    return { ok: false as const, code: "CONFLICT" as const };
  }
  const snapshot = {
    companyId: input.data.companyId,
    importSourceId: run.importSourceId,
    items: approvedItems.map((item) => ({
      id: item.id,
      normalizedChecksum: item.normalizedChecksum,
      selectedCompanyId: item.decision?.selectedCompanyId ?? null,
      status: item.status,
    })),
    right,
  };
  const digests = buildManagedImportEvidenceDigests(snapshot);
  const decision = evaluateManagedImportCommit({
    actorCanCommitForCompany: canRunLicensedSupplyImport(dependencies.actor),
    commitFlag: dependencies.commercialManagedImportEnabled,
    explicitCommitConfirmed: input.data.explicitCommitConfirmed,
    mappingDigest: digests.mappingDigest,
    previewDigest: digests.previewDigest,
    previewStatus:
      run.status === "PREVIEW_READY" ? "PREVIEW_READY" : "PENDING",
    rightsEvidenceDigest: digests.rightsDigest,
    rightsValidFrom: right.validFrom,
    rightsValidTo: right.validTo,
    sourceActive: run.importSource.isActive,
    targetStatus: "DRAFT",
    tenantMatches: approvedItems.length > 0,
    now,
  });
  if (
    !decision.gate.allowed ||
    input.data.expectedMappingDigest !== digests.mappingDigest ||
    input.data.expectedPreviewDigest !== digests.previewDigest ||
    input.data.expectedRightsDigest !== digests.rightsDigest
  ) {
    return {
      ok: false as const,
      code: dependencies.commercialManagedImportEnabled
        ? ("CONFLICT" as const)
        : ("DISABLED" as const),
    };
  }
  return commitImportRun(
    { runId: run.id, idempotencyKey: input.data.idempotencyKey },
    dependencies,
  );
}
