import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { attachCompanyVerificationDocument } from "@/lib/companies/verification/owner-service";
import { parseEnvironment } from "@/lib/config/env-schema";
import {
  consumeDocumentReadGrant,
  createCompanyVerificationDocumentUploadIntent,
  finalizeDocumentUploadIntent,
  issueCompanyVerificationDocumentReadGrant,
  scanDocumentVersion,
  uploadDocumentIntentBody,
  type VaultDependencies,
} from "@/lib/documents/vault-service";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";
import { activateSandboxDocumentProviders } from "@/tests/fixtures/document-vault";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;
let root: string | undefined;
let vault: VaultDependencies | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("document");
  root = await mkdtemp(resolve(tmpdir(), "sth-phase26-document-"));
  const environment = parseEnvironment(
    createValidEnvironment({
      DATABASE_URL: fixture.migrated.connectionString,
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
      COMPANY_VERIFICATION_DOCUMENT: "true",
      WORKER_RUNTIME: "sandbox_command",
    }),
  );
  await activateSandboxDocumentProviders(
    fixture.database,
    environment,
    fixture.now,
  );
  vault = Object.freeze({
    database: fixture.database,
    environment,
    objectStore: createDocumentObjectStore(environment),
    scanner: createDocumentMalwareScanner(environment),
    now: fixture.now,
  });
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
  root = undefined;
  vault = undefined;
});

describe.sequential("Phase 26 verification document vault", () => {
  it("allows only the owner upload and assigned reviewer to read one CLEAN current purpose-bound object", async () => {
    const current = fixture!;
    const dependencies = vault!;
    const request = await current.createPendingRequest({
      assignedReviewerUserId: current.reviewer.userId,
    });
    const bytes = Buffer.from(
      "%PDF-1.4\nphase26-company-verification-clean\n%%EOF",
      "utf8",
    );
    const intent = await createCompanyVerificationDocumentUploadIntent(
      {
        actorUserId: current.owner.userId,
        companyId: current.companyId,
        membershipId: current.ownerMembershipId,
        filename: "handelsregister-auszug.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: bytes.length,
        idempotencyKey: `phase26-upload-${randomUUID()}`,
        correlationId: randomUUID(),
      },
      dependencies,
    );
    expect(intent).toMatchObject({ ok: true, duplicate: false });
    if (!intent.ok) throw new Error(intent.code);
    expect(
      await createCompanyVerificationDocumentUploadIntent(
        {
          actorUserId: current.foreignOwner.userId,
          companyId: current.companyId,
          membershipId: current.foreignMembershipId,
          filename: "fremd.pdf",
          declaredMimeType: "application/pdf",
          expectedSizeBytes: bytes.length,
          idempotencyKey: `phase26-foreign-${randomUUID()}`,
          correlationId: randomUUID(),
        },
        dependencies,
      ),
    ).toEqual({ ok: false, code: "NOT_AUTHORIZED" });

    const uploaded = await uploadDocumentIntentBody(
      {
        actorUserId: current.owner.userId,
        intentId: intent.intentId,
        body: chunks(bytes),
        declaredContentLength: bytes.length,
        correlationId: randomUUID(),
      },
      dependencies,
    );
    if (!uploaded.ok) {
      throw new Error(
        `Company document upload failed: ${uploaded.code}:${uploaded.detailCode ?? "none"}`,
      );
    }
    expect(uploaded).toMatchObject({ ok: true, status: "QUARANTINED" });
    expect(
      await finalizeDocumentUploadIntent(
        { actorUserId: current.owner.userId, intentId: intent.intentId },
        dependencies,
      ),
    ).toMatchObject({ ok: true, documentVersionId: intent.documentVersionId });
    expect(
      await scanDocumentVersion(
        {
          actorUserId: current.owner.userId,
          documentVersionId: intent.documentVersionId,
          correlationId: randomUUID(),
        },
        dependencies,
      ),
    ).toMatchObject({ ok: true, status: "CLEAN" });

    const attached = await attachCompanyVerificationDocument(
      {
        companyId: current.companyId,
        membershipId: current.ownerMembershipId,
        verificationRequestId: request.id,
        documentVersionId: intent.documentVersionId,
        idempotencyKey: randomUUID(),
      },
      current.ownerDependencies(),
    );
    expect(attached).toMatchObject({
      ok: true,
      value: { status: "VALID" },
    });

    const grant = await issueCompanyVerificationDocumentReadGrant(
      {
        actorUserId: current.reviewer.userId,
        companyId: current.companyId,
        verificationRequestId: request.id,
        documentVersionId: intent.documentVersionId,
        correlationId: randomUUID(),
      },
      dependencies,
    );
    expect(grant).toMatchObject({ ok: true });
    if (!grant.ok) throw new Error(grant.code);
    const consumed = await consumeDocumentReadGrant(
      {
        actorUserId: current.reviewer.userId,
        token: grant.token,
        correlationId: randomUUID(),
      },
      dependencies,
    );
    expect(consumed).toMatchObject({
      ok: true,
      safeFilename: "handelsregister-auszug.pdf",
      mimeType: "application/pdf",
    });
    if (!consumed.ok) throw new Error(consumed.code);
    expect(await collect(consumed.body)).toEqual(bytes);
    await expect(
      consumeDocumentReadGrant(
        {
          actorUserId: current.reviewer.userId,
          token: grant.token,
          correlationId: randomUUID(),
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    await expect(
      issueCompanyVerificationDocumentReadGrant(
        {
          actorUserId: current.reviewer.userId,
          companyId: current.foreignCompanyId,
          verificationRequestId: request.id,
          documentVersionId: intent.documentVersionId,
          correlationId: randomUUID(),
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });

    await current.database.documentVersion.update({
      where: { id: intent.documentVersionId },
      data: { status: "REPLACED", replacedAt: current.now },
    });
    await expect(
      issueCompanyVerificationDocumentReadGrant(
        {
          actorUserId: current.reviewer.userId,
          companyId: current.companyId,
          verificationRequestId: request.id,
          documentVersionId: intent.documentVersionId,
          correlationId: randomUUID(),
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

async function* chunks(bytes: Buffer) {
  for (let offset = 0; offset < bytes.length; offset += 7) {
    yield bytes.subarray(offset, Math.min(bytes.length, offset + 7));
  }
}

async function collect(body: AsyncIterable<Uint8Array>) {
  const values: Buffer[] = [];
  for await (const value of body) values.push(Buffer.from(value));
  return Buffer.concat(values);
}
