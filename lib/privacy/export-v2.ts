import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { Prisma } from "@/lib/generated/prisma/client";
import { z } from "zod";

import {
  writeRequiredAudit,
  type AuditPersistenceRecord,
} from "@/lib/audit/log";
import type { KeyringEntry } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";
import { PRIVACY_EXPORT_STORAGE_POLICY_V1 } from "@/lib/providers/storage/privacy-export-storage";
import {
  decideLegalGateV1,
  projectPersistedLegalGateV1,
} from "@/lib/privacy/legal-gate-policy";

const UUID = z.string().uuid();
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/u);
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const AUDIT_RETENTION_DAYS = 400;
const MAX_EXPORT_ATTEMPTS = 5;
const PRIVACY_EXPORT_POLICY_VERSION = "privacy-export-v2";
const SUPPORTED_EXPORT_PROCESSORS = Object.freeze([
  "postgres-primary",
  "document-object-store",
  "notification-outbox",
  "email-provider",
  "payment-ledger",
  "analytics-store",
] as const);

const createInputSchema = z
  .object({
    privacyRequestId: UUID,
    actorUserId: UUID,
    approvalActorUserId: UUID,
    idempotencyKey: z.string().uuid(),
    approvalEvidenceRef: z
      .string()
      .regex(/^phase25:[A-Za-z0-9._:-]{8,220}$|^sandbox:[A-Za-z0-9._:-]{8,220}$/u),
    stepUpEvidenceRef: z
      .string()
      .regex(/^phase25:[A-Za-z0-9._:-]{8,220}$|^sandbox:[A-Za-z0-9._:-]{8,220}$/u),
  })
  .strict();

const consumeInputSchema = z
  .object({
    artifactId: UUID,
    ownerUserId: UUID,
    token: z.string().min(43).max(128),
    stepUpEvidenceRef: z
      .string()
      .regex(/^phase25:[A-Za-z0-9._:-]{8,220}$|^sandbox:[A-Za-z0-9._:-]{8,220}$/u),
  })
  .strict();

export type PrivacyExportManifestSectionV2 = Readonly<{
  category: string;
  processorKey: string;
  count: number;
  byteLength: number;
  sha256: string;
  outcome: "INCLUDED" | "EXCLUDED";
  exclusionReason?: string;
}>;

export type PrivacyExportManifestV2 = Readonly<{
  schemaVersion: "2";
  packageFormat: "STH_PRIVACY_PACKAGE_V2";
  requestId: string;
  ownerUserId: string;
  subjectClass: string;
  inventoryVersion: string;
  policyVersion: string;
  generatedAt: string;
  sections: readonly PrivacyExportManifestSectionV2[];
}>;

export type PrivacyExportV2Dependencies = Readonly<{
  database: DatabaseClient;
  exportStore: DocumentObjectStore;
  documentStore: DocumentObjectStore;
  exportKeyring: readonly KeyringEntry<"PRIVACY_EXPORT_KEYS">[];
  featureEnabled: boolean;
  cohortAllowed: boolean;
  processingMode: "disabled" | "sandbox_command";
  now?: Date;
}>;

export type PrivacyExportV2Result =
  | Readonly<{
      ok: true;
      replay: boolean;
      artifactId: string;
      privacyRequestId: string;
      expiresAt: Date;
      downloadToken: string;
      manifestHash: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "FEATURE_DISABLED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "WRONG_STATE"
        | "INVENTORY_UNAVAILABLE"
        | "PROCESSOR_UNSUPPORTED"
        | "LEGAL_GATE_BLOCKED"
        | "STORAGE_FAILED"
        | "CONFLICT";
    }>;

export type PrivacyExportDownloadResult =
  | Readonly<{
      ok: true;
      filename: string;
      contentType: "application/vnd.swisstalenthub.privacy-export-v2";
      contentLength: number;
      body: AsyncIterable<Uint8Array>;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "EXPIRED"
        | "TOKEN_INVALID"
        | "STORAGE_FAILED";
    }>;

type ExportSection = Readonly<{
  category: string;
  processorKey: string;
  records: readonly unknown[];
}>;
type ExportDocument = Readonly<{
  category: "documentBytes";
  processorKey: "document-object-store";
  documentVersionId: string;
  objectKey: string;
  objectVersion: string;
  safeFilename: string;
  sizeBytes: number;
  sha256: string;
}>;
type PreparedPackage = Readonly<{
  manifest: PrivacyExportManifestV2;
  manifestHash: string;
  expectedSizeBytes: number;
  sections: readonly ExportSection[];
  documents: readonly ExportDocument[];
}>;

export async function createPrivacyExportV2(
  rawInput: unknown,
  dependencies: PrivacyExportV2Dependencies,
): Promise<PrivacyExportV2Result> {
  const input = createInputSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !isValidDate(now)) return failure("INVALID_INPUT");
  if (
    !dependencies.featureEnabled ||
    dependencies.processingMode !== "sandbox_command"
  ) {
    return failure("FEATURE_DISABLED");
  }
  if (!dependencies.cohortAllowed || dependencies.exportKeyring.length === 0) {
    return failure("FEATURE_DISABLED");
  }

  const setup = await setupExportExecution(input.data, dependencies, now);
  if (!setup.ok) return setup;
  if (setup.replay && setup.artifact.status === "READY") {
    const token = derivePrivacyExportDownloadToken(
      dependencies.exportKeyring,
      setup.artifact.encryptionKeyVersion,
      setup.artifact.id,
      setup.artifact.ownerUserId,
      setup.artifact.expiresAt,
    );
    if (token === null) return failure("STORAGE_FAILED");
    return successResult(setup, token, true);
  }
  if (setup.artifact.status !== "BUILDING") return failure("CONFLICT");

  let prepared: PreparedPackage;
  try {
    prepared = await prepareOwnedPackage(
      setup.requesterUserId,
      setup.subjectClass,
      setup.inventoryVersion,
      setup.requestId,
      setup.requiredProcessors,
      dependencies,
      now,
    );
    const receipt = await dependencies.exportStore.putQuarantined({
      objectKey: setup.artifact.objectKey,
      objectVersion: setup.artifact.objectVersion,
      expectedSizeBytes: prepared.expectedSizeBytes,
      body: packageBody(prepared, dependencies.documentStore),
    });
    const stored = await finalizeExportExecution(
      setup,
      prepared,
      receipt.sha256,
      receipt.sizeBytes,
      dependencies.database,
      now,
    );
    const token = derivePrivacyExportDownloadToken(
      dependencies.exportKeyring,
      stored.encryptionKeyVersion,
      stored.artifactId,
      stored.ownerUserId,
      stored.expiresAt,
    );
    if (token === null) return failure("STORAGE_FAILED");
    return Object.freeze({
      ok: true,
      replay: false,
      artifactId: stored.artifactId,
      privacyRequestId: setup.requestId,
      expiresAt: stored.expiresAt,
      downloadToken: token,
      manifestHash: prepared.manifestHash,
    });
  } catch {
    await markExportFailure(setup, dependencies.database, now).catch(
      () => undefined,
    );
    return failure("STORAGE_FAILED");
  }
}

export async function consumePrivacyExportV2(
  rawInput: unknown,
  dependencies: Pick<
    PrivacyExportV2Dependencies,
    "database" | "exportStore" | "exportKeyring" | "processingMode" | "now"
  >,
): Promise<PrivacyExportDownloadResult> {
  const input = consumeInputSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !isValidDate(now)) {
    return downloadFailure("INVALID_INPUT");
  }
  if (dependencies.processingMode !== "sandbox_command") {
    return downloadFailure("NOT_FOUND");
  }

  const artifact = await dependencies.database.privacyExportArtifact.findFirst({
    where: {
      id: input.data.artifactId,
      ownerUserId: input.data.ownerUserId,
    },
    select: {
      id: true,
      ownerUserId: true,
      privacyRequestId: true,
      status: true,
      objectKey: true,
      objectVersion: true,
      encryptionKeyVersion: true,
      packageSha256: true,
      sizeBytes: true,
      downloadTokenHash: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      privacyExecution: {
        select: { stepUpEvidenceRef: true },
      },
    },
  });
  if (artifact === null || artifact.status !== "READY") {
    return downloadFailure("NOT_FOUND");
  }
  if (artifact.expiresAt <= now) {
    await dependencies.database.privacyExportArtifact.updateMany({
      where: { id: artifact.id, status: "READY", consumedAt: null },
      data: { status: "EXPIRED" },
    });
    return downloadFailure("EXPIRED");
  }
  const expectedToken = derivePrivacyExportDownloadToken(
    dependencies.exportKeyring,
    artifact.encryptionKeyVersion,
    artifact.id,
    artifact.ownerUserId,
    artifact.expiresAt,
  );
  if (
    expectedToken === null ||
    !constantTimeTextEqual(expectedToken, input.data.token) ||
    sha256(input.data.token) !== artifact.downloadTokenHash ||
    artifact.privacyExecution.stepUpEvidenceRef !==
      input.data.stepUpEvidenceRef
  ) {
    return downloadFailure("TOKEN_INVALID");
  }

  const opened = await dependencies.exportStore
    .openVerifiedRead(artifact.objectKey)
    .catch(() => null);
  if (
    opened === null ||
    artifact.packageSha256 === null ||
    artifact.sizeBytes === null ||
    opened.receipt.sha256 !== artifact.packageSha256 ||
    opened.receipt.sizeBytes !== artifact.sizeBytes ||
    opened.receipt.objectVersion !== artifact.objectVersion
  ) {
    return downloadFailure("STORAGE_FAILED");
  }

  const consumed = await dependencies.database.$transaction(
    async (transaction) => {
      const updated = await transaction.privacyExportArtifact.updateMany({
        where: {
          id: artifact.id,
          ownerUserId: input.data.ownerUserId,
          status: "READY",
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { status: "CONSUMED", consumedAt: now },
      });
      if (updated.count !== 1) return false;
      await writeRequiredAudit(prismaAuditPort(transaction), {
        action: "PRIVACY_EXPORT_ARTIFACT_DOWNLOADED",
        actorKind: "USER",
        actorUserId: input.data.ownerUserId,
        capability: "PRIVACY_EXPORT_DOWNLOAD",
        correlationId: randomUUID(),
        metadata: {},
        result: "SUCCEEDED",
        retainUntil: auditRetainUntil(now),
        targetId: artifact.id,
        targetType: "PRIVACY_EXPORT_ARTIFACT",
      });
      return true;
    },
    transactionOptions(),
  );
  if (!consumed) return downloadFailure("NOT_FOUND");

  return Object.freeze({
    ok: true,
    filename: `swisstalenthub-datenauszug-${artifact.privacyRequestId}.sthprivacy`,
    contentType: "application/vnd.swisstalenthub.privacy-export-v2",
    contentLength: opened.receipt.sizeBytes,
    body: opened.body,
  });
}

async function setupExportExecution(
  input: z.output<typeof createInputSchema>,
  dependencies: PrivacyExportV2Dependencies,
  now: Date,
) {
  return dependencies.database.$transaction(async (transaction) => {
    await acquireExportLock(transaction, input.privacyRequestId);
    const request = await transaction.privacyRequest.findUnique({
      where: { id: input.privacyRequestId },
      select: {
        id: true,
        requesterUserId: true,
        assignedAdminUserId: true,
        type: true,
        status: true,
        verifiedAt: true,
        version: true,
        requester: { select: { role: true, status: true } },
        executions: {
          where: { kind: "EXPORT" },
          take: 1,
          include: {
            exportArtifact: true,
            inventoryVersion: { select: { version: true } },
          },
        },
      },
    });
    if (request === null) return failure("NOT_FOUND");
    if (
      request.type !== "EXPORT" ||
      !["IN_PROGRESS", "COMPLETED"].includes(request.status) ||
      request.verifiedAt === null
    ) {
      return failure("WRONG_STATE");
    }
    if (
      request.assignedAdminUserId !== input.actorUserId ||
      request.requester.status !== "ACTIVE" ||
      input.actorUserId === input.approvalActorUserId ||
      request.requesterUserId === input.approvalActorUserId
    ) {
      return failure("FORBIDDEN");
    }
    const adminCount = await transaction.user.count({
      where: {
        id: { in: [input.actorUserId, input.approvalActorUserId] },
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    if (adminCount !== 2) return failure("FORBIDDEN");

    const existing = request.executions[0];
    if (existing?.exportArtifact !== null && existing !== undefined) {
      if (
        existing.exportArtifact.status === "FAILED" &&
        existing.status === "RETRY_REQUIRED" &&
        existing.attemptCount < MAX_EXPORT_ATTEMPTS
      ) {
        const expiresAt = new Date(
          now.getTime() +
            PRIVACY_EXPORT_STORAGE_POLICY_V1.artifactTtlMilliseconds,
        );
        const token = derivePrivacyExportDownloadToken(
          dependencies.exportKeyring,
          existing.exportArtifact.encryptionKeyVersion,
          existing.exportArtifact.id,
          existing.exportArtifact.ownerUserId,
          expiresAt,
        );
        if (token === null) return failure("INVENTORY_UNAVAILABLE");
        const restartedArtifact =
          await transaction.privacyExportArtifact.update({
            where: { id: existing.exportArtifact.id },
            data: {
              status: "BUILDING",
              objectVersion: randomUUID(),
              manifest: {
                schemaVersion: "2",
                state: "BUILDING",
                attempt: existing.attemptCount + 1,
              },
              manifestHash: sha256("BUILDING"),
              packageSha256: null,
              sizeBytes: null,
              downloadTokenHash: sha256(token),
              expiresAt,
              consumedAt: null,
              revokedAt: null,
              updatedAt: now,
            },
          });
        await transaction.privacyProcessorOutcome.updateMany({
          where: {
            privacyExecutionId: existing.id,
            status: "RETRY_REQUIRED",
          },
          data: {
            status: "RUNNING",
            attemptCount: { increment: 1 },
            outcomeCode: null,
            providerReceiptHash: null,
            lastErrorClass: null,
            nextRetryAt: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          },
        });
        await transaction.privacyExecution.update({
          where: { id: existing.id },
          data: {
            status: "PROCESSING",
            attemptCount: { increment: 1 },
            lastErrorClass: null,
            nextRetryAt: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          },
        });
        await writeRequiredAudit(prismaAuditPort(transaction), {
          action: "PRIVACY_EXECUTION_STARTED",
          actorKind: "USER",
          actorUserId: input.actorUserId,
          capability: "PRIVACY_CASE_PROCESS",
          correlationId: input.idempotencyKey,
          metadata: {},
          reasonCode: "RETRY_REQUIRED",
          result: "SUCCEEDED",
          retainUntil: auditRetainUntil(now),
          targetId: existing.id,
          targetType: "PRIVACY_EXECUTION",
        });
        return Object.freeze({
          ok: true as const,
          replay: false,
          actorUserId: input.actorUserId,
          requestId: request.id,
          requesterUserId: request.requesterUserId,
          subjectClass: existing.subjectClass,
          inventoryVersion: existing.inventoryVersion.version,
          requiredProcessors: existing.requiredProcessors,
          executionId: existing.id,
          artifact: restartedArtifact,
        });
      }
      return Object.freeze({
        ok: true as const,
        replay: true,
        actorUserId: input.actorUserId,
        requestId: request.id,
        requesterUserId: request.requesterUserId,
        subjectClass: existing.subjectClass,
        inventoryVersion: existing.inventoryVersion.version,
        requiredProcessors: existing.requiredProcessors,
        executionId: existing.id,
        artifact: existing.exportArtifact,
      });
    }
    if (existing !== undefined) return failure("CONFLICT");

    const inventory = await transaction.privacyDataInventoryVersion.findFirst({
      where: {
        status: "ACTIVE",
        effectiveAt: { lte: now },
        revokedAt: null,
      },
      include: { entries: true },
    });
    if (inventory === null || inventory.entries.length === 0) {
      return failure("INVENTORY_UNAVAILABLE");
    }
    const subjectClass = subjectClassForRole(request.requester.role);
    const applicableSubjectClasses = new Set([
      "USER",
      subjectClass,
      "INVITEE",
      "LEAD",
      "REPORTER",
    ]);
    const relevantEntries = inventory.entries.filter(
      (entry) =>
        applicableSubjectClasses.has(entry.subjectClass) &&
        entry.exportOutcome !== "EXCLUDE",
    );
    if (relevantEntries.length === 0) return failure("INVENTORY_UNAVAILABLE");
    const processorRegions = new Map<string, string>();
    for (const entry of relevantEntries) {
      if (
        !SUPPORTED_EXPORT_PROCESSORS.includes(
          entry.processorKey as (typeof SUPPORTED_EXPORT_PROCESSORS)[number],
        )
      ) {
        return failure("PROCESSOR_UNSUPPORTED");
      }
      const knownRegion = processorRegions.get(entry.processorKey);
      if (knownRegion !== undefined && knownRegion !== entry.storageRegion) {
        return failure("INVENTORY_UNAVAILABLE");
      }
      processorRegions.set(entry.processorKey, entry.storageRegion);
    }
    const requiredProcessors = [...processorRegions.keys()].sort();
    const approvals = [];
    for (const processorKey of requiredProcessors) {
      const approval = await transaction.processingApproval.findFirst({
        where: {
          scope: "PRIVACY_EXPORT",
          region: processorRegions.get(processorKey)!,
          processorKey,
          status: "APPROVED",
        },
        orderBy: { createdAt: "desc" },
        include: { legalPublication: true },
      });
      const decision = decideLegalGateV1({
        expectedScope: "PRIVACY_EXPORT",
        expectedRegion: processorRegions.get(processorKey)!,
        expectedProcessorKey: processorKey,
        featureEnabled: dependencies.featureEnabled,
        cohortAllowed: dependencies.cohortAllowed,
        now,
        gate: projectPersistedLegalGateV1(approval),
      });
      if (!decision.allowed || approval === null) {
        return failure("LEGAL_GATE_BLOCKED");
      }
      approvals.push(approval);
    }

    const artifactId = randomUUID();
    const objectVersion = randomUUID();
    const expiresAt = new Date(
      now.getTime() +
        PRIVACY_EXPORT_STORAGE_POLICY_V1.artifactTtlMilliseconds,
    );
    const encryptionKeyVersion = dependencies.exportKeyring[0]!.version;
    const token = derivePrivacyExportDownloadToken(
      dependencies.exportKeyring,
      encryptionKeyVersion,
      artifactId,
      request.requesterUserId,
      expiresAt,
    );
    if (token === null) return failure("INVENTORY_UNAVAILABLE");
    const execution = await transaction.privacyExecution.create({
      data: {
        privacyRequestId: request.id,
        inventoryVersionId: inventory.id,
        processingApprovalId: approvals[0]!.id,
        kind: "EXPORT",
        status: "PROCESSING",
        subjectClass,
        subjectReferenceHash: sha256(request.requesterUserId),
        policyVersion: PRIVACY_EXPORT_POLICY_VERSION,
        requiredProcessors,
        checkpoint: 0,
        attemptCount: 1,
        approvedByUserId: input.approvalActorUserId,
        approvalEvidenceRef: input.approvalEvidenceRef,
        stepUpEvidenceRef: input.stepUpEvidenceRef,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        processorOutcomes: {
          create: requiredProcessors.map((processorKey) => ({
            processorKey,
            dedupeKey: `privacy-export:${request.id}:${processorKey}`,
            status: "RUNNING" as const,
            attemptCount: 1,
            startedAt: now,
            createdAt: now,
            updatedAt: now,
          })),
        },
        exportArtifact: {
          create: {
            id: artifactId,
            privacyRequestId: request.id,
            ownerUserId: request.requesterUserId,
            objectKey: `privacy-export/${artifactId}`,
            objectVersion,
            encryptionKeyVersion,
            storageRegion: dependencies.exportStore.storageRegion,
            manifest: {
              schemaVersion: "2",
              state: "BUILDING",
            },
            manifestHash: sha256("BUILDING"),
            downloadTokenHash: sha256(token),
            expiresAt,
            createdAt: now,
            updatedAt: now,
          },
        },
      },
      include: { exportArtifact: true },
    });
    await writeRequiredAudit(prismaAuditPort(transaction), {
      action: "PRIVACY_EXECUTION_STARTED",
      actorKind: "USER",
      actorUserId: input.actorUserId,
      capability: "PRIVACY_CASE_PROCESS",
      correlationId: input.idempotencyKey,
      metadata: {},
      result: "SUCCEEDED",
      retainUntil: auditRetainUntil(now),
      targetId: execution.id,
      targetType: "PRIVACY_EXECUTION",
    });
    return Object.freeze({
      ok: true as const,
      replay: false,
      actorUserId: input.actorUserId,
      requestId: request.id,
      requesterUserId: request.requesterUserId,
      subjectClass,
      inventoryVersion: inventory.version,
      requiredProcessors,
      executionId: execution.id,
      artifact: execution.exportArtifact!,
    });
  }, transactionOptions());
}

async function prepareOwnedPackage(
  ownerUserId: string,
  subjectClass: string,
  inventoryVersion: string,
  requestId: string,
  requiredProcessors: readonly string[],
  dependencies: PrivacyExportV2Dependencies,
  now: Date,
): Promise<PreparedPackage> {
  const database = dependencies.database;
  const account = await database.user.findUniqueOrThrow({
    where: { id: ownerUserId },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      status: true,
      identityAssurance: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const candidateProfile = await database.candidateProfile.findUnique({
    where: { userId: ownerUserId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      publicDisplayName: true,
      phone: true,
      postalCode: true,
      cityLabel: true,
      summary: true,
      workPermitType: true,
      onboardingStatus: true,
      preference: {
        select: {
          desiredTitles: true,
          desiredJobTypes: true,
          salaryPeriod: true,
          salaryMinChf: true,
          salaryMaxChf: true,
          workloadMin: true,
          workloadMax: true,
          remotePreference: true,
          mobilityRadiusKm: true,
          availableFrom: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  });
  const [
    userConsents,
    notificationPreferences,
    notificationOutbox,
    supportCases,
    reports,
    memberships,
    invitations,
    salesLeads,
    emailLogs,
    analyticsConsents,
  ] = await Promise.all([
    database.userConsentEvent.findMany({
      where: { userId: ownerUserId },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        granted: true,
        purpose: true,
        noticeVersion: true,
        noticeHash: true,
        effectiveAt: true,
        createdAt: true,
      },
    }),
    database.notificationPreference.findMany({
      where: { userId: ownerUserId },
      orderBy: [{ purpose: "asc" }, { channel: "asc" }],
      select: {
        purpose: true,
        channel: true,
        enabled: true,
        version: true,
        updatedAt: true,
      },
    }),
    database.notificationOutbox.findMany({
      where: { recipientUserId: ownerUserId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        purpose: true,
        purposeClass: true,
        channel: true,
        templateKey: true,
        status: true,
        attemptCount: true,
        deliveredAt: true,
        suppressedAt: true,
        deadLetteredAt: true,
        createdAt: true,
      },
    }),
    database.supportCase.findMany({
      where: { requesterUserId: ownerUserId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        subject: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    database.abuseReport.findMany({
      where: { reporterUserId: ownerUserId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        targetType: true,
        reasonCode: true,
        description: true,
        status: true,
        createdAt: true,
      },
    }),
    database.companyMembership.findMany({
      where: { userId: ownerUserId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        companyId: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    database.companyInvitation.findMany({
      where: {
        OR: [
          { acceptedByUserId: ownerUserId },
          { inviteeEmailNormalized: account.email.toLowerCase() },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        companyId: true,
        inviteeEmailNormalized: true,
        intendedRole: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    }),
    database.salesLead.findMany({
      where: { emailNormalized: account.email.toLowerCase() },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        emailNormalized: true,
        organizationName: true,
        contactName: true,
        phoneNormalized: true,
        companySizeCode: true,
        hiringNeedCode: true,
        interestCode: true,
        callbackWindowCode: true,
        purpose: true,
        needSummary: true,
        message: true,
        noticeVersion: true,
        noticeHash: true,
        status: true,
        retainUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    database.emailLog.findMany({
      where: { recipient: account.email },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        purpose: true,
        templateKey: true,
        status: true,
        providerReference: true,
        errorCode: true,
        createdAt: true,
      },
    }),
    database.analyticsConsentEvent.findMany({
      where: { userId: ownerUserId },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        eventFamily: true,
        granted: true,
        policyVersion: true,
        noticeHash: true,
        pseudonymEpoch: true,
        reasonCode: true,
        effectiveAt: true,
      },
    }),
  ]);

  const candidateData =
    candidateProfile === null
      ? {
          candidateConsents: [],
          applications: [],
          radar: [],
          documentVersions: [],
        }
      : {
          candidateConsents: await database.candidateConsent.findMany({
            where: { candidateProfileId: candidateProfile.id },
            orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              kind: true,
              granted: true,
              noticeVersion: true,
              noticeHash: true,
              effectiveAt: true,
            },
          }),
          applications: await database.application.findMany({
            where: { candidateProfileId: candidateProfile.id },
            orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              jobId: true,
              status: true,
              coverLetter: true,
              submittedAt: true,
              rejectionReason: true,
              rejectionNote: true,
              updatedAt: true,
            },
          }),
          radar: await database.radarProfile.findMany({
            where: { candidateProfileId: candidateProfile.id },
            orderBy: { id: "asc" },
            select: {
              id: true,
              displayLabel: true,
              cantonBucket: true,
              categoryBucket: true,
              languageCodes: true,
              skillSlugs: true,
              updatedAt: true,
            },
          }),
          documentVersions: await database.documentVersion.findMany({
            where: {
              candidateProfileId: candidateProfile.id,
              status: "CLEAN",
              sizeBytes: { not: null },
              sha256: { not: null },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              objectKey: true,
              providerObjectVersion: true,
              safeFilename: true,
              sizeBytes: true,
              sha256: true,
            },
          }),
        };

  const sections: ExportSection[] = [
    section("account", "postgres-primary", [account]),
    section(
      "candidateProfile",
      "postgres-primary",
      candidateProfile === null ? [] : [candidateProfile],
    ),
    section("userConsents", "postgres-primary", userConsents),
    section(
      "candidateConsents",
      "postgres-primary",
      candidateData.candidateConsents,
    ),
    section("applications", "postgres-primary", candidateData.applications),
    section("talentRadar", "postgres-primary", candidateData.radar),
    section("supportCases", "postgres-primary", supportCases),
    section("abuseReports", "postgres-primary", reports),
    section("memberships", "postgres-primary", memberships),
    section("invitations", "postgres-primary", invitations),
    section("salesLeads", "postgres-primary", salesLeads),
    section("analyticsConsents", "analytics-store", analyticsConsents),
    section(
      "notificationPreferences",
      "notification-outbox",
      notificationPreferences,
    ),
    section("notificationDelivery", "notification-outbox", notificationOutbox),
    section("emailDeliveryReceipts", "email-provider", emailLogs),
    section("billingEvidence", "payment-ledger", []),
  ].filter((item) => requiredProcessors.includes(item.processorKey));
  for (const processorKey of requiredProcessors) {
    if (!sections.some((item) => item.processorKey === processorKey)) {
      sections.push(section(`${processorKey}Evidence`, processorKey, []));
    }
  }
  const documents: ExportDocument[] = requiredProcessors.includes(
    "document-object-store",
  )
    ? candidateData.documentVersions.map((document) =>
        Object.freeze({
          category: "documentBytes" as const,
          processorKey: "document-object-store" as const,
          documentVersionId: document.id,
          objectKey: document.objectKey,
          objectVersion: document.providerObjectVersion,
          safeFilename: document.safeFilename,
          sizeBytes: document.sizeBytes!,
          sha256: document.sha256!,
        }),
      )
    : [];
  const manifestSections = [
    ...sections.map(manifestSectionForRecords),
    manifestSectionForDocuments(documents),
  ].filter(
    (item) =>
      item.processorKey !== "document-object-store" ||
      requiredProcessors.includes("document-object-store"),
  );
  const manifest: PrivacyExportManifestV2 = Object.freeze({
    schemaVersion: "2",
    packageFormat: "STH_PRIVACY_PACKAGE_V2",
    requestId,
    ownerUserId,
    subjectClass,
    inventoryVersion,
    policyVersion: PRIVACY_EXPORT_POLICY_VERSION,
    generatedAt: now.toISOString(),
    sections: Object.freeze(manifestSections),
  });
  const manifestLine = encodeLine({ kind: "manifest", manifest });
  const expectedSizeBytes =
    manifestLine.byteLength +
    sections.reduce<number>(
      (total, item) =>
        total +
        item.records.reduce<number>(
          (sectionTotal, record) =>
            sectionTotal +
            encodeLine({
              kind: "record",
              category: item.category,
              processorKey: item.processorKey,
              data: record,
            }).byteLength,
          0,
        ),
      0,
    ) +
    documents.reduce<number>(
      (total, document) =>
        total +
        encodeLine({
          kind: "document",
          category: document.category,
          documentVersionId: document.documentVersionId,
          filename: document.safeFilename,
          sizeBytes: document.sizeBytes,
          sha256: document.sha256,
        }).byteLength +
        document.sizeBytes +
        1,
      0,
    );
  if (
    expectedSizeBytes <= 0 ||
    expectedSizeBytes > PRIVACY_EXPORT_STORAGE_POLICY_V1.maximumBytes
  ) {
    throw new Error("privacy export package exceeds its bounded size");
  }
  return Object.freeze({
    manifest,
    manifestHash: sha256(stableJson(manifest)),
    expectedSizeBytes,
    sections: Object.freeze(sections),
    documents: Object.freeze(documents),
  });
}

async function* packageBody(
  prepared: PreparedPackage,
  documentStore: DocumentObjectStore,
): AsyncGenerator<Uint8Array> {
  yield encodeLine({ kind: "manifest", manifest: prepared.manifest });
  for (const item of prepared.sections) {
    for (const record of item.records) {
      yield encodeLine({
        kind: "record",
        category: item.category,
        processorKey: item.processorKey,
        data: record,
      });
    }
  }
  for (const document of prepared.documents) {
    yield encodeLine({
      kind: "document",
      category: document.category,
      documentVersionId: document.documentVersionId,
      filename: document.safeFilename,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
    });
    const opened = await documentStore.openVerifiedRead(document.objectKey);
    if (
      opened === null ||
      opened.receipt.objectVersion !== document.objectVersion ||
      opened.receipt.sizeBytes !== document.sizeBytes ||
      opened.receipt.sha256 !== document.sha256
    ) {
      throw new Error("document export source changed");
    }
    for await (const chunk of opened.body) yield chunk;
    yield Uint8Array.of(0x0a);
  }
}

async function finalizeExportExecution(
  setup: Extract<Awaited<ReturnType<typeof setupExportExecution>>, { ok: true }>,
  prepared: PreparedPackage,
  packageSha256: string,
  sizeBytes: number,
  database: DatabaseClient,
  now: Date,
) {
  return database.$transaction(async (transaction) => {
    await acquireExportLock(transaction, setup.requestId);
    const artifact = await transaction.privacyExportArtifact.findUnique({
      where: { id: setup.artifact.id },
      select: { status: true },
    });
    if (artifact?.status !== "BUILDING") {
      throw new Error("privacy export artifact changed");
    }
    for (const processorKey of setup.requiredProcessors) {
      await transaction.privacyProcessorOutcome.update({
        where: {
          privacyExecutionId_processorKey: {
            privacyExecutionId: setup.executionId,
            processorKey,
          },
        },
        data: {
          status: "SUCCEEDED",
          checkpoint: "PACKAGE_VERIFIED",
          outcomeCode: "EXPORTED",
          providerReceiptHash: sha256(
            `${prepared.manifestHash}:${processorKey}:${packageSha256}`,
          ),
          completedAt: now,
          updatedAt: now,
        },
      });
    }
    await transaction.privacyExportArtifact.update({
      where: { id: setup.artifact.id },
      data: {
        status: "READY",
        manifest: prepared.manifest as Prisma.InputJsonValue,
        manifestHash: prepared.manifestHash,
        packageSha256,
        sizeBytes,
        updatedAt: now,
      },
    });
    await transaction.privacyExecution.update({
      where: { id: setup.executionId },
      data: {
        status: "COMPLETED",
        checkpoint: setup.requiredProcessors.length,
        completedAt: now,
        updatedAt: now,
      },
    });
    const request = await transaction.privacyRequest.update({
      where: { id: setup.requestId },
      data: {
        status: "COMPLETED",
        version: { increment: 1 },
        completedAt: now,
        exportManifest: prepared.manifest as Prisma.InputJsonValue,
        exportManifestChecksum: prepared.manifestHash,
        exportExpiresAt: setup.artifact.expiresAt,
      },
      select: { version: true },
    });
    const correlationId = randomUUID();
    await transaction.privacyRequestEvent.createMany({
      data: [
        {
          privacyRequestId: setup.requestId,
          kind: "MANIFEST_CREATED",
          fromStatus: "IN_PROGRESS",
          toStatus: "IN_PROGRESS",
          actorUserId: setup.actorUserId,
          idempotencyKey: `PRIVACY_EXPORT_V2:MANIFEST:${setup.requestId}`,
          correlationId,
          createdAt: now,
        },
        {
          privacyRequestId: setup.requestId,
          kind: "COMPLETED",
          fromStatus: "IN_PROGRESS",
          toStatus: "COMPLETED",
          actorUserId: setup.actorUserId,
          idempotencyKey: `PRIVACY_EXPORT_V2:COMPLETED:${setup.requestId}`,
          correlationId,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      {
        recipientUserId: setup.artifact.ownerUserId,
        kind: "PRIVACY_REQUEST_CHANGED",
        dedupeKey: `privacy-export-v2:${setup.requestId}:ready`,
        payload: {
          requestId: setup.requestId,
          type: "EXPORT",
          status: "COMPLETED",
          reasonCode: "EXPORT_READY",
        },
      },
    );
    for (const audit of [
      {
        action: "PRIVACY_EXPORT_ARTIFACT_CREATED" as const,
        targetId: setup.artifact.id,
        targetType: "PRIVACY_EXPORT_ARTIFACT" as const,
      },
      {
        action: "PRIVACY_EXECUTION_COMPLETED" as const,
        targetId: setup.executionId,
        targetType: "PRIVACY_EXECUTION" as const,
      },
      {
        action: "PRIVACY_REQUEST_STATUS_CHANGED" as const,
        targetId: setup.requestId,
        targetType: "PRIVACY_REQUEST" as const,
      },
    ]) {
      await writeRequiredAudit(prismaAuditPort(transaction), {
        ...audit,
        actorKind: "SYSTEM",
        capability: "PRIVACY_EXPORT_V2",
        correlationId,
        metadata: {},
        reasonCode: "EXPORT_READY",
        result: "SUCCEEDED",
        retainUntil: auditRetainUntil(now),
      });
    }
    return Object.freeze({
      artifactId: setup.artifact.id,
      ownerUserId: setup.artifact.ownerUserId,
      encryptionKeyVersion: setup.artifact.encryptionKeyVersion,
      expiresAt: setup.artifact.expiresAt,
      requestVersion: request.version,
    });
  }, transactionOptions());
}

async function markExportFailure(
  setup: Extract<Awaited<ReturnType<typeof setupExportExecution>>, { ok: true }>,
  database: DatabaseClient,
  now: Date,
) {
  await database.$transaction(async (transaction) => {
    await transaction.privacyExportArtifact.updateMany({
      where: { id: setup.artifact.id, status: "BUILDING" },
      data: { status: "FAILED", updatedAt: now },
    });
    await transaction.privacyProcessorOutcome.updateMany({
      where: {
        privacyExecutionId: setup.executionId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      data: {
        status: "RETRY_REQUIRED",
        lastErrorClass: "PROVIDER_FAILURE",
        nextRetryAt: new Date(now.getTime() + 60_000),
        updatedAt: now,
      },
    });
    await transaction.privacyExecution.updateMany({
      where: { id: setup.executionId, status: "PROCESSING" },
      data: {
        status: "RETRY_REQUIRED",
        lastErrorClass: "PROVIDER_FAILURE",
        nextRetryAt: new Date(now.getTime() + 60_000),
        updatedAt: now,
      },
    });
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      {
        recipientUserId: setup.artifact.ownerUserId,
        kind: "PRIVACY_REQUEST_CHANGED",
        dedupeKey: `privacy-export-v2:${setup.requestId}:retry-required`,
        payload: {
          requestId: setup.requestId,
          type: "EXPORT",
          status: "IN_PROGRESS",
          reasonCode: "RETRY_REQUIRED",
        },
      },
    );
  }, transactionOptions());
}

export function derivePrivacyExportDownloadToken(
  keyring: readonly KeyringEntry<"PRIVACY_EXPORT_KEYS">[],
  keyVersion: string,
  artifactId: string,
  ownerUserId: string,
  expiresAt: Date,
): string | null {
  const entry = keyring.find(({ version }) => version === keyVersion);
  if (
    entry === undefined ||
    !UUID.safeParse(artifactId).success ||
    !UUID.safeParse(ownerUserId).success ||
    !isValidDate(expiresAt)
  ) {
    return null;
  }
  return entry.key.withValue((encoded) =>
    createHmac("sha256", Buffer.from(encoded, "base64"))
      .update("privacy-export-download-v1\0", "utf8")
      .update(artifactId, "utf8")
      .update("\0", "utf8")
      .update(ownerUserId, "utf8")
      .update("\0", "utf8")
      .update(expiresAt.toISOString(), "utf8")
      .digest("base64url"),
  );
}

function successResult(
  setup: Extract<Awaited<ReturnType<typeof setupExportExecution>>, { ok: true }>,
  token: string,
  replay: boolean,
): PrivacyExportV2Result {
  return Object.freeze({
    ok: true,
    replay,
    artifactId: setup.artifact.id,
    privacyRequestId: setup.requestId,
    expiresAt: setup.artifact.expiresAt,
    downloadToken: token,
    manifestHash: setup.artifact.manifestHash,
  });
}

function section(
  category: string,
  processorKey: string,
  records: readonly unknown[],
): ExportSection {
  return Object.freeze({
    category,
    processorKey,
    records: Object.freeze([...records]),
  });
}

function manifestSectionForRecords(
  item: ExportSection,
): PrivacyExportManifestSectionV2 {
  const lines = item.records.map((record) =>
    encodeLine({
      kind: "record",
      category: item.category,
      processorKey: item.processorKey,
      data: record,
    }),
  );
  return Object.freeze({
    category: item.category,
    processorKey: item.processorKey,
    count: item.records.length,
    byteLength: lines.reduce((total, line) => total + line.byteLength, 0),
    sha256: hashChunks(lines),
    outcome: "INCLUDED",
  });
}

function manifestSectionForDocuments(
  documents: readonly ExportDocument[],
): PrivacyExportManifestSectionV2 {
  return Object.freeze({
    category: "documentBytes",
    processorKey: "document-object-store",
    count: documents.length,
    byteLength: documents.reduce((total, item) => total + item.sizeBytes, 0),
    sha256: sha256(
      stableJson(
        documents.map(({ documentVersionId, sizeBytes, sha256: digest }) => ({
          documentVersionId,
          sizeBytes,
          sha256: digest,
        })),
      ),
    ),
    outcome: "INCLUDED",
  });
}

function subjectClassForRole(role: string) {
  return role === "CANDIDATE"
    ? ("CANDIDATE" as const)
    : role === "EMPLOYER" || role === "RECRUITER"
      ? ("EMPLOYER_MEMBER" as const)
      : ("USER" as const);
}

function encodeLine(value: unknown) {
  return new TextEncoder().encode(`${stableJson(value)}\n`);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function hashChunks(chunks: readonly Uint8Array[]) {
  const digest = createHash("sha256");
  for (const chunk of chunks) digest.update(chunk);
  return digest.digest("hex");
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

async function acquireExportLock(
  transaction: Prisma.TransactionClient,
  privacyRequestId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`privacy-export-v2:${privacyRequestId}`}, 0)
    ) IS NULL AS "locked"
  `;
}

function prismaAuditPort(transaction: Prisma.TransactionClient) {
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

function auditRetainUntil(now: Date) {
  return new Date(
    now.getTime() + AUDIT_RETENTION_DAYS * DAY_MILLISECONDS,
  );
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 15_000,
    timeout: 30_000,
  } as const;
}

function failure<
  Code extends Extract<PrivacyExportV2Result, { ok: false }>["code"],
>(code: Code): Readonly<{ ok: false; code: Code }> {
  return Object.freeze({ ok: false, code });
}

function downloadFailure(
  code: Extract<PrivacyExportDownloadResult, { ok: false }>["code"],
): PrivacyExportDownloadResult {
  return Object.freeze({ ok: false, code });
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

void SHA256;
