import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { hasAdminCapability } from "@/lib/admin/capabilities";
import { resolveAdminActor } from "@/lib/admin/role-policy";
import {
  consumeStepUpGrant,
  type StepUpActor,
} from "@/lib/auth/assurance/step-up-service";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PrivacyRequestType } from "@/lib/generated/prisma/enums";
import { createDocumentObjectStore } from "@/lib/providers/storage/document-storage-composition";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";
import { bindObjectStoreToProviderAuthority } from "@/lib/providers/storage/provider-authority-bound-object-store";
import { documentObjectStoreActivationBinding } from "@/lib/documents/provider-activation-binding";
import { createPrivacyExportV2 } from "@/lib/privacy/export-v2";
import { runPrivacyExecutionV2 } from "@/lib/privacy/execution-v2";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";

const UUID = z.uuid();
const APPROVAL_TTL_MILLISECONDS = 15 * 60_000;
const PRIVACY_APPROVAL_SCHEMA_VERSION = "privacy-execution-approval-v1";

const requestApprovalSchema = z.strictObject({
  requestId: UUID,
  requestVersion: z.number().int().nonnegative(),
  idempotencyKey: UUID,
  stepUpEvidenceId: UUID,
  stepUpGrantToken: z.string().min(32).max(128),
});

const releaseApprovalSchema = z.strictObject({
  approvalId: UUID,
  requestId: UUID,
  idempotencyKey: UUID,
  stepUpEvidenceId: UUID,
  stepUpGrantToken: z.string().min(32).max(128),
});

const approvalPayloadSchema = z.strictObject({
  schemaVersion: z.literal(PRIVACY_APPROVAL_SCHEMA_VERSION),
  requestId: UUID,
  requestVersion: z.number().int().nonnegative(),
  requestType: z.enum(["EXPORT", "CORRECT", "DELETE"]),
  requestedByUserId: UUID,
  executeStepUpEvidenceId: UUID,
  releaseStepUpEvidenceId: UUID.nullable(),
  releaseIdempotencyKey: UUID.nullable(),
  handlerKey: z.enum([
    "privacy.export",
    "privacy.correction",
    "privacy.erasure",
  ]),
  handlerVersion: z.literal("v1"),
  payloadVersion: z.literal("v1"),
  runtimeConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  requestIdempotencyKey: UUID,
});

export type PrivacyApprovalActor = StepUpActor &
  Readonly<{ capabilities: readonly string[] }>;

export type PrivacyApprovalResult =
  | Readonly<{
      ok: true;
      approvalId: string;
      replay: boolean;
      status: "PENDING" | "QUEUED";
      workItemId?: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "CONFIGURATION_CHANGED"
        | "CONFLICT"
        | "DISABLED"
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "STALE_VERSION"
        | "STEP_UP_REQUIRED"
        | "WRITE_FAILED";
    }>;

export type PrivacyWorkerExecutionResult =
  | Readonly<{
      ok: true;
      effectDigest: string;
      replay: boolean;
    }>
  | Readonly<{
      ok: false;
      code: string;
      failureClass:
        | "CONFIGURATION"
        | "PERMANENT_CLIENT"
        | "PERMANENT_VALIDATION"
        | "TRANSIENT";
    }>;

export async function requestPrivacyExecutionApproval(
  raw: unknown,
  dependencies: Readonly<{
    actor: PrivacyApprovalActor;
    correlationId: string;
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
  }>,
): Promise<PrivacyApprovalResult> {
  const parsed = requestApprovalSchema.safeParse(raw);
  if (
    !parsed.success ||
    !UUID.safeParse(dependencies.correlationId).success ||
    !Number.isFinite(dependencies.now.getTime())
  ) {
    return approvalFailure("INVALID_INPUT");
  }
  const input = parsed.data;
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await lockPrivacyRequest(transaction, input.requestId);
        const request = await transaction.privacyRequest.findUnique({
          where: { id: input.requestId },
          select: {
            id: true,
            type: true,
            status: true,
            version: true,
            verifiedAt: true,
            requesterUserId: true,
            assignedAdminUserId: true,
          },
        });
        if (request === null) return approvalFailure("NOT_FOUND");
        if (
          request.status !== "IN_PROGRESS" ||
          request.verifiedAt === null ||
          !isExecutableRequestType(request.type)
        ) {
          return approvalFailure("CONFLICT");
        }
        const runtime = resolvePrivacyExecutionRuntime(
          dependencies.environment,
          request.type,
        );
        if (!runtime.allowed) return approvalFailure("DISABLED");

        const actor = await resolveAdminActor(
          transaction,
          {
            userId: dependencies.actor.userId,
            role: dependencies.actor.role,
            status: dependencies.actor.status,
          },
          dependencies.now,
        );
        if (!hasAdminCapability(actor, "PRIVACY_CASE_PROCESS")) {
          return approvalFailure("FORBIDDEN");
        }
        if (request.requesterUserId === actor.userId) {
          return approvalFailure("FORBIDDEN");
        }

        const existing = await transaction.privilegedApproval.findFirst({
          where: {
            kind: "PRIVACY",
            targetType: "PRIVACY_REQUEST",
            targetId: request.id,
            status: { in: ["PENDING", "APPROVED", "CONSUMED"] },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (existing !== null) {
          const payload = approvalPayloadSchema.safeParse(existing.requestPayload);
          if (
            payload.success &&
            existing.requestedByUserId === actor.userId &&
            payload.data.executeStepUpEvidenceId === input.stepUpEvidenceId &&
            payload.data.requestIdempotencyKey === input.idempotencyKey &&
            payload.data.requestId === request.id
          ) {
            const workItem =
              existing.status === "CONSUMED"
                ? await transaction.workItem.findUnique({
                    where: { dedupeKey: privacyWorkDedupeKey(existing.id) },
                    select: { id: true },
                  })
                : null;
            return Object.freeze({
              ok: true as const,
              approvalId: existing.id,
              replay: true,
              status: existing.status === "CONSUMED" ? ("QUEUED" as const) : ("PENDING" as const),
              ...(workItem === null ? {} : { workItemId: workItem.id }),
            });
          }
          return approvalFailure("CONFLICT");
        }

        if (request.version !== input.requestVersion) {
          return approvalFailure("STALE_VERSION");
        }

        let requestVersion = request.version;
        if (
          request.assignedAdminUserId !== null &&
          request.assignedAdminUserId !== actor.userId
        ) {
          const currentAssignee = await transaction.user.findUnique({
            where: { id: request.assignedAdminUserId },
            select: { id: true, role: true, status: true },
          });
          const resolvedAssignee =
            currentAssignee === null
              ? null
              : await resolveAdminActor(
                  transaction,
                  {
                    userId: currentAssignee.id,
                    role: currentAssignee.role,
                    status: currentAssignee.status,
                  },
                  dependencies.now,
                );
          if (
            resolvedAssignee !== null &&
            hasAdminCapability(resolvedAssignee, "PRIVACY_CASE_PROCESS")
          ) {
            return approvalFailure("FORBIDDEN");
          }
        }
        const executeAction = privacyAdminAction(request.type, "EXECUTE");
        const stepUpConsumed = await consumeStepUpGrant(transaction, {
          evidenceId: input.stepUpEvidenceId,
          grantToken: input.stepUpGrantToken,
          actor: dependencies.actor,
          purpose: "ADMIN_PRIVACY",
          action: executeAction,
          resourceId: request.id,
          correlationId: dependencies.correlationId,
          now: dependencies.now,
        });
        if (!stepUpConsumed) return approvalFailure("STEP_UP_REQUIRED");

        if (request.assignedAdminUserId !== actor.userId) {
          const claimed = await transaction.privacyRequest.updateMany({
            where: {
              id: request.id,
              version: request.version,
              status: "IN_PROGRESS",
            },
            data: {
              assignedAdminUserId: actor.userId,
              assignmentReasonCode: "PRIVACY_PROCESSOR_ASSIGNED",
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1) {
            // Rolling back is essential here: the valid single-use grant was
            // consumed earlier in this transaction and must not be lost when
            // the optimistic assignment CAS unexpectedly loses.
            throw new PrivacyApprovalTransactionAbort("STALE_VERSION");
          }
          requestVersion += 1;
        }

        const approvalId = randomUUID();
        const payload = Object.freeze({
          schemaVersion: PRIVACY_APPROVAL_SCHEMA_VERSION,
          requestId: request.id,
          requestVersion,
          requestType: request.type,
          requestedByUserId: actor.userId,
          executeStepUpEvidenceId: input.stepUpEvidenceId,
          releaseStepUpEvidenceId: null,
          releaseIdempotencyKey: null,
          handlerKey: runtime.handlerKey,
          handlerVersion: "v1" as const,
          payloadVersion: "v1" as const,
          runtimeConfigurationDigest: runtime.configurationDigest,
          requestIdempotencyKey: input.idempotencyKey,
        });
        await transaction.privilegedApproval.create({
          data: {
            id: approvalId,
            kind: "PRIVACY",
            status: "PENDING",
            requestedByUserId: actor.userId,
            targetType: "PRIVACY_REQUEST",
            targetId: request.id,
            duty: "PRIVACY_PROCESS",
            reasonCode: "PRIVACY_EXECUTION_REQUESTED",
            evidenceDigest: digestJson(payload),
            requestPayload: payload as Prisma.InputJsonValue,
            expiresAt: new Date(
              dependencies.now.getTime() + APPROVAL_TTL_MILLISECONDS,
            ),
            createdAt: dependencies.now,
          },
        });
        return Object.freeze({
          ok: true as const,
          approvalId,
          replay: false,
          status: "PENDING" as const,
        });
      },
      transactionOptions(),
    );
  } catch (error) {
    if (error instanceof PrivacyApprovalTransactionAbort) {
      return approvalFailure(error.code);
    }
    return approvalFailure("WRITE_FAILED");
  }
}

export async function approveAndEnqueuePrivacyExecution(
  raw: unknown,
  dependencies: Readonly<{
    actor: PrivacyApprovalActor;
    correlationId: string;
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
  }>,
): Promise<PrivacyApprovalResult> {
  const parsed = releaseApprovalSchema.safeParse(raw);
  if (
    !parsed.success ||
    !UUID.safeParse(dependencies.correlationId).success ||
    !Number.isFinite(dependencies.now.getTime())
  ) {
    return approvalFailure("INVALID_INPUT");
  }
  const input = parsed.data;
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "PrivilegedApproval"
          WHERE "id" = ${input.approvalId}::uuid
          FOR UPDATE
        `;
        const approval = await transaction.privilegedApproval.findUnique({
          where: { id: input.approvalId },
        });
        if (
          approval === null ||
          approval.kind !== "PRIVACY" ||
          approval.targetType !== "PRIVACY_REQUEST" ||
          approval.targetId !== input.requestId
        ) {
          return approvalFailure("NOT_FOUND");
        }
        if (approval.status === "CONSUMED") {
          if (approval.approvedByUserId !== dependencies.actor.userId) {
            return approvalFailure("FORBIDDEN");
          }
          const consumedPayload = approvalPayloadSchema.safeParse(
            approval.requestPayload,
          );
          if (
            !consumedPayload.success ||
            consumedPayload.data.requestId !== input.requestId ||
            consumedPayload.data.releaseStepUpEvidenceId !==
              input.stepUpEvidenceId ||
            consumedPayload.data.releaseIdempotencyKey !==
              input.idempotencyKey ||
            digestJson(consumedPayload.data) !== approval.evidenceDigest
          ) {
            return approvalFailure("CONFLICT");
          }
          const workItem = await transaction.workItem.findUnique({
            where: { dedupeKey: privacyWorkDedupeKey(approval.id) },
            select: { id: true },
          });
          if (workItem === null) return approvalFailure("CONFLICT");
          return Object.freeze({
            ok: true as const,
            approvalId: approval.id,
            replay: true,
            status: "QUEUED" as const,
            workItemId: workItem.id,
          });
        }
        if (
          approval.status !== "PENDING" ||
          approval.expiresAt <= dependencies.now
        ) {
          if (approval.status === "PENDING") {
            await transaction.privilegedApproval.update({
              where: { id: approval.id },
              data: { status: "EXPIRED", decidedAt: dependencies.now },
            });
          }
          return approvalFailure("CONFLICT");
        }
        if (
          approval.requestedByUserId === dependencies.actor.userId ||
          approval.requestedByUserId === approval.approvedByUserId
        ) {
          return approvalFailure("FORBIDDEN");
        }
        const payload = approvalPayloadSchema.safeParse(approval.requestPayload);
        if (
          !payload.success ||
          payload.data.releaseStepUpEvidenceId !== null ||
          payload.data.releaseIdempotencyKey !== null ||
          payload.data.requestId !== input.requestId ||
          payload.data.requestedByUserId !== approval.requestedByUserId ||
          digestJson(payload.data) !== approval.evidenceDigest
        ) {
          return approvalFailure("CONFLICT");
        }

        const [approver, requester, request] = await Promise.all([
          resolveAdminActor(
            transaction,
            {
              userId: dependencies.actor.userId,
              role: dependencies.actor.role,
              status: dependencies.actor.status,
            },
            dependencies.now,
          ),
          transaction.user.findUnique({
            where: { id: approval.requestedByUserId },
            select: { id: true, role: true, status: true },
          }),
          transaction.privacyRequest.findUnique({
            where: { id: input.requestId },
            select: {
              id: true,
              type: true,
              status: true,
              version: true,
              verifiedAt: true,
              assignedAdminUserId: true,
              requesterUserId: true,
            },
          }),
        ]);
        const resolvedRequester =
          requester === null
            ? null
            : await resolveAdminActor(
                transaction,
                {
                  userId: requester.id,
                  role: requester.role,
                  status: requester.status,
                },
                dependencies.now,
              );
        if (
          !hasAdminCapability(approver, "PRIVACY_EXECUTION_APPROVE") ||
          resolvedRequester === null ||
          !hasAdminCapability(resolvedRequester, "PRIVACY_CASE_PROCESS")
        ) {
          return approvalFailure("FORBIDDEN");
        }
        if (
          request === null ||
          request.type !== payload.data.requestType ||
          request.status !== "IN_PROGRESS" ||
          request.verifiedAt === null ||
          request.version !== payload.data.requestVersion ||
          request.assignedAdminUserId !== approval.requestedByUserId ||
          request.requesterUserId === approver.userId
        ) {
          return approvalFailure("STALE_VERSION");
        }

        const runtime = resolvePrivacyExecutionRuntime(
          dependencies.environment,
          request.type,
        );
        if (!runtime.allowed) return approvalFailure("DISABLED");
        if (
          runtime.handlerKey !== payload.data.handlerKey ||
          runtime.configurationDigest !==
            payload.data.runtimeConfigurationDigest
        ) {
          return approvalFailure("CONFIGURATION_CHANGED");
        }

        const releaseAction = privacyAdminAction(request.type, "RELEASE");
        const stepUpConsumed = await consumeStepUpGrant(transaction, {
          evidenceId: input.stepUpEvidenceId,
          grantToken: input.stepUpGrantToken,
          actor: dependencies.actor,
          purpose: "ADMIN_PRIVACY",
          action: releaseAction,
          resourceId: approval.id,
          correlationId: dependencies.correlationId,
          now: dependencies.now,
        });
        if (!stepUpConsumed) return approvalFailure("STEP_UP_REQUIRED");

        const finalPayload = Object.freeze({
          ...payload.data,
          releaseStepUpEvidenceId: input.stepUpEvidenceId,
          releaseIdempotencyKey: input.idempotencyKey,
        });
        const consumed = await transaction.privilegedApproval.updateMany({
          where: {
            id: approval.id,
            status: "PENDING",
            approvedByUserId: null,
            expiresAt: { gt: dependencies.now },
          },
          data: {
            status: "CONSUMED",
            approvedByUserId: approver.userId,
            decidedAt: dependencies.now,
            consumedAt: dependencies.now,
            evidenceDigest: digestJson(finalPayload),
            requestPayload: finalPayload as Prisma.InputJsonValue,
          },
        });
        if (consumed.count !== 1) return approvalFailure("CONFLICT");

        const workItem = await enqueuePrivacyWorkItem(
          transaction,
          approval.id,
          finalPayload.handlerKey,
          dependencies.now,
        );
        return Object.freeze({
          ok: true as const,
          approvalId: approval.id,
          replay: !workItem.created,
          status: "QUEUED" as const,
          workItemId: workItem.id,
        });
      },
      transactionOptions(),
    );
  } catch {
    return approvalFailure("WRITE_FAILED");
  }
}

export async function executeApprovedPrivacyWorkItem(
  raw: unknown,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    handlerKey: string;
    now: Date;
  }>,
): Promise<PrivacyWorkerExecutionResult> {
  const input = z.strictObject({ approvalId: UUID }).safeParse(raw);
  if (!input.success || !Number.isFinite(dependencies.now.getTime())) {
    return workerFailure("PRIVACY_APPROVAL_PAYLOAD_INVALID", "PERMANENT_VALIDATION");
  }
  const approval = await dependencies.database.privilegedApproval.findUnique({
    where: { id: input.data.approvalId },
  });
  if (
    approval === null ||
    approval.kind !== "PRIVACY" ||
    approval.status !== "CONSUMED" ||
    approval.approvedByUserId === null ||
    approval.targetType !== "PRIVACY_REQUEST" ||
    approval.targetId.length === 0
  ) {
    return workerFailure("PRIVACY_APPROVAL_UNAVAILABLE", "PERMANENT_CLIENT");
  }
  const payload = approvalPayloadSchema.safeParse(approval.requestPayload);
  if (
    !payload.success ||
    payload.data.releaseStepUpEvidenceId === null ||
    payload.data.requestId !== approval.targetId ||
    payload.data.requestedByUserId !== approval.requestedByUserId ||
    payload.data.handlerKey !== dependencies.handlerKey ||
    digestJson(payload.data) !== approval.evidenceDigest
  ) {
    return workerFailure("PRIVACY_APPROVAL_EVIDENCE_INVALID", "PERMANENT_VALIDATION");
  }
  const approvalEvidenceRef = privacyApprovalEvidenceRef(approval.id);
  const stepUpEvidenceRef = privacyStepUpEvidenceRef(
    payload.data.executeStepUpEvidenceId,
  );
  const request = await dependencies.database.privacyRequest.findUnique({
    where: { id: payload.data.requestId },
    select: {
      id: true,
      type: true,
      status: true,
      version: true,
      verifiedAt: true,
      assignedAdminUserId: true,
      executions: {
        where: { kind: executionKind(payload.data.requestType) },
        select: {
          id: true,
          status: true,
          approvedByUserId: true,
          approvalEvidenceRef: true,
          stepUpEvidenceRef: true,
          exportArtifact: { select: { id: true, status: true } },
        },
        take: 1,
      },
    },
  });
  if (request === null || request.type !== payload.data.requestType) {
    return workerFailure("PRIVACY_EXECUTION_SUBJECT_MISSING", "PERMANENT_CLIENT");
  }

  // Crash recovery is intentionally evaluated before mutable, current actor
  // authority. Once the immutable dual approval and matching completed
  // execution prove that the domain effect committed, no provider or domain
  // action is repeated: the handler only reconstructs the digest needed for
  // the generic WorkEffectReceipt.
  const completedExecution = request.executions.find(
    (execution) =>
      execution.status === "COMPLETED" &&
      execution.approvedByUserId === approval.approvedByUserId &&
      execution.approvalEvidenceRef === approvalEvidenceRef &&
      execution.stepUpEvidenceRef === stepUpEvidenceRef,
  );
  if (completedExecution !== undefined) {
    if (payload.data.requestType === "EXPORT") {
      const artifact = completedExecution.exportArtifact;
      if (
        artifact === null ||
        artifact.status === "BUILDING" ||
        artifact.status === "FAILED"
      ) {
        return workerFailure(
          "PRIVACY_EXECUTION_RECOVERY_EVIDENCE_INVALID",
          "PERMANENT_VALIDATION",
        );
      }
      return Object.freeze({
        ok: true,
        replay: true,
        effectDigest: digestJson({
          approvalId: approval.id,
          artifactId: artifact.id,
          execution: "EXPORT",
        }),
      });
    }
    return Object.freeze({
      ok: true,
      replay: true,
      effectDigest: digestJson({
        approvalId: approval.id,
        executionId: completedExecution.id,
        execution: payload.data.requestType,
      }),
    });
  }

  const runtime = resolvePrivacyExecutionRuntime(
    dependencies.environment,
    payload.data.requestType,
  );
  if (!runtime.allowed) {
    return workerFailure("PRIVACY_RUNTIME_DISABLED", "CONFIGURATION");
  }
  if (
    runtime.handlerKey !== dependencies.handlerKey ||
    runtime.configurationDigest !== payload.data.runtimeConfigurationDigest
  ) {
    return workerFailure("PRIVACY_RUNTIME_CONFIGURATION_CHANGED", "CONFIGURATION");
  }

  const [requester, approver] = await Promise.all([
    dependencies.database.user.findUnique({
      where: { id: approval.requestedByUserId },
      select: { id: true, role: true, status: true },
    }),
    dependencies.database.user.findUnique({
      where: { id: approval.approvedByUserId },
      select: { id: true, role: true, status: true },
    }),
  ]);
  if (requester === null || approver === null) {
    return workerFailure("PRIVACY_EXECUTION_SUBJECT_MISSING", "PERMANENT_CLIENT");
  }
  const [resolvedRequester, resolvedApprover] = await Promise.all([
    resolveAdminActor(
      dependencies.database,
      { userId: requester.id, role: requester.role, status: requester.status },
      dependencies.now,
    ),
    resolveAdminActor(
      dependencies.database,
      { userId: approver.id, role: approver.role, status: approver.status },
      dependencies.now,
    ),
  ]);
  if (
    !hasAdminCapability(resolvedRequester, "PRIVACY_CASE_PROCESS") ||
    !hasAdminCapability(resolvedApprover, "PRIVACY_EXECUTION_APPROVE") ||
    resolvedRequester.userId === resolvedApprover.userId ||
    request.type !== payload.data.requestType ||
    request.verifiedAt === null ||
    !["IN_PROGRESS", "COMPLETED"].includes(request.status) ||
    request.assignedAdminUserId !== approval.requestedByUserId
  ) {
    return workerFailure("PRIVACY_EXECUTION_AUTHORITY_REVOKED", "PERMANENT_CLIENT");
  }
  if (
    request.version !== payload.data.requestVersion &&
    !request.executions.some(
      (execution) =>
        execution.approvalEvidenceRef === approvalEvidenceRef &&
        execution.stepUpEvidenceRef === stepUpEvidenceRef,
    )
  ) {
    return workerFailure("PRIVACY_EXECUTION_VERSION_CHANGED", "PERMANENT_CLIENT");
  }

  const documentStore = bindObjectStoreToProviderAuthority({
    binding: documentObjectStoreActivationBinding(dependencies.environment),
    database: dependencies.database,
    delegate: createDocumentObjectStore(dependencies.environment),
    environment: dependencies.environment,
    now: () => dependencies.now,
  });
  const commonCommand = {
    privacyRequestId: payload.data.requestId,
    actorUserId: approval.requestedByUserId,
    approvalActorUserId: approval.approvedByUserId,
    idempotencyKey: approval.id,
    approvalEvidenceRef,
    stepUpEvidenceRef,
  } as const;

  if (payload.data.requestType === "EXPORT") {
    const exportStore = bindObjectStoreToProviderAuthority({
      binding: privacyExportStoreActivationBinding(dependencies.environment),
      database: dependencies.database,
      delegate: createPrivacyExportObjectStore(dependencies.environment),
      environment: dependencies.environment,
      now: () => dependencies.now,
    });
    const result = await createPrivacyExportV2(commonCommand, {
      database: dependencies.database,
      exportStore,
      documentStore,
      exportKeyring: dependencies.environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
      featureEnabled: dependencies.environment.PRIVACY_EXPORT_V2,
      cohortAllowed: true,
      processingMode: dependencies.environment.PRIVACY_PROCESSING_MODE,
      now: dependencies.now,
    });
    if (!result.ok) return mapExportFailure(result.code);
    return Object.freeze({
      ok: true,
      replay: result.replay,
      effectDigest: digestJson({
        approvalId: approval.id,
        artifactId: result.artifactId,
        execution: "EXPORT",
      }),
    });
  }

  const result = await runPrivacyExecutionV2(commonCommand, {
    database: dependencies.database,
    documentStore,
    notificationDeliveryKeyring:
      dependencies.environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
    notificationRecipientHashKeyring:
      dependencies.environment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    correctionEnabled: dependencies.environment.PRIVACY_CORRECTION_EXECUTION,
    erasureEnabled: dependencies.environment.PRIVACY_ERASURE_EXECUTION,
    cohortAllowed: true,
    processingMode: dependencies.environment.PRIVACY_PROCESSING_MODE,
    now: dependencies.now,
  });
  if (!result.ok) return mapExecutionFailure(result.code);
  return Object.freeze({
    ok: true,
    replay: result.replay,
    effectDigest: digestJson({
      approvalId: approval.id,
      executionId: result.executionId,
      execution: payload.data.requestType,
    }),
  });
}

export function resolvePrivacyExecutionRuntime(
  environment: ServerEnvironment,
  requestType: PrivacyRequestType,
):
  | Readonly<{
      allowed: true;
      configurationDigest: string;
      handlerKey: "privacy.export" | "privacy.correction" | "privacy.erasure";
    }>
  | Readonly<{ allowed: false }> {
  if (!isExecutableRequestType(requestType)) return Object.freeze({ allowed: false });
  const mode = environment.PRIVACY_PROCESSING_MODE;
  const modeAllowed =
    (mode === "sandbox_command" &&
      ["local", "ci"].includes(environment.APP_ENV) &&
      environment.PRIVACY_PROCESSING_COHORT === "test") ||
    (mode === "contract_worker" &&
      environment.APP_ENV === "ci" &&
      environment.NODE_ENV === "production" &&
      environment.PRIVACY_PROCESSING_COHORT === "test") ||
    (mode === "autonomous_worker" &&
      ["staging", "production"].includes(environment.APP_ENV) &&
      environment.NODE_ENV === "production" &&
      environment.PRIVACY_PROCESSING_COHORT === "approved");
  const featureEnabled =
    requestType === "EXPORT"
      ? environment.PRIVACY_EXPORT_V2
      : requestType === "CORRECT"
        ? environment.PRIVACY_CORRECTION_EXECUTION
        : environment.PRIVACY_ERASURE_EXECUTION;
  const providersEnabled =
    environment.PRIVACY_PROVIDER_POSTGRES &&
    environment.PRIVACY_PROVIDER_DOCUMENTS &&
    environment.PRIVACY_PROVIDER_EMAIL &&
    environment.PRIVACY_PROVIDER_PAYMENT &&
    environment.PRIVACY_PROVIDER_ANALYTICS &&
    (requestType === "EXPORT" || environment.PRIVACY_PROVIDER_BACKUP);
  if (
    !modeAllowed ||
    !featureEnabled ||
    !providersEnabled ||
    !environment.NOTIFICATION_OUTBOX_PRODUCERS ||
    environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS.length === 0 ||
    environment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS.length === 0 ||
    (requestType === "EXPORT" &&
      (environment.PRIVACY_EXPORT_STORAGE_MODE === "disabled" ||
        environment.secrets.keyrings.PRIVACY_EXPORT_KEYS.length === 0))
  ) {
    return Object.freeze({ allowed: false });
  }
  const handlerKey =
    requestType === "EXPORT"
      ? ("privacy.export" as const)
      : requestType === "CORRECT"
        ? ("privacy.correction" as const)
        : ("privacy.erasure" as const);
  return Object.freeze({
    allowed: true,
    handlerKey,
    configurationDigest: digestJson({
      appEnvironment: environment.APP_ENV,
      buildId: environment.APP_BUILD_ID ?? null,
      cohort: environment.PRIVACY_PROCESSING_COHORT,
      documentStorageMode: environment.DOCUMENT_STORAGE_MODE,
      exportStorageMode: environment.PRIVACY_EXPORT_STORAGE_MODE,
      featureEnabled,
      handlerKey,
      mode,
      notificationOutbox: environment.NOTIFICATION_OUTBOX_PRODUCERS,
      providerAnalytics: environment.PRIVACY_PROVIDER_ANALYTICS,
      providerBackup: environment.PRIVACY_PROVIDER_BACKUP,
      providerDocuments: environment.PRIVACY_PROVIDER_DOCUMENTS,
      providerEmail: environment.PRIVACY_PROVIDER_EMAIL,
      providerPayment: environment.PRIVACY_PROVIDER_PAYMENT,
      providerPostgres: environment.PRIVACY_PROVIDER_POSTGRES,
      requestType,
    }),
  });
}

export function privacyAdminAction(
  requestType: Extract<PrivacyRequestType, "EXPORT" | "CORRECT" | "DELETE">,
  stage: "EXECUTE" | "RELEASE",
) {
  return `PRIVACY_${requestType}_${stage}`;
}

function isExecutableRequestType(
  value: PrivacyRequestType,
): value is Extract<PrivacyRequestType, "EXPORT" | "CORRECT" | "DELETE"> {
  return value === "EXPORT" || value === "CORRECT" || value === "DELETE";
}

function executionKind(requestType: "EXPORT" | "CORRECT" | "DELETE") {
  return requestType === "EXPORT"
    ? ("EXPORT" as const)
    : requestType === "CORRECT"
      ? ("CORRECTION" as const)
      : ("ERASURE" as const);
}

function privacyApprovalEvidenceRef(approvalId: string) {
  return `phase25:privacy-approval:${approvalId}`;
}

function privacyStepUpEvidenceRef(evidenceId: string) {
  return `phase25:privacy-step-up:${evidenceId}`;
}

async function enqueuePrivacyWorkItem(
  transaction: Prisma.TransactionClient,
  approvalId: string,
  handlerKey: "privacy.export" | "privacy.correction" | "privacy.erasure",
  now: Date,
) {
  const dedupeKey = privacyWorkDedupeKey(approvalId);
  const data = {
    handlerKey,
    handlerVersion: "v1",
    subjectType: "PRIVACY_APPROVAL",
    subjectId: approvalId,
    dedupeKey,
    effectKey: `privacy-execution:${approvalId}`,
    priority: 80,
    availableAt: now,
    maxAttempts: 8,
    payloadVersion: "v1",
    payloadReference: { approvalId },
  } as const;
  const inserted = await transaction.workItem.createMany({
    data: [data],
    skipDuplicates: true,
  });
  const item = await transaction.workItem.findUniqueOrThrow({
    where: { dedupeKey },
    select: {
      id: true,
      handlerKey: true,
      handlerVersion: true,
      subjectType: true,
      subjectId: true,
      effectKey: true,
      payloadVersion: true,
      payloadReference: true,
    },
  });
  if (
    item.handlerKey !== data.handlerKey ||
    item.handlerVersion !== data.handlerVersion ||
    item.subjectType !== data.subjectType ||
    item.subjectId !== data.subjectId ||
    item.effectKey !== data.effectKey ||
    item.payloadVersion !== data.payloadVersion ||
    canonicalJson(item.payloadReference) !== canonicalJson(data.payloadReference)
  ) {
    throw new Error("PRIVACY_WORK_ITEM_DEDUPE_CONFLICT");
  }
  return Object.freeze({ id: item.id, created: inserted.count === 1 });
}

function privacyWorkDedupeKey(approvalId: string) {
  return `privacy-approval:${approvalId}`;
}

async function lockPrivacyRequest(
  transaction: Prisma.TransactionClient,
  requestId: string,
) {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "PrivacyRequest"
    WHERE "id" = ${requestId}::uuid
    FOR UPDATE
  `;
}

function mapExportFailure(code: string): PrivacyWorkerExecutionResult {
  return code === "STORAGE_FAILED"
    ? workerFailure(`PRIVACY_EXPORT_${code}`, "TRANSIENT")
    : code === "FEATURE_DISABLED"
      ? workerFailure(`PRIVACY_EXPORT_${code}`, "CONFIGURATION")
      : workerFailure(`PRIVACY_EXPORT_${code}`, "PERMANENT_CLIENT");
}

function mapExecutionFailure(code: string): PrivacyWorkerExecutionResult {
  return code === "RETRY_REQUIRED"
    ? workerFailure(`PRIVACY_EXECUTION_${code}`, "TRANSIENT")
    : code === "FEATURE_DISABLED"
      ? workerFailure(`PRIVACY_EXECUTION_${code}`, "CONFIGURATION")
      : workerFailure(`PRIVACY_EXECUTION_${code}`, "PERMANENT_CLIENT");
}

function workerFailure(
  code: string,
  failureClass: Extract<
    PrivacyWorkerExecutionResult,
    { ok: false }
  >["failureClass"],
): PrivacyWorkerExecutionResult {
  return Object.freeze({ ok: false, code, failureClass });
}

function approvalFailure(
  code: Extract<PrivacyApprovalResult, { ok: false }>["code"],
): PrivacyApprovalResult {
  return Object.freeze({ ok: false, code });
}

function digestJson(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function transactionOptions() {
  return Object.freeze({
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 30_000,
  });
}

class PrivacyApprovalTransactionAbort extends Error {
  constructor(
    readonly code: Extract<
      PrivacyApprovalResult,
      { ok: false }
    >["code"],
  ) {
    super(`Privacy approval transaction aborted: ${code}`);
    this.name = "PrivacyApprovalTransactionAbort";
  }
}
