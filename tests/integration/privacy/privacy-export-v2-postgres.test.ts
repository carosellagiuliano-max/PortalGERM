import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumePrivacyExportV2,
  createPrivacyExportV2,
} from "@/lib/privacy/export-v2";
import {
  createMemoryDocumentStore,
  createPhase22Harness,
  phase22ExportKeyring,
  PHASE22_NOW,
  privacyExecutionCommand,
  seedActiveInventory,
  seedPhase22Actors,
  seedPrivacyRequest,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase22_privacy_export_v2");
  actors = await seedPhase22Actors(harness.client, "export");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 privacy export V2", () => {
  it("builds a bounded owner-only package and enforces step-up, expiry and atomic single use", async () => {
    const { client, users } = requireFixture();
    const foreign = await client.user.create({
      data: {
        email: "FOREIGN_EXPORT_CANARY@example.test",
        emailNormalized: "foreign_export_canary@example.test",
        role: "CANDIDATE",
        name: "FOREIGN_EXPORT_NAME_CANARY",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: PHASE22_NOW,
        identityAssurance: "VERIFIED_EMAIL",
      },
    });
    const legal = await seedPublishedPrivacyNotice(client, users, "export");
    const exportProcessors = [
      "postgres-primary",
      "document-object-store",
      "notification-outbox",
    ] as const;
    await seedActiveInventory(client, "export", exportProcessors);
    await Promise.all(
      exportProcessors.map((processorKey) =>
        seedProcessingApproval(client, legal.publication.id, {
          suffix: `export-${processorKey}`,
          scope: "PRIVACY_EXPORT",
          processorKey,
        }),
      ),
    );
    const store = createMemoryDocumentStore();
    const keyring = phase22ExportKeyring();
    const dependencies = {
      database: client,
      exportStore: store,
      documentStore: store,
      exportKeyring: keyring,
      featureEnabled: true,
      cohortAllowed: true,
      processingMode: "sandbox_command" as const,
      now: PHASE22_NOW,
    };
    const profile = await client.candidateProfile.create({
      data: {
        userId: users.requester.id,
        firstName: "Export",
        publicDisplayName: "Export Candidate",
      },
    });
    const document = await client.document.create({
      data: {
        candidateProfileId: profile.id,
        purpose: "CV",
      },
    });
    const documentBytes = Buffer.from(
      "%PDF-1.4\nPHASE22_OWN_DOCUMENT_BYTE_CANARY\n%%EOF",
      "utf8",
    );
    const documentHash = createHash("sha256")
      .update(documentBytes)
      .digest("hex");
    const documentObjectKey = `phase22/export/${users.requester.id}/cv`;
    const documentObjectVersion = "phase22-export-doc-v1";
    await store.putQuarantined({
      objectKey: documentObjectKey,
      objectVersion: documentObjectVersion,
      expectedSizeBytes: documentBytes.byteLength,
      expectedSha256: documentHash,
      body: (async function* () {
        yield documentBytes;
      })(),
    });
    const documentVersion = await client.documentVersion.create({
      data: {
        documentId: document.id,
        candidateProfileId: profile.id,
        sequence: 1,
        objectKey: documentObjectKey,
        providerObjectVersion: documentObjectVersion,
        safeFilename: "phase22-own-cv.pdf",
        declaredMimeType: "application/pdf",
        detectedMimeType: "application/pdf",
        sizeBytes: documentBytes.byteLength,
        sha256: documentHash,
        status: "CLEAN",
        encryptionKeyVersion: "privacy-export-v1",
        storageRegion: "ch-sandbox",
        uploadedAt: PHASE22_NOW,
        scanCompletedAt: PHASE22_NOW,
      },
    });
    await client.document.update({
      where: { id: document.id },
      data: { currentVersionId: documentVersion.id },
    });
    const company = await client.company.create({
      data: {
        name: "Phase 22 Export Company",
        slug: `phase22-export-${users.requester.id}`,
        dataProvenance: "TEST",
      },
    });
    const freshnessJob = await client.job.create({
      data: {
        companyId: company.id,
        slug: `phase30-export-freshness-${users.requester.id}`,
        status: "DRAFT",
        origin: "MANUAL",
        sourceReference: `phase30-privacy-export:${users.requester.id}`,
        createdByUserId: users.assignedAdmin.id,
        dataProvenance: "TEST",
      },
    });
    const ownReport = await client.abuseReport.create({
      data: {
        targetType: "JOB",
        targetId: freshnessJob.id,
        reporterUserId: users.requester.id,
        reasonCode: "OWN_REPORT_CANARY",
        description: "Own reporter evidence",
        dueAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
      },
    });
    const freshnessReviewDueAt = new Date("2030-12-31T12:34:56.000Z");
    await client.jobFreshnessReport.create({
      data: {
        jobId: freshnessJob.id,
        abuseReportId: ownReport.id,
        reporterUserId: users.requester.id,
        status: "OPEN",
        reviewDueAt: freshnessReviewDueAt,
        createdAt: PHASE22_NOW,
        updatedAt: PHASE22_NOW,
      },
    });
    await Promise.all([
      client.companyInvitation.create({
        data: {
          companyId: company.id,
          inviterUserId: users.assignedAdmin.id,
          inviteeEmailNormalized: users.requester.email.toLowerCase(),
          intendedRole: "RECRUITER",
          tokenHash: createHash("sha256")
            .update(`own-invite:${users.requester.id}`)
            .digest("hex"),
          expiresAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
          createdAt: PHASE22_NOW,
          updatedAt: PHASE22_NOW,
        },
      }),
      client.companyInvitation.create({
        data: {
          companyId: company.id,
          inviterUserId: users.assignedAdmin.id,
          inviteeEmailNormalized: foreign.email.toLowerCase(),
          intendedRole: "RECRUITER",
          tokenHash: createHash("sha256")
            .update(`foreign-invite:${foreign.id}`)
            .digest("hex"),
          expiresAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
          createdAt: PHASE22_NOW,
          updatedAt: PHASE22_NOW,
        },
      }),
      client.salesLead.create({
        data: {
          emailNormalized: users.requester.email.toLowerCase(),
          contactName: "OWN_LEAD_CANARY",
          purpose: `phase22-own-${users.requester.id}`,
          consentSource: "phase22-test",
          retainUntil: new Date(PHASE22_NOW.getTime() + 86_400_000),
        },
      }),
      client.salesLead.create({
        data: {
          emailNormalized: foreign.email.toLowerCase(),
          contactName: "FOREIGN_LEAD_CANARY",
          purpose: `phase22-foreign-${foreign.id}`,
          consentSource: "phase22-test",
          retainUntil: new Date(PHASE22_NOW.getTime() + 86_400_000),
        },
      }),
      client.abuseReport.create({
        data: {
          targetType: "USER",
          targetId: users.requester.id,
          reporterUserId: foreign.id,
          reasonCode: "FOREIGN_REPORT_CANARY",
          description: "Foreign reporter evidence",
          dueAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
        },
      }),
    ]);
    await client.notificationOutbox.createMany({
      data: Array.from({ length: 251 }, (_, index) => ({
        recipientUserId: users.requester.id,
        purpose: "PRIVACY_REQUEST" as const,
        purposeClass: "MANDATORY" as const,
        channel: "EMAIL" as const,
        templateKey:
          index === 250
            ? 'phase22-export-"unicode-ü'
            : "phase22-export-notification",
        payloadSchemaVersion: "1",
        payload: { index },
        dedupeKey: `phase22-export-notification-${users.requester.id}-${index}`,
        providerDedupeKey: `phase22-export-provider-${users.requester.id}-${index}`,
        status: "PENDING" as const,
        availableAt: PHASE22_NOW,
        createdAt: PHASE22_NOW,
        updatedAt: PHASE22_NOW,
      })),
    });
    const request = await seedPrivacyRequest(client, users, "EXPORT");
    const command = privacyExecutionCommand(request.id, users);

    const created = await createPrivacyExportV2(command, dependencies);
    expect(created).toMatchObject({
      ok: true,
      replay: false,
      privacyRequestId: request.id,
    });
    if (!created.ok) throw new Error("Privacy export V2 was not created.");
    expect(created.expiresAt.getTime() - PHASE22_NOW.getTime()).toBe(
      15 * 60_000,
    );
    expect(created.manifestHash).toMatch(/^[a-f0-9]{64}$/u);

    const artifact = await client.privacyExportArtifact.findUniqueOrThrow({
      where: { id: created.artifactId },
      include: {
        privacyExecution: { include: { processorOutcomes: true } },
      },
    });
    expect(artifact).toMatchObject({
      ownerUserId: users.requester.id,
      status: "READY",
      storageRegion: "ch-sandbox",
      privacyExecution: {
        status: "COMPLETED",
        checkpoint: 3,
      },
    });
    expect(artifact.privacyExecution.processorOutcomes).toHaveLength(3);
    expect(
      artifact.privacyExecution.processorOutcomes.map(
        ({ processorKey, status, outcomeCode }) => ({
          processorKey,
          status,
          outcomeCode,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          processorKey: "postgres-primary",
          status: "SUCCEEDED",
          outcomeCode: "EXPORTED",
        },
        {
          processorKey: "document-object-store",
          status: "SUCCEEDED",
          outcomeCode: "EXPORTED",
        },
        {
          processorKey: "notification-outbox",
          status: "SUCCEEDED",
          outcomeCode: "EXPORTED",
        },
      ]),
    );
    expect(artifact.sizeBytes).toBeGreaterThan(0);
    expect(artifact.sizeBytes).toBeLessThanOrEqual(64 * 1024 * 1024);

    await expect(
      consumePrivacyExportV2(
        {
          artifactId: created.artifactId,
          ownerUserId: foreign.id,
          token: created.downloadToken,
          stepUpEvidenceRef: command.stepUpEvidenceRef,
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      consumePrivacyExportV2(
        {
          artifactId: created.artifactId,
          ownerUserId: users.requester.id,
          token: created.downloadToken,
          stepUpEvidenceRef: "sandbox:phase22-wrong-step-up-evidence",
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "TOKEN_INVALID" });

    const downloaded = await consumePrivacyExportV2(
      {
        artifactId: created.artifactId,
        ownerUserId: users.requester.id,
        token: created.downloadToken,
        stepUpEvidenceRef: command.stepUpEvidenceRef,
      },
      dependencies,
    );
    expect(downloaded).toMatchObject({
      ok: true,
      contentType: "application/vnd.swisstalenthub.privacy-export-v2",
      contentLength: artifact.sizeBytes,
    });
    if (!downloaded.ok) throw new Error("Privacy export was not consumed.");
    const bytes: Uint8Array[] = [];
    for await (const chunk of downloaded.body) bytes.push(chunk);
    const packageText = Buffer.concat(bytes).toString("utf8");
    expect(packageText).toContain("STH_PRIVACY_PACKAGE_V2");
    expect(packageText).toContain(users.requester.email);
    expect(packageText).toContain("PHASE22_OWN_DOCUMENT_BYTE_CANARY");
    expect(packageText).toContain(documentHash);
    expect(packageText).toContain("OWN_LEAD_CANARY");
    expect(packageText).toContain("OWN_REPORT_CANARY");
    expect(packageText).toContain(freshnessReviewDueAt.toISOString());
    expect(packageText).toContain('phase22-export-\\"unicode-ü');
    expect(packageText).not.toContain(foreign.email);
    expect(packageText).not.toContain("FOREIGN_EXPORT_NAME_CANARY");
    expect(packageText).not.toContain("FOREIGN_LEAD_CANARY");
    expect(packageText).not.toContain("FOREIGN_REPORT_CANARY");
    expect(packageText).not.toContain(users.assignedAdmin.email);

    await expect(
      consumePrivacyExportV2(
        {
          artifactId: created.artifactId,
          ownerUserId: users.requester.id,
          token: created.downloadToken,
          stepUpEvidenceRef: command.stepUpEvidenceRef,
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      client.privacyExportArtifact.findUniqueOrThrow({
        where: { id: created.artifactId },
      }),
    ).resolves.toMatchObject({
      status: "CONSUMED",
      consumedAt: PHASE22_NOW,
    });

    const expiringRequest = await seedPrivacyRequest(client, users, "EXPORT");
    const expiringCommand = privacyExecutionCommand(expiringRequest.id, users);
    const expiring = await createPrivacyExportV2(expiringCommand, dependencies);
    if (!expiring.ok)
      throw new Error("Expiring privacy export was not created.");
    await expect(
      consumePrivacyExportV2(
        {
          artifactId: expiring.artifactId,
          ownerUserId: users.requester.id,
          token: expiring.downloadToken,
          stepUpEvidenceRef: expiringCommand.stepUpEvidenceRef,
        },
        {
          ...dependencies,
          now: new Date(expiring.expiresAt),
        },
      ),
    ).resolves.toEqual({ ok: false, code: "EXPIRED" });

    const retryRequest = await seedPrivacyRequest(client, users, "EXPORT");
    const retryCommand = privacyExecutionCommand(retryRequest.id, users);
    const retryBackingStore = createMemoryDocumentStore();
    let remainingInjectedFailures = 1;
    const failOnceStore = Object.freeze({
      ...retryBackingStore,
      async putQuarantined(
        input: Parameters<typeof retryBackingStore.putQuarantined>[0],
      ) {
        if (remainingInjectedFailures > 0) {
          remainingInjectedFailures -= 1;
          throw new Error("INJECTED_EXPORT_STORE_FAILURE");
        }
        return retryBackingStore.putQuarantined(input);
      },
    });
    const retryDependencies = {
      ...dependencies,
      exportStore: failOnceStore,
    };
    await expect(
      createPrivacyExportV2(retryCommand, retryDependencies),
    ).resolves.toEqual({ ok: false, code: "STORAGE_FAILED" });
    const failedArtifact = await client.privacyExportArtifact.findFirstOrThrow({
      where: { privacyRequestId: retryRequest.id },
      include: { privacyExecution: true },
    });
    expect(failedArtifact).toMatchObject({
      status: "FAILED",
      privacyExecution: {
        status: "RETRY_REQUIRED",
        attemptCount: 1,
      },
    });

    const resumed = await createPrivacyExportV2(
      retryCommand,
      retryDependencies,
    );
    expect(resumed).toMatchObject({
      ok: true,
      replay: false,
      artifactId: failedArtifact.id,
    });
    await expect(
      client.privacyExportArtifact.findUniqueOrThrow({
        where: { id: failedArtifact.id },
        include: {
          privacyExecution: { include: { processorOutcomes: true } },
        },
      }),
    ).resolves.toMatchObject({
      status: "READY",
      privacyExecution: {
        status: "COMPLETED",
        attemptCount: 2,
        processorOutcomes: [
          {
            status: "SUCCEEDED",
            attemptCount: 2,
          },
          {
            status: "SUCCEEDED",
            attemptCount: 2,
          },
          {
            status: "SUCCEEDED",
            attemptCount: 2,
          },
        ],
      },
    });
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 export fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
