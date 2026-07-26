import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  createDocumentUploadIntent,
  finalizeDocumentUploadIntent,
  scanDocumentVersion,
  uploadDocumentIntentBody,
} from "@/lib/documents/vault-service";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

export async function createDocumentVaultHarness(purpose: string) {
  const migrated = await createMigratedTestDatabase(purpose);
  const root = await mkdtemp(resolve(tmpdir(), `sth-${purpose}-`));
  const environment = parseEnvironment(
    createValidEnvironment({
      DATABASE_URL: migrated.connectionString,
      DOCUMENT_STORAGE_KEYS: `document-v1:${keyMaterial(10)}`,
      DOCUMENT_VAULT_WRITES: "true",
      DOCUMENT_STORAGE_MODE: "filesystem_sandbox",
      DOCUMENT_SCANNER_MODE: "sandbox",
      DOCUMENT_CLEAN_READS: "true",
      DOCUMENT_RECONCILIATION: "command",
      DOCUMENT_BULK_ACCESS: "false",
      DOCUMENT_VAULT_COHORT: "test",
      DOCUMENT_STORAGE_ROOT: root,
      DOCUMENT_STORAGE_REGION: "local-test",
    }),
  );
  const database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const objectStore = createDocumentObjectStore(environment);
  const scanner = createDocumentMalwareScanner(environment);
  return Object.freeze({
    migrated,
    root,
    environment,
    database,
    objectStore,
    scanner,
    dependencies: Object.freeze({
      database,
      environment,
      objectStore,
      scanner,
    }),
    async dispose() {
      await database.$disconnect().catch(() => undefined);
      await migrated.dispose();
      await rm(root, { recursive: true, force: true });
    },
  });
}

export async function seedVaultCandidate(
  harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>,
  input: Readonly<{
    userId?: string;
    profileId?: string;
    email?: string;
  }> = {},
) {
  const userId = input.userId ?? randomUUID();
  const profileId = input.profileId ?? randomUUID();
  const email =
    input.email ?? `candidate-${userId.slice(0, 8)}@phase21.example.test`;
  const now = new Date();
  await harness.database.user.create({
    data: {
      id: userId,
      email,
      emailNormalized: email.toLowerCase(),
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: now,
      identityAssurance: "VERIFIED_EMAIL",
      updatedAt: now,
    },
  });
  await harness.database.candidateProfile.create({
    data: {
      id: profileId,
      userId,
      firstName: "Phase",
      lastName: "Twentyone",
      createdAt: now,
      updatedAt: now,
    },
  });
  return Object.freeze({ userId, profileId, email });
}

export async function uploadCleanCandidateCv(
  harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>,
  candidate: Awaited<ReturnType<typeof seedVaultCandidate>>,
  input: Readonly<{
    bytes?: Buffer;
    filename?: string;
    idempotencyKey?: string;
  }> = {},
) {
  const bytes =
    input.bytes ?? Buffer.from("%PDF-1.4\nphase21-clean\n%%EOF", "utf8");
  const filename = input.filename ?? "phase21-cv.pdf";
  const intent = await createDocumentUploadIntent(
    {
      actorUserId: candidate.userId,
      filename,
      declaredMimeType: "application/pdf",
      expectedSizeBytes: bytes.length,
      idempotencyKey: input.idempotencyKey ?? `upload-${randomUUID()}`,
      correlationId: randomUUID(),
    },
    harness.dependencies,
  );
  if (!intent.ok) {
    throw new Error(`Intent failed: ${intent.code}`);
  }
  const uploaded = await uploadDocumentIntentBody(
    {
      actorUserId: candidate.userId,
      intentId: intent.intentId,
      body: chunks(bytes, 5),
      declaredContentLength: bytes.length,
      correlationId: randomUUID(),
    },
    harness.dependencies,
  );
  if (!uploaded.ok) {
    throw new Error(`Upload failed: ${uploaded.code}`);
  }
  const finalized = await finalizeDocumentUploadIntent(
    { actorUserId: candidate.userId, intentId: intent.intentId },
    harness.dependencies,
  );
  if (!finalized.ok) {
    throw new Error(`Finalize failed: ${finalized.code}`);
  }
  const scanned = await scanDocumentVersion(
    {
      actorUserId: candidate.userId,
      documentVersionId: intent.documentVersionId,
      correlationId: randomUUID(),
    },
    harness.dependencies,
  );
  if (!scanned.ok || scanned.status !== "CLEAN") {
    throw new Error(
      `Scan failed: ${scanned.ok ? scanned.status : scanned.code}`,
    );
  }
  const metadata =
    await harness.database.candidateDocumentMetadata.findUniqueOrThrow({
      where: { documentVersionId: intent.documentVersionId },
      select: {
        id: true,
        storageKey: true,
        safeFilename: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
  return Object.freeze({
    intentId: intent.intentId,
    documentVersionId: intent.documentVersionId,
    metadataId: metadata.id,
    storageKeyHash: createHash("sha256")
      .update(metadata.storageKey)
      .digest("hex"),
    safeFilename: metadata.safeFilename,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    bytes,
  });
}

export async function seedVaultApplication(
  harness: Awaited<ReturnType<typeof createDocumentVaultHarness>>,
  input: Readonly<{
    candidate: Awaited<ReturnType<typeof seedVaultCandidate>>;
    document: Awaited<ReturnType<typeof uploadCleanCandidateCv>>;
    employerRole?: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
    assignment?: boolean;
  }>,
) {
  const now = new Date();
  const employerUserId = randomUUID();
  const employerEmail = `employer-${employerUserId.slice(0, 8)}@phase21.example.test`;
  await harness.database.user.create({
    data: {
      id: employerUserId,
      email: employerEmail,
      emailNormalized: employerEmail,
      role: input.employerRole === "RECRUITER" ? "RECRUITER" : "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: now,
      identityAssurance: "VERIFIED_EMAIL",
      updatedAt: now,
    },
  });
  const company = await harness.database.company.create({
    data: {
      name: "Phase 21 Employer",
      slug: `phase21-employer-${randomUUID().slice(0, 8)}`,
      industry: "Technology",
      size: "11-50",
      about: "Isolated Phase 21 authorization fixture.",
      website: "https://phase21.example.test",
      status: "DRAFT",
      dataProvenance: "TEST",
      updatedAt: now,
    },
    select: { id: true },
  });
  const canton = await harness.database.canton.create({
    data: {
      code: randomCantonCode(),
      name: `Phase 21 Canton ${randomUUID().slice(0, 6)}`,
      slug: `phase21-canton-${randomUUID().slice(0, 8)}`,
      language: "DE",
      updatedAt: now,
    },
    select: { id: true },
  });
  const city = await harness.database.city.create({
    data: {
      cantonId: canton.id,
      name: "Phase 21 City",
      slug: `phase21-city-${randomUUID().slice(0, 8)}`,
      updatedAt: now,
    },
    select: { id: true },
  });
  await harness.database.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: canton.id,
      cityId: city.id,
      isPrimary: true,
      createdAt: now,
    },
  });
  await harness.database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE", updatedAt: now },
  });
  const membership = await harness.database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: employerUserId,
      role: input.employerRole ?? "OWNER",
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  const category = await harness.database.category.create({
    data: {
      name: `Phase 21 ${randomUUID().slice(0, 8)}`,
      slug: `phase21-category-${randomUUID().slice(0, 8)}`,
      updatedAt: now,
    },
    select: { id: true },
  });
  const job = await harness.database.job.create({
    data: {
      companyId: company.id,
      slug: `phase21-job-${randomUUID().slice(0, 8)}`,
      status: "DRAFT",
      dataProvenance: "TEST",
      createdByUserId: employerUserId,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  const revision = await harness.database.jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: "Phase 21 Test Job",
      description: "Document vault authorization fixture.",
      tasks: ["Test"],
      requirements: ["Test"],
      applicationProcessSteps: ["Apply"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      categoryId: category.id,
      cantonId: canton.id,
      cityId: city.id,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      responseTargetDays: 7,
      applicationEffort: "MEDIUM",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@phase21.example.test",
      authoredByUserId: employerUserId,
      contentChecksum: randomUUID().replaceAll("-", ""),
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  await harness.database.job.update({
    where: { id: job.id },
    data: {
      currentRevisionId: revision.id,
      updatedAt: now,
    },
  });
  if (input.assignment) {
    await harness.database.jobAssignment.create({
      data: {
        membershipId: membership.id,
        companyId: company.id,
        jobId: job.id,
        userId: employerUserId,
        role: "PIPELINE",
        status: "ACTIVE",
        assignedByUserId: employerUserId,
        validFrom: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  const application = await harness.database.application.create({
    data: {
      jobId: job.id,
      submittedJobRevisionId: revision.id,
      candidateProfileId: input.candidate.profileId,
      idempotencyKey: `application-${randomUUID()}`,
      submissionPayloadHash: "a".repeat(64),
      status: "SUBMITTED",
      submittedAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  await harness.database.applicationSubmissionDocument.create({
    data: {
      applicationId: application.id,
      candidateProfileId: input.candidate.profileId,
      documentMetadataId: input.document.metadataId,
      documentVersionId: input.document.documentVersionId,
      safeFilenameSnapshot: input.document.safeFilename,
      mimeTypeSnapshot: input.document.mimeType,
      sizeBytesSnapshot: input.document.sizeBytes,
      storageKeyHash: input.document.storageKeyHash,
      createdAt: now,
    },
  });
  return Object.freeze({
    employerUserId,
    companyId: company.id,
    membershipId: membership.id,
    jobId: job.id,
    revisionId: revision.id,
    applicationId: application.id,
  });
}

export async function* chunks(bytes: Buffer, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
  }
}

function randomCantonCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const seed = randomUUID().replaceAll("-", "");
  return `${alphabet[Number.parseInt(seed[0]!, 16)]}${alphabet[Number.parseInt(seed[1]!, 16)]}`;
}
