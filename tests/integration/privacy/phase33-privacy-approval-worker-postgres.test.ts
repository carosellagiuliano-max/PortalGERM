import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import { parseEnvironment, type ServerEnvironment } from "@/lib/config/env-schema";
import {
  approveAndEnqueuePrivacyExecution,
  requestPrivacyExecutionApproval,
  type PrivacyApprovalActor,
} from "@/lib/privacy/execution-approval";
import {
  consumePrivacyExportV2,
  derivePrivacyExportDownloadToken,
} from "@/lib/privacy/export-v2";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";
import {
  ensurePhase33LocalHandlerActivations,
  ensurePhase33LocalProviderActivation,
} from "@/lib/ops/phase33-contract-activation";
import { createWorkerRun } from "@/lib/ops/worker-runtime";
import { runWorkerCycle } from "@/lib/ops/worker-service";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";
import { bindObjectStoreToProviderAuthority } from "@/lib/providers/storage/provider-authority-bound-object-store";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";
import {
  seedActiveInventory,
  seedPhase22Actors,
  seedPrivacyRequest,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
} from "@/tests/fixtures/phase22-privacy";
import {
  createPhase25SecurityFixture,
  PHASE25_NOW,
  type Phase25Actor,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

const DEPLOYMENT_DIGEST = "phase33-privacy-worker-test";
const FIRST_WORKER_AT = new Date(PHASE25_NOW.getTime() + 1_000);

let fixture: Phase25SecurityFixture | undefined;
let environment: ServerEnvironment | undefined;
let storageRoot: string | undefined;

beforeAll(async () => {
  fixture = await createPhase25SecurityFixture(
    "phase33_privacy_approval_worker",
  );
  storageRoot = await mkdtemp(
    resolve(tmpdir(), "sth-phase33-privacy-worker-"),
  );
  environment = parseEnvironment(
    createValidEnvironment({
      APP_BUILD_ID: DEPLOYMENT_DIGEST,
      DATABASE_URL: fixture.migrated.connectionString,
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      PRIVACY_EXPORT_KEYS: `privacy-export-v1:${keyMaterial(22)}`,
      PRIVACY_EXPORT_STORAGE_MODE: "filesystem_sandbox",
      PRIVACY_EXPORT_STORAGE_REGION: "ch-sandbox",
      PRIVACY_EXPORT_STORAGE_ROOT: storageRoot,
      PRIVACY_EXPORT_V2: "true",
      PRIVACY_PROCESSING_COHORT: "test",
      PRIVACY_PROCESSING_MODE: "sandbox_command",
      PRIVACY_PROVIDER_ANALYTICS: "true",
      PRIVACY_PROVIDER_BACKUP: "true",
      PRIVACY_PROVIDER_DOCUMENTS: "true",
      PRIVACY_PROVIDER_EMAIL: "true",
      PRIVACY_PROVIDER_PAYMENT: "true",
      PRIVACY_PROVIDER_POSTGRES: "true",
      WORKER_RUNTIME: "sandbox_command",
    }),
  );
  await Promise.all([
    fixture.assignRole(fixture.requester, "PRIVACY_PROCESSOR"),
    fixture.assignRole(fixture.approver, "PRIVACY_PROCESSOR"),
  ]);
  await ensurePhase33LocalHandlerActivations(fixture.database, {
    deploymentDigest: DEPLOYMENT_DIGEST,
    environment,
    now: PHASE25_NOW,
  });
}, 600_000);

afterAll(async () => {
  await fixture?.dispose();
  if (storageRoot !== undefined) {
    await rm(storageRoot, { force: true, recursive: true });
  }
});

describe("Phase-33 privacy approval and worker authority", () => {
  it("leaves request, assignment, version and approval state untouched for invalid, expired and foreign-bound execute grants", async () => {
    const context = requireContext();
    const actors = await seedPhase22Actors(
      context.fixture.database,
      "phase33-execute-step-up-denial",
    );
    const request = await seedPrivacyRequest(
      context.fixture.database,
      actors,
      "EXPORT",
    );
    const baseline = await privacyApprovalMutationSnapshot(
      context.fixture.database,
      request.id,
    );

    const validGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      "PRIVACY_EXPORT_EXECUTE",
      request.id,
    );
    await expect(
      requestPrivacyExecutionApproval(
        {
          idempotencyKey: randomUUID(),
          requestId: request.id,
          requestVersion: request.version,
          stepUpEvidenceId: validGrant.evidenceId,
          stepUpGrantToken: "invalid-grant-token-that-is-still-long-enough-00000000",
        },
        approvalDependencies(
          context.fixture,
          context.environment,
          context.fixture.requester,
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
    await expect(
      privacyApprovalMutationSnapshot(context.fixture.database, request.id),
    ).resolves.toEqual(baseline);

    const expiredAt = new Date(validGrant.expiresAt.getTime() + 1);
    await expect(
      requestPrivacyExecutionApproval(
        {
          idempotencyKey: randomUUID(),
          requestId: request.id,
          requestVersion: request.version,
          stepUpEvidenceId: validGrant.evidenceId,
          stepUpGrantToken: validGrant.grantToken,
        },
        {
          ...approvalDependencies(
            context.fixture,
            context.environment,
            context.fixture.requester,
          ),
          now: expiredAt,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
    await expect(
      privacyApprovalMutationSnapshot(context.fixture.database, request.id),
    ).resolves.toEqual(baseline);

    const foreignGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      "PRIVACY_EXPORT_EXECUTE",
      randomUUID(),
    );
    await expect(
      requestPrivacyExecutionApproval(
        {
          idempotencyKey: randomUUID(),
          requestId: request.id,
          requestVersion: request.version,
          stepUpEvidenceId: foreignGrant.evidenceId,
          stepUpGrantToken: foreignGrant.grantToken,
        },
        approvalDependencies(
          context.fixture,
          context.environment,
          context.fixture.requester,
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
    await expect(
      privacyApprovalMutationSnapshot(context.fixture.database, request.id),
    ).resolves.toEqual(baseline);
  });

  it("hands a verified case to a processor, enforces independent step-ups, retries and replays exactly once", async () => {
    const context = requireContext();
    const actors = await seedPhase22Actors(
      context.fixture.database,
      "phase33-approval-worker",
    );
    const legal = await seedPublishedPrivacyNotice(
      context.fixture.database,
      actors,
      "phase33-approval-worker",
    );
    await seedActiveInventory(
      context.fixture.database,
      "phase33-approval-worker",
      ["postgres-primary"],
    );
    const processingApproval = await seedProcessingApproval(
      context.fixture.database,
      legal.publication.id,
      {
        processorKey: "postgres-primary",
        scope: "PRIVACY_EXPORT",
        suffix: "phase33-approval-worker",
      },
    );
    await context.fixture.database.processingApproval.update({
      where: { id: processingApproval.id },
      data: {
        expiresAt: new Date(PHASE25_NOW.getTime() + 7 * 86_400_000),
        reviewAt: new Date(PHASE25_NOW.getTime() + 86_400_000),
      },
    });
    const request = await seedPrivacyRequest(
      context.fixture.database,
      actors,
      "EXPORT",
    );
    await context.fixture.database.privacyRequest.update({
      where: { id: request.id },
      data: { requesterUserId: context.fixture.candidate.userId },
    });

    const executeGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      "PRIVACY_EXPORT_EXECUTE",
      request.id,
    );
    const requested = await requestPrivacyExecutionApproval(
      {
        idempotencyKey: randomUUID(),
        requestId: request.id,
        requestVersion: request.version,
        stepUpEvidenceId: executeGrant.evidenceId,
        stepUpGrantToken: executeGrant.grantToken,
      },
      approvalDependencies(
        context.fixture,
        context.environment,
        context.fixture.requester,
      ),
    );
    expect(requested).toMatchObject({
      ok: true,
      replay: false,
      status: "PENDING",
    });
    if (!requested.ok) throw new Error(`Approval request failed: ${requested.code}`);

    const handedOff = await context.fixture.database.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { assignedAdminUserId: true, assignmentReasonCode: true, version: true },
    });
    expect(handedOff).toEqual({
      assignedAdminUserId: context.fixture.requester.userId,
      assignmentReasonCode: "PRIVACY_PROCESSOR_ASSIGNED",
      version: request.version + 1,
    });
    await expect(
      context.fixture.database.workItem.count({
        where: { subjectId: requested.approvalId },
      }),
    ).resolves.toBe(0);

    const selfGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      "PRIVACY_EXPORT_RELEASE",
      requested.approvalId,
    );
    await expect(
      approveAndEnqueuePrivacyExecution(
        {
          approvalId: requested.approvalId,
          idempotencyKey: randomUUID(),
          requestId: request.id,
          stepUpEvidenceId: selfGrant.evidenceId,
          stepUpGrantToken: selfGrant.grantToken,
        },
        approvalDependencies(
          context.fixture,
          context.environment,
          context.fixture.requester,
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    const releaseGrant = await issueStepUp(
      context.fixture,
      context.fixture.approver,
      "PRIVACY_EXPORT_RELEASE",
      requested.approvalId,
    );
    const releaseInput = {
      approvalId: requested.approvalId,
      idempotencyKey: randomUUID(),
      requestId: request.id,
      stepUpEvidenceId: releaseGrant.evidenceId,
      stepUpGrantToken: releaseGrant.grantToken,
    } as const;
    await expect(
      approveAndEnqueuePrivacyExecution(
        { ...releaseInput, requestId: randomUUID() },
        approvalDependencies(
          context.fixture,
          context.environment,
          context.fixture.approver,
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    const released = await approveAndEnqueuePrivacyExecution(
      releaseInput,
      approvalDependencies(
        context.fixture,
        context.environment,
        context.fixture.approver,
      ),
    );
    expect(released).toMatchObject({
      approvalId: requested.approvalId,
      ok: true,
      replay: false,
      status: "QUEUED",
    });
    if (!released.ok || released.workItemId === undefined) {
      throw new Error("Privacy release did not enqueue a work item.");
    }
    const queued = await context.fixture.database.workItem.findUniqueOrThrow({
      where: { id: released.workItemId },
    });
    expect(queued).toMatchObject({
      handlerKey: "privacy.export",
      payloadReference: { approvalId: requested.approvalId },
      status: "PENDING",
      subjectId: requested.approvalId,
      subjectType: "PRIVACY_APPROVAL",
    });
    expect(Object.keys(queued.payloadReference as object)).toEqual(["approvalId"]);
    await expect(
      approveAndEnqueuePrivacyExecution(
        releaseInput,
        approvalDependencies(
          context.fixture,
          context.environment,
          context.fixture.approver,
        ),
      ),
    ).resolves.toMatchObject({ ok: true, replay: true, workItemId: queued.id });
    await expect(
      approveAndEnqueuePrivacyExecution(
        { ...releaseInput, idempotencyKey: randomUUID() },
        approvalDependencies(
          context.fixture,
          context.environment,
          context.fixture.approver,
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      context.fixture.database.workItem.count({
        where: { subjectId: requested.approvalId },
      }),
    ).resolves.toBe(1);
    await expect(
      context.fixture.database.privilegedApproval.findUniqueOrThrow({
        where: { id: requested.approvalId },
        select: {
          approvedByUserId: true,
          consumedAt: true,
          duty: true,
          kind: true,
          requestedByUserId: true,
          status: true,
        },
      }),
    ).resolves.toMatchObject({
      approvedByUserId: context.fixture.approver.userId,
      consumedAt: PHASE25_NOW,
      duty: "PRIVACY_PROCESS",
      kind: "PRIVACY",
      requestedByUserId: context.fixture.requester.userId,
      status: "CONSUMED",
    });
    const approvalEvidence =
      await context.fixture.database.authAssuranceEvidence.findMany({
        where: {
          id: {
            in: [
              executeGrant.evidenceId,
              releaseGrant.evidenceId,
              selfGrant.evidenceId,
            ],
          },
        },
        select: { action: true, resourceId: true, usedAt: true, userId: true },
      });
    expect(approvalEvidence).toHaveLength(3);
    expect(approvalEvidence).toEqual(expect.arrayContaining([
      {
        action: "PRIVACY_EXPORT_EXECUTE",
        resourceId: request.id,
        usedAt: PHASE25_NOW,
        userId: context.fixture.requester.userId,
      },
      {
        action: "PRIVACY_EXPORT_RELEASE",
        resourceId: requested.approvalId,
        usedAt: PHASE25_NOW,
        userId: context.fixture.approver.userId,
      },
      {
        action: "PRIVACY_EXPORT_RELEASE",
        resourceId: requested.approvalId,
        usedAt: null,
        userId: context.fixture.requester.userId,
      },
    ]));

    const workerRun = await createWorkerRun(context.fixture.database, {
      deploymentDigest: DEPLOYMENT_DIGEST,
      environment: "local",
      now: FIRST_WORKER_AT,
      runtimeVersion: "v1",
      workerId: "phase33-privacy-worker",
    });
    await runWorkerCycle({
      database: context.fixture.database,
      deploymentDigest: DEPLOYMENT_DIGEST,
      environment: context.environment,
      now: () => FIRST_WORKER_AT,
      workerId: "phase33-privacy-worker",
      workerRunId: workerRun.id,
    });
    const retry = await context.fixture.database.workItem.findUniqueOrThrow({
      where: { id: queued.id },
      select: {
        availableAt: true,
        lastErrorCode: true,
        lastFailureClass: true,
        status: true,
      },
    });
    expect(retry).toMatchObject({
      lastErrorCode: "PRIVACY_EXPORT_STORAGE_FAILED",
      lastFailureClass: "TRANSIENT",
      status: "RETRY",
    });

    const exportBinding = privacyExportStoreActivationBinding(
      context.environment,
    );
    if (
      exportBinding === null ||
      exportBinding.expectedMode !== "SANDBOX"
    ) {
      throw new Error("Privacy export sandbox binding unavailable.");
    }
    await ensurePhase33LocalProviderActivation(context.fixture.database, {
      binding: {
        ...exportBinding,
        expectedMode: "SANDBOX",
        region: context.environment.PRIVACY_EXPORT_STORAGE_REGION,
      },
      deploymentDigest: DEPLOYMENT_DIGEST,
      environment: context.environment,
      now: retry.availableAt,
    });
    const retryAt = new Date(retry.availableAt.getTime() + 1);
    await runWorkerCycle({
      database: context.fixture.database,
      deploymentDigest: DEPLOYMENT_DIGEST,
      environment: context.environment,
      now: () => retryAt,
      workerId: "phase33-privacy-worker",
      workerRunId: workerRun.id,
    });
    const completed = await context.fixture.database.workItem.findUniqueOrThrow({
      where: { id: queued.id },
      select: {
        attemptCount: true,
        lastErrorCode: true,
        lastFailureClass: true,
        status: true,
      },
    });
    expect(completed.status).toBe("SUCCEEDED");
    await expect(
      context.fixture.database.privacyExportArtifact.count({
        where: { privacyRequestId: request.id },
      }),
    ).resolves.toBe(1);
    await expect(
      context.fixture.database.workEffectReceipt.count({
        where: { workItemId: queued.id },
      }),
    ).resolves.toBe(1);
    await expect(
      context.fixture.database.notificationOutbox.findUniqueOrThrow({
        where: {
          dedupeKey: `privacy-export-v2:${request.id}:retry-required-email`,
        },
        select: { status: true, suppressedAt: true },
      }),
    ).resolves.toEqual({ status: "SUPPRESSED", suppressedAt: retryAt });

    const artifact = await context.fixture.database.privacyExportArtifact.findFirstOrThrow({
      where: { privacyRequestId: request.id },
    });
    const downloadAt = new Date(retryAt.getTime() + 100);
    const downloadGrant = await issueStepUp(
      context.fixture,
      context.fixture.candidate,
      "PRIVACY_EXPORT_DOWNLOAD",
      artifact.id,
      "CANDIDATE_PRIVACY",
      downloadAt,
    );
    const downloadToken = derivePrivacyExportDownloadToken(
      context.environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
      artifact.encryptionKeyVersion,
      artifact.id,
      artifact.ownerUserId,
      artifact.expiresAt,
    );
    if (downloadToken === null) throw new Error("Privacy download token unavailable.");
    const boundExportStore = bindObjectStoreToProviderAuthority({
      binding: privacyExportStoreActivationBinding(context.environment),
      database: context.fixture.database,
      delegate: createPrivacyExportObjectStore(context.environment),
      environment: context.environment,
      now: () => downloadAt,
    });
    let failVerifiedBodyOnce = true;
    const exportStore = {
      ...boundExportStore,
      async openVerifiedRead(objectKey: string) {
        const opened = await boundExportStore.openVerifiedRead(objectKey);
        if (opened === null || !failVerifiedBodyOnce) return opened;
        failVerifiedBodyOnce = false;
        return Object.freeze({
          receipt: opened.receipt,
          body: failAfterFirstVerifiedChunk(opened.body),
        });
      },
    };
    const downloadDependencies = {
      correlationId: randomUUID(),
      database: context.fixture.database,
      exportKeyring: context.environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
      exportStore,
      now: downloadAt,
      processingMode: context.environment.PRIVACY_PROCESSING_MODE,
      stepUpActor: {
        role: context.fixture.candidate.role,
        sessionId: context.fixture.candidate.sessionId,
        status: "ACTIVE",
        userId: context.fixture.candidate.userId,
      },
    } as const;
    const downloadInput = {
      artifactId: artifact.id,
      ownerUserId: context.fixture.candidate.userId,
      stepUpEvidenceId: downloadGrant.evidenceId,
      stepUpGrantToken: downloadGrant.grantToken,
      token: downloadToken,
    } as const;
    await expect(
      consumePrivacyExportV2(
        { ...downloadInput, ownerUserId: randomUUID() },
        downloadDependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      consumePrivacyExportV2(downloadInput, downloadDependencies),
    ).resolves.toEqual({ ok: false, code: "STORAGE_FAILED" });
    await expect(
      context.fixture.database.privacyExportArtifact.findUniqueOrThrow({
        where: { id: artifact.id },
        select: {
          consumedAt: true,
          downloadClaimExpiresAt: true,
          downloadClaimId: true,
          downloadClaimedAt: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      consumedAt: null,
      downloadClaimExpiresAt: null,
      downloadClaimId: null,
      downloadClaimedAt: null,
      status: "READY",
    });
    await expect(
      context.fixture.database.authAssuranceEvidence.findUniqueOrThrow({
        where: { id: downloadGrant.evidenceId },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: null });
    const downloaded = await consumePrivacyExportV2(
      downloadInput,
      downloadDependencies,
    );
    expect(downloaded).toMatchObject({
      contentType: "application/vnd.swisstalenthub.privacy-export-v2",
      ok: true,
    });
    if (!downloaded.ok) throw new Error("Privacy export download failed.");
    const downloadedChunks: Uint8Array[] = [];
    for await (const chunk of downloaded.body) downloadedChunks.push(chunk);
    expect(Buffer.concat(downloadedChunks).toString("utf8")).toContain(
      context.fixture.candidate.email,
    );
    await expect(
      consumePrivacyExportV2(downloadInput, downloadDependencies),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      context.fixture.database.authAssuranceEvidence.findUniqueOrThrow({
        where: { id: downloadGrant.evidenceId },
        select: { action: true, resourceId: true, usedAt: true },
      }),
    ).resolves.toMatchObject({
      action: "PRIVACY_EXPORT_DOWNLOAD",
      resourceId: artifact.id,
      usedAt: downloadAt,
    });

    const originalReceipt =
      await context.fixture.database.workEffectReceipt.findUniqueOrThrow({
        where: { effectKey: queued.effectKey },
        select: { effectDigest: true },
      });
    await removeEffectReceiptForCrashSimulation(
      context.fixture.database,
      queued.effectKey,
    );
    await context.fixture.database.user.updateMany({
      where: {
        id: {
          in: [
            context.fixture.requester.userId,
            context.fixture.approver.userId,
          ],
        },
      },
      data: { status: "SUSPENDED" },
    });
    const replayAt = new Date(retryAt.getTime() + 1_000);
    await context.fixture.database.workItem.update({
      where: { id: queued.id },
      data: {
        availableAt: replayAt,
        completedAt: null,
        status: "RETRY",
      },
    });
    await runWorkerCycle({
      database: context.fixture.database,
      deploymentDigest: DEPLOYMENT_DIGEST,
      environment: context.environment,
      now: () => replayAt,
      workerId: "phase33-privacy-worker",
      workerRunId: workerRun.id,
    });
    await expect(
      context.fixture.database.workAttempt.findMany({
        where: { workItemId: queued.id },
        orderBy: { attemptNumber: "asc" },
        select: { outcome: true },
      }),
    ).resolves.toEqual([
      { outcome: "RETRY_SCHEDULED" },
      { outcome: "SUCCEEDED" },
      { outcome: "SUCCEEDED" },
    ]);
    await expect(
      context.fixture.database.workEffectReceipt.findUniqueOrThrow({
        where: { effectKey: queued.effectKey },
        select: { effectDigest: true },
      }),
    ).resolves.toEqual(originalReceipt);
    const immutableExecution =
      await context.fixture.database.privacyExecution.findFirstOrThrow({
        where: { privacyRequestId: request.id, kind: "EXPORT" },
        select: { id: true },
      });
    await expect(
      context.fixture.database.privacyExecution.update({
        where: { id: immutableExecution.id },
        data: { approvalEvidenceRef: `phase25:tampered:${randomUUID()}` },
      }),
    ).rejects.toThrow();
    await expect(
      context.fixture.database.privilegedApproval.update({
        where: { id: requested.approvalId },
        data: { reasonCode: "TAMPERED_AFTER_CONSUMPTION" },
      }),
    ).rejects.toThrow();
    await expect(
      context.fixture.database.privacyExportArtifact.count({
        where: { privacyRequestId: request.id },
      }),
    ).resolves.toBe(1);
  }, 180_000);
});

async function privacyApprovalMutationSnapshot(
  database: Phase25SecurityFixture["database"],
  requestId: string,
) {
  const [request, approvalCount, eventCount] = await Promise.all([
    database.privacyRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        assignedAdminUserId: true,
        assignmentReasonCode: true,
        status: true,
        version: true,
      },
    }),
    database.privilegedApproval.count({
      where: {
        kind: "PRIVACY",
        targetType: "PRIVACY_REQUEST",
        targetId: requestId,
      },
    }),
    database.privacyRequestEvent.count({
      where: { privacyRequestId: requestId },
    }),
  ]);
  return Object.freeze({ approvalCount, eventCount, request });
}

async function removeEffectReceiptForCrashSimulation(
  database: Phase25SecurityFixture["database"],
  effectKey: string,
) {
  // Production receipts are append-only. The isolated PostgreSQL test removes
  // exactly one row with the guard disabled only long enough to recreate the
  // otherwise unobservable crash boundary: domain commit succeeded, generic
  // receipt insert never happened.
  await database.$executeRawUnsafe(
    'ALTER TABLE "WorkEffectReceipt" DISABLE TRIGGER phase23_effect_receipt_append_only',
  );
  try {
    await database.workEffectReceipt.delete({ where: { effectKey } });
  } finally {
    await database.$executeRawUnsafe(
      'ALTER TABLE "WorkEffectReceipt" ENABLE TRIGGER phase23_effect_receipt_append_only',
    );
  }
}

async function* failAfterFirstVerifiedChunk(
  body: AsyncIterable<Uint8Array>,
) {
  for await (const chunk of body) {
    yield chunk;
    throw new Error("injected verified export stream interruption");
  }
  throw new Error("injected empty verified export stream interruption");
}

async function issueStepUp(
  context: Phase25SecurityFixture,
  actor: Phase25Actor,
  action: string,
  resourceId: string,
  purpose = "ADMIN_PRIVACY",
  now = PHASE25_NOW,
) {
  const dependencies = context.stepUpDependencies(actor, now);
  const begun = await beginStepUpChallenge(
    { action, purpose, resourceId },
    dependencies,
  );
  if (!begun.ok) throw new Error(`Step-up challenge failed: ${begun.code}`);
  const completed = await completeStepUpChallenge(
    {
      challengeId: begun.value.challengeId,
      challengeToken: begun.value.challengeToken,
    },
    dependencies,
  );
  if (!completed.ok) throw new Error(`Step-up completion failed: ${completed.code}`);
  return completed.value;
}

function approvalDependencies(
  context: Phase25SecurityFixture,
  serverEnvironment: ServerEnvironment,
  actor: Phase25Actor,
) {
  return Object.freeze({
    actor: approvalActor(actor),
    correlationId: randomUUID(),
    database: context.database,
    environment: serverEnvironment,
    now: PHASE25_NOW,
  });
}

function approvalActor(actor: Phase25Actor): PrivacyApprovalActor {
  return Object.freeze({
    capabilities: Object.freeze([]),
    role: actor.role,
    sessionId: actor.sessionId,
    status: "ACTIVE",
    userId: actor.userId,
  });
}

function requireContext() {
  if (fixture === undefined || environment === undefined) {
    throw new Error("Phase-33 privacy worker fixture unavailable.");
  }
  return Object.freeze({ fixture, environment });
}
