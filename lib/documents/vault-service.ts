import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { hasAdminCapability } from "@/lib/admin/capabilities";
import { resolveAdminActor } from "@/lib/admin/role-policy";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  DOCUMENT_UPLOAD_POLICY_V1,
  validateDocumentUploadMetadata,
} from "@/lib/documents/document-upload-policy";
import {
  assertDocumentBulkAccessDisabled,
  isDocumentDataProvenanceAllowed,
  resolveDocumentRuntime,
} from "@/lib/documents/runtime-policy";
import { hasExactDocumentProviderAuthority } from "@/lib/documents/provider-activation-guard";
import { getDocumentStorageEncryptionVersion } from "@/lib/providers/storage/document-storage-composition";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";
import { DocumentObjectStoreFailure } from "@/lib/providers/storage/document-object-store";
import type {
  MalwareScanner,
  MalwareScanReceipt,
} from "@/lib/providers/storage/malware-scanner";

const AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

export type VaultDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  objectStore: DocumentObjectStore;
  scanner: MalwareScanner;
  now?: Date;
}>;

export type CreateDocumentUploadIntentResult =
  | Readonly<{
      ok: true;
      duplicate: boolean;
      intentId: string;
      documentVersionId: string;
      expiresAt: Date;
      status: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "DOCUMENT_VAULT_UNAVAILABLE"
        | "NOT_AUTHORIZED"
        | "INVALID_UPLOAD"
        | "UPLOAD_CONFLICT"
        | "UPLOAD_QUOTA_EXCEEDED";
      detailCode?: string;
    }>;

export async function createDocumentUploadIntent(
  input: Readonly<{
    actorUserId: string;
    filename: string;
    declaredMimeType: string;
    expectedSizeBytes: number;
    expectedSha256?: string;
    idempotencyKey: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<CreateDocumentUploadIntentResult> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available || !runtime.writes) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  assertDocumentBulkAccessDisabled(dependencies.environment);
  const encryptionKeyVersion = getDocumentStorageEncryptionVersion(
    dependencies.environment,
  );
  if (encryptionKeyVersion === null) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const policy = validateDocumentUploadMetadata(input);
  if (!policy.ok || !isBoundedIdempotencyKey(input.idempotencyKey)) {
    return Object.freeze({
      ok: false,
      code: "INVALID_UPLOAD",
      detailCode: policy.ok ? "INVALID_IDEMPOTENCY_KEY" : policy.code,
    });
  }
  const now = dependencies.now ?? new Date();

  try {
    return await withSerializationRetry(() =>
      dependencies.database.$transaction(
        async (transaction) => {
          await acquireDocumentLock(transaction, input.actorUserId, "CV");
          const profile = await transaction.candidateProfile.findUnique({
            where: { userId: input.actorUserId },
            select: {
              id: true,
              user: {
                select: {
                  role: true,
                  status: true,
                  dataProvenance: true,
                },
              },
            },
          });
          if (
            profile === null ||
            profile.user.role !== "CANDIDATE" ||
            profile.user.status !== "ACTIVE" ||
            !isDocumentDataProvenanceAllowed(
              dependencies.environment,
              profile.user.dataProvenance,
            )
          ) {
            return Object.freeze({
              ok: false as const,
              code: "NOT_AUTHORIZED" as const,
            });
          }

          const replay = await transaction.documentUploadIntent.findUnique({
            where: {
              actorUserId_idempotencyKey: {
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
              },
            },
            select: {
              id: true,
              documentVersionId: true,
              expectedSizeBytes: true,
              expectedSha256: true,
              declaredMimeType: true,
              safeFilename: true,
              expiresAt: true,
              status: true,
            },
          });
          if (replay !== null) {
            if (
              replay.expectedSizeBytes !== policy.expectedSizeBytes ||
              replay.expectedSha256 !== (policy.expectedSha256 ?? null) ||
              replay.declaredMimeType !== policy.declaredMimeType ||
              replay.safeFilename !== policy.safeFilename
            ) {
              return Object.freeze({
                ok: false as const,
                code: "UPLOAD_CONFLICT" as const,
              });
            }
            return Object.freeze({
              ok: true as const,
              duplicate: true,
              intentId: replay.id,
              documentVersionId: replay.documentVersionId,
              expiresAt: replay.expiresAt,
              status: replay.status,
            });
          }

          await transaction.documentUploadIntent.updateMany({
            where: {
              candidateProfileId: profile.id,
              purpose: "CV",
              status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
              expiresAt: { lte: now },
            },
            data: {
              status: "EXPIRED",
              abortedAt: now,
            },
          });
          const activeUploads = await transaction.documentUploadIntent.count({
            where: {
              actorUserId: input.actorUserId,
              status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
              expiresAt: { gt: now },
            },
          });
          if (
            activeUploads >=
            DOCUMENT_UPLOAD_POLICY_V1.maximumConcurrentUploadsPerActor
          ) {
            return Object.freeze({
              ok: false as const,
              code: "UPLOAD_QUOTA_EXCEEDED" as const,
            });
          }
          const currentForPurpose =
            await transaction.documentUploadIntent.findFirst({
              where: {
                candidateProfileId: profile.id,
                purpose: "CV",
                status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
                expiresAt: { gt: now },
              },
              select: { id: true },
            });
          if (currentForPurpose !== null) {
            return Object.freeze({
              ok: false as const,
              code: "UPLOAD_CONFLICT" as const,
            });
          }

          const document = await transaction.document.upsert({
            where: {
              candidateProfileId_purpose: {
                candidateProfileId: profile.id,
                purpose: "CV",
              },
            },
            update: { updatedAt: now },
            create: {
              candidateProfileId: profile.id,
              purpose: "CV",
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          const latestVersion = await transaction.documentVersion.findFirst({
            where: { documentId: document.id },
            orderBy: [{ sequence: "desc" }, { id: "desc" }],
            select: { sequence: true },
          });
          const documentVersionId = randomUUID();
          const objectVersion = randomUUID();
          await transaction.documentVersion.create({
            data: {
              id: documentVersionId,
              documentId: document.id,
              candidateProfileId: profile.id,
              sequence: (latestVersion?.sequence ?? 0) + 1,
              objectKey: `candidate-cv/${documentVersionId}`,
              providerObjectVersion: objectVersion,
              safeFilename: policy.safeFilename,
              declaredMimeType: policy.declaredMimeType,
              encryptionKeyVersion,
              storageRegion: dependencies.environment.DOCUMENT_STORAGE_REGION,
              status: "UPLOADING",
              createdAt: now,
            },
          });
          const expiresAt = new Date(
            now.getTime() + DOCUMENT_UPLOAD_POLICY_V1.intentTtlMilliseconds,
          );
          const intent = await transaction.documentUploadIntent.create({
            data: {
              documentVersionId,
              candidateProfileId: profile.id,
              actorUserId: input.actorUserId,
              purpose: "CV",
              idempotencyKey: input.idempotencyKey,
              expectedSizeBytes: policy.expectedSizeBytes,
              expectedSha256: policy.expectedSha256,
              declaredMimeType: policy.declaredMimeType,
              safeFilename: policy.safeFilename,
              status: "CREATED",
              expiresAt,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          await transaction.documentAccessEvent.create({
            data: {
              documentVersionId,
              actorUserId: input.actorUserId,
              kind: "UPLOAD_INTENT_CREATED",
              outcomeCode: "CREATED",
              correlationId: input.correlationId,
              occurredAt: now,
            },
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "DOCUMENT_UPLOAD_INTENT_CREATED",
              actorKind: "USER",
              actorUserId: input.actorUserId,
              capability: "CANDIDATE_DOCUMENT_UPLOAD",
              correlationId: input.correlationId,
              result: "SUCCEEDED",
              retainUntil: new Date(
                now.getTime() + AUDIT_RETENTION_MILLISECONDS,
              ),
              targetId: intent.id,
              targetType: "DOCUMENT_UPLOAD_INTENT",
            },
          );
          return Object.freeze({
            ok: true as const,
            duplicate: false,
            intentId: intent.id,
            documentVersionId,
            expiresAt,
            status: "CREATED",
          });
        },
        { isolationLevel: "Serializable" },
      ),
    );
  } catch {
    return Object.freeze({
      ok: false,
      code: "UPLOAD_CONFLICT",
    });
  }
}

export async function createCompanyVerificationDocumentUploadIntent(
  input: Readonly<{
    actorUserId: string;
    companyId: string;
    membershipId: string;
    filename: string;
    declaredMimeType: string;
    expectedSizeBytes: number;
    expectedSha256?: string;
    idempotencyKey: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<CreateDocumentUploadIntentResult> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (
    !runtime.available ||
    !runtime.writes ||
    !dependencies.environment.COMPANY_VERIFICATION_DOCUMENT
  ) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  assertDocumentBulkAccessDisabled(dependencies.environment);
  const encryptionKeyVersion = getDocumentStorageEncryptionVersion(
    dependencies.environment,
  );
  if (encryptionKeyVersion === null) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const policy = validateDocumentUploadMetadata(input);
  if (!policy.ok || !isBoundedIdempotencyKey(input.idempotencyKey)) {
    return Object.freeze({
      ok: false,
      code: "INVALID_UPLOAD",
      detailCode: policy.ok ? "INVALID_IDEMPOTENCY_KEY" : policy.code,
    });
  }
  const now = dependencies.now ?? new Date();
  try {
    return await withSerializationRetry(() =>
      dependencies.database.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT pg_advisory_xact_lock(
              hashtextextended(
                ${`document-upload:${input.companyId}:COMPANY_VERIFICATION`},
                0
              )
            ) IS NULL AS "locked"
          `;
          const company = await transaction.company.findFirst({
            where: {
              id: input.companyId,
              status: "ACTIVE",
              dataProvenance:
                runtime.mode === "LIVE" ? "LIVE" : { in: ["DEMO", "TEST"] },
              memberships: {
                some: {
                  id: input.membershipId,
                  userId: input.actorUserId,
                  status: "ACTIVE",
                  removedAt: null,
                  role: { in: ["OWNER", "ADMIN"] },
                },
              },
            },
            select: { id: true },
          });
          if (company === null) {
            return Object.freeze({
              ok: false as const,
              code: "NOT_AUTHORIZED" as const,
            });
          }
          const replay = await transaction.documentUploadIntent.findUnique({
            where: {
              actorUserId_idempotencyKey: {
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
              },
            },
            select: {
              id: true,
              companyId: true,
              purpose: true,
              documentVersionId: true,
              expectedSizeBytes: true,
              expectedSha256: true,
              declaredMimeType: true,
              safeFilename: true,
              expiresAt: true,
              status: true,
            },
          });
          if (replay !== null) {
            if (
              replay.companyId !== input.companyId ||
              replay.purpose !== "COMPANY_VERIFICATION" ||
              replay.expectedSizeBytes !== policy.expectedSizeBytes ||
              replay.expectedSha256 !== (policy.expectedSha256 ?? null) ||
              replay.declaredMimeType !== policy.declaredMimeType ||
              replay.safeFilename !== policy.safeFilename
            ) {
              return Object.freeze({
                ok: false as const,
                code: "UPLOAD_CONFLICT" as const,
              });
            }
            return Object.freeze({
              ok: true as const,
              duplicate: true,
              intentId: replay.id,
              documentVersionId: replay.documentVersionId,
              expiresAt: replay.expiresAt,
              status: replay.status,
            });
          }
          await transaction.documentUploadIntent.updateMany({
            where: {
              companyId: input.companyId,
              purpose: "COMPANY_VERIFICATION",
              status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
              expiresAt: { lte: now },
            },
            data: { status: "EXPIRED", abortedAt: now },
          });
          const activeUploads = await transaction.documentUploadIntent.count({
            where: {
              actorUserId: input.actorUserId,
              status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
              expiresAt: { gt: now },
            },
          });
          if (
            activeUploads >=
            DOCUMENT_UPLOAD_POLICY_V1.maximumConcurrentUploadsPerActor
          ) {
            return Object.freeze({
              ok: false as const,
              code: "UPLOAD_QUOTA_EXCEEDED" as const,
            });
          }
          const currentForPurpose =
            await transaction.documentUploadIntent.findFirst({
              where: {
                companyId: input.companyId,
                purpose: "COMPANY_VERIFICATION",
                status: { in: ["CREATED", "UPLOADING", "UPLOADED"] },
                expiresAt: { gt: now },
              },
              select: { id: true },
            });
          if (currentForPurpose !== null) {
            return Object.freeze({
              ok: false as const,
              code: "UPLOAD_CONFLICT" as const,
            });
          }
          const document = await transaction.document.upsert({
            where: {
              companyId_purpose: {
                companyId: input.companyId,
                purpose: "COMPANY_VERIFICATION",
              },
            },
            update: { updatedAt: now },
            create: {
              companyId: input.companyId,
              purpose: "COMPANY_VERIFICATION",
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          const latestVersion = await transaction.documentVersion.findFirst({
            where: { documentId: document.id },
            orderBy: [{ sequence: "desc" }, { id: "desc" }],
            select: { sequence: true },
          });
          const documentVersionId = randomUUID();
          const objectVersion = randomUUID();
          await transaction.documentVersion.create({
            data: {
              id: documentVersionId,
              documentId: document.id,
              companyId: input.companyId,
              sequence: (latestVersion?.sequence ?? 0) + 1,
              objectKey: `company-verification/${documentVersionId}`,
              providerObjectVersion: objectVersion,
              safeFilename: policy.safeFilename,
              declaredMimeType: policy.declaredMimeType,
              encryptionKeyVersion,
              storageRegion: dependencies.environment.DOCUMENT_STORAGE_REGION,
              status: "UPLOADING",
              createdAt: now,
            },
          });
          const expiresAt = new Date(
            now.getTime() + DOCUMENT_UPLOAD_POLICY_V1.intentTtlMilliseconds,
          );
          const intent = await transaction.documentUploadIntent.create({
            data: {
              documentVersionId,
              companyId: input.companyId,
              actorUserId: input.actorUserId,
              purpose: "COMPANY_VERIFICATION",
              idempotencyKey: input.idempotencyKey,
              expectedSizeBytes: policy.expectedSizeBytes,
              expectedSha256: policy.expectedSha256,
              declaredMimeType: policy.declaredMimeType,
              safeFilename: policy.safeFilename,
              status: "CREATED",
              expiresAt,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          await transaction.documentAccessEvent.create({
            data: {
              documentVersionId,
              actorUserId: input.actorUserId,
              companyId: input.companyId,
              kind: "UPLOAD_INTENT_CREATED",
              outcomeCode: "CREATED",
              correlationId: input.correlationId,
              occurredAt: now,
            },
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "DOCUMENT_UPLOAD_INTENT_CREATED",
              actorKind: "USER",
              actorUserId: input.actorUserId,
              capability: "COMPANY_VERIFICATION_DOCUMENT_UPLOAD",
              companyId: input.companyId,
              correlationId: input.correlationId,
              result: "SUCCEEDED",
              retainUntil: new Date(
                now.getTime() + AUDIT_RETENTION_MILLISECONDS,
              ),
              targetId: intent.id,
              targetType: "DOCUMENT_UPLOAD_INTENT",
            },
          );
          return Object.freeze({
            ok: true as const,
            duplicate: false,
            intentId: intent.id,
            documentVersionId,
            expiresAt,
            status: "CREATED",
          });
        },
        { isolationLevel: "Serializable" },
      ),
    );
  } catch {
    return Object.freeze({ ok: false, code: "UPLOAD_CONFLICT" });
  }
}

export async function uploadDocumentIntentBody(
  input: Readonly<{
    actorUserId: string;
    intentId: string;
    body: AsyncIterable<Uint8Array>;
    declaredContentLength: number | null;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{
      ok: true;
      duplicate: boolean;
      documentVersionId: string;
      sizeBytes: number;
      sha256: string;
      status: "QUARANTINED";
    }>
  | Readonly<{
      ok: false;
      code:
        | "DOCUMENT_VAULT_UNAVAILABLE"
        | "NOT_FOUND"
        | "INTENT_EXPIRED"
        | "INVALID_STATE"
        | "UPLOAD_REJECTED";
      detailCode?: string;
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available || !runtime.writes) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const now = dependencies.now ?? new Date();
  const prepared = await withSerializationRetry(() =>
    dependencies.database.$transaction(
      async (transaction) => {
        const intent = await transaction.documentUploadIntent.findFirst({
          where: { id: input.intentId, actorUserId: input.actorUserId },
          select: uploadIntentSelect,
        });
        if (intent === null) return { kind: "NOT_FOUND" as const };
        await lockRow(transaction, "DocumentUploadIntent", intent.id);
        const current =
          await transaction.documentUploadIntent.findUniqueOrThrow({
            where: { id: intent.id },
            select: uploadIntentSelect,
          });
        if (current.expiresAt <= now) {
          if (["CREATED", "UPLOADING", "UPLOADED"].includes(current.status)) {
            await transaction.documentUploadIntent.update({
              where: { id: current.id },
              data: { status: "EXPIRED", abortedAt: now, updatedAt: now },
            });
          }
          return { kind: "EXPIRED" as const };
        }
        if (current.status === "UPLOADED" || current.status === "FINALIZED") {
          return { kind: "DUPLICATE" as const, intent: current };
        }
        if (current.status !== "CREATED" && current.status !== "UPLOADING") {
          return { kind: "INVALID_STATE" as const };
        }
        if (current.status === "CREATED") {
          await transaction.documentUploadIntent.update({
            where: { id: current.id },
            data: { status: "UPLOADING", updatedAt: now },
          });
          await transaction.documentAccessEvent.create({
            data: {
              documentVersionId: current.documentVersionId,
              actorUserId: input.actorUserId,
              companyId: current.companyId,
              kind: "UPLOAD_STARTED",
              outcomeCode: "STREAMING",
              correlationId: input.correlationId,
              occurredAt: now,
            },
          });
        }
        return { kind: "READY" as const, intent: current };
      },
      { isolationLevel: "Serializable" },
    ),
  );
  if (prepared.kind === "NOT_FOUND") {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (prepared.kind === "EXPIRED") {
    return Object.freeze({ ok: false, code: "INTENT_EXPIRED" });
  }
  if (prepared.kind === "INVALID_STATE") {
    return Object.freeze({ ok: false, code: "INVALID_STATE" });
  }

  const intent = prepared.intent;
  if (
    input.declaredContentLength === null ||
    !Number.isSafeInteger(input.declaredContentLength) ||
    input.declaredContentLength !== intent.expectedSizeBytes
  ) {
    await dependencies.database.documentUploadIntent
      .updateMany({
        where: {
          id: intent.id,
          actorUserId: input.actorUserId,
          status: "UPLOADING",
        },
        data: {
          status: "FAILED",
          failureCode: "CONTENT_LENGTH_MISMATCH",
          updatedAt: now,
        },
      })
      .catch(() => undefined);
    return Object.freeze({
      ok: false,
      code: "UPLOAD_REJECTED",
      detailCode: "CONTENT_LENGTH_MISMATCH",
    });
  }
  if (
    !(await hasExactDocumentProviderAuthority(
      dependencies.database,
      dependencies.environment,
      now,
      ["OBJECT_STORE"],
    ))
  ) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  if (prepared.kind === "DUPLICATE") {
    const receipt = await dependencies.objectStore.headObject(
      intent.documentVersion.objectKey,
    );
    if (receipt === null) {
      return Object.freeze({ ok: false, code: "UPLOAD_REJECTED" });
    }
    return Object.freeze({
      ok: true,
      duplicate: true,
      documentVersionId: intent.documentVersionId,
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      status: "QUARANTINED",
    });
  }

  let receipt;
  try {
    receipt = await dependencies.objectStore.putQuarantined({
      objectKey: intent.documentVersion.objectKey,
      objectVersion: intent.documentVersion.providerObjectVersion,
      expectedSizeBytes: intent.expectedSizeBytes,
      expectedSha256: intent.expectedSha256 ?? undefined,
      body: input.body,
    });
  } catch (error) {
    if (
      error instanceof DocumentObjectStoreFailure &&
      error.code === "OBJECT_ALREADY_EXISTS"
    ) {
      const existing = await dependencies.objectStore.headObject(
        intent.documentVersion.objectKey,
      );
      if (
        existing !== null &&
        existing.objectVersion ===
          intent.documentVersion.providerObjectVersion &&
        existing.sizeBytes === intent.expectedSizeBytes &&
        (intent.expectedSha256 === null ||
          existing.sha256 === intent.expectedSha256)
      ) {
        receipt = existing;
      }
    }
    if (receipt === undefined) {
      await dependencies.database.documentUploadIntent
        .updateMany({
          where: {
            id: intent.id,
            actorUserId: input.actorUserId,
            status: "UPLOADING",
          },
          data: {
            status: "FAILED",
            failureCode:
              error instanceof DocumentObjectStoreFailure
                ? error.code
                : "PROVIDER_IO_FAILURE",
            updatedAt: now,
          },
        })
        .catch(() => undefined);
      return Object.freeze({
        ok: false,
        code: "UPLOAD_REJECTED",
        detailCode:
          error instanceof DocumentObjectStoreFailure
            ? error.code
            : "PROVIDER_IO_FAILURE",
      });
    }
  }

  await withSerializationRetry(() =>
    dependencies.database.$transaction(
      async (transaction) => {
        await lockRow(transaction, "DocumentUploadIntent", intent.id);
        const current =
          await transaction.documentUploadIntent.findUniqueOrThrow({
            where: { id: intent.id },
            select: { status: true },
          });
        if (current.status === "UPLOADING") {
          await transaction.documentVersion.update({
            where: { id: intent.documentVersionId },
            data: {
              status: "QUARANTINED",
              sizeBytes: receipt!.sizeBytes,
              sha256: receipt!.sha256,
              uploadedAt: now,
            },
          });
          await transaction.documentUploadIntent.update({
            where: { id: intent.id },
            data: { status: "UPLOADED", updatedAt: now },
          });
          await transaction.documentAccessEvent.create({
            data: {
              documentVersionId: intent.documentVersionId,
              actorUserId: input.actorUserId,
              companyId: intent.companyId,
              kind: "UPLOAD_COMPLETED",
              outcomeCode: "QUARANTINED",
              correlationId: input.correlationId,
              occurredAt: now,
            },
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "DOCUMENT_UPLOAD_COMPLETED",
              actorKind: "USER",
              actorUserId: input.actorUserId,
              capability:
                intent.companyId === null
                  ? "CANDIDATE_DOCUMENT_UPLOAD"
                  : "COMPANY_VERIFICATION_DOCUMENT_UPLOAD",
              companyId: intent.companyId,
              correlationId: input.correlationId,
              result: "SUCCEEDED",
              retainUntil: new Date(
                now.getTime() + AUDIT_RETENTION_MILLISECONDS,
              ),
              targetId: intent.documentVersionId,
              targetType: "DOCUMENT_VERSION",
            },
          );
        }
      },
      { isolationLevel: "Serializable" },
    ),
  );
  return Object.freeze({
    ok: true,
    duplicate: false,
    documentVersionId: intent.documentVersionId,
    sizeBytes: receipt.sizeBytes,
    sha256: receipt.sha256,
    status: "QUARANTINED",
  });
}

export async function finalizeDocumentUploadIntent(
  input: Readonly<{
    actorUserId: string;
    intentId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{ ok: true; duplicate: boolean; documentVersionId: string }>
  | Readonly<{
      ok: false;
      code:
        | "DOCUMENT_VAULT_UNAVAILABLE"
        | "NOT_FOUND"
        | "INTENT_EXPIRED"
        | "INVALID_STATE"
        | "PROVIDER_MISMATCH";
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available || !runtime.writes) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const now = dependencies.now ?? new Date();
  const intent = await dependencies.database.documentUploadIntent.findFirst({
    where: { id: input.intentId, actorUserId: input.actorUserId },
    select: uploadIntentSelect,
  });
  if (intent === null) return Object.freeze({ ok: false, code: "NOT_FOUND" });
  if (intent.expiresAt <= now) {
    return Object.freeze({ ok: false, code: "INTENT_EXPIRED" });
  }
  if (intent.status === "FINALIZED") {
    return Object.freeze({
      ok: true,
      duplicate: true,
      documentVersionId: intent.documentVersionId,
    });
  }
  if (intent.status !== "UPLOADED") {
    return Object.freeze({ ok: false, code: "INVALID_STATE" });
  }
  if (
    !(await hasExactDocumentProviderAuthority(
      dependencies.database,
      dependencies.environment,
      now,
      ["OBJECT_STORE"],
    ))
  ) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const receipt = await dependencies.objectStore.headObject(
    intent.documentVersion.objectKey,
  );
  if (
    receipt === null ||
    receipt.objectVersion !== intent.documentVersion.providerObjectVersion ||
    receipt.sizeBytes !== intent.expectedSizeBytes ||
    receipt.sha256 !== intent.documentVersion.sha256 ||
    (intent.expectedSha256 !== null && receipt.sha256 !== intent.expectedSha256)
  ) {
    await dependencies.database.documentUploadIntent.updateMany({
      where: { id: intent.id, status: "UPLOADED" },
      data: {
        status: "FAILED",
        failureCode: "PROVIDER_MISMATCH",
        updatedAt: now,
      },
    });
    return Object.freeze({ ok: false, code: "PROVIDER_MISMATCH" });
  }
  const updated = await dependencies.database.documentUploadIntent.updateMany({
    where: {
      id: intent.id,
      actorUserId: input.actorUserId,
      status: "UPLOADED",
    },
    data: { status: "FINALIZED", finalizedAt: now, updatedAt: now },
  });
  return Object.freeze({
    ok: true,
    duplicate: updated.count === 0,
    documentVersionId: intent.documentVersionId,
  });
}

export async function scanDocumentVersion(
  input: Readonly<{
    actorUserId: string;
    documentVersionId: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{
      ok: true;
      duplicate: boolean;
      status: "CLEAN" | "REJECTED" | "INFECTED" | "SCAN_FAILED";
      outcomeCode: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "DOCUMENT_VAULT_UNAVAILABLE"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "PROVIDER_DEGRADED";
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available || !runtime.writes) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const now = dependencies.now ?? new Date();
  const prepared = await withSerializationRetry(() =>
    dependencies.database.$transaction(
      async (transaction) => {
        await lockRow(transaction, "DocumentVersion", input.documentVersionId);
        const version = await transaction.documentVersion.findFirst({
          where: {
            id: input.documentVersionId,
            OR: [
              { candidateProfile: { userId: input.actorUserId } },
              {
                company: {
                  memberships: {
                    some: {
                      userId: input.actorUserId,
                      status: "ACTIVE",
                      removedAt: null,
                      role: { in: ["OWNER", "ADMIN"] },
                    },
                  },
                },
              },
            ],
          },
          select: scanVersionSelect,
        });
        if (version === null) return { kind: "NOT_FOUND" as const };
        if (["CLEAN", "REJECTED", "INFECTED"].includes(version.status)) {
          return { kind: "TERMINAL" as const, version };
        }
        if (
          version.status !== "QUARANTINED" &&
          version.status !== "SCAN_FAILED"
        ) {
          return { kind: "INVALID_STATE" as const };
        }
        await transaction.documentVersion.update({
          where: { id: version.id },
          data: { status: "SCANNING", scanCompletedAt: null },
        });
        await transaction.documentAccessEvent.create({
          data: {
            documentVersionId: version.id,
            actorUserId: input.actorUserId,
            kind: "SCAN_REQUESTED",
            outcomeCode: "SCANNING",
            correlationId: input.correlationId,
            occurredAt: now,
          },
        });
        return { kind: "READY" as const, version };
      },
      { isolationLevel: "Serializable" },
    ),
  );
  if (prepared.kind === "NOT_FOUND") {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (prepared.kind === "INVALID_STATE") {
    return Object.freeze({ ok: false, code: "INVALID_STATE" });
  }
  if (prepared.kind === "TERMINAL") {
    const status = prepared.version.status as "CLEAN" | "REJECTED" | "INFECTED";
    return Object.freeze({
      ok: true,
      duplicate: true,
      status,
      outcomeCode: "ALREADY_TERMINAL",
    });
  }

  if (
    !(await hasExactDocumentProviderAuthority(
      dependencies.database,
      dependencies.environment,
      now,
      ["OBJECT_STORE", "MALWARE_SCANNER"],
    ))
  ) {
    await dependencies.database.documentVersion.updateMany({
      where: { id: prepared.version.id, status: "SCANNING" },
      data: { status: "SCAN_FAILED", scanCompletedAt: now },
    });
    return Object.freeze({ ok: false, code: "PROVIDER_DEGRADED" });
  }

  const opened = await dependencies.objectStore.openVerifiedRead(
    prepared.version.objectKey,
  );
  let receipt: MalwareScanReceipt;
  if (opened === null) {
    receipt = Object.freeze({
      engineVersion: "storage-verifier-v1",
      signatureVersion: "not-applicable",
      outcome: "FAILED",
      outcomeCode: "OBJECT_MISSING",
      detectedMimeType: null,
    });
  } else {
    receipt = await dependencies.scanner.scan(opened.body, {
      declaredMimeType: prepared.version.declaredMimeType,
      timeoutMilliseconds: DOCUMENT_UPLOAD_POLICY_V1.scannerTimeoutMilliseconds,
    });
  }
  const status = scanOutcomeToStatus(receipt.outcome);

  await withSerializationRetry(() =>
    dependencies.database.$transaction(
      async (transaction) => {
        await lockRow(transaction, "DocumentVersion", prepared.version.id);
        const current = await transaction.documentVersion.findUniqueOrThrow({
          where: { id: prepared.version.id },
          select: { status: true },
        });
        if (current.status !== "SCANNING") return;
        const lastAttempt = await transaction.documentScanAttempt.findFirst({
          where: { documentVersionId: prepared.version.id },
          orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
          select: { attemptNumber: true },
        });
        await transaction.documentScanAttempt.create({
          data: {
            documentVersionId: prepared.version.id,
            attemptNumber: (lastAttempt?.attemptNumber ?? 0) + 1,
            engineVersion: receipt.engineVersion,
            signatureVersion: receipt.signatureVersion,
            outcome: receipt.outcome,
            detectedMimeType: receipt.detectedMimeType,
            outcomeCode: receipt.outcomeCode,
            startedAt: now,
            completedAt: now,
          },
        });
        await transaction.documentVersion.update({
          where: { id: prepared.version.id },
          data: {
            status,
            detectedMimeType: receipt.detectedMimeType,
            scanCompletedAt: now,
          },
        });

        if (status === "CLEAN") {
          const canonical = await transaction.document.findUniqueOrThrow({
            where: { id: prepared.version.documentId },
            select: { currentVersionId: true },
          });
          if (
            canonical.currentVersionId !== null &&
            canonical.currentVersionId !== prepared.version.id
          ) {
            const replaced = await transaction.documentVersion.updateMany({
              where: {
                id: canonical.currentVersionId,
                ...(prepared.version.candidateProfileId === null
                  ? { companyId: prepared.version.companyId }
                  : {
                      candidateProfileId: prepared.version.candidateProfileId,
                    }),
                status: "CLEAN",
              },
              data: { status: "REPLACED", replacedAt: now },
            });
            if (replaced.count > 0) {
              await writeRequiredAudit(
                createPrismaTransactionAuditPort(transaction),
                {
                  action: "DOCUMENT_REPLACED",
                  actorKind: "USER",
                  actorUserId: input.actorUserId,
                  capability:
                    prepared.version.companyId === null
                      ? "CANDIDATE_DOCUMENT_REPLACE"
                      : "COMPANY_VERIFICATION_DOCUMENT_REPLACE",
                  companyId: prepared.version.companyId,
                  correlationId: input.correlationId,
                  result: "SUCCEEDED",
                  retainUntil: new Date(
                    now.getTime() + AUDIT_RETENTION_MILLISECONDS,
                  ),
                  targetId: canonical.currentVersionId,
                  targetType: "DOCUMENT_VERSION",
                },
              );
            }
          }
          if (prepared.version.candidateProfileId !== null) {
            await transaction.candidateDocumentMetadata.updateMany({
              where: {
                candidateProfileId: prepared.version.candidateProfileId,
                purpose: "CV",
                status: "ACTIVE",
                NOT: { documentVersionId: prepared.version.id },
              },
              data: { status: "REMOVED", removedAt: now },
            });
            await transaction.candidateDocumentMetadata.upsert({
              where: { documentVersionId: prepared.version.id },
              update: {
                status: "ACTIVE",
                removedAt: null,
                storageKind: "VAULT_ENCRYPTED",
              },
              create: {
                candidateProfileId: prepared.version.candidateProfileId,
                storageKey: `vault-version:${prepared.version.id}`,
                safeFilename: prepared.version.safeFilename,
                mimeType:
                  receipt.detectedMimeType ?? prepared.version.declaredMimeType,
                sizeBytes: prepared.version.sizeBytes!,
                purpose: "CV",
                status: "ACTIVE",
                storageKind: "VAULT_ENCRYPTED",
                documentVersionId: prepared.version.id,
                createdAt: now,
              },
            });
          }
          await transaction.document.update({
            where: { id: prepared.version.documentId },
            data: { currentVersionId: prepared.version.id, updatedAt: now },
          });
        }

        await transaction.documentAccessEvent.create({
          data: {
            documentVersionId: prepared.version.id,
            actorUserId: input.actorUserId,
            companyId: prepared.version.companyId,
            kind: "SCAN_COMPLETED",
            outcomeCode: receipt.outcomeCode,
            correlationId: input.correlationId,
            occurredAt: now,
          },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "DOCUMENT_SCAN_COMPLETED",
            actorKind: "USER",
            actorUserId: input.actorUserId,
            capability:
              prepared.version.companyId === null
                ? "CANDIDATE_DOCUMENT_SCAN_SANDBOX"
                : "COMPANY_VERIFICATION_DOCUMENT_SCAN",
            companyId: prepared.version.companyId,
            correlationId: input.correlationId,
            reasonCode: receipt.outcomeCode,
            result: status === "CLEAN" ? "SUCCEEDED" : "DENIED",
            retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
            targetId: prepared.version.id,
            targetType: "DOCUMENT_VERSION",
          },
        );
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return Object.freeze({
    ok: true,
    duplicate: false,
    status,
    outcomeCode: receipt.outcomeCode,
  });
}

export async function requestCandidateDocumentDeletion(
  input: Readonly<{
    actorUserId: string;
    documentVersionId: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{ ok: true; status: "DELETE_PENDING" }>
  | Readonly<{ ok: false; code: "NOT_FOUND" | "INVALID_STATE" }>
> {
  const now = dependencies.now ?? new Date();
  return dependencies.database.$transaction(
    async (transaction) => {
      await lockRow(transaction, "DocumentVersion", input.documentVersionId);
      const version = await transaction.documentVersion.findFirst({
        where: {
          id: input.documentVersionId,
          candidateProfile: { userId: input.actorUserId },
        },
        select: {
          id: true,
          documentId: true,
          candidateProfileId: true,
          status: true,
        },
      });
      if (version === null) {
        return Object.freeze({
          ok: false as const,
          code: "NOT_FOUND" as const,
        });
      }
      if (version.status !== "CLEAN" && version.status !== "REPLACED") {
        return Object.freeze({
          ok: false as const,
          code: "INVALID_STATE" as const,
        });
      }
      await transaction.documentVersion.update({
        where: { id: version.id },
        data: { status: "DELETE_PENDING", deleteRequestedAt: now },
      });
      await transaction.document.updateMany({
        where: { id: version.documentId, currentVersionId: version.id },
        data: { currentVersionId: null, updatedAt: now },
      });
      await transaction.candidateDocumentMetadata.updateMany({
        where: { documentVersionId: version.id, status: "ACTIVE" },
        data: { status: "REMOVED", removedAt: now },
      });
      await transaction.documentAccessEvent.create({
        data: {
          documentVersionId: version.id,
          actorUserId: input.actorUserId,
          kind: "DELETE_REQUESTED",
          outcomeCode: "AWAITING_PHASE22_POLICY",
          correlationId: input.correlationId,
          occurredAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "DOCUMENT_DELETE_REQUESTED",
        actorKind: "USER",
        actorUserId: input.actorUserId,
        capability: "CANDIDATE_DOCUMENT_DELETE_REQUEST",
        correlationId: input.correlationId,
        reasonCode: "AWAITING_PHASE22_POLICY",
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
        targetId: version.id,
        targetType: "DOCUMENT_VERSION",
      });
      return Object.freeze({
        ok: true as const,
        status: "DELETE_PENDING" as const,
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function getCandidateDocumentVaultView(
  actorUserId: string,
  database: DatabaseClient,
) {
  const profile = await database.candidateProfile.findUnique({
    where: { userId: actorUserId },
    select: {
      documents: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: {
          id: true,
          storageKind: true,
          status: true,
          safeFilename: true,
          mimeType: true,
          sizeBytes: true,
          documentVersion: {
            select: {
              id: true,
              status: true,
              sequence: true,
              scanCompletedAt: true,
              createdAt: true,
            },
          },
        },
      },
      vaultDocuments: {
        where: { purpose: "CV" },
        take: 1,
        select: {
          currentVersionId: true,
          versions: {
            orderBy: [{ sequence: "desc" }],
            take: 5,
            select: {
              id: true,
              safeFilename: true,
              declaredMimeType: true,
              detectedMimeType: true,
              sizeBytes: true,
              status: true,
              sequence: true,
              createdAt: true,
              scanCompletedAt: true,
            },
          },
        },
      },
      documentUploadIntents: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          documentVersionId: true,
          status: true,
          expiresAt: true,
          failureCode: true,
        },
      },
    },
  });
  return profile === null
    ? null
    : Object.freeze({
        legacyMetadata: Object.freeze(
          profile.documents
            .filter(
              (document) => document.storageKind === "METADATA_ONLY_LEGACY",
            )
            .map((document) =>
              Object.freeze({
                id: document.id,
                safeFilename: document.safeFilename,
                mimeType: document.mimeType,
                sizeBytes: document.sizeBytes,
                status: document.status,
                downloadable: false,
              }),
            ),
        ),
        currentVersionId: profile.vaultDocuments[0]?.currentVersionId ?? null,
        versions: Object.freeze(profile.vaultDocuments[0]?.versions ?? []),
        latestIntent: profile.documentUploadIntents[0] ?? null,
      });
}

export async function issueDocumentReadGrant(
  input: Readonly<{
    actorUserId: string;
    documentVersionId: string;
    applicationId?: string;
    companyId?: string;
    membershipId?: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{
      ok: true;
      grantId: string;
      token: string;
      expiresAt: Date;
    }>
  | Readonly<{
      ok: false;
      code: "DOCUMENT_VAULT_UNAVAILABLE" | "NOT_FOUND" | "NOT_AUTHORIZED";
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available || !runtime.cleanReads) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  assertDocumentBulkAccessDisabled(dependencies.environment);
  const now = dependencies.now ?? new Date();
  return dependencies.database.$transaction(
    async (transaction) => {
      const authorization = await authorizeDocumentRead(
        transaction,
        input,
        now,
      );
      if (!authorization.ok) {
        return Object.freeze({
          ok: false as const,
          code: authorization.code,
        });
      }
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashReadToken(token);
      const expiresAt = new Date(
        now.getTime() + DOCUMENT_UPLOAD_POLICY_V1.readGrantTtlMilliseconds,
      );
      const grant = await transaction.documentReadGrant.create({
        data: {
          documentVersionId: input.documentVersionId,
          actorUserId: input.actorUserId,
          companyId: input.companyId,
          applicationId: input.applicationId,
          membershipId: input.membershipId,
          tokenHash,
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await transaction.documentAccessEvent.create({
        data: {
          documentVersionId: input.documentVersionId,
          documentReadGrantId: grant.id,
          actorUserId: input.actorUserId,
          companyId: input.companyId,
          applicationId: input.applicationId,
          kind: "READ_GRANT_ISSUED",
          outcomeCode: "SINGLE_OBJECT_60S",
          correlationId: input.correlationId,
          occurredAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "DOCUMENT_READ_GRANTED",
        actorKind: "USER",
        actorUserId: input.actorUserId,
        capability: "DOCUMENT_SINGLE_OBJECT_READ",
        companyId: input.companyId,
        correlationId: input.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
        targetId: grant.id,
        targetType: "DOCUMENT_READ_GRANT",
      });
      return Object.freeze({
        ok: true as const,
        grantId: grant.id,
        token,
        expiresAt,
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function issueCompanyVerificationDocumentReadGrant(
  input: Readonly<{
    actorUserId: string;
    companyId: string;
    verificationRequestId: string;
    documentVersionId: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{
      ok: true;
      grantId: string;
      token: string;
      expiresAt: Date;
    }>
  | Readonly<{
      ok: false;
      code: "DOCUMENT_VAULT_UNAVAILABLE" | "NOT_FOUND" | "NOT_AUTHORIZED";
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (
    !runtime.available ||
    !runtime.cleanReads ||
    !dependencies.environment.COMPANY_VERIFICATION_DOCUMENT
  ) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  assertDocumentBulkAccessDisabled(dependencies.environment);
  const now = dependencies.now ?? new Date();
  return dependencies.database.$transaction(
    async (transaction) => {
      const actor = await transaction.user.findUnique({
        where: { id: input.actorUserId },
        select: { id: true, role: true, status: true },
      });
      if (actor === null) {
        return Object.freeze({
          ok: false as const,
          code: "NOT_AUTHORIZED" as const,
        });
      }
      const resolved = await resolveAdminActor(
        transaction,
        {
          userId: actor.id,
          role: actor.role,
          status: actor.status,
        },
        now,
      );
      if (!hasAdminCapability(resolved, "COMPANY_VERIFICATION_REVIEW")) {
        return Object.freeze({
          ok: false as const,
          code: "NOT_AUTHORIZED" as const,
        });
      }
      const evidence = await transaction.companyVerificationEvidence.findFirst({
        where: {
          companyId: input.companyId,
          verificationRequestId: input.verificationRequestId,
          documentVersionId: input.documentVersionId,
          type: "DOCUMENT",
          status: "VALID",
          revokedAt: null,
          verificationRequest: {
            policyVersion: "COMPANY_TRUST_POLICY_V2",
            assignedReviewerUserId: input.actorUserId,
            status: { in: ["PENDING", "CHANGES_REQUESTED", "VERIFIED"] },
            supersededBy: null,
          },
          documentVersion: {
            companyId: input.companyId,
            status: "CLEAN",
            replacedAt: null,
            document: {
              companyId: input.companyId,
              purpose: "COMPANY_VERIFICATION",
              currentVersionId: input.documentVersionId,
            },
          },
        },
        select: { id: true },
      });
      if (evidence === null) {
        return Object.freeze({
          ok: false as const,
          code: "NOT_FOUND" as const,
        });
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        now.getTime() + DOCUMENT_UPLOAD_POLICY_V1.readGrantTtlMilliseconds,
      );
      const grant = await transaction.documentReadGrant.create({
        data: {
          documentVersionId: input.documentVersionId,
          actorUserId: input.actorUserId,
          companyId: input.companyId,
          tokenHash: hashReadToken(token),
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await transaction.documentAccessEvent.create({
        data: {
          documentVersionId: input.documentVersionId,
          documentReadGrantId: grant.id,
          actorUserId: input.actorUserId,
          companyId: input.companyId,
          kind: "READ_GRANT_ISSUED",
          outcomeCode: "COMPANY_VERIFICATION_SINGLE_OBJECT_60S",
          correlationId: input.correlationId,
          occurredAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "DOCUMENT_READ_GRANTED",
        actorKind: "USER",
        actorUserId: input.actorUserId,
        capability: "COMPANY_VERIFICATION_DOCUMENT_READ",
        companyId: input.companyId,
        correlationId: input.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
        targetId: grant.id,
        targetType: "DOCUMENT_READ_GRANT",
      });
      return Object.freeze({
        ok: true as const,
        grantId: grant.id,
        token,
        expiresAt,
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function consumeDocumentReadGrant(
  input: Readonly<{
    actorUserId: string;
    token: string;
    correlationId: string;
  }>,
  dependencies: VaultDependencies,
): Promise<
  | Readonly<{
      ok: true;
      safeFilename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      body: AsyncIterable<Uint8Array>;
    }>
  | Readonly<{
      ok: false;
      code:
        | "DOCUMENT_VAULT_UNAVAILABLE"
        | "NOT_FOUND"
        | "GRANT_EXPIRED"
        | "GRANT_REVOKED"
        | "PROVIDER_DEGRADED";
    }>
> {
  const runtime = resolveDocumentRuntime(dependencies.environment);
  if (!runtime.available || !runtime.cleanReads) {
    return Object.freeze({
      ok: false,
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
  }
  const now = dependencies.now ?? new Date();
  const tokenHash = hashReadToken(input.token);
  const grant = await dependencies.database.documentReadGrant.findUnique({
    where: { tokenHash },
    select: readGrantSelect,
  });
  if (grant === null || grant.actorUserId !== input.actorUserId) {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (grant.status === "REVOKED") {
    return Object.freeze({ ok: false, code: "GRANT_REVOKED" });
  }
  if (grant.status !== "ACTIVE") {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (grant.expiresAt <= now) {
    await dependencies.database.documentReadGrant.updateMany({
      where: { id: grant.id, status: "ACTIVE" },
      data: { status: "EXPIRED", revokedAt: now },
    });
    return Object.freeze({ ok: false, code: "GRANT_EXPIRED" });
  }
  const preliminary = await dependencies.database.$transaction(
    (transaction) =>
      authorizeDocumentRead(
        transaction,
        {
          actorUserId: grant.actorUserId,
          documentVersionId: grant.documentVersionId,
          applicationId: grant.applicationId ?? undefined,
          companyId: grant.companyId ?? undefined,
          membershipId: grant.membershipId ?? undefined,
        },
        now,
      ),
    { isolationLevel: "RepeatableRead" },
  );
  if (!preliminary.ok) {
    await dependencies.database.documentReadGrant.updateMany({
      where: { id: grant.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now },
    });
    return Object.freeze({ ok: false, code: "GRANT_REVOKED" });
  }
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
  const opened = await dependencies.objectStore.openVerifiedRead(
    grant.documentVersion.objectKey,
  );
  if (
    opened === null ||
    opened.receipt.sha256 !== grant.documentVersion.sha256 ||
    opened.receipt.sizeBytes !== grant.documentVersion.sizeBytes
  ) {
    return Object.freeze({ ok: false, code: "PROVIDER_DEGRADED" });
  }

  const consumed = await dependencies.database.$transaction(
    async (transaction) => {
      await lockRow(transaction, "DocumentReadGrant", grant.id);
      const current = await transaction.documentReadGrant.findUniqueOrThrow({
        where: { id: grant.id },
        select: { status: true, expiresAt: true },
      });
      if (current.status !== "ACTIVE" || current.expiresAt <= now) return false;
      const authorization = await authorizeDocumentRead(
        transaction,
        {
          actorUserId: grant.actorUserId,
          documentVersionId: grant.documentVersionId,
          applicationId: grant.applicationId ?? undefined,
          companyId: grant.companyId ?? undefined,
          membershipId: grant.membershipId ?? undefined,
        },
        now,
      );
      if (!authorization.ok) {
        await transaction.documentReadGrant.update({
          where: { id: grant.id },
          data: { status: "REVOKED", revokedAt: now },
        });
        return false;
      }
      await transaction.documentReadGrant.update({
        where: { id: grant.id },
        data: { status: "CONSUMED", consumedAt: now },
      });
      await transaction.documentAccessEvent.create({
        data: {
          documentVersionId: grant.documentVersionId,
          documentReadGrantId: grant.id,
          actorUserId: grant.actorUserId,
          companyId: grant.companyId,
          applicationId: grant.applicationId,
          kind: "READ_GRANTED",
          outcomeCode: "SINGLE_USE_CONSUMED",
          correlationId: input.correlationId,
          occurredAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "DOCUMENT_READ",
        actorKind: "USER",
        actorUserId: grant.actorUserId,
        capability: "DOCUMENT_SINGLE_OBJECT_READ",
        companyId: grant.companyId,
        correlationId: input.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
        targetId: grant.documentVersionId,
        targetType: "DOCUMENT_VERSION",
      });
      return true;
    },
    { isolationLevel: "Serializable" },
  );
  if (!consumed) return Object.freeze({ ok: false, code: "NOT_FOUND" });

  return Object.freeze({
    ok: true,
    safeFilename: grant.documentVersion.safeFilename,
    mimeType:
      grant.documentVersion.detectedMimeType ??
      grant.documentVersion.declaredMimeType,
    sizeBytes: opened.receipt.sizeBytes,
    sha256: opened.receipt.sha256,
    body: opened.body,
  });
}

export async function revokeDocumentReadGrant(
  input: Readonly<{
    actorUserId: string;
    grantId: string;
  }>,
  database: DatabaseClient,
  now = new Date(),
): Promise<"REVOKED" | "MISSING" | "TERMINAL"> {
  const grant = await database.documentReadGrant.findFirst({
    where: { id: input.grantId, actorUserId: input.actorUserId },
    select: { id: true, status: true },
  });
  if (grant === null) return "MISSING";
  if (grant.status !== "ACTIVE") return "TERMINAL";
  const updated = await database.documentReadGrant.updateMany({
    where: {
      id: input.grantId,
      actorUserId: input.actorUserId,
      status: "ACTIVE",
    },
    data: { status: "REVOKED", revokedAt: now },
  });
  return updated.count === 1 ? "REVOKED" : "TERMINAL";
}

async function authorizeDocumentRead(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId: string;
    documentVersionId: string;
    applicationId?: string;
    companyId?: string;
    membershipId?: string;
  }>,
  now: Date,
): Promise<
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "NOT_FOUND" | "NOT_AUTHORIZED" }>
> {
  const actor = await transaction.user.findUnique({
    where: { id: input.actorUserId },
    select: { role: true, status: true },
  });
  if (actor?.status !== "ACTIVE") {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  const version = await transaction.documentVersion.findUnique({
    where: { id: input.documentVersionId },
    select: {
      status: true,
      candidateProfile: { select: { userId: true } },
    },
  });
  if (
    version === null ||
    (version.status !== "CLEAN" && version.status !== "REPLACED")
  ) {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (actor.role === "CANDIDATE") {
    return version.candidateProfile?.userId === input.actorUserId &&
      input.applicationId === undefined &&
      input.companyId === undefined &&
      input.membershipId === undefined
      ? Object.freeze({ ok: true })
      : Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (actor.role === "ADMIN") {
    if (
      input.companyId === undefined ||
      input.applicationId !== undefined ||
      input.membershipId !== undefined
    ) {
      return Object.freeze({ ok: false, code: "NOT_AUTHORIZED" });
    }
    const resolved = await resolveAdminActor(
      transaction,
      {
        userId: input.actorUserId,
        role: actor.role,
        status: actor.status,
      },
      now,
    );
    if (!hasAdminCapability(resolved, "COMPANY_VERIFICATION_REVIEW")) {
      return Object.freeze({ ok: false, code: "NOT_AUTHORIZED" });
    }
    const evidence = await transaction.companyVerificationEvidence.findFirst({
      where: {
        companyId: input.companyId,
        documentVersionId: input.documentVersionId,
        type: "DOCUMENT",
        status: "VALID",
        revokedAt: null,
        verificationRequest: {
          policyVersion: "COMPANY_TRUST_POLICY_V2",
          assignedReviewerUserId: input.actorUserId,
          status: { in: ["PENDING", "CHANGES_REQUESTED", "VERIFIED"] },
          supersededBy: null,
        },
        documentVersion: {
          companyId: input.companyId,
          status: "CLEAN",
          replacedAt: null,
          document: {
            companyId: input.companyId,
            purpose: "COMPANY_VERIFICATION",
            currentVersionId: input.documentVersionId,
          },
        },
      },
      select: { id: true },
    });
    return evidence === null
      ? Object.freeze({ ok: false, code: "NOT_FOUND" })
      : Object.freeze({ ok: true });
  }
  if (
    (actor.role !== "EMPLOYER" && actor.role !== "RECRUITER") ||
    input.applicationId === undefined ||
    input.companyId === undefined ||
    input.membershipId === undefined
  ) {
    return Object.freeze({ ok: false, code: "NOT_AUTHORIZED" });
  }
  const membership = await transaction.companyMembership.findFirst({
    where: {
      id: input.membershipId,
      companyId: input.companyId,
      userId: input.actorUserId,
      status: "ACTIVE",
      company: { status: "ACTIVE" },
    },
    select: { role: true },
  });
  if (membership === null || membership.role === "VIEWER") {
    return Object.freeze({ ok: false, code: "NOT_AUTHORIZED" });
  }
  const application = await transaction.application.findFirst({
    where: {
      id: input.applicationId,
      job: {
        companyId: input.companyId,
        status: { not: "REMOVED" },
      },
      submissionDocuments: {
        some: { documentVersionId: input.documentVersionId },
      },
    },
    select: { jobId: true },
  });
  if (application === null) {
    return Object.freeze({ ok: false, code: "NOT_FOUND" });
  }
  if (membership.role === "OWNER" || membership.role === "ADMIN") {
    return Object.freeze({ ok: true });
  }
  const assignment = await transaction.jobAssignment.findFirst({
    where: {
      jobId: application.jobId,
      membershipId: input.membershipId,
      role: "PIPELINE",
      status: "ACTIVE",
      validFrom: { lte: now },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return assignment === null
    ? Object.freeze({ ok: false, code: "NOT_AUTHORIZED" })
    : Object.freeze({ ok: true });
}

const uploadIntentSelect = {
  id: true,
  documentVersionId: true,
  companyId: true,
  purpose: true,
  expectedSizeBytes: true,
  expectedSha256: true,
  expiresAt: true,
  status: true,
  documentVersion: {
    select: {
      objectKey: true,
      providerObjectVersion: true,
      sha256: true,
    },
  },
} as const satisfies Prisma.DocumentUploadIntentSelect;

const scanVersionSelect = {
  id: true,
  documentId: true,
  candidateProfileId: true,
  companyId: true,
  objectKey: true,
  safeFilename: true,
  declaredMimeType: true,
  sizeBytes: true,
  status: true,
} as const satisfies Prisma.DocumentVersionSelect;

const readGrantSelect = {
  id: true,
  documentVersionId: true,
  actorUserId: true,
  companyId: true,
  applicationId: true,
  membershipId: true,
  status: true,
  expiresAt: true,
  documentVersion: {
    select: {
      objectKey: true,
      safeFilename: true,
      declaredMimeType: true,
      detectedMimeType: true,
      sizeBytes: true,
      sha256: true,
    },
  },
} as const satisfies Prisma.DocumentReadGrantSelect;

function scanOutcomeToStatus(
  outcome: MalwareScanReceipt["outcome"],
): "CLEAN" | "REJECTED" | "INFECTED" | "SCAN_FAILED" {
  if (outcome === "CLEAN") return "CLEAN";
  if (outcome === "INFECTED") return "INFECTED";
  if (outcome === "POLICY_REJECTED") return "REJECTED";
  return "SCAN_FAILED";
}

async function acquireDocumentLock(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  purpose: "CV",
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`document-upload:${actorUserId}:${purpose}`}, 0)
    ) IS NULL AS "locked"
  `;
}

async function lockRow(
  transaction: Prisma.TransactionClient,
  table: "DocumentUploadIntent" | "DocumentVersion" | "DocumentReadGrant",
  id: string,
): Promise<void> {
  const identifiers = {
    DocumentUploadIntent: '"DocumentUploadIntent"',
    DocumentVersion: '"DocumentVersion"',
    DocumentReadGrant: '"DocumentReadGrant"',
  } as const;
  await transaction.$queryRawUnsafe(
    `SELECT "id" FROM ${identifiers[table]} WHERE "id" = $1::uuid FOR UPDATE`,
    id,
  );
}

function hashReadToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isBoundedIdempotencyKey(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

async function withSerializationRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === 4) throw error;
    }
  }
  throw new Error("Unreachable document serialization retry state.");
}

function isSerializationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown };
  };
  return (
    candidate.code === "P2034" ||
    candidate.meta?.code === "40001" ||
    (typeof candidate.message === "string" &&
      /could not serialize access/u.test(candidate.message))
  );
}
