import "server-only";

import { createHash } from "node:crypto";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { DOCUMENT_UPLOAD_POLICY_V1 } from "@/lib/documents/document-upload-policy";
import { resolveDocumentRuntime } from "@/lib/documents/runtime-policy";
import { hasExactDocumentProviderAuthority } from "@/lib/documents/provider-activation-guard";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";

export type DocumentReconciliationFinding = Readonly<{
  objectKeyHash: string;
  documentVersionId: string | null;
  kind:
    | "DB_WITHOUT_OBJECT"
    | "OBJECT_WITHOUT_DB"
    | "INCOMPLETE_UPLOAD"
    | "CHECKSUM_MISMATCH"
    | "DELETE_PENDING"
    | "LEGAL_HOLD"
    | "CONSISTENT";
  status:
    "OBSERVED" | "QUARANTINED" | "REPAIRED" | "RETRYABLE" | "BLOCKED_BY_HOLD";
}>;

export async function reconcileDocumentObjects(
  input: Readonly<{
    mode: "dry_run" | "command";
    correlationId: string;
    now?: Date;
  }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    objectStore: DocumentObjectStore;
  }>,
): Promise<
  | Readonly<{
      ok: true;
      findings: readonly DocumentReconciliationFinding[];
      changed: number;
    }>
  | Readonly<{
      ok: false;
      code:
        | "DOCUMENT_VAULT_UNAVAILABLE"
        | "RECONCILIATION_DISABLED"
        | "PROVIDER_DEGRADED";
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  if (
    runtime.reconciliation === "disabled" ||
    (input.mode === "command" && runtime.reconciliation !== "command")
  ) {
    return Object.freeze({ ok: false, code: "RECONCILIATION_DISABLED" });
  }
  const now = input.now ?? new Date();
  if (
    !(await hasExactDocumentProviderAuthority(
      dependencies.database,
      dependencies.environment,
      now,
      ["OBJECT_STORE"],
    ))
  ) {
    return Object.freeze({ ok: false, code: "PROVIDER_DEGRADED" });
  }
  const limit = DOCUMENT_UPLOAD_POLICY_V1.reconcilerBatchSize;
  const [inventory, versions] = await Promise.all([
    dependencies.objectStore.listObjects({ limit }).catch(() => null),
    dependencies.database.documentVersion.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        objectKey: true,
        sizeBytes: true,
        sha256: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);
  if (inventory === null) {
    return Object.freeze({ ok: false, code: "PROVIDER_DEGRADED" });
  }
  const inventoryByHash = new Map(
    inventory.map((entry) => [entry.objectKeyHash, entry]),
  );
  const versionsByHash = new Map(
    versions.map((version) => [hashObjectKey(version.objectKey), version]),
  );
  const findings: DocumentReconciliationFinding[] = [];

  for (const [objectKeyHash, version] of versionsByHash) {
    const object = inventoryByHash.get(objectKeyHash);
    if (object === undefined) {
      findings.push(
        finding(
          objectKeyHash,
          version.id,
          version.status === "UPLOADING"
            ? "INCOMPLETE_UPLOAD"
            : "DB_WITHOUT_OBJECT",
          "RETRYABLE",
        ),
      );
      continue;
    }
    if (version.status === "DELETE_PENDING" || version.status === "HELD") {
      findings.push(
        finding(
          objectKeyHash,
          version.id,
          version.status === "HELD" ? "LEGAL_HOLD" : "DELETE_PENDING",
          "BLOCKED_BY_HOLD",
        ),
      );
    } else if (
      (version.sizeBytes !== null && object.sizeBytes !== version.sizeBytes) ||
      (version.sha256 !== null && object.sha256 !== version.sha256)
    ) {
      findings.push(
        finding(objectKeyHash, version.id, "CHECKSUM_MISMATCH", "QUARANTINED"),
      );
    } else {
      findings.push(
        finding(objectKeyHash, version.id, "CONSISTENT", "OBSERVED"),
      );
    }
  }
  for (const object of inventory) {
    if (!versionsByHash.has(object.objectKeyHash)) {
      findings.push(
        finding(object.objectKeyHash, null, "OBJECT_WITHOUT_DB", "QUARANTINED"),
      );
    }
  }

  let changed = 0;
  if (input.mode === "command") {
    for (const item of findings) {
      const idempotencyKey = `phase21:${item.kind}:${item.objectKeyHash}:${item.documentVersionId ?? "orphan"}`;
      const result =
        await dependencies.database.objectLifecycleOutcome.createMany({
          data: [
            {
              documentVersionId: item.documentVersionId,
              objectKeyHash: item.objectKeyHash,
              kind: item.kind,
              status: item.status,
              reasonCode:
                item.kind === "DELETE_PENDING" || item.kind === "LEGAL_HOLD"
                  ? "AWAITING_PHASE22_POLICY"
                  : "PHASE21_RECONCILIATION",
              idempotencyKey,
              observedAt: now,
            },
          ],
          skipDuplicates: true,
        });
      changed += result.count;
      if (
        item.kind === "INCOMPLETE_UPLOAD" &&
        item.documentVersionId !== null
      ) {
        await dependencies.database.documentUploadIntent.updateMany({
          where: {
            documentVersionId: item.documentVersionId,
            status: { in: ["CREATED", "UPLOADING"] },
          },
          data: {
            status: "ABORTED",
            abortedAt: now,
            failureCode: "RECONCILED_INCOMPLETE",
            updatedAt: now,
          },
        });
      }
    }
  }
  return Object.freeze({
    ok: true,
    findings: Object.freeze(findings),
    changed,
  });
}

function finding(
  objectKeyHash: string,
  documentVersionId: string | null,
  kind: DocumentReconciliationFinding["kind"],
  status: DocumentReconciliationFinding["status"],
): DocumentReconciliationFinding {
  return Object.freeze({ objectKeyHash, documentVersionId, kind, status });
}

function hashObjectKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
