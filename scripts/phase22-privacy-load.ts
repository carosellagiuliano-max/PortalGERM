import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  recordAnalyticsConsentV1,
  trackAnalyticsEventWithLiveConsentV1,
} from "@/lib/analytics/live-consent-policy";
import { createPrivacyExportV2 } from "@/lib/privacy/export-v2";
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
} from "@/tests/fixtures/phase22-privacy";

const EXPORT_ROW_COUNT = 10_000;
const DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_HEAP_DELTA_BYTES = 32 * 1024 * 1024;
const ANALYTICS_CONCURRENCY = 50;
const MAX_ANALYTICS_P95_MS = 250;

const harness = await createPhase22Harness("phase22_privacy_load");

try {
  const actors = await seedPhase22Actors(harness.client, "load");
  const legal = await seedPublishedPrivacyNotice(
    harness.client,
    actors,
    "load",
  );
  const exportProcessors = [
    "postgres-primary",
    "document-object-store",
    "notification-outbox",
  ] as const;

  await seedActiveInventory(harness.client, "load", exportProcessors);
  await Promise.all(
    exportProcessors.map((processorKey) =>
      seedProcessingApproval(harness.client, legal.publication.id, {
        suffix: `load-export-${processorKey}`,
        scope: "PRIVACY_EXPORT",
        processorKey,
      }),
    ),
  );

  const store = createMemoryDocumentStore();
  const profile = await harness.client.candidateProfile.create({
    data: {
      userId: actors.requester.id,
      firstName: "Load",
      publicDisplayName: "Phase 22 Load",
    },
  });
  const document = await harness.client.document.create({
    data: { candidateProfileId: profile.id, purpose: "CV" },
  });
  const bytes = Buffer.alloc(DOCUMENT_BYTES, 0x41);
  const documentHash = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `phase22/load/${actors.requester.id}/cv`;
  const objectVersion = "phase22-load-document-v1";

  await store.putQuarantined({
    objectKey,
    objectVersion,
    expectedSizeBytes: bytes.byteLength,
    expectedSha256: documentHash,
    body: (async function* () {
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
      }
    })(),
  });
  const documentVersion = await harness.client.documentVersion.create({
    data: {
      documentId: document.id,
      candidateProfileId: profile.id,
      sequence: 1,
      objectKey,
      providerObjectVersion: objectVersion,
      safeFilename: "phase22-load-cv.pdf",
      declaredMimeType: "application/pdf",
      detectedMimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: documentHash,
      status: "CLEAN",
      encryptionKeyVersion: "privacy-export-v1",
      storageRegion: "ch-sandbox",
      uploadedAt: PHASE22_NOW,
      scanCompletedAt: PHASE22_NOW,
    },
  });
  await harness.client.document.update({
    where: { id: document.id },
    data: { currentVersionId: documentVersion.id },
  });

  for (let offset = 0; offset < EXPORT_ROW_COUNT; offset += 1_000) {
    await harness.client.notificationOutbox.createMany({
      data: Array.from(
        { length: Math.min(1_000, EXPORT_ROW_COUNT - offset) },
        (_, localIndex) => {
          const sequence = offset + localIndex;
          return {
            recipientUserId: actors.requester.id,
            purpose: "PRIVACY_REQUEST" as const,
            purposeClass: "MANDATORY" as const,
            channel: "EMAIL" as const,
            templateKey: "phase22-privacy-load",
            payloadSchemaVersion: "1",
            payload: { sequence },
            dedupeKey: `phase22-load-notification-${sequence}`,
            providerDedupeKey: `phase22-load-provider-${sequence}`,
            status: "PENDING" as const,
            availableAt: PHASE22_NOW,
          };
        },
      ),
    });
  }

  const request = await seedPrivacyRequest(harness.client, actors, "EXPORT");
  const heapBaseline = process.memoryUsage().heapUsed;
  let peakHeap = heapBaseline;
  const sampler = setInterval(() => {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }, 1);
  sampler.unref();
  const exportStartedAt = performance.now();
  const exported = await createPrivacyExportV2(
    privacyExecutionCommand(request.id, actors),
    {
      database: harness.client,
      exportStore: store,
      documentStore: store,
      exportKeyring: phase22ExportKeyring(),
      featureEnabled: true,
      cohortAllowed: true,
      processingMode: "sandbox_command",
      now: PHASE22_NOW,
    },
  ).finally(() => {
    clearInterval(sampler);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  });
  const exportDurationMs = performance.now() - exportStartedAt;
  const heapDeltaBytes = Math.max(0, peakHeap - heapBaseline);

  if (!exported.ok) {
    throw new Error(`Phase-22 load export failed: ${exported.code}.`);
  }
  const artifact = await harness.client.privacyExportArtifact.findUniqueOrThrow({
    where: { id: exported.artifactId },
    select: { manifest: true, sizeBytes: true, status: true },
  });
  const sections = readManifestSections(artifact.manifest);
  const notificationSection = sections.find(
    ({ category }) => category === "notificationDelivery",
  );
  const documentSection = sections.find(
    ({ category }) => category === "documentBytes",
  );

  if (
    artifact.status !== "READY" ||
    notificationSection?.count !== EXPORT_ROW_COUNT ||
    documentSection?.byteLength !== DOCUMENT_BYTES ||
    heapDeltaBytes > MAX_HEAP_DELTA_BYTES
  ) {
    throw new Error(
      "Phase-22 export load contract exceeded a row, byte, status or heap boundary.",
    );
  }

  const analyticsApproval = await seedProcessingApproval(
    harness.client,
    legal.publication.id,
    {
      suffix: "load-analytics-navigation",
      scope: "OPTIONAL_ANALYTICS_NAVIGATION",
      processorKey: "analytics-store",
    },
  );
  const consent = await recordAnalyticsConsentV1(
    {
      userId: actors.requester.id,
      eventFamily: "NAVIGATION",
      granted: true,
      policyVersion: "analytics-v1",
      noticeHash: legal.publication.publicationHash,
      legalPublicationId: legal.publication.id,
      processingApprovalId: analyticsApproval.id,
      pseudonymEpoch: 1,
      actorUserId: actors.requester.id,
      reasonCode: "USER_OPT_IN",
      effectiveAt: PHASE22_NOW,
    },
    {
      database: harness.client,
      region: "ch-sandbox",
      familyEnabled: true,
      now: PHASE22_NOW,
    },
  );
  if (!consent.ok) {
    throw new Error(`Phase-22 analytics consent failed: ${consent.code}.`);
  }

  const analyticsLatencies = await Promise.all(
    Array.from({ length: ANALYTICS_CONCURRENCY }, async (_, index) => {
      const startedAt = performance.now();
      const result = await trackAnalyticsEventWithLiveConsentV1(
        {
          schemaVersion: "1",
          producerEventId: `phase22-load-navigation-${index}`,
          occurredAt: PHASE22_NOW,
          pseudonymousActorId: "phase22-load-epoch-1",
          kind: "PUBLIC_VALUE_VIEWED",
          properties: { surface: "HOMEPAGE", locale: "de-CH" },
        },
        {
          database: harness.client,
          producer: "phase22-load",
          userId: actors.requester.id,
          requiredPolicyVersion: "analytics-v1",
          region: "ch-sandbox",
          familyFlags: { NAVIGATION: true, CONVERSION: false },
          searchLearningCollection: false,
          provenance: { actor: "LIVE" },
          now: PHASE22_NOW,
        },
      );
      if (!result.recorded || result.duplicate || result.skippedForPrivacy) {
        throw new Error("Phase-22 analytics load write was not recorded exactly once.");
      }
      return performance.now() - startedAt;
    }),
  );
  const analyticsP95Ms = percentile(analyticsLatencies, 0.95);
  if (analyticsP95Ms > MAX_ANALYTICS_P95_MS) {
    throw new Error(
      `Phase-22 analytics p95 ${analyticsP95Ms.toFixed(2)} ms exceeds ${MAX_ANALYTICS_P95_MS} ms.`,
    );
  }

  console.info(
    JSON.stringify(
      {
        contract: "phase22-privacy-load-v1",
        export: {
          rows: EXPORT_ROW_COUNT,
          documentBytes: DOCUMENT_BYTES,
          artifactBytes: artifact.sizeBytes,
          durationMs: round(exportDurationMs),
          heapDeltaBytes,
          maximumHeapDeltaBytes: MAX_HEAP_DELTA_BYTES,
        },
        analytics: {
          concurrency: ANALYTICS_CONCURRENCY,
          p95Ms: round(analyticsP95Ms),
          maximumP95Ms: MAX_ANALYTICS_P95_MS,
          recorded: analyticsLatencies.length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await harness.dispose();
}

function readManifestSections(value: unknown) {
  if (
    value === null ||
    typeof value !== "object" ||
    !("sections" in value) ||
    !Array.isArray(value.sections)
  ) {
    throw new Error("Phase-22 export manifest has no sections.");
  }
  return value.sections.map((section) => {
    if (
      section === null ||
      typeof section !== "object" ||
      !("category" in section) ||
      typeof section.category !== "string" ||
      !("count" in section) ||
      typeof section.count !== "number" ||
      !("byteLength" in section) ||
      typeof section.byteLength !== "number"
    ) {
      throw new Error("Phase-22 export manifest section is invalid.");
    }
    return {
      category: section.category,
      count: section.count,
      byteLength: section.byteLength,
    };
  });
}

function percentile(values: readonly number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? Infinity;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
