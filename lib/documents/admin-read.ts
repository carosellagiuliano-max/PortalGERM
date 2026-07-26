import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";

export async function getRedactedDocumentVaultSummary(
  database: DatabaseClient,
) {
  const [statuses, scanOutcomes, pendingIntents, lifecycle] = await Promise.all([
    database.documentVersion.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    database.documentScanAttempt.groupBy({
      by: ["outcome"],
      _count: { _all: true },
      orderBy: { outcome: "asc" },
    }),
    database.documentUploadIntent.count({
      where: { status: { in: ["CREATED", "UPLOADING", "UPLOADED"] } },
    }),
    database.objectLifecycleOutcome.groupBy({
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
