import "server-only";

import { createHash } from "node:crypto";

import type { DatabaseClient } from "@/lib/db/factory";

/**
 * Phase 21 exposes a redacted, replay-safe manifest and lifecycle hooks only.
 * Phase 22 remains the sole authority that may decide retention, Legal Hold,
 * export release, or erasure.
 */
export async function getCandidateDocumentLifecycleManifest(
  candidateProfileId: string,
  database: DatabaseClient,
) {
  const versions = await database.documentVersion.findMany({
    where: { candidateProfileId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      documentId: true,
      sequence: true,
      status: true,
      sizeBytes: true,
      sha256: true,
      classification: true,
      storageRegion: true,
      createdAt: true,
      uploadedAt: true,
      scanCompletedAt: true,
      applicationLinks: { select: { applicationId: true } },
    },
  });
  return Object.freeze(
    versions.map((version) =>
      Object.freeze({
        documentVersionId: version.id,
        documentId: version.documentId,
        sequence: version.sequence,
        status: version.status,
        sizeBytes: version.sizeBytes,
        contentDigest: version.sha256,
        classification: version.classification,
        storageRegion: version.storageRegion,
        createdAt: version.createdAt,
        uploadedAt: version.uploadedAt,
        scanCompletedAt: version.scanCompletedAt,
        applicationReferenceHashes: Object.freeze(
          version.applicationLinks.map((link) =>
            createHash("sha256")
              .update(link.applicationId, "utf8")
              .digest("hex"),
          ),
        ),
      }),
    ),
  );
}

export async function getDocumentHoldHook(
  documentVersionId: string,
  database: DatabaseClient,
) {
  const version = await database.documentVersion.findUnique({
    where: { id: documentVersionId },
    select: {
      id: true,
      status: true,
      applicationLinks: { select: { id: true }, take: 1 },
    },
  });
  if (version === null) return null;
  return Object.freeze({
    documentVersionId: version.id,
    held: version.status === "HELD",
    hasApplicationEvidence: version.applicationLinks.length > 0,
    authority: "PHASE_22_REQUIRED" as const,
  });
}
