import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma/client";
import { z } from "zod";

import {
  writeRequiredAudit,
  type AuditPersistenceRecord,
} from "@/lib/audit/log";
import type { KeyringEntry } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { enqueueNotification } from "@/lib/notifications/outbox";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import {
  destroyedNotificationRecipientMaterial,
  notificationRecipientMaterialExpiresAt,
} from "@/lib/notifications/retention";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import type { DocumentObjectStore } from "@/lib/providers/storage/document-object-store";
import {
  decideLegalGateV1,
  projectPersistedLegalGateV1,
} from "@/lib/privacy/legal-gate-policy";
import { applyRecruitingPrivacyErasureV1 } from "@/lib/privacy/recruiting-lifecycle";
import { applyCandidateRadarEligibilityLoss } from "@/lib/talentradar/eligibility-loss-effects";

const UUID = z.string().uuid();
const EXECUTION_ERROR = "Privacy execution is unavailable.";
const DAY_MILLISECONDS = 86_400_000;
const SUPPORTED_PROCESSORS = Object.freeze([
  "postgres-primary",
  "document-object-store",
  "notification-outbox",
  "email-provider",
  "payment-ledger",
  "analytics-store",
  "backup-restore",
] as const);

const commandSchema = z
  .object({
    privacyRequestId: UUID,
    actorUserId: UUID,
    approvalActorUserId: UUID,
    idempotencyKey: UUID,
    approvalEvidenceRef: z
      .string()
      .regex(
        /^phase25:[A-Za-z0-9._:-]{8,220}$|^sandbox:[A-Za-z0-9._:-]{8,220}$/u,
      ),
    stepUpEvidenceRef: z
      .string()
      .regex(
        /^phase25:[A-Za-z0-9._:-]{8,220}$|^sandbox:[A-Za-z0-9._:-]{8,220}$/u,
      ),
  })
  .strict();

export type PrivacyExecutionV2Dependencies = Readonly<{
  database: DatabaseClient;
  documentStore: DocumentObjectStore;
  correctionEnabled: boolean;
  erasureEnabled: boolean;
  cohortAllowed: boolean;
  processingMode:
    "disabled" | "sandbox_command" | "contract_worker" | "autonomous_worker";
  notificationDeliveryKeyring?: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[];
  notificationRecipientHashKeyring?: readonly KeyringEntry<"NOTIFICATION_RECIPIENT_HASH_KEYS">[];
  now?: Date;
  injectProcessorFailure?: (
    processorKey: string,
    attempt: number,
  ) => "RETRYABLE" | "TERMINAL" | null;
  injectCrashAfterStage?: (stage: PrivacyExecutionCrashStage) => boolean;
}>;

export type PrivacyExecutionCrashStage =
  | "ERASURE_NOTIFICATION_STAGED"
  | "ERASURE_POSTGRES_ANONYMIZED"
  | "ERASURE_PROCESSOR_OUTCOME_COMMITTED"
  | "ERASURE_EXECUTION_COMPLETED";

export type PrivacyExecutionV2Result =
  | Readonly<{
      ok: true;
      replay: boolean;
      executionId: string;
      privacyRequestId: string;
      status: "COMPLETED";
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
        | "RETRY_REQUIRED"
        | "TERMINAL_FAILURE"
        | "CONFLICT";
      executionId?: string;
    }>;

type Setup = Readonly<{
  executionId: string;
  requestId: string;
  requesterUserId: string;
  actorUserId: string;
  kind: "CORRECTION" | "ERASURE";
  subjectClass: "USER" | "CANDIDATE" | "EMPLOYER_MEMBER";
  subjectReferenceHash: string;
  requiredProcessors: readonly string[];
  startedAt: Date;
  recipientRetentionUntil: Date;
  replay: boolean;
}>;

type ProcessorResult = Readonly<{
  status: "SUCCEEDED" | "RETAINED";
  outcomeCode: string;
  retainedBasisRef?: string;
  receiptHash: string;
  proofs?: readonly Readonly<{
    entityKey: string;
    action: "ERASED" | "ANONYMIZED" | "RETAINED";
    retainedBasisRef?: string;
  }>[];
  domainEventRefs?: readonly string[];
}>;

export async function runPrivacyExecutionV2(
  rawCommand: unknown,
  dependencies: PrivacyExecutionV2Dependencies,
): Promise<PrivacyExecutionV2Result> {
  const command = commandSchema.safeParse(rawCommand);
  const now = dependencies.now ?? new Date();
  if (!command.success || !isValidDate(now)) return failure("INVALID_INPUT");
  if (
    dependencies.processingMode === "disabled" ||
    !dependencies.cohortAllowed
  ) {
    return failure("FEATURE_DISABLED");
  }

  const setup = await setupExecution(command.data, dependencies, now);
  if (!setup.ok) return setup;
  const execution = setup.value;
  const current = await dependencies.database.privacyExecution.findUnique({
    where: { id: execution.executionId },
    include: {
      processorOutcomes: { orderBy: { processorKey: "asc" } },
    },
  });
  if (current === null) return failure("NOT_FOUND");
  if (current.status === "COMPLETED") {
    return Object.freeze({
      ok: true,
      replay: true,
      executionId: current.id,
      privacyRequestId: execution.requestId,
      status: "COMPLETED",
    });
  }

  const domainEventRefs = current.processorOutcomes.flatMap(({ checkpoint }) =>
    parseDomainEventCheckpoint(checkpoint),
  );
  for (const processorKey of execution.requiredProcessors) {
    const outcome = current.processorOutcomes.find(
      (candidate) => candidate.processorKey === processorKey,
    );
    if (
      outcome === undefined ||
      ["SUCCEEDED", "RETAINED"].includes(outcome.status)
    ) {
      continue;
    }
    const attempt = outcome.attemptCount + 1;
    await markProcessorRunning(
      execution.executionId,
      processorKey,
      attempt,
      dependencies.database,
      now,
    );
    try {
      const injected = dependencies.injectProcessorFailure?.(
        processorKey,
        attempt,
      );
      if (injected === "RETRYABLE") throw new RetryableProcessorError();
      if (injected === "TERMINAL") throw new TerminalProcessorError();
      const result = await executeProcessor(
        execution,
        processorKey,
        dependencies,
        now,
      );
      if (execution.kind === "ERASURE" && processorKey === "postgres-primary") {
        injectPrivacyExecutionCrash(
          dependencies,
          "ERASURE_POSTGRES_ANONYMIZED",
        );
      }
      domainEventRefs.push(...(result.domainEventRefs ?? []));
      await storeProcessorResult(
        execution,
        processorKey,
        result,
        dependencies.database,
        now,
      );
      if (execution.kind === "ERASURE" && processorKey === "postgres-primary") {
        injectPrivacyExecutionCrash(
          dependencies,
          "ERASURE_PROCESSOR_OUTCOME_COMMITTED",
        );
      }
    } catch (error) {
      if (error instanceof InjectedPrivacyExecutionCrash) throw error;
      const terminal = error instanceof TerminalProcessorError;
      await storeProcessorFailure(
        execution,
        processorKey,
        terminal,
        dependencies.database,
        dependencies.notificationDeliveryKeyring ?? [],
        now,
      );
      return Object.freeze({
        ok: false,
        code: terminal ? "TERMINAL_FAILURE" : "RETRY_REQUIRED",
        executionId: execution.executionId,
      });
    }
  }

  await completeExecution(
    execution,
    domainEventRefs,
    dependencies.database,
    dependencies.notificationDeliveryKeyring ?? [],
    now,
  );
  if (execution.kind === "ERASURE") {
    injectPrivacyExecutionCrash(dependencies, "ERASURE_EXECUTION_COMPLETED");
  }
  return Object.freeze({
    ok: true,
    replay: setup.value.replay,
    executionId: execution.executionId,
    privacyRequestId: execution.requestId,
    status: "COMPLETED",
  });
}

async function setupExecution(
  command: z.output<typeof commandSchema>,
  dependencies: PrivacyExecutionV2Dependencies,
  now: Date,
) {
  return dependencies.database.$transaction(async (transaction) => {
    await acquireExecutionLock(transaction, command.privacyRequestId);
    const request = await transaction.privacyRequest.findUnique({
      where: { id: command.privacyRequestId },
      include: {
        requester: { select: { role: true, status: true } },
        executions: true,
      },
    });
    if (request === null) return setupFailure("NOT_FOUND");
    const kind =
      request.type === "CORRECT"
        ? ("CORRECTION" as const)
        : request.type === "DELETE"
          ? ("ERASURE" as const)
          : null;
    if (
      kind === null ||
      !["IN_PROGRESS", "COMPLETED"].includes(request.status) ||
      request.verifiedAt === null
    ) {
      return setupFailure("WRONG_STATE");
    }
    if (
      (kind === "CORRECTION" && !dependencies.correctionEnabled) ||
      (kind === "ERASURE" && !dependencies.erasureEnabled)
    ) {
      return setupFailure("FEATURE_DISABLED");
    }
    if (
      request.assignedAdminUserId !== command.actorUserId ||
      command.actorUserId === command.approvalActorUserId ||
      request.requesterUserId === command.approvalActorUserId
    ) {
      return setupFailure("FORBIDDEN");
    }
    const existing = request.executions.find(
      (candidate) => candidate.kind === kind,
    );
    const adminCount = await transaction.user.count({
      where: {
        id: { in: [command.actorUserId, command.approvalActorUserId] },
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    if (
      adminCount !== 2 ||
      (request.requester.status !== "ACTIVE" && existing === undefined)
    ) {
      return setupFailure("FORBIDDEN");
    }
    if (existing !== undefined) {
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({
          executionId: existing.id,
          requestId: request.id,
          requesterUserId: request.requesterUserId,
          actorUserId: command.actorUserId,
          kind,
          subjectClass: existing.subjectClass as Setup["subjectClass"],
          subjectReferenceHash: existing.subjectReferenceHash,
          requiredProcessors: Object.freeze(existing.requiredProcessors),
          startedAt: existing.startedAt ?? existing.createdAt,
          recipientRetentionUntil: erasureNotificationRetentionUntil(
            request.dueAt,
            existing.startedAt ?? existing.createdAt,
          ),
          replay: true,
        }),
      });
    }
    const inventory = await transaction.privacyDataInventoryVersion.findFirst({
      where: { status: "ACTIVE", effectiveAt: { lte: now }, revokedAt: null },
      include: { entries: true },
    });
    if (inventory === null) return setupFailure("INVENTORY_UNAVAILABLE");
    const subjectClass = subjectClassForRole(request.requester.role);
    const applicableSubjectClasses = await subjectClassesForIdentity(
      transaction,
      request.requesterUserId,
      request.requester.role,
    );
    const outcomeKey =
      kind === "CORRECTION" ? "correctionOutcome" : "erasureOutcome";
    const relevant = inventory.entries.filter(
      (entry) =>
        applicableSubjectClasses.has(entry.subjectClass) &&
        entry[outcomeKey] !== "EXCLUDE",
    );
    if (relevant.length === 0) return setupFailure("INVENTORY_UNAVAILABLE");
    const processorRegions = new Map<string, string>();
    for (const entry of relevant) {
      if (
        !SUPPORTED_PROCESSORS.includes(
          entry.processorKey as (typeof SUPPORTED_PROCESSORS)[number],
        )
      ) {
        return setupFailure("PROCESSOR_UNSUPPORTED");
      }
      const region = processorRegions.get(entry.processorKey);
      if (region !== undefined && region !== entry.storageRegion) {
        return setupFailure("INVENTORY_UNAVAILABLE");
      }
      processorRegions.set(entry.processorKey, entry.storageRegion);
    }
    const requiredProcessors = orderProcessors([...processorRegions.keys()]);
    const scope =
      kind === "CORRECTION" ? "PRIVACY_CORRECTION" : "PRIVACY_ERASURE";
    const approvals = [];
    for (const processorKey of requiredProcessors) {
      const approval = await transaction.processingApproval.findFirst({
        where: {
          scope,
          region: processorRegions.get(processorKey)!,
          processorKey,
          status: "APPROVED",
        },
        orderBy: { createdAt: "desc" },
        include: { legalPublication: true },
      });
      const decision = decideLegalGateV1({
        expectedScope: scope,
        expectedRegion: processorRegions.get(processorKey)!,
        expectedProcessorKey: processorKey,
        featureEnabled: true,
        cohortAllowed: true,
        now,
        gate: projectPersistedLegalGateV1(approval),
      });
      if (!decision.allowed || approval === null) {
        return setupFailure("LEGAL_GATE_BLOCKED");
      }
      approvals.push(approval);
    }
    const subjectReferenceHash = sha256(request.requesterUserId);
    const execution = await transaction.privacyExecution.create({
      data: {
        privacyRequestId: request.id,
        inventoryVersionId: inventory.id,
        processingApprovalId: approvals[0]!.id,
        kind,
        status: "PROCESSING",
        subjectClass,
        subjectReferenceHash,
        policyVersion:
          kind === "CORRECTION"
            ? "privacy-correction-v2"
            : "privacy-erasure-v2",
        requiredProcessors,
        approvedByUserId: command.approvalActorUserId,
        approvalEvidenceRef: command.approvalEvidenceRef,
        stepUpEvidenceRef: command.stepUpEvidenceRef,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        processorOutcomes: {
          create: requiredProcessors.map((processorKey) => ({
            processorKey,
            dedupeKey: `privacy-${kind.toLowerCase()}:${request.id}:${processorKey}`,
            createdAt: now,
            updatedAt: now,
          })),
        },
      },
      select: { id: true },
    });
    await transaction.privacyRequestEvent.create({
      data: {
        privacyRequestId: request.id,
        kind: "EXECUTION_STARTED",
        fromStatus: "IN_PROGRESS",
        toStatus: "IN_PROGRESS",
        actorUserId: command.actorUserId,
        reasonCode: kind,
        idempotencyKey: `PRIVACY_EXECUTION:${kind}:${request.id}`,
        correlationId: command.idempotencyKey,
        createdAt: now,
      },
    });
    await writeRequiredAudit(prismaAuditPort(transaction), {
      action: "PRIVACY_EXECUTION_STARTED",
      actorKind: "USER",
      actorUserId: command.actorUserId,
      capability: "PRIVACY_CASE_PROCESS",
      correlationId: command.idempotencyKey,
      metadata: {},
      reasonCode: kind,
      result: "SUCCEEDED",
      retainUntil: auditRetainUntil(now),
      targetId: execution.id,
      targetType: "PRIVACY_EXECUTION",
    });
    return Object.freeze({
      ok: true as const,
      value: Object.freeze({
        executionId: execution.id,
        requestId: request.id,
        requesterUserId: request.requesterUserId,
        actorUserId: command.actorUserId,
        kind,
        subjectClass,
        subjectReferenceHash,
        requiredProcessors: Object.freeze(requiredProcessors),
        startedAt: now,
        recipientRetentionUntil: erasureNotificationRetentionUntil(
          request.dueAt,
          now,
        ),
        replay: false,
      }),
    });
  }, transactionOptions());
}

async function executeProcessor(
  setup: Setup,
  processorKey: string,
  dependencies: PrivacyExecutionV2Dependencies,
  now: Date,
): Promise<ProcessorResult> {
  if (setup.kind === "CORRECTION") {
    if (processorKey !== "postgres-primary") {
      return retainedResult(processorKey, "CANONICAL_PROVIDER_REVIEW_REQUIRED");
    }
    return executePostgresCorrection(setup, dependencies.database, now);
  }
  switch (processorKey) {
    case "postgres-primary":
      return executePostgresErasure(
        setup,
        dependencies.database,
        dependencies.notificationDeliveryKeyring ?? [],
        dependencies.notificationRecipientHashKeyring ?? [],
        dependencies,
        now,
      );
    case "document-object-store":
      return executeDocumentErasure(
        setup,
        dependencies.database,
        dependencies.documentStore,
        now,
      );
    case "email-provider":
      return executeEmailErasure(setup, dependencies.database, now);
    case "analytics-store":
      return executeAnalyticsErasure(setup, dependencies.database, now);
    case "notification-outbox":
      return retainedResult(
        processorKey,
        "TRANSACTIONAL_DELIVERY_EVIDENCE_RETENTION",
      );
    case "payment-ledger":
      return retainedResult(processorKey, "ACCOUNTING_RETENTION");
    case "backup-restore":
      return executeBackupTombstone(setup, dependencies.database, now);
    default:
      throw new TerminalProcessorError();
  }
}

async function executePostgresCorrection(
  setup: Setup,
  database: DatabaseClient,
  now: Date,
): Promise<ProcessorResult> {
  return database.$transaction(async (transaction) => {
    const request = await transaction.privacyRequest.findUnique({
      where: { id: setup.requestId },
      include: {
        correctionFields: true,
        requester: { include: { candidateProfile: true } },
      },
    });
    if (request === null || request.type !== "CORRECT") {
      throw new TerminalProcessorError();
    }
    const supported = new Set([
      "DISPLAY_NAME",
      "LEGAL_NAME",
      "PHONE",
      "LOCATION",
      "PROFILE_PREFERENCES",
      "CONSENT_HISTORY",
      "APPLICATION_DATA",
      "OTHER_ACCOUNT_DATA",
    ]);
    if (
      request.correctionFields.length === 0 ||
      request.correctionFields.some(
        ({ fieldCode }) => !supported.has(fieldCode),
      )
    ) {
      throw new TerminalProcessorError();
    }
    const domainEventRefs: string[] = [];
    let manualReviewRequired = false;
    for (const field of request.correctionFields) {
      const value = field.correctionText.trim();
      if (value.length === 0) throw new TerminalProcessorError();
      if (
        field.fieldCode === "DISPLAY_NAME" ||
        field.fieldCode === "LEGAL_NAME"
      ) {
        if (value.length > 160) throw new TerminalProcessorError();
        await transaction.user.update({
          where: { id: setup.requesterUserId },
          data: { name: value, updatedAt: now },
        });
        domainEventRefs.push(randomUUID());
      } else if (field.fieldCode === "PHONE") {
        if (value.length > 40 || request.requester.candidateProfile === null) {
          throw new TerminalProcessorError();
        }
        await transaction.candidateProfile.update({
          where: { id: request.requester.candidateProfile.id },
          data: { phone: value, updatedAt: now },
        });
        domainEventRefs.push(randomUUID());
      } else if (field.fieldCode === "LOCATION") {
        if (value.length > 160 || request.requester.candidateProfile === null) {
          throw new TerminalProcessorError();
        }
        await transaction.candidateProfile.update({
          where: { id: request.requester.candidateProfile.id },
          data: { cityLabel: value, updatedAt: now },
        });
        domainEventRefs.push(randomUUID());
      } else {
        // Email, historical evidence and free-form domain structures require
        // their owning canonical workflow; never pretend a text description
        // mutated them.
        manualReviewRequired = true;
      }
    }
    await transaction.privacyRequestCorrectionField.updateMany({
      where: { privacyRequestId: setup.requestId },
      data: { reviewedAt: now },
    });
    return Object.freeze({
      status: manualReviewRequired
        ? ("RETAINED" as const)
        : ("SUCCEEDED" as const),
      outcomeCode: manualReviewRequired
        ? "MANUAL_POLICY_REVIEW_REQUIRED"
        : "CANONICAL_CORRECTION_APPLIED",
      ...(manualReviewRequired
        ? { retainedBasisRef: "MANUAL_POLICY_REVIEW_REQUIRED" }
        : {}),
      receiptHash: sha256(
        stableReceipt(setup, "postgres-primary", domainEventRefs),
      ),
      domainEventRefs: Object.freeze(domainEventRefs),
    });
  }, transactionOptions());
}

async function executePostgresErasure(
  setup: Setup,
  database: DatabaseClient,
  notificationDeliveryKeyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  notificationRecipientHashKeyring: readonly KeyringEntry<"NOTIFICATION_RECIPIENT_HASH_KEYS">[],
  dependencies: PrivacyExecutionV2Dependencies,
  now: Date,
): Promise<ProcessorResult> {
  return database.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { id: setup.requesterUserId },
      include: { candidateProfile: true },
    });
    if (user === null) throw new TerminalProcessorError();
    const holds = await activeHolds(
      transaction,
      setup.subjectReferenceHash,
      now,
    );
    const proofs: NonNullable<ProcessorResult["proofs"]>[number][] = [];
    const held = (entityKey: string) =>
      holds.find(
        (hold) => hold.entityType === entityKey || hold.scope === entityKey,
      );
    const accountHold = held("USER_ACCOUNT");
    if (accountHold === undefined) {
      if (
        notificationDeliveryKeyring.length > 0 &&
        notificationRecipientHashKeyring.length > 0
      ) {
        await stageErasureStatusEmails(
          transaction,
          setup,
          user.email,
          notificationDeliveryKeyring,
          notificationRecipientHashKeyring,
        );
        injectPrivacyExecutionCrash(
          dependencies,
          "ERASURE_NOTIFICATION_STAGED",
        );
      }
      const activeAssignments = await transaction.personaAssignment.findMany({
        where: { userId: user.id, status: "ACTIVE" },
        select: {
          id: true,
          status: true,
          source: true,
          version: true,
        },
      });
      for (const assignment of activeAssignments) {
        await transaction.personaAssignment.update({
          where: { id: assignment.id },
          data: {
            status: "SUSPENDED",
            version: assignment.version + 1,
            suspendedAt: now,
            updatedAt: now,
          },
        });
        await transaction.personaAssignmentEvent.create({
          data: {
            personaAssignmentId: assignment.id,
            kind: "SUSPENDED",
            fromStatus: assignment.status,
            toStatus: "SUSPENDED",
            source: assignment.source,
            actorUserId: null,
            reasonCode: "IDENTITY_ERASURE",
            correlationId: randomUUID(),
            createdAt: now,
          },
        });
      }
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.user.update({
        where: { id: user.id },
        data: {
          email: `erased-${setup.subjectReferenceHash.slice(0, 24)}@invalid.local`,
          emailNormalized: `erased-${setup.subjectReferenceHash.slice(0, 24)}@invalid.local`,
          emailAddressEpoch: { increment: 1 },
          name: null,
          status: "SUSPENDED",
          updatedAt: now,
        },
      });
      proofs.push(proof("USER_ACCOUNT", "ANONYMIZED"));
      if (activeAssignments.length > 0) {
        proofs.push(proof("PERSONA_ASSIGNMENT", "ANONYMIZED"));
      }
    } else {
      proofs.push(proof("USER_ACCOUNT", "RETAINED", accountHold.basisRef));
    }
    const recruitingErasure = await applyRecruitingPrivacyErasureV1(
      transaction,
      {
        userId: user.id,
        candidateProfileId: user.candidateProfile?.id ?? null,
        requestId: setup.requestId,
        now,
      },
    );
    if (recruitingErasure.ownedInterviews > 0) {
      proofs.push(
        proof(
          "INTERVIEW_SCHEDULING",
          "RETAINED",
          held("INTERVIEW_SCHEDULING")?.basisRef ??
            "INTERVIEW_EVIDENCE_RETENTION",
        ),
      );
    }
    if (recruitingErasure.externalTrackers > 0) {
      proofs.push(
        proof(
          "EXTERNAL_APPLICATION_TRACKER",
          "RETAINED",
          held("EXTERNAL_APPLICATION_TRACKER")?.basisRef ??
            "APPLICATION_EVIDENCE_RETENTION",
        ),
      );
    }
    if (user.candidateProfile !== null) {
      const profile = user.candidateProfile;
      const profileHold = held("CANDIDATE_PROFILE");
      if (profileHold === undefined) {
        await applyCandidateRadarEligibilityLoss(transaction, {
          candidateProfileId: profile.id,
          candidateUserId: user.id,
          reason: "CANDIDATE_USER_UNAVAILABLE",
          actor: { kind: "SYSTEM" },
          correlationId: randomUUID(),
          now,
        });
        await transaction.candidatePreferenceCategory.deleteMany({
          where: {
            candidatePreference: { candidateProfileId: profile.id },
          },
        });
        await transaction.candidatePreference.deleteMany({
          where: { candidateProfileId: profile.id },
        });
        await transaction.candidateSkill.deleteMany({
          where: { candidateProfileId: profile.id },
        });
        await transaction.candidateLanguage.deleteMany({
          where: { candidateProfileId: profile.id },
        });
        await transaction.candidateProfile.update({
          where: { id: profile.id },
          data: {
            firstName: null,
            lastName: null,
            publicDisplayName: null,
            phone: null,
            postalCode: null,
            cityLabel: null,
            summary: null,
            workPermitType: null,
            updatedAt: now,
          },
        });
        await transaction.message.updateMany({
          where: { senderUserId: user.id },
          data: { body: "[anonymisiert]", editedAt: now },
        });
        await transaction.applicationCandidateNote.updateMany({
          where: { application: { candidateProfileId: profile.id } },
          data: { body: "[anonymisiert]", updatedAt: now },
        });
        const retainedApplications = await transaction.application.count({
          where: { candidateProfileId: profile.id },
        });
        proofs.push(proof("CANDIDATE_PROFILE", "ANONYMIZED"));
        if (retainedApplications > 0) {
          proofs.push(
            proof(
              "CANDIDATE_APPLICATION",
              "RETAINED",
              "APPLICATION_EVIDENCE_RETENTION",
            ),
          );
        }
      } else {
        proofs.push(
          proof("CANDIDATE_PROFILE", "RETAINED", profileHold.basisRef),
        );
      }
    }
    return Object.freeze({
      status: proofs.some(({ action }) => action === "RETAINED")
        ? ("RETAINED" as const)
        : ("SUCCEEDED" as const),
      outcomeCode: proofs.some(({ action }) => action === "RETAINED")
        ? "ERASURE_WITH_NARROW_HOLDS"
        : "POSTGRES_ANONYMIZED",
      retainedBasisRef: proofs.find(({ retainedBasisRef }) => retainedBasisRef)
        ?.retainedBasisRef,
      receiptHash: sha256(stableReceipt(setup, "postgres-primary", proofs)),
      proofs: Object.freeze(proofs),
    });
  }, transactionOptions());
}

async function executeDocumentErasure(
  setup: Setup,
  database: DatabaseClient,
  store: DocumentObjectStore,
  now: Date,
): Promise<ProcessorResult> {
  const profile = await database.candidateProfile.findUnique({
    where: { userId: setup.requesterUserId },
    select: { id: true },
  });
  if (profile === null) {
    return successProcessorResult(
      setup,
      "document-object-store",
      "NO_DOCUMENTS",
    );
  }
  const versions = await database.documentVersion.findMany({
    where: {
      candidateProfileId: profile.id,
      status: { not: "DELETED" },
    },
    include: { applicationLinks: { select: { id: true }, take: 1 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const holds = await database.legalHold.findMany({
    where: {
      subjectReferenceHash: setup.subjectReferenceHash,
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
  const proofs: NonNullable<ProcessorResult["proofs"]>[number][] = [];
  for (const version of versions) {
    const hold = holds.find(
      (candidate) =>
        candidate.entityType === "DOCUMENT_VERSION" &&
        candidate.entityReferenceHash === sha256(version.id),
    );
    if (hold !== undefined || version.applicationLinks.length > 0) {
      await database.documentVersion.updateMany({
        where: { id: version.id, status: "DELETE_PENDING" },
        data: { status: "HELD" },
      });
      proofs.push(
        proof(
          `DOCUMENT_VERSION:${sha256(version.id).slice(0, 16)}`,
          "RETAINED",
          hold?.basisRef ?? "APPLICATION_EVIDENCE_RETENTION",
        ),
      );
      continue;
    }
    if (version.sha256 === null) throw new RetryableProcessorError();
    await database.$transaction(async (transaction) => {
      await transaction.documentReadGrant.updateMany({
        where: { documentVersionId: version.id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
      if (version.status !== "DELETE_PENDING") {
        await transaction.documentVersion.update({
          where: { id: version.id },
          data: { status: "DELETE_PENDING", deleteRequestedAt: now },
        });
      }
    });
    const deleted = await store.deleteObject(version.objectKey, {
      sha256: version.sha256,
      objectVersion: version.providerObjectVersion,
    });
    if (deleted === "MISMATCH") throw new RetryableProcessorError();
    await database.documentVersion.update({
      where: { id: version.id },
      data: { status: "DELETED" },
    });
    proofs.push(
      proof(`DOCUMENT_VERSION:${sha256(version.id).slice(0, 16)}`, "ERASED"),
    );
  }
  return Object.freeze({
    status: proofs.some(({ action }) => action === "RETAINED")
      ? ("RETAINED" as const)
      : ("SUCCEEDED" as const),
    outcomeCode: "DOCUMENT_ERASURE_RECONCILED",
    retainedBasisRef: proofs.find(({ retainedBasisRef }) => retainedBasisRef)
      ?.retainedBasisRef,
    receiptHash: sha256(stableReceipt(setup, "document-object-store", proofs)),
    proofs: Object.freeze(proofs),
  });
}

const DEFERRED_ERASURE_NOTIFICATION_AT = new Date("9999-12-31T23:59:59.000Z");

async function stageErasureStatusEmails(
  transaction: Prisma.TransactionClient,
  setup: Setup,
  recipientAddress: string,
  keyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  hashKeyring: readonly KeyringEntry<"NOTIFICATION_RECIPIENT_HASH_KEYS">[],
) {
  const successDedupeKey = erasureSuccessEmailDedupeKey(setup.executionId);
  const failureDedupeKey = erasureFailureEmailDedupeKey(setup.executionId);
  const existing = await transaction.notificationOutbox.count({
    where: { dedupeKey: { in: [successDedupeKey, failureDedupeKey] } },
  });
  if (existing === 2) return;
  if (existing !== 0) throw new TerminalProcessorError();
  await enqueueNotification(transaction, {
    recipient: {
      address: recipientAddress,
      keyring,
      hashKeyring,
      retentionUntil: setup.recipientRetentionUntil,
    },
    templateKey: "privacy_request_changed",
    payloadSchemaVersion: "privacy-request-v1",
    payload: { requestId: setup.requestId, statusLabel: "Abgeschlossen" },
    dedupeKey: successDedupeKey,
    createdAt: setup.startedAt,
    availableAt: DEFERRED_ERASURE_NOTIFICATION_AT,
  });
  await enqueueNotification(transaction, {
    recipient: {
      address: recipientAddress,
      keyring,
      hashKeyring,
      retentionUntil: setup.recipientRetentionUntil,
    },
    templateKey: "privacy_request_changed",
    payloadSchemaVersion: "privacy-request-v1",
    payload: {
      requestId: setup.requestId,
      statusLabel: "Weitere Bearbeitung erforderlich",
    },
    dedupeKey: failureDedupeKey,
    createdAt: setup.startedAt,
    availableAt: DEFERRED_ERASURE_NOTIFICATION_AT,
  });
}

async function executeEmailErasure(
  setup: Setup,
  database: DatabaseClient,
  now: Date,
): Promise<ProcessorResult> {
  const user = await database.user.findUnique({
    where: { id: setup.requesterUserId },
    select: { email: true },
  });
  if (user === null) throw new TerminalProcessorError();
  const updated = await database.emailLog.updateMany({
    where: { recipient: user.email },
    data: {
      recipient: `erased-${setup.subjectReferenceHash.slice(0, 24)}@invalid.local`,
      payload: { redacted: true, policyVersion: "privacy-erasure-v2" },
      updatedAt: now,
    },
  });
  return Object.freeze({
    status: "SUCCEEDED",
    outcomeCode: "EMAIL_RECEIPTS_ANONYMIZED",
    receiptHash: sha256(
      stableReceipt(setup, "email-provider", { updated: updated.count }),
    ),
    proofs: Object.freeze([proof("EMAIL_PROVIDER_RECEIPT", "ANONYMIZED")]),
  });
}

async function executeAnalyticsErasure(
  setup: Setup,
  database: DatabaseClient,
  now: Date,
): Promise<ProcessorResult> {
  const latest = await database.analyticsConsentEvent.findMany({
    where: { userId: setup.requesterUserId },
    orderBy: [{ eventFamily: "asc" }, { effectiveAt: "desc" }],
    distinct: ["eventFamily"],
  });
  for (const consent of latest) {
    if (!consent.granted) continue;
    await database.analyticsConsentEvent.create({
      data: {
        userId: setup.requesterUserId,
        eventFamily: consent.eventFamily,
        granted: false,
        policyVersion: consent.policyVersion,
        noticeHash: consent.noticeHash,
        legalPublicationId: consent.legalPublicationId,
        processingApprovalId: consent.processingApprovalId,
        pseudonymEpoch: consent.pseudonymEpoch + 1,
        actorUserId: setup.requesterUserId,
        reasonCode: "PRIVACY_ERASURE",
        effectiveAt: now,
        createdAt: now,
      },
    });
  }
  return Object.freeze({
    status: "SUCCEEDED",
    outcomeCode: "OPTIONAL_ANALYTICS_REVOKED",
    receiptHash: sha256(
      stableReceipt(setup, "analytics-store", { revoked: latest.length }),
    ),
    proofs: Object.freeze([proof("OPTIONAL_PRODUCT_ANALYTICS", "ERASED")]),
  });
}

async function executeBackupTombstone(
  setup: Setup,
  database: DatabaseClient,
  now: Date,
): Promise<ProcessorResult> {
  const digest = sha256(
    stableReceipt(setup, "backup-restore", "ERASURE_TOMBSTONE"),
  );
  await database.privacyTombstone.upsert({
    where: {
      subjectReferenceHash_processorKey_entityKey: {
        subjectReferenceHash: setup.subjectReferenceHash,
        processorKey: "backup-restore",
        entityKey: "SUBJECT_ROOT",
      },
    },
    create: {
      subjectReferenceHash: setup.subjectReferenceHash,
      processorKey: "backup-restore",
      entityKey: "SUBJECT_ROOT",
      erasureProofDigest: digest,
      effectiveAt: now,
    },
    update: {},
  });
  return Object.freeze({
    status: "SUCCEEDED",
    outcomeCode: "RESTORE_TOMBSTONE_WRITTEN",
    receiptHash: digest,
    proofs: Object.freeze([proof("BACKUP_SNAPSHOT", "ANONYMIZED")]),
  });
}

async function markProcessorRunning(
  executionId: string,
  processorKey: string,
  attempt: number,
  database: DatabaseClient,
  now: Date,
) {
  await database.privacyProcessorOutcome.update({
    where: {
      privacyExecutionId_processorKey: {
        privacyExecutionId: executionId,
        processorKey,
      },
    },
    data: {
      status: "RUNNING",
      attemptCount: attempt,
      startedAt: now,
      completedAt: null,
      lastErrorClass: null,
      nextRetryAt: null,
      updatedAt: now,
    },
  });
}

async function storeProcessorResult(
  setup: Setup,
  processorKey: string,
  result: ProcessorResult,
  database: DatabaseClient,
  now: Date,
) {
  await database.$transaction(async (transaction) => {
    await transaction.privacyProcessorOutcome.update({
      where: {
        privacyExecutionId_processorKey: {
          privacyExecutionId: setup.executionId,
          processorKey,
        },
      },
      data: {
        status: result.status,
        checkpoint:
          result.domainEventRefs === undefined ||
          result.domainEventRefs.length === 0
            ? "TERMINAL"
            : `EVENTS:${result.domainEventRefs.join(",")}`,
        outcomeCode: result.outcomeCode,
        retainedBasisRef: result.retainedBasisRef ?? null,
        providerReceiptHash: result.receiptHash,
        completedAt: now,
        updatedAt: now,
      },
    });
    for (const item of result.proofs ?? []) {
      const proofDigest = sha256(stableReceipt(setup, processorKey, item));
      await transaction.erasureProof.upsert({
        where: {
          privacyExecutionId_processorKey_entityKey: {
            privacyExecutionId: setup.executionId,
            processorKey,
            entityKey: item.entityKey,
          },
        },
        create: {
          privacyExecutionId: setup.executionId,
          processorKey,
          entityKey: item.entityKey,
          subjectReferenceHash: setup.subjectReferenceHash,
          action: item.action,
          proofDigest,
          retainedBasisRef: item.retainedBasisRef ?? null,
          occurredAt: now,
          createdAt: now,
        },
        update: {},
      });
      if (item.action !== "RETAINED") {
        await transaction.privacyTombstone.upsert({
          where: {
            subjectReferenceHash_processorKey_entityKey: {
              subjectReferenceHash: setup.subjectReferenceHash,
              processorKey,
              entityKey: item.entityKey,
            },
          },
          create: {
            subjectReferenceHash: setup.subjectReferenceHash,
            processorKey,
            entityKey: item.entityKey,
            erasureProofDigest: proofDigest,
            effectiveAt: now,
          },
          update: {},
        });
      }
    }
    const terminal = await transaction.privacyProcessorOutcome.count({
      where: {
        privacyExecutionId: setup.executionId,
        status: { in: ["SUCCEEDED", "RETAINED"] },
      },
    });
    await transaction.privacyExecution.update({
      where: { id: setup.executionId },
      data: { checkpoint: terminal, updatedAt: now },
    });
    await transaction.privacyRequestEvent.create({
      data: {
        privacyRequestId: setup.requestId,
        kind: "PROCESSOR_UPDATED",
        fromStatus: "IN_PROGRESS",
        toStatus: "IN_PROGRESS",
        actorUserId: setup.actorUserId,
        reasonCode: result.outcomeCode.slice(0, 64),
        idempotencyKey: `PRIVACY_PROCESSOR:${setup.executionId}:${processorKey}:TERMINAL`,
        correlationId: randomUUID(),
        createdAt: now,
      },
    });
    await writeRequiredAudit(prismaAuditPort(transaction), {
      action: "PRIVACY_PROCESSOR_OUTCOME_CHANGED",
      actorKind: "SYSTEM",
      capability: "PRIVACY_PROCESSOR_EXECUTE",
      correlationId: randomUUID(),
      metadata: {},
      reasonCode: result.outcomeCode.slice(0, 64),
      result: "SUCCEEDED",
      retainUntil: auditRetainUntil(now),
      targetId: setup.executionId,
      targetType: "PRIVACY_EXECUTION",
    });
  }, transactionOptions());
}

async function storeProcessorFailure(
  setup: Setup,
  processorKey: string,
  terminal: boolean,
  database: DatabaseClient,
  notificationDeliveryKeyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  now: Date,
) {
  await database.$transaction(async (transaction) => {
    await transaction.privacyProcessorOutcome.update({
      where: {
        privacyExecutionId_processorKey: {
          privacyExecutionId: setup.executionId,
          processorKey,
        },
      },
      data: {
        status: terminal ? "FAILED_TERMINAL" : "RETRY_REQUIRED",
        outcomeCode: terminal ? "POLICY_OR_DATA_FAILURE" : null,
        lastErrorClass: terminal ? "TERMINAL" : "RETRYABLE_PROVIDER",
        nextRetryAt: terminal ? null : new Date(now.getTime() + 60_000),
        completedAt: terminal ? now : null,
        updatedAt: now,
      },
    });
    await transaction.privacyExecution.update({
      where: { id: setup.executionId },
      data: {
        status: terminal ? "PARTIAL" : "RETRY_REQUIRED",
        lastErrorClass: terminal ? "TERMINAL" : "RETRYABLE_PROVIDER",
        nextRetryAt: terminal ? null : new Date(now.getTime() + 60_000),
        updatedAt: now,
      },
    });
    await transaction.privacyRequestEvent.create({
      data: {
        privacyRequestId: setup.requestId,
        kind: "PARTIAL",
        fromStatus: "IN_PROGRESS",
        toStatus: "IN_PROGRESS",
        actorUserId: setup.actorUserId,
        reasonCode: terminal ? "TERMINAL_FAILURE" : "RETRY_REQUIRED",
        idempotencyKey: `PRIVACY_PROCESSOR:${setup.executionId}:${processorKey}:${terminal ? "TERMINAL" : "RETRY"}`,
        correlationId: randomUUID(),
        createdAt: now,
      },
    });
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      {
        recipientUserId: setup.requesterUserId,
        kind: "PRIVACY_REQUEST_CHANGED",
        dedupeKey: `privacy-execution:${setup.executionId}:${processorKey}:${terminal ? "terminal" : "retry"}`,
        payload: {
          requestId: setup.requestId,
          type: setup.kind === "CORRECTION" ? "CORRECT" : "DELETE",
          status: "IN_PROGRESS",
          reasonCode: terminal ? "PARTIAL" : "RETRY_REQUIRED",
        },
      },
    );
    const requester = await transaction.user.findUnique({
      where: { id: setup.requesterUserId },
      select: { status: true },
    });
    if (
      setup.kind === "ERASURE" &&
      requester?.status !== "ACTIVE" &&
      notificationDeliveryKeyring.length > 0
    ) {
      const omitted = await activateStagedErasureEmail(
        transaction,
        setup,
        "FAILURE",
        now,
      );
      if (omitted) {
        await recordErasureDeliveryOmitted(
          transaction,
          setup,
          "IN_PROGRESS",
          now,
        );
      }
      if (terminal) {
        await transaction.notificationOutbox.updateMany({
          where: {
            dedupeKey: erasureSuccessEmailDedupeKey(setup.executionId),
            status: "PENDING",
            recipientAddressCiphertext: { not: null },
            recipientAddressDestroyedAt: null,
          },
          data: {
            status: "SUPPRESSED",
            suppressedAt: now,
            ...destroyedNotificationRecipientMaterial(now),
          },
        });
      }
    } else {
      await enqueueNotification(transaction, {
        recipient: { userId: setup.requesterUserId },
        templateKey: "privacy_request_changed",
        payloadSchemaVersion: "privacy-request-v1",
        payload: {
          requestId: setup.requestId,
          statusLabel: terminal
            ? "Bearbeitung dauerhaft blockiert"
            : "Weitere Bearbeitung erforderlich",
        },
        dedupeKey: `privacy-execution:${setup.executionId}:${processorKey}:${terminal ? "terminal" : "retry"}:email`,
        createdAt: now,
        availableAt: now,
      });
    }
  }, transactionOptions());
}

async function completeExecution(
  setup: Setup,
  domainEventRefs: readonly string[],
  database: DatabaseClient,
  notificationDeliveryKeyring: readonly KeyringEntry<"NOTIFICATION_DELIVERY_KEYS">[],
  now: Date,
) {
  await database.$transaction(async (transaction) => {
    const outcomes = await transaction.privacyProcessorOutcome.findMany({
      where: { privacyExecutionId: setup.executionId },
      select: { status: true, retainedBasisRef: true },
    });
    if (
      outcomes.length !== setup.requiredProcessors.length ||
      outcomes.some(({ status }) => !["SUCCEEDED", "RETAINED"].includes(status))
    ) {
      throw new Error(EXECUTION_ERROR);
    }
    const anyRetained = outcomes.some(({ status }) => status === "RETAINED");
    const retainedProofs = anyRetained
      ? await transaction.erasureProof.findMany({
          where: {
            privacyExecutionId: setup.executionId,
            action: "RETAINED",
          },
          select: { retainedBasisRef: true },
        })
      : [];
    const deletionDependencies = [
      ...new Set(
        retainedProofs.map(({ retainedBasisRef }) =>
          retainedBasisRef === "ACCOUNTING_RETENTION"
            ? ("ACCOUNTING_RETENTION" as const)
            : retainedBasisRef === "APPLICATION_EVIDENCE_RETENTION"
              ? ("ACTIVE_APPLICATIONS" as const)
              : ("LEGAL_HOLD" as const),
        ),
      ),
    ];
    await transaction.privacyExecution.update({
      where: { id: setup.executionId },
      data: {
        status: "COMPLETED",
        checkpoint: setup.requiredProcessors.length,
        completedAt: now,
        nextRetryAt: null,
        lastErrorClass: null,
        updatedAt: now,
      },
    });
    await transaction.privacyRequest.update({
      where: { id: setup.requestId },
      data: {
        status: "COMPLETED",
        version: { increment: 1 },
        completedAt: now,
        ...(setup.kind === "CORRECTION"
          ? {
              correctionOutcome: anyRetained
                ? "REFERRED_FOR_POLICY"
                : "CORRECTED_VIA_CANONICAL_COMMAND",
              domainEventRefs: [...new Set(domainEventRefs)],
              safeOutcomeNote: anyRetained
                ? "Kanonisch korrigierbare Felder wurden aktualisiert; weitere Felder bleiben zur fachlichen Bearbeitung referenziert."
                : "Korrigierbare Daten wurden über kanonische Domainbefehle aktualisiert.",
            }
          : {
              deletionDependencies: anyRetained
                ? deletionDependencies.length > 0
                  ? deletionDependencies
                  : (["LEGAL_HOLD"] as const)
                : (["NONE"] as const),
              deletionOutcome: anyRetained
                ? "PARTIALLY_RETAINED_WITH_BASIS"
                : "ERASURE_OR_ANONYMIZATION_COMPLETED",
              safeOutcomeNote: anyRetained
                ? "Freigegebene Daten wurden gelöscht oder anonymisiert; eng begrenzte Evidence bleibt mit dokumentierter Basis erhalten."
                : "Freigegebene Daten wurden gelöscht oder irreversibel anonymisiert.",
            }),
      },
    });
    await transaction.privacyRequestEvent.create({
      data: {
        privacyRequestId: setup.requestId,
        kind: "COMPLETED",
        fromStatus: "IN_PROGRESS",
        toStatus: "COMPLETED",
        actorUserId: setup.actorUserId,
        reasonCode: anyRetained ? "COMPLETED_WITH_RETENTION" : "COMPLETED",
        idempotencyKey: `PRIVACY_EXECUTION:COMPLETED:${setup.executionId}`,
        correlationId: randomUUID(),
        createdAt: now,
      },
    });
    await writeNotificationExactlyOnce(
      createPrismaNotificationPort(transaction),
      {
        recipientUserId: setup.requesterUserId,
        kind: "PRIVACY_REQUEST_CHANGED",
        dedupeKey: `privacy-execution:${setup.executionId}:completed`,
        payload: {
          requestId: setup.requestId,
          type: setup.kind === "CORRECTION" ? "CORRECT" : "DELETE",
          status: "COMPLETED",
          reasonCode: anyRetained ? "COMPLETED_WITH_RETENTION" : "COMPLETED",
        },
      },
    );
    await transaction.notificationOutbox.updateMany({
      where: {
        dedupeKey: { startsWith: `privacy-execution:${setup.executionId}:` },
        status: "PENDING",
        OR: [
          { dedupeKey: { endsWith: ":retry:email" } },
          { dedupeKey: { endsWith: ":terminal:email" } },
        ],
      },
      data: { status: "SUPPRESSED", suppressedAt: now },
    });
    const requester = await transaction.user.findUnique({
      where: { id: setup.requesterUserId },
      select: { status: true },
    });
    if (
      setup.kind === "ERASURE" &&
      requester?.status !== "ACTIVE" &&
      notificationDeliveryKeyring.length > 0
    ) {
      const omitted = await activateStagedErasureEmail(
        transaction,
        setup,
        "SUCCESS",
        now,
      );
      if (omitted) {
        await recordErasureDeliveryOmitted(
          transaction,
          setup,
          "COMPLETED",
          now,
        );
      }
      await transaction.notificationOutbox.updateMany({
        where: {
          dedupeKey: erasureFailureEmailDedupeKey(setup.executionId),
          status: "PENDING",
          availableAt: DEFERRED_ERASURE_NOTIFICATION_AT,
        },
        data: {
          status: "SUPPRESSED",
          suppressedAt: now,
          ...destroyedNotificationRecipientMaterial(now),
        },
      });
    } else {
      await enqueueNotification(transaction, {
        recipient: { userId: setup.requesterUserId },
        templateKey: "privacy_request_changed",
        payloadSchemaVersion: "privacy-request-v1",
        payload: { requestId: setup.requestId, statusLabel: "Abgeschlossen" },
        dedupeKey: `privacy-execution:${setup.executionId}:completed-email`,
        createdAt: now,
        availableAt: now,
      });
    }
    await writeRequiredAudit(prismaAuditPort(transaction), {
      action: "PRIVACY_EXECUTION_COMPLETED",
      actorKind: "SYSTEM",
      capability: "PRIVACY_PROCESSOR_EXECUTE",
      correlationId: randomUUID(),
      metadata: {},
      reasonCode: anyRetained ? "COMPLETED_WITH_RETENTION" : "COMPLETED",
      result: "SUCCEEDED",
      retainUntil: auditRetainUntil(now),
      targetId: setup.executionId,
      targetType: "PRIVACY_EXECUTION",
    });
  }, transactionOptions());
}

async function activeHolds(
  transaction: Prisma.TransactionClient,
  subjectReferenceHash: string,
  now: Date,
) {
  return transaction.legalHold.findMany({
    where: {
      subjectReferenceHash,
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
}

function retainedResult(processorKey: string, basis: string): ProcessorResult {
  return Object.freeze({
    status: "RETAINED",
    outcomeCode: "RETAINED_WITH_BASIS",
    retainedBasisRef: basis,
    receiptHash: sha256(`${processorKey}:${basis}`),
    proofs: Object.freeze([
      proof(processorKey.toUpperCase(), "RETAINED", basis),
    ]),
  });
}

function successProcessorResult(
  setup: Setup,
  processorKey: string,
  outcomeCode: string,
): ProcessorResult {
  return Object.freeze({
    status: "SUCCEEDED",
    outcomeCode,
    receiptHash: sha256(stableReceipt(setup, processorKey, outcomeCode)),
  });
}

function proof(
  entityKey: string,
  action: "ERASED" | "ANONYMIZED" | "RETAINED",
  retainedBasisRef?: string,
) {
  return Object.freeze({
    entityKey: entityKey.slice(0, 96),
    action,
    ...(retainedBasisRef === undefined ? {} : { retainedBasisRef }),
  });
}

function orderProcessors(processors: readonly string[]) {
  const order = [
    "email-provider",
    "document-object-store",
    "analytics-store",
    "notification-outbox",
    "payment-ledger",
    "backup-restore",
    // The account address is anonymized here. Keeping PostgreSQL last lets us
    // stage the encrypted completion/failure recipient only after every
    // external processor has reached a terminal success/retention outcome.
    "postgres-primary",
  ];
  return [...processors].sort(
    (left, right) => order.indexOf(left) - order.indexOf(right),
  );
}

function subjectClassForRole(role: string): Setup["subjectClass"] {
  return role === "CANDIDATE"
    ? "CANDIDATE"
    : role === "EMPLOYER" || role === "RECRUITER"
      ? "EMPLOYER_MEMBER"
      : "USER";
}

async function subjectClassesForIdentity(
  transaction: Prisma.TransactionClient,
  userId: string,
  legacyRole: string,
) {
  const [candidateProfileCount, membershipCount, assignments] =
    await Promise.all([
      transaction.candidateProfile.count({ where: { userId } }),
      transaction.companyMembership.count({ where: { userId } }),
      transaction.personaAssignment.findMany({
        where: { userId },
        select: { kind: true },
      }),
    ]);
  const classes = new Set<string>(["USER", subjectClassForRole(legacyRole)]);
  if (
    candidateProfileCount > 0 ||
    assignments.some(({ kind }) => kind === "CANDIDATE")
  ) {
    classes.add("CANDIDATE");
  }
  if (
    membershipCount > 0 ||
    assignments.some(({ kind }) => kind === "EMPLOYER")
  ) {
    classes.add("EMPLOYER_MEMBER");
  }
  return classes;
}

function stableReceipt(setup: Setup, processorKey: string, value: unknown) {
  return JSON.stringify({
    executionId: setup.executionId,
    processorKey,
    subjectReferenceHash: setup.subjectReferenceHash,
    value,
  });
}

function erasureSuccessEmailDedupeKey(executionId: string) {
  return `privacy-execution:${executionId}:completed-email`;
}

function erasureFailureEmailDedupeKey(executionId: string) {
  return `privacy-execution:${executionId}:erasure-retry-email`;
}

function erasureNotificationRetentionUntil(dueAt: Date, startedAt: Date) {
  return notificationRecipientMaterialExpiresAt(
    new Date(Math.max(dueAt.getTime(), startedAt.getTime())),
  );
}

async function activateStagedErasureEmail(
  transaction: Prisma.TransactionClient,
  setup: Setup,
  kind: "SUCCESS" | "FAILURE",
  now: Date,
) {
  const dedupeKey =
    kind === "SUCCESS"
      ? erasureSuccessEmailDedupeKey(setup.executionId)
      : erasureFailureEmailDedupeKey(setup.executionId);
  const expectedStatusLabel =
    kind === "SUCCESS" ? "Abgeschlossen" : "Weitere Bearbeitung erforderlich";
  const activated = await transaction.notificationOutbox.updateMany({
    where: {
      dedupeKey,
      status: "PENDING",
      availableAt: DEFERRED_ERASURE_NOTIFICATION_AT,
      recipientAddressCiphertext: { not: null },
      recipientAddressDestroyedAt: null,
      recipientAddressExpiresAt: { gt: now },
    },
    data: { availableAt: now },
  });
  if (activated.count === 1) return false;
  const existing = await transaction.notificationOutbox.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      recipientUserId: true,
      recipientAddressCiphertext: true,
      recipientAddressDestroyedAt: true,
      recipientAddressExpiresAt: true,
      status: true,
      lastErrorCode: true,
      purpose: true,
      purposeClass: true,
      templateKey: true,
      payloadSchemaVersion: true,
      payload: true,
    },
  });
  if (
    existing === null ||
    existing.recipientUserId !== null ||
    existing.purpose !== "PRIVACY_REQUEST" ||
    existing.purposeClass !== "MANDATORY" ||
    existing.templateKey !== "privacy_request_changed" ||
    existing.payloadSchemaVersion !== "privacy-request-v1" ||
    !matchesErasureEmailPayload(
      existing.payload,
      setup.requestId,
      expectedStatusLabel,
    )
  ) {
    throw new Error(EXECUTION_ERROR);
  }
  if (
    existing.status === "PENDING" &&
    existing.recipientAddressCiphertext !== null &&
    existing.recipientAddressDestroyedAt === null &&
    existing.recipientAddressExpiresAt !== null &&
    existing.recipientAddressExpiresAt.getTime() <= now.getTime()
  ) {
    const expired = await transaction.notificationOutbox.updateMany({
      where: {
        id: existing.id,
        status: "PENDING",
        recipientAddressCiphertext: { not: null },
        recipientAddressDestroyedAt: null,
        recipientAddressExpiresAt: { lte: now },
      },
      data: {
        status: "SUPPRESSED",
        availableAt: now,
        suppressedAt: now,
        lastErrorCode: "RECIPIENT_MATERIAL_RETENTION_EXPIRED",
        ...destroyedNotificationRecipientMaterial(now),
      },
    });
    if (expired.count !== 1) throw new Error(EXECUTION_ERROR);
    return true;
  }
  if (
    ["PAUSED", "SUPPRESSED"].includes(existing.status) &&
    existing.lastErrorCode === "RECIPIENT_MATERIAL_RETENTION_EXPIRED" &&
    existing.recipientAddressCiphertext === null &&
    existing.recipientAddressDestroyedAt !== null
  ) {
    return true;
  }
  if (
    existing.recipientAddressCiphertext !== null ||
    ["DELIVERED", "SUPPRESSED", "DEAD_LETTER"].includes(existing.status)
  ) {
    return false;
  }
  throw new Error(EXECUTION_ERROR);
}

function matchesErasureEmailPayload(
  payload: unknown,
  requestId: string,
  statusLabel: string,
) {
  return (
    payload !== null &&
    !Array.isArray(payload) &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>).requestId === requestId &&
    (payload as Record<string, unknown>).statusLabel === statusLabel
  );
}

async function recordErasureDeliveryOmitted(
  transaction: Prisma.TransactionClient,
  setup: Setup,
  requestStatus: "IN_PROGRESS" | "COMPLETED",
  now: Date,
) {
  await transaction.privacyRequestEvent.upsert({
    where: {
      idempotencyKey: `PRIVACY_EXECUTION:DELIVERY_OMITTED:${setup.executionId}`,
    },
    create: {
      privacyRequestId: setup.requestId,
      kind: "NOTE_ADDED",
      fromStatus: requestStatus,
      toStatus: requestStatus,
      actorUserId: setup.actorUserId,
      reasonCode: "DELIVERY_OMITTED_RETENTION_EXPIRED",
      safeNote:
        "Die externe Status-E-Mail wurde wegen abgelaufener Empfänger-Retention nicht versandt; die In-App-Mitteilung bleibt bestehen.",
      idempotencyKey: `PRIVACY_EXECUTION:DELIVERY_OMITTED:${setup.executionId}`,
      correlationId: randomUUID(),
      createdAt: now,
    },
    update: {},
  });
}

function parseDomainEventCheckpoint(value: string | null): readonly string[] {
  if (value === null || !value.startsWith("EVENTS:")) return [];
  const parsed = value
    .slice("EVENTS:".length)
    .split(",")
    .filter((candidate) => UUID.safeParse(candidate).success);
  return Object.freeze(parsed);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function acquireExecutionLock(
  transaction: Prisma.TransactionClient,
  requestId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`privacy-execution-v2:${requestId}`}, 0)
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
  return new Date(now.getTime() + 400 * DAY_MILLISECONDS);
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 15_000,
    timeout: 30_000,
  } as const;
}

function setupFailure<
  Code extends Extract<PrivacyExecutionV2Result, { ok: false }>["code"],
>(code: Code) {
  return Object.freeze({ ok: false as const, code });
}

function failure<
  Code extends Extract<PrivacyExecutionV2Result, { ok: false }>["code"],
>(code: Code): Readonly<{ ok: false; code: Code }> {
  return Object.freeze({ ok: false, code });
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function injectPrivacyExecutionCrash(
  dependencies: PrivacyExecutionV2Dependencies,
  stage: PrivacyExecutionCrashStage,
) {
  if (dependencies.injectCrashAfterStage?.(stage) === true) {
    throw new InjectedPrivacyExecutionCrash(stage);
  }
}

class InjectedPrivacyExecutionCrash extends Error {
  constructor(readonly stage: PrivacyExecutionCrashStage) {
    super(`Injected privacy execution crash after ${stage}.`);
    this.name = "InjectedPrivacyExecutionCrash";
  }
}

class RetryableProcessorError extends Error {}
class TerminalProcessorError extends Error {}
