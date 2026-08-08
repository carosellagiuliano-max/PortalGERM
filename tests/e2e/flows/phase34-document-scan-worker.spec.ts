import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  APIRequestContext,
  BrowserContext,
  Page,
} from "@playwright/test";

import { SESSION_POLICY_V1 } from "@/lib/auth/session";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const DOCUMENT_SCAN_HANDLER_KEY = "documents.scan";
const DOCUMENT_SCAN_HANDLER_VERSION = "v1";
const JOB_ALERT_HANDLER_KEY = "candidate.job-alert-digest";
const NOTIFICATION_DISPATCH_HANDLER_KEY = "notifications.dispatch";
const MAXIMUM_WORKER_OUTPUT_CHARACTERS = 24_000;
const WORKER_TIMEOUT_MILLISECONDS = 90_000;

type Database = ReturnType<typeof phase17Database>;
type UploadIntent = Readonly<{
  documentVersionId: string;
  intentId: string;
}>;

test.describe.configure({ mode: "serial" });

test("[F34-DOC-001][F34-OPS-012] @phase34 a real local document worker releases one clean CV and permanently isolates deterministic malware", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const database = phase17Database();
  let foreignContext: BrowserContext | undefined;
  let previewContext: BrowserContext | undefined;
  try {
    const candidateDigest = requiredEnvironment("PHASE34_CANDIDATE_DIGEST");
    const handlerActivationId = requiredEnvironment(
      "PHASE34_DOCUMENT_SCAN_HANDLER_ACTIVATION_ID",
    );
    const objectStoreActivationId = requiredEnvironment(
      "PHASE34_DOCUMENT_OBJECT_STORE_PROVIDER_ACTIVATION_ID",
    );
    const scannerActivationId = requiredEnvironment(
      "PHASE34_DOCUMENT_SCANNER_PROVIDER_ACTIVATION_ID",
    );
    const [handlerActivationBefore, objectStoreBefore, scannerBefore] =
      await Promise.all([
        database.workerHandlerActivation.findUniqueOrThrow({
          where: { id: handlerActivationId },
          select: activationSelect,
        }),
        database.providerActivation.findUniqueOrThrow({
          where: { id: objectStoreActivationId },
          select: providerActivationSelect,
        }),
        database.providerActivation.findUniqueOrThrow({
          where: { id: scannerActivationId },
          select: providerActivationSelect,
        }),
      ]);
    expect(handlerActivationBefore).toMatchObject({
      environment: "local",
      handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
      handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
      payloadVersion: "v1",
      mode: "SANDBOX",
      deploymentDigest: candidateDigest,
      providerUseCase: "documents.object-store",
      killSwitchEngaged: false,
      effectiveAt: expect.any(Date),
      expiresAt: null,
      revokedAt: null,
    });
    expect(objectStoreBefore).toMatchObject({
      environment: "local",
      useCase: "documents.object-store",
      adapterKey: "filesystem_sandbox",
      adapterVersion: "v1",
      mode: "SANDBOX",
      secretVersionRef: "builtin:filesystem-sandbox:v1",
      region: "local-test",
      health: "HEALTHY",
      killSwitchEngaged: false,
      effectiveAt: expect.any(Date),
      expiresAt: null,
      revokedAt: null,
    });
    expect(scannerBefore).toMatchObject({
      environment: "local",
      useCase: "documents.malware-scan",
      adapterKey: "deterministic_sandbox",
      adapterVersion: "v1",
      mode: "SANDBOX",
      secretVersionRef: "builtin:deterministic-scanner:v1",
      region: "local-test",
      health: "HEALTHY",
      killSwitchEngaged: false,
      effectiveAt: expect.any(Date),
      expiresAt: null,
      revokedAt: null,
    });
    await assertNoPreviewDocumentAuthority(database);

    const project = projectIdentity(testInfo.project.name);
    const suffix = `${project.slug}-${randomUUID().slice(0, 8)}`;
    const [owner, foreign] = await Promise.all([
      createCandidate(database, `owner-${suffix}`),
      createCandidate(database, `foreign-${suffix}`),
    ]);
    await page.context().setExtraHTTPHeaders({
      "x-forwarded-for": project.ownerSourceIp,
    });
    await login(page, owner.email, DEMO_PASSWORD);
    const localOrigin = new URL(page.url()).origin;
    const safeBytes = Buffer.from(
      `%PDF-1.4\nphase34-document-safe-${suffix}\n%%EOF`,
      "utf8",
    );
    const maliciousBytes = Buffer.from(
      `%PDF-1.4\nphase34-document-malware-${suffix}\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE\n%%EOF`,
      "utf8",
    );
    const safe = await uploadCandidatePdf(
      page.context().request,
      localOrigin,
      project.ownerSourceIp,
      `phase34-safe-${suffix}.pdf`,
      safeBytes,
    );
    const malicious = await uploadCandidatePdf(
      page.context().request,
      localOrigin,
      project.ownerSourceIp,
      `phase34-malware-${suffix}.pdf`,
      maliciousBytes,
    );

    const beforeWorker = await database.document.findUniqueOrThrow({
      where: {
        candidateProfileId_purpose: {
          candidateProfileId: owner.profileId,
          purpose: "CV",
        },
      },
      select: {
        currentVersionId: true,
        versions: {
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
          select: {
            id: true,
            sequence: true,
            status: true,
            detectedMimeType: true,
            scanCompletedAt: true,
          },
        },
      },
    });
    expect(beforeWorker).toEqual({
      currentVersionId: null,
      versions: [
        {
          id: safe.documentVersionId,
          sequence: 1,
          status: "QUARANTINED",
          detectedMimeType: null,
          scanCompletedAt: null,
        },
        {
          id: malicious.documentVersionId,
          sequence: 2,
          status: "QUARANTINED",
          detectedMimeType: null,
          scanCompletedAt: null,
        },
      ],
    });
    await expect(
      database.documentScanAttempt.count({
        where: {
          documentVersionId: {
            in: [safe.documentVersionId, malicious.documentVersionId],
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      database.candidateDocumentMetadata.count({
        where: { candidateProfileId: owner.profileId },
      }),
    ).resolves.toBe(0);
    await expect(
      database.documentReadGrant.count({
        where: {
          documentVersionId: {
            in: [safe.documentVersionId, malicious.documentVersionId],
          },
        },
      }),
    ).resolves.toBe(0);
    const outboxBefore = await database.notificationOutbox.count({
      where: { recipientUserId: owner.userId },
    });
    expect(outboxBefore).toBe(0);

    const statusBefore = await page
      .context()
      .request.get(`${localOrigin}/api/documents/status`, {
        failOnStatusCode: false,
      });
    expect(statusBefore.status()).toBe(200);
    expect(await statusBefore.json()).toMatchObject({
      currentVersionId: null,
      versions: expect.arrayContaining([
        expect.objectContaining({
          id: safe.documentVersionId,
          status: "QUARANTINED",
        }),
        expect.objectContaining({
          id: malicious.documentVersionId,
          status: "QUARANTINED",
        }),
      ]),
    });

    // Both email handlers share minute-wide durable schedule keys. Waiting
    // for one unused bucket keeps this real worker run additive without
    // deleting evidence produced by an earlier Phase-34 browser project.
    await waitForUnusedMinuteScheduleBucket(database);
    const firstWorkerId = `phase34-doc-${suffix}-first`.slice(0, 90);
    const firstWorker = await runWorkerOnce(firstWorkerId);
    expect(firstWorker.output).toContain(`"workerId":"${firstWorkerId}"`);
    expect(firstWorker.output).toContain('"runtime":"sandbox_command"');

    const firstWorkerRun = await database.workerRun.findFirstOrThrow({
      where: { workerId: firstWorkerId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    expect(firstWorkerRun).toMatchObject({
      environment: "local",
      deploymentDigest: candidateDigest,
      runtimeVersion: "v1",
      status: "STOPPED",
      shutdownOutcome: "CLEAN",
      lastErrorDigest: null,
      failedCount: 0,
      drainingAt: expect.any(Date),
      stoppedAt: expect.any(Date),
      heartbeatAt: expect.any(Date),
    });
    expect(firstWorkerRun.claimedCount).toBeGreaterThanOrEqual(2);
    expect(firstWorkerRun.succeededCount).toBe(firstWorkerRun.claimedCount);
    assertWorkerRunTimeline(firstWorkerRun);

    const expectedScans = [
      {
        versionId: safe.documentVersionId,
        status: "CLEAN" as const,
        outcome: "CLEAN" as const,
        outcomeCode: "ALLOWLIST_CLEAN",
        detectedMimeType: "application/pdf",
      },
      {
        versionId: malicious.documentVersionId,
        status: "INFECTED" as const,
        outcome: "INFECTED" as const,
        outcomeCode: "MALWARE_SIGNATURE",
        detectedMimeType: null,
      },
    ] as const;
    for (const expectedScan of expectedScans) {
      const workItem = await database.workItem.findUniqueOrThrow({
        where: {
          dedupeKey: `${DOCUMENT_SCAN_HANDLER_KEY}:${DOCUMENT_SCAN_HANDLER_VERSION}:${expectedScan.versionId}`,
        },
        include: {
          attempts: { orderBy: [{ attemptNumber: "asc" }, { id: "asc" }] },
          effectReceipts: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      });
      expect(workItem).toMatchObject({
        handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
        handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
        payloadVersion: "v1",
        subjectType: "DOCUMENT_VERSION",
        subjectId: expectedScan.versionId,
        payloadReference: { documentVersionId: expectedScan.versionId },
        effectKey: `effect:${DOCUMENT_SCAN_HANDLER_KEY}:${DOCUMENT_SCAN_HANDLER_VERSION}:${expectedScan.versionId}`,
        status: "SUCCEEDED",
        attemptCount: 1,
        completedAt: expect.any(Date),
        leaseWorkerRunId: null,
        leaseHandlerActivationId: null,
        leaseHandlerActivationGeneration: null,
        lastFailureClass: null,
        lastErrorCode: null,
        lastErrorDigest: null,
      });
      expect(workItem.attempts).toHaveLength(1);
      expect(workItem.attempts[0]).toMatchObject({
        workerRunId: firstWorkerRun.id,
        handlerActivationId,
        handlerActivationGeneration: handlerActivationBefore.generation,
        handlerActivationCurrentAtCompletion: true,
        attemptNumber: 1,
        workerId: firstWorkerId,
        deploymentDigest: candidateDigest,
        outcome: "SUCCEEDED",
        failureClass: null,
        errorCode: null,
        errorDigest: null,
      });
      expect(workItem.effectReceipts).toHaveLength(1);
      expect(workItem.effectReceipts[0]).toMatchObject({
        workItemId: workItem.id,
        effectKey: workItem.effectKey,
        handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
        handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
        handlerActivationId,
        handlerActivationGeneration: handlerActivationBefore.generation,
        handlerActivationCurrentAtReceipt: true,
        leaseWorkerRunId: firstWorkerRun.id,
        providerReceiptDigest: null,
        effectDigest: digestSummary({
          ok: true,
          duplicate: false,
          status: expectedScan.status,
          outcomeCode: expectedScan.outcomeCode,
        }),
      });

      const scanAttempt = await database.documentScanAttempt.findFirstOrThrow({
        where: { documentVersionId: expectedScan.versionId },
        select: {
          attemptNumber: true,
          engineVersion: true,
          signatureVersion: true,
          outcome: true,
          outcomeCode: true,
          detectedMimeType: true,
          startedAt: true,
          completedAt: true,
        },
      });
      expect(scanAttempt).toMatchObject({
        attemptNumber: 1,
        engineVersion: "sth-sandbox-policy-v1",
        signatureVersion: "phase21-fixtures-v1",
        outcome: expectedScan.outcome,
        outcomeCode: expectedScan.outcomeCode,
        detectedMimeType: expectedScan.detectedMimeType,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      });
    }

    const afterWorker = await database.document.findUniqueOrThrow({
      where: {
        candidateProfileId_purpose: {
          candidateProfileId: owner.profileId,
          purpose: "CV",
        },
      },
      select: {
        currentVersionId: true,
        versions: {
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
          select: {
            id: true,
            sequence: true,
            status: true,
            detectedMimeType: true,
            scanCompletedAt: true,
            metadataProjection: {
              select: { status: true, storageKind: true },
            },
          },
        },
      },
    });
    expect(afterWorker).toEqual({
      currentVersionId: safe.documentVersionId,
      versions: [
        {
          id: safe.documentVersionId,
          sequence: 1,
          status: "CLEAN",
          detectedMimeType: "application/pdf",
          scanCompletedAt: expect.any(Date),
          metadataProjection: {
            status: "ACTIVE",
            storageKind: "VAULT_ENCRYPTED",
          },
        },
        {
          id: malicious.documentVersionId,
          sequence: 2,
          status: "INFECTED",
          detectedMimeType: null,
          scanCompletedAt: expect.any(Date),
          metadataProjection: null,
        },
      ],
    });
    for (const expectedScan of expectedScans) {
      const accessEvents = await database.documentAccessEvent.findMany({
        where: { documentVersionId: expectedScan.versionId },
        select: {
          actorUserId: true,
          companyId: true,
          kind: true,
          outcomeCode: true,
        },
      });
      expect(accessEvents).toHaveLength(5);
      expect(accessEvents).toEqual(
        expect.arrayContaining([
          {
            actorUserId: owner.userId,
            companyId: null,
            kind: "UPLOAD_INTENT_CREATED",
            outcomeCode: "CREATED",
          },
          {
            actorUserId: owner.userId,
            companyId: null,
            kind: "UPLOAD_STARTED",
            outcomeCode: "STREAMING",
          },
          {
            actorUserId: owner.userId,
            companyId: null,
            kind: "UPLOAD_COMPLETED",
            outcomeCode: "QUARANTINED",
          },
          {
            actorUserId: owner.userId,
            companyId: null,
            kind: "SCAN_REQUESTED",
            outcomeCode: "SCANNING",
          },
          {
            actorUserId: owner.userId,
            companyId: null,
            kind: "SCAN_COMPLETED",
            outcomeCode: expectedScan.outcomeCode,
          },
        ]),
      );
      await expect(
        database.auditLog.findMany({
          where: {
            action: "DOCUMENT_SCAN_COMPLETED",
            actorUserId: owner.userId,
            targetType: "DOCUMENT_VERSION",
            targetId: expectedScan.versionId,
          },
          select: { capability: true, reasonCode: true, result: true },
        }),
      ).resolves.toEqual([
        {
          capability: "CANDIDATE_DOCUMENT_SCAN_SANDBOX",
          reasonCode: expectedScan.outcomeCode,
          result: expectedScan.status === "CLEAN" ? "SUCCEEDED" : "DENIED",
        },
      ]);
    }
    await expect(
      database.notificationOutbox.count({
        where: { recipientUserId: owner.userId },
      }),
    ).resolves.toBe(outboxBefore);

    const statusAfter = await page
      .context()
      .request.get(`${localOrigin}/api/documents/status`, {
        failOnStatusCode: false,
      });
    expect(statusAfter.status()).toBe(200);
    expect(await statusAfter.json()).toMatchObject({
      currentVersionId: safe.documentVersionId,
      versions: expect.arrayContaining([
        expect.objectContaining({
          id: safe.documentVersionId,
          status: "CLEAN",
        }),
        expect.objectContaining({
          id: malicious.documentVersionId,
          status: "INFECTED",
        }),
      ]),
    });

    foreignContext = await browser.newContext({
      baseURL: requiredEnvironment("PHASE34_LOCAL_BASE_URL"),
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": project.foreignSourceIp },
    });
    const foreignPage = await foreignContext.newPage();
    await login(foreignPage, foreign.email, DEMO_PASSWORD);
    const foreignOrigin = new URL(foreignPage.url()).origin;
    for (const versionId of [
      safe.documentVersionId,
      malicious.documentVersionId,
    ]) {
      const denied = await issueReadGrant(
        foreignPage.context().request,
        foreignOrigin,
        project.foreignSourceIp,
        versionId,
      );
      expect(denied.status()).toBe(404);
      expect(await denied.json()).toEqual({ code: "NOT_FOUND" });
    }
    await foreignContext.close();
    foreignContext = undefined;

    const infectedGrant = await issueReadGrant(
      page.context().request,
      localOrigin,
      project.ownerSourceIp,
      malicious.documentVersionId,
    );
    expect(infectedGrant.status()).toBe(404);
    expect(await infectedGrant.json()).toEqual({ code: "NOT_FOUND" });
    const cleanGrantResponse = await issueReadGrant(
      page.context().request,
      localOrigin,
      project.ownerSourceIp,
      safe.documentVersionId,
    );
    expect(cleanGrantResponse.status()).toBe(200);
    const cleanGrant = requireReadGrant(await cleanGrantResponse.json());
    const cleanRead = await page
      .context()
      .request.post(`${localOrigin}/api/documents/read`, {
        data: { token: cleanGrant.token },
        failOnStatusCode: false,
        headers: mutationHeaders(localOrigin, project.ownerSourceIp),
      });
    expect(cleanRead.status()).toBe(200);
    expect(await cleanRead.body()).toEqual(safeBytes);
    expect(cleanRead.headers()["x-document-sha256"]).toBe(
      createHash("sha256").update(safeBytes).digest("hex"),
    );
    await expect(
      database.documentReadGrant.count({
        where: {
          actorUserId: foreign.userId,
          documentVersionId: {
            in: [safe.documentVersionId, malicious.documentVersionId],
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      database.documentReadGrant.count({
        where: { documentVersionId: malicious.documentVersionId },
      }),
    ).resolves.toBe(0);
    await expect(
      database.documentReadGrant.findUniqueOrThrow({
        where: { id: cleanGrant.grantId },
        select: { documentVersionId: true, actorUserId: true, status: true },
      }),
    ).resolves.toEqual({
      documentVersionId: safe.documentVersionId,
      actorUserId: owner.userId,
      status: "CONSUMED",
    });

    const versionCountBeforePreview = await database.documentVersion.count({
      where: { candidateProfileId: owner.profileId },
    });
    previewContext = await browser.newContext({
      baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": project.previewSourceIp },
    });
    const previewPage = await previewContext.newPage();
    await login(previewPage, owner.email, DEMO_PASSWORD);
    await rebindPhase34PreviewCookiesForHttpLoopback(
      previewContext,
      requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      [SESSION_POLICY_V1.cookieName],
    );
    const previewBytes = Buffer.from(
      `%PDF-1.4\nphase34-preview-must-stay-disabled-${suffix}\n%%EOF`,
      "utf8",
    );
    const previewUpload = await postUploadIntentFromPage(
      previewPage,
      project.previewSourceIp,
      `phase34-preview-disabled-${suffix}.pdf`,
      previewBytes,
    );
    expect(previewUpload.status).toBe(503);
    expect(previewUpload.body).toMatchObject({
      code: "DOCUMENT_VAULT_UNAVAILABLE",
    });
    await expect(
      database.documentVersion.count({
        where: { candidateProfileId: owner.profileId },
      }),
    ).resolves.toBe(versionCountBeforePreview);
    await assertNoPreviewDocumentAuthority(database);
    await previewContext.close();
    previewContext = undefined;

    const beforeReplay = await documentScanFingerprint(database, [
      safe.documentVersionId,
      malicious.documentVersionId,
    ]);
    const secondWorkerId = `phase34-doc-${suffix}-replay`.slice(0, 90);
    const secondWorker = await runWorkerOnce(secondWorkerId);
    expect(secondWorker.output).toContain(`"workerId":"${secondWorkerId}"`);
    const secondWorkerRun = await database.workerRun.findFirstOrThrow({
      where: { workerId: secondWorkerId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    expect(secondWorkerRun).toMatchObject({
      environment: "local",
      deploymentDigest: candidateDigest,
      runtimeVersion: "v1",
      status: "STOPPED",
      shutdownOutcome: "CLEAN",
      lastErrorDigest: null,
      failedCount: 0,
    });
    expect(secondWorkerRun.succeededCount).toBe(secondWorkerRun.claimedCount);
    assertWorkerRunTimeline(secondWorkerRun);
    expect(
      await documentScanFingerprint(database, [
        safe.documentVersionId,
        malicious.documentVersionId,
      ]),
    ).toEqual(beforeReplay);
    await expect(
      database.notificationOutbox.count({
        where: { recipientUserId: owner.userId },
      }),
    ).resolves.toBe(outboxBefore);
    await expect(
      database.workerHandlerActivation.findUniqueOrThrow({
        where: { id: handlerActivationId },
        select: activationSelect,
      }),
    ).resolves.toEqual(handlerActivationBefore);
    await expect(
      database.providerActivation.findUniqueOrThrow({
        where: { id: objectStoreActivationId },
        select: providerActivationSelect,
      }),
    ).resolves.toEqual(objectStoreBefore);
    await expect(
      database.providerActivation.findUniqueOrThrow({
        where: { id: scannerActivationId },
        select: providerActivationSelect,
      }),
    ).resolves.toEqual(scannerBefore);
  } finally {
    await Promise.allSettled([
      foreignContext?.close() ?? Promise.resolve(),
      previewContext?.close() ?? Promise.resolve(),
    ]);
    await database.$disconnect();
  }
});

const activationSelect = {
  id: true,
  generation: true,
  environment: true,
  handlerKey: true,
  handlerVersion: true,
  payloadVersion: true,
  mode: true,
  configurationDigest: true,
  deploymentDigest: true,
  providerUseCase: true,
  killSwitchEngaged: true,
  effectiveAt: true,
  expiresAt: true,
  revokedAt: true,
  updatedAt: true,
} as const;

const providerActivationSelect = {
  id: true,
  environment: true,
  useCase: true,
  adapterKey: true,
  adapterVersion: true,
  mode: true,
  configurationDigest: true,
  secretVersionRef: true,
  region: true,
  health: true,
  killSwitchEngaged: true,
  effectiveAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

async function createCandidate(database: Database, suffix: string) {
  const credential = await database.credential.findFirstOrThrow({
    where: { user: { emailNormalized: DEMO_ACCOUNTS.candidate } },
    select: {
      algorithm: true,
      algorithmVersion: true,
      passwordChangedAt: true,
      passwordHash: true,
    },
  });
  const email = `phase34-document-${suffix}@example.test`;
  const userId = randomUUID();
  const profileId = randomUUID();
  await database.user.create({
    data: {
      id: userId,
      email,
      emailNormalized: email,
      role: "CANDIDATE",
      name: `Phase 34 Document ${suffix}`,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: new Date(),
      identityAssurance: "VERIFIED_EMAIL",
      credential: {
        create: { id: randomUUID(), ...credential },
      },
      candidateProfile: {
        create: {
          id: profileId,
          firstName: "Document",
          lastName: `Candidate ${suffix}`,
          publicDisplayName: `Document Candidate ${suffix}`,
        },
      },
    },
  });
  return Object.freeze({ email, profileId, userId });
}

async function uploadCandidatePdf(
  request: APIRequestContext,
  origin: string,
  sourceIp: string,
  filename: string,
  bytes: Buffer,
): Promise<UploadIntent> {
  const intentResponse = await postUploadIntent(
    request,
    origin,
    sourceIp,
    filename,
    bytes,
  );
  expect(intentResponse.status()).toBe(201);
  const intent = requireUploadIntent(await intentResponse.json());

  const uploaded = await request.post(
    `${origin}/api/documents/upload-intents/${intent.intentId}/body`,
    {
      data: bytes,
      failOnStatusCode: false,
      headers: {
        ...mutationHeaders(origin, sourceIp, "application/pdf"),
        "content-length": String(bytes.byteLength),
      },
    },
  );
  expect(uploaded.status()).toBe(200);
  expect(await uploaded.json()).toMatchObject({
    documentVersionId: intent.documentVersionId,
    duplicate: false,
    status: "QUARANTINED",
  });

  const finalized = await request.post(
    `${origin}/api/documents/upload-intents/${intent.intentId}/finalize`,
    {
      failOnStatusCode: false,
      headers: mutationHeaders(origin, sourceIp),
    },
  );
  expect(finalized.status()).toBe(200);
  expect(await finalized.json()).toMatchObject({
    documentVersionId: intent.documentVersionId,
    duplicate: false,
  });
  return intent;
}

function postUploadIntent(
  request: APIRequestContext,
  origin: string,
  sourceIp: string,
  filename: string,
  bytes: Buffer,
) {
  return request.post(`${origin}/api/documents/upload-intents`, {
    data: {
      filename,
      declaredMimeType: "application/pdf",
      expectedSizeBytes: bytes.byteLength,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: randomUUID(),
    },
    failOnStatusCode: false,
    headers: mutationHeaders(origin, sourceIp, "application/json"),
  });
}

async function postUploadIntentFromPage(
  page: Page,
  sourceIp: string,
  filename: string,
  bytes: Buffer,
) {
  const payload = {
    filename,
    declaredMimeType: "application/pdf",
    expectedSizeBytes: bytes.byteLength,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    idempotencyKey: randomUUID(),
  };
  return page.evaluate(
    async ({ forwardedFor, uploadPayload }) => {
      const response = await fetch("/api/documents/upload-intents", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": forwardedFor,
        },
        body: JSON.stringify(uploadPayload),
      });
      return Object.freeze({
        status: response.status,
        body: (await response.json()) as unknown,
      });
    },
    { forwardedFor: sourceIp, uploadPayload: payload },
  );
}

async function rebindPhase34PreviewCookiesForHttpLoopback(
  context: BrowserContext,
  baseUrl: string,
  requiredNames: readonly string[],
) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new Error("PHASE34_PREVIEW_COOKIE_REBIND_REQUIRES_HTTP_LOOPBACK");
  }
  // Query the complete jar: Playwright filters Secure cookies out when an
  // HTTP URL is supplied, which would make the genuine Preview session look
  // absent before it can be rebound for this loopback-only transport.
  const cookies = await context.cookies();
  const selected = requiredNames.map((name) => {
    const candidates = cookies.filter(
      (candidate) =>
        candidate.name === name && isLoopbackCookieDomain(candidate.domain),
    );
    const cookie =
      candidates.find(
        (candidate) => normalizeCookieDomain(candidate.domain) === origin.hostname,
      ) ?? candidates[0];
    if (cookie === undefined) {
      throw new Error(`PHASE34_PREVIEW_COOKIE_MISSING:${name}`);
    }
    return cookie;
  });
  const secure = selected.filter((cookie) => cookie.secure);
  if (secure.length > 0) {
    // Real Preview runs on HTTPS and must retain Secure cookies. The gate's
    // 127.0.0.1 HTTP transport is the sole exception; browser engines differ
    // on whether they send Secure loopback cookies, so rebind the genuine
    // server-issued values only inside this isolated browser context.
    await context.addCookies(
      secure.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: origin.hostname,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: false,
        sameSite: cookie.sameSite,
      })),
    );
  }
  const rebound = await context.cookies();
  for (const name of requiredNames) {
    const cookie = rebound.find(
      (candidate) =>
        candidate.name === name &&
        normalizeCookieDomain(candidate.domain) === origin.hostname,
    );
    if (cookie === undefined || cookie.secure) {
      throw new Error(`PHASE34_PREVIEW_COOKIE_REBIND_FAILED:${name}`);
    }
  }
}

function isLoopbackCookieDomain(domain: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    normalizeCookieDomain(domain),
  );
}

function normalizeCookieDomain(domain: string) {
  return domain.replace(/^\./u, "").toLowerCase();
}

function issueReadGrant(
  request: APIRequestContext,
  origin: string,
  sourceIp: string,
  documentVersionId: string,
) {
  return request.post(
    `${origin}/api/documents/versions/${documentVersionId}/read-grants`,
    {
      data: {},
      failOnStatusCode: false,
      headers: mutationHeaders(origin, sourceIp, "application/json"),
    },
  );
}

function mutationHeaders(
  origin: string,
  sourceIp: string,
  contentType = "application/json",
) {
  return {
    origin,
    referer: `${origin}/candidate/jobpass`,
    "x-forwarded-for": sourceIp,
    "content-type": contentType,
  };
}

function requireUploadIntent(value: unknown): UploadIntent {
  if (
    !isRecord(value) ||
    typeof value.intentId !== "string" ||
    typeof value.documentVersionId !== "string" ||
    value.duplicate !== false ||
    value.status !== "CREATED"
  ) {
    throw new Error("Phase-34 document upload-intent contract is invalid.");
  }
  return Object.freeze({
    intentId: value.intentId,
    documentVersionId: value.documentVersionId,
  });
}

function requireReadGrant(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.grantId !== "string" ||
    typeof value.token !== "string" ||
    typeof value.expiresAt !== "string"
  ) {
    throw new Error("Phase-34 clean read-grant contract is invalid.");
  }
  return Object.freeze({
    grantId: value.grantId,
    token: value.token,
    expiresAt: value.expiresAt,
  });
}

async function waitForUnusedMinuteScheduleBucket(database: Database) {
  const deadline = Date.now() + 65_000;
  while (Date.now() < deadline) {
    const bucket = Math.floor(Date.now() / 60_000);
    const dedupeKeys = [
      `${JOB_ALERT_HANDLER_KEY}:v1:${bucket}`,
      `${NOTIFICATION_DISPATCH_HANDLER_KEY}:v1:${bucket}`,
    ];
    if (
      (await database.workItem.count({
        where: { dedupeKey: { in: dedupeKeys } },
      })) === 0
    ) {
      return;
    }
    const nextBoundary = (bucket + 1) * 60_000;
    await delay(Math.max(50, Math.min(500, nextBoundary - Date.now() + 25)));
  }
  throw new Error("PHASE34_UNUSED_DOCUMENT_WORKER_SCHEDULE_BUCKET_TIMEOUT");
}

async function runWorkerOnce(workerId: string) {
  const tsxCli = resolve(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const runtimeGuard = resolve(
    process.cwd(),
    "scripts",
    "e2e",
    "runtime-guard.cjs",
  );
  const workerScript = resolve(process.cwd(), "scripts", "phase23-worker.ts");
  if (
    !existsSync(tsxCli) ||
    !existsSync(runtimeGuard) ||
    !existsSync(workerScript)
  ) {
    throw new Error("PHASE34_DOCUMENT_WORKER_RUNTIME_MISSING");
  }

  const child = spawn(
    process.execPath,
    [
      "--require",
      runtimeGuard,
      tsxCli,
      "--conditions",
      "react-server",
      workerScript,
      "--once",
      `--worker-id=${workerId}`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "local",
        NODE_ENV: "production",
        APP_URL: requiredEnvironment("PHASE34_LOCAL_BASE_URL"),
        APP_BUILD_ID: requiredEnvironment("PHASE34_CANDIDATE_DIGEST"),
        DATABASE_URL: requiredEnvironment("DATABASE_URL"),
        TEST_DATABASE_URL: "",
        TRUSTED_PROXY_HOPS: "1",
        EMAIL_PROVIDER_MODE: "local_mock",
        NOTIFICATION_DISPATCH: "command",
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
        DEV_MAILBOX_SECRET: "",
        PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "false",
        PAYMENT_PROVIDER_MODE: "disabled",
        WORKER_RUNTIME: "sandbox_command",
        DOCUMENT_STORAGE_KEYS: requiredEnvironment(
          "PHASE34_DOCUMENT_STORAGE_KEYS",
        ),
        DOCUMENT_VAULT_WRITES: "true",
        DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
        DOCUMENT_SCANNER_MODE: "sandbox",
        DOCUMENT_CLEAN_READS: "true",
        DOCUMENT_RECONCILIATION: "disabled",
        DOCUMENT_BULK_ACCESS: "false",
        DOCUMENT_VAULT_COHORT: "test",
        DOCUMENT_STORAGE_ROOT: requiredEnvironment(
          "PHASE34_DOCUMENT_STORAGE_ROOT",
        ),
        DOCUMENT_STORAGE_REGION: "local-test",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  const record = (chunk: Buffer | string) => {
    output = `${output}${chunk.toString()}`.slice(
      -MAXIMUM_WORKER_OUTPUT_CHARACTERS,
    );
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);

  const result = await new Promise<
    Readonly<{
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
    }>
  >((resolveExit, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, WORKER_TIMEOUT_MILLISECONDS);
    timeout.unref();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveExit(Object.freeze({ code, signal, timedOut }));
    });
  });
  if (result.timedOut || result.code !== 0) {
    throw new Error(
      `Phase 34 document worker failed (code ${String(result.code)}, signal ${String(result.signal)}, timeout ${String(result.timedOut)}):\n${redact(output)}`,
    );
  }
  return Object.freeze({ ...result, output });
}

async function assertNoPreviewDocumentAuthority(database: Database) {
  const [providers, handlers] = await Promise.all([
    database.providerActivation.count({
      where: {
        environment: "preview",
        useCase: {
          in: ["documents.object-store", "documents.malware-scan"],
        },
        revokedAt: null,
      },
    }),
    database.workerHandlerActivation.count({
      where: {
        environment: "preview",
        handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
        handlerVersion: DOCUMENT_SCAN_HANDLER_VERSION,
        revokedAt: null,
      },
    }),
  ]);
  expect({ handlers, providers }).toEqual({ handlers: 0, providers: 0 });
}

async function documentScanFingerprint(
  database: Database,
  documentVersionIds: readonly string[],
) {
  const [versions, attempts, workItems, accessEvents, audits, metadata] =
    await Promise.all([
      database.documentVersion.findMany({
        where: { id: { in: [...documentVersionIds] } },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          detectedMimeType: true,
          scanCompletedAt: true,
        },
      }),
      database.documentScanAttempt.findMany({
        where: { documentVersionId: { in: [...documentVersionIds] } },
        orderBy: [
          { documentVersionId: "asc" },
          { attemptNumber: "asc" },
          { id: "asc" },
        ],
      }),
      database.workItem.findMany({
        where: {
          handlerKey: DOCUMENT_SCAN_HANDLER_KEY,
          subjectId: { in: [...documentVersionIds] },
        },
        orderBy: { subjectId: "asc" },
        include: {
          attempts: { orderBy: [{ attemptNumber: "asc" }, { id: "asc" }] },
          effectReceipts: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      }),
      database.documentAccessEvent.findMany({
        where: {
          documentVersionId: { in: [...documentVersionIds] },
          kind: { in: ["SCAN_REQUESTED", "SCAN_COMPLETED"] },
        },
        orderBy: [
          { documentVersionId: "asc" },
          { occurredAt: "asc" },
          { id: "asc" },
        ],
      }),
      database.auditLog.findMany({
        where: {
          action: "DOCUMENT_SCAN_COMPLETED",
          targetType: "DOCUMENT_VERSION",
          targetId: { in: [...documentVersionIds] },
        },
        orderBy: [{ targetId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      database.candidateDocumentMetadata.findMany({
        where: { documentVersionId: { in: [...documentVersionIds] } },
        orderBy: { documentVersionId: "asc" },
      }),
    ]);
  return Object.freeze({
    accessEvents,
    attempts,
    audits,
    metadata,
    versions,
    workItems,
  });
}

function assertWorkerRunTimeline(
  run: Readonly<{
    drainingAt: Date | null;
    heartbeatAt: Date;
    startedAt: Date;
    stoppedAt: Date | null;
  }>,
) {
  expect(run.drainingAt).toBeInstanceOf(Date);
  expect(run.stoppedAt).toBeInstanceOf(Date);
  expect(run.heartbeatAt.getTime()).toBeGreaterThanOrEqual(
    run.startedAt.getTime(),
  );
  expect(run.heartbeatAt.getTime()).toBeLessThanOrEqual(
    requireDate(run.stoppedAt).getTime(),
  );
  expect(requireDate(run.drainingAt).getTime()).toBeGreaterThanOrEqual(
    run.startedAt.getTime(),
  );
  expect(requireDate(run.drainingAt).getTime()).toBeLessThanOrEqual(
    requireDate(run.stoppedAt).getTime(),
  );
}

function projectIdentity(projectName: string) {
  const slug = projectName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
  switch (projectName) {
    case "chromium-phase34":
      return Object.freeze({
        slug,
        ownerSourceIp: "198.51.100.111",
        foreignSourceIp: "198.51.100.121",
        previewSourceIp: "198.51.100.131",
      });
    case "firefox-phase34":
      return Object.freeze({
        slug,
        ownerSourceIp: "198.51.100.112",
        foreignSourceIp: "198.51.100.122",
        previewSourceIp: "198.51.100.132",
      });
    case "webkit-phase34":
      return Object.freeze({
        slug,
        ownerSourceIp: "198.51.100.113",
        foreignSourceIp: "198.51.100.123",
        previewSourceIp: "198.51.100.133",
      });
    default:
      throw new Error(`Unsupported Phase-34 browser project: ${projectName}`);
  }
}

function digestSummary(value: unknown) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function requireDate(value: Date | null) {
  if (!(value instanceof Date)) throw new Error("WORKER_RUN_DATE_MISSING");
  return value;
}

function redact(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /((?:secret|token|password|authorization|cookie|key)[\w.-]*\s*[:=]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    );
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 34 document worker E2E.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
