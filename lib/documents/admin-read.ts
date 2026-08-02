import "server-only";

import {
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";

export async function getRedactedDocumentVaultSummary(
  dependencies: AdminDependencies,
) {
  if (!(await requireCapability(dependencies, "ADMIN_OPS_READ"))) {
    return null;
  }
  const [statuses, scanOutcomes, pendingIntents, lifecycle] = await Promise.all([
    dependencies.database.documentVersion.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    dependencies.database.documentScanAttempt.groupBy({
      by: ["outcome"],
      _count: { _all: true },
      orderBy: { outcome: "asc" },
    }),
    dependencies.database.documentUploadIntent.count({
      where: { status: { in: ["CREATED", "UPLOADING", "UPLOADED"] } },
    }),
    dependencies.database.objectLifecycleOutcome.groupBy({
      by: ["kind", "status"],
      _count: { _all: true },
      orderBy: [{ kind: "asc" }, { status: "asc" }],
    }),
  ]);
  return Object.freeze({
    statuses: Object.freeze(
      Object.fromEntries(
        statuses.map((row) => [row.status, row._count._all]),
      ),
    ),
    scanOutcomes: Object.freeze(
      Object.fromEntries(
        scanOutcomes.map((row) => [row.outcome, row._count._all]),
      ),
    ),
    pendingIntents,
    lifecycle: Object.freeze(
      lifecycle.map((row) =>
        Object.freeze({
          kind: row.kind,
          status: row.status,
          count: row._count._all,
        }),
      ),
    ),
  });
}
