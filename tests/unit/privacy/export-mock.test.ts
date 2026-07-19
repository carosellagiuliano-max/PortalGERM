// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildExportManifestForCase,
  checksumManifest,
  PRIVACY_EXPORT_MANIFEST_POLICY_V1,
  type PrivacyExportActor,
  type PrivacyExportCaseTransaction,
  type PrivacyExportManifest,
} from "@/lib/privacy/export-mock";

const requestId = "11111111-1111-4111-8111-111111111111";
const requesterUserId = "22222222-2222-4222-8222-222222222222";
const adminId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-19T10:00:00.000Z");
const actor: PrivacyExportActor = {
  userId: adminId,
  capabilities: ["PRIVACY_CASE_PROCESS"],
};

function exportCase(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    requesterUserId,
    type: "EXPORT",
    status: "IN_PROGRESS",
    verifiedAt: new Date(now.getTime() - 1_000),
    version: 7,
    categoryCounts: {
      account: 1,
      candidateProfile: 1,
      consentHistory: 4,
      applications: 12,
      radar: 3,
    },
    ...overrides,
  };
}

function transaction(overrides: Partial<PrivacyExportCaseTransaction> = {}) {
  return {
    loadAuthorizedExportCase: vi.fn(async () => exportCase()),
    loadExistingManifest: vi.fn(async () => null),
    saveManifestAndComplete: vi.fn(async () => undefined),
    ...overrides,
  } satisfies PrivacyExportCaseTransaction;
}

describe("privacy export manifest Mock", () => {
  it("creates only allowlisted category counts and atomically completes a verified case", async () => {
    const tx = transaction();
    const result = await buildExportManifestForCase(tx, requestId, actor, now);
    expect(result.manifest).toEqual({
      schemaVersion: "v1",
      requestId,
      categories: {
        account: 1,
        candidateProfile: 1,
        consentHistory: 4,
        applications: 12,
        radar: 3,
      },
      generatedAt: now.toISOString(),
    });
    expect(result.checksum).toBe(
      createHash("sha256").update(JSON.stringify(result.manifest), "utf8").digest("hex"),
    );
    expect(result.expiresAt.toISOString()).toBe("2026-07-26T10:00:00.000Z");
    expect(tx.loadAuthorizedExportCase).toHaveBeenCalledWith(requestId, adminId);
    expect(tx.saveManifestAndComplete).toHaveBeenCalledWith({
      privacyRequestId: requestId,
      requesterUserId,
      expectedVersion: 7,
      manifest: result.manifest,
      checksum: result.checksum,
      expiresAt: result.expiresAt,
      events: ["MANIFEST_CREATED", "COMPLETED"],
      auditActions: ["PRIVACY_EXPORT_MANIFEST_CREATED", "PRIVACY_REQUEST_STATUS_CHANGED"],
    });
    expect(PRIVACY_EXPORT_MANIFEST_POLICY_V1.containsProviderBytes).toBe(false);
  });

  it("returns a valid stored manifest idempotently without a second write", async () => {
    const manifest: PrivacyExportManifest = {
      schemaVersion: "v1",
      requestId,
      categories: { account: 1, candidateProfile: 0, consentHistory: 2, applications: 0, radar: 0 },
      generatedAt: now.toISOString(),
    };
    const existing = {
      manifest,
      checksum: checksumManifest(manifest),
      expiresAt: new Date("2026-07-26T10:00:00.000Z"),
    };
    const tx = transaction({
      loadAuthorizedExportCase: vi.fn(async () => exportCase({ status: "COMPLETED" })),
      loadExistingManifest: vi.fn(async () => existing),
    });
    expect(await buildExportManifestForCase(tx, requestId, actor, now)).toEqual(existing);
    expect(tx.saveManifestAndComplete).not.toHaveBeenCalled();
  });

  it("does not expose raw rows, provider bytes, callback destinations or private notes", async () => {
    const tx = transaction();
    const result = await buildExportManifestForCase(tx, requestId, actor, now);
    const serialized = JSON.stringify(result);
    for (const canary of [
      "PII_EMAIL_CANARY@example.invalid",
      "PRIVATE_EMPLOYER_NOTE_CANARY",
      "RAW_CV_BYTES_CANARY",
      "https://provider.invalid/callback",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    expect(Object.keys(result.manifest.categories)).toEqual([
      "account",
      "candidateProfile",
      "consentHistory",
      "applications",
      "radar",
    ]);
  });

  it("uses one indistinguishable denial for unauthorized or malformed cases", async () => {
    const invalidCases = [
      exportCase({ type: "DELETE" }),
      exportCase({ status: "PENDING" }),
      exportCase({ requestId: otherId }),
      exportCase({ verifiedAt: new Date(now.getTime() + 1) }),
      exportCase({ categoryCounts: { account: -1, candidateProfile: 0, consentHistory: 0, applications: 0, radar: 0 } }),
      exportCase({ privateEmployerNotes: ["PRIVATE_EMPLOYER_NOTE_CANARY"] }),
      exportCase({ rawData: { email: "PII_EMAIL_CANARY@example.invalid" } }),
    ];
    for (const invalid of invalidCases) {
      await expect(buildExportManifestForCase(
        transaction({ loadAuthorizedExportCase: vi.fn(async () => invalid) }),
        requestId,
        actor,
        now,
      )).rejects.toThrow("Privacy export case is unavailable.");
    }
    await expect(buildExportManifestForCase(
      transaction({ loadAuthorizedExportCase: vi.fn(async () => null) }),
      requestId,
      actor,
      now,
    )).rejects.toThrow("Privacy export case is unavailable.");
    await expect(buildExportManifestForCase(
      transaction(),
      requestId,
      { ...actor, capabilities: [] },
      now,
    )).rejects.toThrow("Privacy export case is unavailable.");
  });

  it("rejects missing or tampered stored manifests", async () => {
    const completed = transaction({
      loadAuthorizedExportCase: vi.fn(async () => exportCase({ status: "COMPLETED" })),
      loadExistingManifest: vi.fn(async () => null),
    });
    await expect(buildExportManifestForCase(completed, requestId, actor, now)).rejects.toThrow(
      "Privacy export case is unavailable.",
    );

    const manifest: PrivacyExportManifest = {
      schemaVersion: "v1",
      requestId,
      categories: { account: 1, candidateProfile: 0, consentHistory: 0, applications: 0, radar: 0 },
      generatedAt: now.toISOString(),
    };
    const tampered = transaction({
      loadAuthorizedExportCase: vi.fn(async () => exportCase({ status: "COMPLETED" })),
      loadExistingManifest: vi.fn(async () => ({
        manifest,
        checksum: "0".repeat(64),
        expiresAt: new Date("2026-07-26T10:00:00.000Z"),
      })),
    });
    await expect(buildExportManifestForCase(tampered, requestId, actor, now)).rejects.toThrow(
      "Privacy export case is unavailable.",
    );
  });
});
