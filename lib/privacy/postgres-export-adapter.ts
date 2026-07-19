import { randomUUID } from "node:crypto";

import {
  writeRequiredAudit,
  type AuditPersistenceRecord,
} from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  PrivacyRequestStatus,
  PrivacyRequestType,
} from "@/lib/generated/prisma/enums";
import {
  buildExportManifestForCase,
  checksumManifest,
  type PrivacyExportActor,
  type PrivacyExportCaseTransaction,
  type PrivacyExportResult,
} from "@/lib/privacy/export-mock";

const EXPORT_ERROR = "Privacy export case is unavailable.";
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

type TransactionClient = Prisma.TransactionClient;

/**
 * These are the only row roots counted by the Phase-03 local export Mock.
 * In particular, employer notes, messages, Audit rows and reveal ciphertext
 * are not part of a category query and can never enter the manifest.
 */
export const POSTGRES_PRIVACY_EXPORT_POLICY_V1 = Object.freeze({
  lockNamespace: "privacy-export-manifest-v1" as const,
  transactionTimeoutMilliseconds: 15_000,
  auditRetentionDays: 400,
  categorySources: Object.freeze({
    account: Object.freeze(["User"] as const),
    candidateProfile: Object.freeze(["CandidateProfile"] as const),
    consentHistory: Object.freeze(
      ["UserConsentEvent", "CandidateConsent"] as const,
    ),
    applications: Object.freeze(["Application"] as const),
    radar: Object.freeze(["RadarProfile"] as const),
  }),
});

export type PostgresPrivacyExportAdapter = Readonly<{
  buildExportManifestForCase(
    privacyRequestId: string,
    actor: PrivacyExportActor,
    now: Date,
  ): Promise<PrivacyExportResult>;
}>;

/**
 * Production PostgreSQL boundary for the local Privacy export Mock. The case
 * lock, owner-scoped counts, manifest, two events, two required audits and the
 * status/version update all live in one transaction.
 */
export function createPostgresPrivacyExportAdapter(
  database: DatabaseClient,
): PostgresPrivacyExportAdapter {
  return Object.freeze({
    buildExportManifestForCase: (privacyRequestId, actor, now) =>
      runPostgresExport(database, privacyRequestId, actor, now),
  });
}

async function runPostgresExport(
  database: DatabaseClient,
  privacyRequestId: string,
  actor: PrivacyExportActor,
  now: Date,
): Promise<PrivacyExportResult> {
  if (!isUuid(privacyRequestId)) throw new Error(EXPORT_ERROR);

  try {
    return await database.$transaction(
      async (transaction) => {
        await acquireExportLock(transaction, privacyRequestId);
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "PrivacyRequest"
          WHERE "id" = ${privacyRequestId}::uuid
          FOR UPDATE
        `;

        return buildExportManifestForCase(
          createTransactionPort(transaction, actor.userId, now),
          privacyRequestId,
          actor,
          now,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait:
          POSTGRES_PRIVACY_EXPORT_POLICY_V1.transactionTimeoutMilliseconds,
        timeout:
          POSTGRES_PRIVACY_EXPORT_POLICY_V1.transactionTimeoutMilliseconds,
      },
    );
  } catch {
    throw new Error(EXPORT_ERROR);
  }
}

function createTransactionPort(
  transaction: TransactionClient,
  actorUserId: string,
  now: Date,
): PrivacyExportCaseTransaction {
  const port: PrivacyExportCaseTransaction = {
    loadAuthorizedExportCase: async (privacyRequestId, requestedActorUserId) => {
      if (requestedActorUserId !== actorUserId || !isUuid(actorUserId)) {
        return null;
      }

      const actor = await transaction.user.findFirst({
        where: { id: actorUserId, role: "ADMIN", status: "ACTIVE" },
        select: { id: true },
      });
      if (actor === null) return null;

      const request = await transaction.privacyRequest.findFirst({
        where: {
          id: privacyRequestId,
          assignedAdminUserId: actorUserId,
          type: PrivacyRequestType.EXPORT,
          status: {
            in: [
              PrivacyRequestStatus.IN_PROGRESS,
              PrivacyRequestStatus.COMPLETED,
            ],
          },
          verifiedAt: { not: null },
        },
        select: {
          id: true,
          requesterUserId: true,
          type: true,
          status: true,
          verifiedAt: true,
          version: true,
        },
      });
      if (request?.verifiedAt == null) return null;

      const account = await transaction.user.count({
        where: { id: request.requesterUserId },
      });
      const profile = await transaction.candidateProfile.findUnique({
        where: { userId: request.requesterUserId },
        select: { id: true },
      });
      const userConsentCount = await transaction.userConsentEvent.count({
        where: { userId: request.requesterUserId },
      });
      const candidateConsentCount =
        profile === null
          ? 0
          : await transaction.candidateConsent.count({
              where: { candidateProfileId: profile.id },
            });
      const applications =
        profile === null
          ? 0
          : await transaction.application.count({
              where: { candidateProfileId: profile.id },
            });
      const radar =
        profile === null
          ? 0
          : await transaction.radarProfile.count({
              where: { candidateProfileId: profile.id },
            });

      return Object.freeze({
        requestId: request.id,
        requesterUserId: request.requesterUserId,
        type: request.type,
        status: request.status,
        verifiedAt: new Date(request.verifiedAt),
        version: request.version,
        categoryCounts: Object.freeze({
          account,
          candidateProfile: profile === null ? 0 : 1,
          consentHistory: userConsentCount + candidateConsentCount,
          applications,
          radar,
        }),
      });
    },

    loadExistingManifest: async (privacyRequestId, requestedActorUserId) => {
      if (requestedActorUserId !== actorUserId) return null;
      const request = await transaction.privacyRequest.findFirst({
        where: {
          id: privacyRequestId,
          assignedAdminUserId: actorUserId,
          type: PrivacyRequestType.EXPORT,
          status: PrivacyRequestStatus.COMPLETED,
        },
        select: {
          exportManifest: true,
          exportManifestChecksum: true,
          exportExpiresAt: true,
        },
      });
      if (
        request?.exportManifest == null ||
        request.exportManifestChecksum == null ||
        request.exportExpiresAt == null
      ) {
        return null;
      }
      return Object.freeze({
        manifest: request.exportManifest,
        checksum: request.exportManifestChecksum,
        expiresAt: new Date(request.exportExpiresAt),
      });
    },

    saveManifestAndComplete: async (input) => {
      assertPersistenceContract(input, actorUserId, now);
      const correlationId = randomUUID();
      const updated = await transaction.privacyRequest.updateMany({
        where: {
          id: input.privacyRequestId,
          requesterUserId: input.requesterUserId,
          assignedAdminUserId: actorUserId,
          type: PrivacyRequestType.EXPORT,
          status: PrivacyRequestStatus.IN_PROGRESS,
          version: input.expectedVersion,
          verifiedAt: { not: null },
          exportManifest: { equals: Prisma.DbNull },
          exportManifestChecksum: null,
          exportExpiresAt: null,
        },
        data: {
          status: PrivacyRequestStatus.COMPLETED,
          version: { increment: 1 },
          completedAt: now,
          exportManifest: input.manifest as Prisma.InputJsonValue,
          exportManifestChecksum: input.checksum,
          exportExpiresAt: input.expiresAt,
        },
      });
      if (updated.count !== 1) throw new Error("stale export case");

      await transaction.privacyRequestEvent.create({
        data: {
          privacyRequestId: input.privacyRequestId,
          kind: "MANIFEST_CREATED",
          fromStatus: PrivacyRequestStatus.IN_PROGRESS,
          toStatus: PrivacyRequestStatus.IN_PROGRESS,
          actorUserId,
          idempotencyKey: `PRIVACY_EXPORT:MANIFEST:${input.privacyRequestId}:v${input.expectedVersion}`,
          correlationId,
          createdAt: now,
        },
      });
      await transaction.privacyRequestEvent.create({
        data: {
          privacyRequestId: input.privacyRequestId,
          kind: "COMPLETED",
          fromStatus: PrivacyRequestStatus.IN_PROGRESS,
          toStatus: PrivacyRequestStatus.COMPLETED,
          actorUserId,
          idempotencyKey: `PRIVACY_EXPORT:COMPLETED:${input.privacyRequestId}:v${input.expectedVersion}`,
          correlationId,
          createdAt: now,
        },
      });

      const retainUntil = new Date(
        now.getTime() +
          POSTGRES_PRIVACY_EXPORT_POLICY_V1.auditRetentionDays *
            DAY_MILLISECONDS,
      );
      await writeRequiredAudit(prismaAuditPort(transaction), {
        action: "PRIVACY_EXPORT_MANIFEST_CREATED",
        actorKind: "USER",
        actorUserId,
        capability: "PRIVACY_CASE_PROCESS",
        correlationId,
        metadata: {},
        result: "SUCCEEDED",
        retainUntil,
        targetId: input.privacyRequestId,
        targetType: "PRIVACY_REQUEST",
      });
      await writeRequiredAudit(prismaAuditPort(transaction), {
        action: "PRIVACY_REQUEST_STATUS_CHANGED",
        actorKind: "USER",
        actorUserId,
        capability: "PRIVACY_CASE_PROCESS",
        correlationId,
        metadata: {},
        result: "SUCCEEDED",
        retainUntil,
        targetId: input.privacyRequestId,
        targetType: "PRIVACY_REQUEST",
      });
    },
  };

  return Object.freeze(port);
}

function assertPersistenceContract(
  input: Parameters<PrivacyExportCaseTransaction["saveManifestAndComplete"]>[0],
  actorUserId: string,
  now: Date,
) {
  if (
    !isUuid(actorUserId) ||
    input.manifest.requestId !== input.privacyRequestId ||
    input.manifest.generatedAt !== now.toISOString() ||
    checksumManifest(input.manifest) !== input.checksum ||
    input.events.length !== 2 ||
    input.events[0] !== "MANIFEST_CREATED" ||
    input.events[1] !== "COMPLETED" ||
    input.auditActions.length !== 2 ||
    input.auditActions[0] !== "PRIVACY_EXPORT_MANIFEST_CREATED" ||
    input.auditActions[1] !== "PRIVACY_REQUEST_STATUS_CHANGED"
  ) {
    throw new TypeError("Privacy export persistence contract is invalid.");
  }
}

async function acquireExportLock(
  transaction: TransactionClient,
  privacyRequestId: string,
) {
  await transaction.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`${POSTGRES_PRIVACY_EXPORT_POLICY_V1.lockNamespace}:${privacyRequestId}`},
        0
      )
    ) IS NULL AS "locked"
  `;
}

function prismaAuditPort(transaction: TransactionClient) {
  return {
    auditLog: {
      create: ({ data }: Readonly<{ data: AuditPersistenceRecord }>) =>
        transaction.auditLog.create({
          data: {
            ...data,
            metadata:
              data.metadata === null
                ? Prisma.JsonNull
                : (data.metadata as Prisma.InputJsonValue),
          },
        }),
    },
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
