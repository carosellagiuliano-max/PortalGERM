import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "@/lib/db/factory";
import { createDatabaseClient } from "@/lib/db/factory";
import { parseEnvironment } from "@/lib/config/env-schema";
import type {
  DocumentObjectReceipt,
  DocumentObjectStore,
} from "@/lib/providers/storage/document-object-store";
import { hashLegalContent } from "@/lib/legal/publication-service";
import { createValidEnvironment, keyMaterial } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

export const PHASE22_NOW = new Date("2026-07-26T12:00:00.000Z");
export const PHASE22_REGION = "ch-sandbox";

export type Phase22Harness = Readonly<{
  client: DatabaseClient;
  migrated: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  dispose: () => Promise<void>;
}>;

export type Phase22Actors = Readonly<{
  requester: Awaited<ReturnType<typeof createTestUser>>;
  assignedAdmin: Awaited<ReturnType<typeof createTestUser>>;
  approvalAdmin: Awaited<ReturnType<typeof createTestUser>>;
  legalAuthor: Awaited<ReturnType<typeof createTestUser>>;
  legalReviewer: Awaited<ReturnType<typeof createTestUser>>;
  legalPublisher: Awaited<ReturnType<typeof createTestUser>>;
}>;

export async function createPhase22Harness(
  purpose: string,
): Promise<Phase22Harness> {
  const migrated = await createMigratedTestDatabase(purpose);
  const client = createDatabaseClient(migrated.connectionString);
  return Object.freeze({
    client,
    migrated,
    dispose: async () => {
      await client.$disconnect().catch(() => undefined);
      await migrated.dispose();
    },
  });
}

export async function seedPhase22Actors(
  client: DatabaseClient,
  suffix: string,
): Promise<Phase22Actors> {
  const requester = await createTestUser(
    client,
    `phase22-requester-${suffix}@example.test`,
    "CANDIDATE",
    `Phase 22 Requester ${suffix}`,
  );
  const assignedAdmin = await createTestUser(
    client,
    `phase22-assigned-${suffix}@example.test`,
    "ADMIN",
    `Phase 22 Assigned ${suffix}`,
  );
  const approvalAdmin = await createTestUser(
    client,
    `phase22-approver-${suffix}@example.test`,
    "ADMIN",
    `Phase 22 Approver ${suffix}`,
  );
  const legalAuthor = await createTestUser(
    client,
    `phase22-legal-author-${suffix}@example.test`,
    "ADMIN",
    `Phase 22 Legal Author ${suffix}`,
  );
  const legalReviewer = await createTestUser(
    client,
    `phase22-legal-reviewer-${suffix}@example.test`,
    "ADMIN",
    `Phase 22 Legal Reviewer ${suffix}`,
  );
  const legalPublisher = await createTestUser(
    client,
    `phase22-legal-publisher-${suffix}@example.test`,
    "ADMIN",
    `Phase 22 Legal Publisher ${suffix}`,
  );
  return Object.freeze({
    requester,
    assignedAdmin,
    approvalAdmin,
    legalAuthor,
    legalReviewer,
    legalPublisher,
  });
}

export async function seedPublishedPrivacyNotice(
  client: DatabaseClient,
  actors: Phase22Actors,
  suffix: string,
) {
  const contentMarkdown = [
    `# Datenschutz Test ${suffix}`,
    "",
    "Diese ausschließlich technische Testpublikation dokumentiert eine überprüfte Versionskette.",
    "Sie ist keine Rechtsberatung und wird nur in einer isolierten Testdatenbank verwendet.",
  ].join("\n");
  const contentHash = hashLegalContent(contentMarkdown);
  const document = await client.legalDocument.create({
    data: {
      type: "PRIVACY",
      locale: "de-CH",
      slug: `privacy-${suffix}`,
      title: `Datenschutz ${suffix}`,
      updatedAt: new Date(PHASE22_NOW.getTime() - 180_000),
    },
  });
  const revision = await client.legalRevision.create({
    data: {
      legalDocumentId: document.id,
      revisionNumber: 1,
      versionLabel: "test-v1",
      status: "APPROVED",
      contentMarkdown,
      contentHash,
      changeSummary: "Isolierte Phase-22-Vertragsprüfung",
      requiresReconsent: true,
      createdByUserId: actors.legalAuthor.id,
      reviewedByUserId: actors.legalReviewer.id,
      reviewedAt: new Date(PHASE22_NOW.getTime() - 120_000),
      createdAt: new Date(PHASE22_NOW.getTime() - 180_000),
    },
  });
  const publication = await client.legalPublication.create({
    data: {
      legalDocumentId: document.id,
      legalRevisionId: revision.id,
      publicationHash: contentHash,
      publishedByUserId: actors.legalPublisher.id,
      effectiveAt: new Date(PHASE22_NOW.getTime() - 60_000),
      createdAt: new Date(PHASE22_NOW.getTime() - 60_000),
    },
  });
  return Object.freeze({ document, revision, publication, contentHash });
}

export async function seedActiveInventory(
  client: DatabaseClient,
  suffix: string,
  processors: readonly string[],
) {
  const inventory = await client.privacyDataInventoryVersion.create({
    data: {
      version: `test-${suffix}`.slice(0, 32),
      status: "ACTIVE",
      contentHash: createHash("sha256")
        .update(`phase22-inventory:${suffix}:${processors.join(",")}`)
        .digest("hex"),
      owner: "Phase 22 Test Privacy Owner",
      reviewRef: `test-review:${suffix}`,
      effectiveAt: new Date(PHASE22_NOW.getTime() - 60_000),
      createdAt: new Date(PHASE22_NOW.getTime() - 120_000),
      entries: {
        create: processors.map((processorKey, index) => ({
          entityKey: `TEST_ENTITY_${index + 1}`,
          fieldScope: `isolated Phase-22 test scope ${index + 1}`,
          subjectClass: "CANDIDATE" as const,
          purposeCode: "PRIVACY_RIGHTS",
          legalBasisCode: "COUNSEL_TEST_EVIDENCE_ONLY",
          processorKey,
          storageRegion: PHASE22_REGION,
          retentionDays: processorKey === "payment-ledger" ? 3650 : 400,
          exportOutcome: "INCLUDE" as const,
          correctionOutcome:
            processorKey === "postgres-primary"
              ? ("CORRECT" as const)
              : ("RETAIN" as const),
          erasureOutcome:
            processorKey === "payment-ledger"
              ? ("RETAIN" as const)
              : ("ANONYMIZE" as const),
          holdRuleCode: "PHASE22_TEST_HOLD_MATRIX",
          owner: "Phase 22 Test Privacy Owner",
        })),
      },
    },
    include: { entries: true },
  });
  return inventory;
}

export async function seedProcessingApproval(
  client: DatabaseClient,
  publicationId: string,
  input: Readonly<{
    suffix: string;
    scope: string;
    processorKey: string;
    region?: string;
  }>,
) {
  const externalProcessor = [
    "document-object-store",
    "email-provider",
    "payment-ledger",
    "runtime-logs",
    "backup-restore",
  ].includes(input.processorKey);
  return client.processingApproval.create({
    data: {
      scope: input.scope,
      region: input.region ?? PHASE22_REGION,
      processorKey: input.processorKey,
      version: `test-${input.suffix}`.slice(0, 32),
      status: "APPROVED",
      legalPublicationId: publicationId,
      legalBasisRef: `counsel:test:${input.scope.toLowerCase()}:v1`,
      avgDecisionRef: input.scope.includes("TALENT_RADAR")
        ? "seco:test:avg-decision:v1"
        : null,
      dpaRef: externalProcessor ? "dpa:test:processor:v1" : null,
      dsfaDecision: "NOT_REQUIRED",
      dsfaDecisionRef: `dsfa:test:${input.scope.toLowerCase()}:v1`,
      owner: "Phase 22 Test Privacy Owner",
      approvedBy: "Phase 22 Independent Test Reviewer",
      effectiveAt: new Date(PHASE22_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE22_NOW.getTime() + 7 * 86_400_000),
      reviewAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
      createdAt: new Date(PHASE22_NOW.getTime() - 120_000),
    },
  });
}

export async function seedPrivacyRequest(
  client: DatabaseClient,
  actors: Phase22Actors,
  type: "EXPORT" | "CORRECT" | "DELETE",
) {
  return client.privacyRequest.create({
    data: {
      requesterUserId: actors.requester.id,
      type,
      status: "IN_PROGRESS",
      version: 4,
      dueAt: new Date(PHASE22_NOW.getTime() + 30 * 86_400_000),
      assignedAdminUserId: actors.assignedAdmin.id,
      assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
      verifiedAt: new Date(PHASE22_NOW.getTime() - 120_000),
      processingStartedAt: new Date(PHASE22_NOW.getTime() - 60_000),
      idempotencyKey: `phase22-request-${randomUUID()}`,
      noticeVersion: "privacy-request-v2",
      domainEventRefs: [],
      deletionDependencies: [],
      createdAt: new Date(PHASE22_NOW.getTime() - 180_000),
      updatedAt: new Date(PHASE22_NOW.getTime() - 60_000),
    },
  });
}

export function privacyExecutionCommand(
  requestId: string,
  actors: Phase22Actors,
) {
  return {
    privacyRequestId: requestId,
    actorUserId: actors.assignedAdmin.id,
    approvalActorUserId: actors.approvalAdmin.id,
    idempotencyKey: randomUUID(),
    approvalEvidenceRef: "sandbox:phase22-separated-approval-v1",
    stepUpEvidenceRef: "sandbox:phase22-step-up-evidence-v1",
  } as const;
}

export function phase22ExportKeyring() {
  const environment = parseEnvironment(
    createValidEnvironment({
      PRIVACY_EXPORT_KEYS: `privacy-export-v1:${keyMaterial(22)}`,
    }),
  );
  return environment.secrets.keyrings.PRIVACY_EXPORT_KEYS;
}

export function createMemoryDocumentStore(
  storageRegion = PHASE22_REGION,
): DocumentObjectStore {
  const objects = new Map<
    string,
    Readonly<{
      bytes: Uint8Array;
      receipt: DocumentObjectReceipt;
      modifiedAt: Date;
    }>
  >();
  return Object.freeze({
    providerClass: "phase22-memory-test-store",
    storageRegion,
    async putQuarantined(input) {
      if (objects.has(input.objectKey)) throw new Error("OBJECT_ALREADY_EXISTS");
      const chunks: Uint8Array[] = [];
      let sizeBytes = 0;
      for await (const chunk of input.body) {
        const copied = Uint8Array.from(chunk);
        chunks.push(copied);
        sizeBytes += copied.byteLength;
      }
      const bytes = new Uint8Array(sizeBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (
        sizeBytes !== input.expectedSizeBytes ||
        (input.expectedSha256 !== undefined &&
          input.expectedSha256 !== sha256)
      ) {
        throw new Error("OBJECT_RECEIPT_MISMATCH");
      }
      const receipt = Object.freeze({
        objectVersion: input.objectVersion,
        sizeBytes,
        sha256,
        encryptionKeyVersion: "privacy-export-v1",
        storageRegion,
      });
      objects.set(
        input.objectKey,
        Object.freeze({ bytes, receipt, modifiedAt: PHASE22_NOW }),
      );
      return receipt;
    },
    async headObject(objectKey) {
      return objects.get(objectKey)?.receipt ?? null;
    },
    async openVerifiedRead(objectKey) {
      const stored = objects.get(objectKey);
      if (stored === undefined) return null;
      return {
        receipt: stored.receipt,
        body: (async function* () {
          yield Uint8Array.from(stored.bytes);
        })(),
      };
    },
    async listObjects({ limit }) {
      return [...objects.entries()].slice(0, limit).map(
        ([objectKey, stored]) =>
          Object.freeze({
            objectKeyHash: createHash("sha256")
              .update(objectKey)
              .digest("hex"),
            sizeBytes: stored.receipt.sizeBytes,
            sha256: stored.receipt.sha256,
            lastModifiedAt: stored.modifiedAt,
          }),
      );
    },
    async deleteObject(objectKey, expected) {
      const stored = objects.get(objectKey);
      if (stored === undefined) return "MISSING";
      if (
        stored.receipt.sha256 !== expected.sha256 ||
        stored.receipt.objectVersion !== expected.objectVersion
      ) {
        return "MISMATCH";
      }
      objects.delete(objectKey);
      return "DELETED";
    },
  });
}

async function createTestUser(
  client: DatabaseClient,
  email: string,
  role: "ADMIN" | "CANDIDATE",
  name: string,
) {
  return client.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      role,
      name,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: PHASE22_NOW,
      identityAssurance: "VERIFIED_EMAIL",
      createdAt: new Date(PHASE22_NOW.getTime() - 300_000),
      updatedAt: new Date(PHASE22_NOW.getTime() - 300_000),
    },
  });
}
