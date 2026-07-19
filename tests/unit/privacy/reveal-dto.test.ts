// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  authorizeAndRecheckRevealConfirmation,
  buildRevealPreview,
  canReadRevealSnapshot,
  decryptAuthorizedRevealSnapshot,
  decryptRevealValue,
  encryptRevealValues,
  REVEAL_SNAPSHOT_POLICY_V1,
  validateRevealConfirmation,
  type EncryptedRevealField,
  type RevealKey,
  type RevealConfirmationAuthorization,
  type RevealReadScope,
  type RevealSnapshotBinding,
  type RevealValue,
} from "@/lib/privacy/reveal-dto";

const requestId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const grantId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";
const companyId = "55555555-5555-4555-8555-555555555555";
const otherId = "66666666-6666-4666-8666-666666666666";
const now = new Date("2026-07-19T10:00:00.000Z");
const oldKey: RevealKey = { version: "pii-2026-01", secret: Buffer.alloc(32, 1).toString("base64") };
const newKey: RevealKey = { version: "pii-2026-07", secret: Buffer.alloc(32, 2).toString("base64") };
const confirmationKey: RevealKey = { version: "confirm-2026-07", secret: Buffer.alloc(32, 9).toString("base64") };
const binding: RevealSnapshotBinding = {
  grantId,
  candidateProfileId: profileId,
  companyId,
  contactRequestId: requestId,
};
const values: readonly RevealValue[] = [
  { field: "DISPLAY_NAME", value: "Ada Lovelace" },
  { field: "EMAIL", value: "ADA@EXAMPLE.CH" },
  { field: "PHONE", value: "+41791234567" },
  {
    field: "CV_METADATA",
    value: { fileName: "Ada-Lovelace.pdf", mimeType: "application/pdf", sizeBytes: 123_456 },
  },
];

function confirmation(fields = values.map(({ field }) => field)) {
  const preview = buildRevealPreview(
    values.filter(({ field }) => fields.includes(field)),
    { contactRequestId: requestId, conversationId, candidateProfileId: profileId, companyId },
    [confirmationKey],
    now,
  );
  return {
    preview,
    input: {
      contactRequestId: requestId,
      conversationId,
      fields,
      noticeVersion: "identity-reveal-v1",
      previewHmac: preview.evidence.previewHmac,
      idempotencyKey: "reveal-idempotency-1",
    },
  };
}

function authorization(
  overrides: Partial<RevealConfirmationAuthorization> = {},
): RevealConfirmationAuthorization {
  return {
    actorUserId: profileId,
    candidateOwnerUserId: profileId,
    candidateUserStatus: "ACTIVE",
    candidateProfileId: profileId,
    companyId,
    companyStatus: "ACTIVE",
    companyVerified: true,
    requestId,
    requestStatus: "ACCEPTED",
    requestCandidateProfileId: profileId,
    requestCompanyId: companyId,
    requestConversationId: conversationId,
    existingGrant: null,
    ...overrides,
  };
}

function readScope(overrides: Partial<RevealReadScope> = {}): RevealReadScope {
  return {
    requestId,
    requestStatus: "ACCEPTED",
    requestCompanyId: companyId,
    requestCandidateProfileId: profileId,
    requestConversationId: conversationId,
    grantRequestId: requestId,
    grantCompanyId: companyId,
    grantCandidateProfileId: profileId,
    grantConversationId: conversationId,
    viewerCompanyId: companyId,
    revokedAt: null,
    ...overrides,
  };
}

describe("Reveal confirmation and immutable snapshots", () => {
  it("accepts each closed field and the complete unique field set", () => {
    for (const field of values.map(({ field }) => field)) {
      expect(validateRevealConfirmation(confirmation([field]).input).fields).toEqual([field]);
    }
    expect(validateRevealConfirmation(confirmation().input).fields).toHaveLength(4);
  });

  it("rejects duplicate, unknown, unchecked, stale and free-string confirmation shapes", () => {
    const valid = confirmation().input;
    expect(() => validateRevealConfirmation({ ...valid, fields: ["EMAIL", "EMAIL"] })).toThrow();
    expect(() => validateRevealConfirmation({ ...valid, fields: ["EMAIL", "ADDRESS"] })).toThrow();
    expect(() => validateRevealConfirmation({ ...valid, fields: [] })).toThrow();
    expect(() => validateRevealConfirmation({ ...valid, fields: "EMAIL" })).toThrow();
    expect(() => validateRevealConfirmation({ ...valid, noticeVersion: "identity-reveal-v0" })).toThrow();
    expect(() => validateRevealConfirmation({ ...valid, selector: "candidate.*" })).toThrow();
    expect(() => validateRevealConfirmation({ ...valid, displayName: "PII_IN_FORM" })).toThrow();
  });

  it("rechecks the exact current values and detects a stale preview", () => {
    const { input, preview } = confirmation();
    const matched = authorizeAndRecheckRevealConfirmation(
      input,
      values,
      preview.evidence,
      [confirmationKey],
      authorization(),
      now,
    );
    expect(matched).toMatchObject({ ok: true });
    if (matched.ok) {
      expect(matched.values[1]).toEqual({ field: "EMAIL", value: "ada@example.ch" });
    }
    expect(authorizeAndRecheckRevealConfirmation(
      input,
      values.map((value) => value.field === "EMAIL"
        ? { field: "EMAIL" as const, value: "changed@example.ch" }
        : value),
      preview.evidence,
      [confirmationKey],
      authorization(),
      now,
    )).toEqual({ ok: false, code: "STALE_REVEAL_PREVIEW" });
  });

  it("fails closed for expired, consumed, scope-changed and missing-key previews", () => {
    const { input, preview } = confirmation();
    const expired = { ...preview.evidence, expiresAt: now };
    const consumed = { ...preview.evidence, usedAt: new Date(now) };
    expect(authorizeAndRecheckRevealConfirmation(input, values, expired, [confirmationKey], authorization(), now)).toEqual({
      ok: false, code: "INVALID_REVEAL_CONFIRMATION",
    });
    expect(authorizeAndRecheckRevealConfirmation(input, values, consumed, [confirmationKey], authorization(), now)).toEqual({
      ok: false, code: "INVALID_REVEAL_CONFIRMATION",
    });
    expect(authorizeAndRecheckRevealConfirmation({ ...input, contactRequestId: otherId }, values, preview.evidence, [confirmationKey], authorization(), now)).toMatchObject({ ok: false });
    expect(authorizeAndRecheckRevealConfirmation(input, values, preview.evidence, [newKey], authorization(), now)).toMatchObject({ ok: false });
  });

  it("requires the active Candidate owner and an exact accepted ContactRequest scope", () => {
    const { input, preview } = confirmation();
    const invalidAuthorizations: RevealConfirmationAuthorization[] = [
      authorization({ actorUserId: otherId }),
      authorization({ candidateUserStatus: "SUSPENDED" }),
      authorization({ companyStatus: "SUSPENDED" }),
      authorization({ companyVerified: false }),
      authorization({ requestStatus: "PENDING" }),
      authorization({ requestId: otherId }),
      authorization({ requestCandidateProfileId: otherId }),
      authorization({ requestCompanyId: otherId }),
      authorization({ requestConversationId: otherId }),
      authorization({
        existingGrant: {
          contactRequestId: requestId,
          candidateProfileId: profileId,
          companyId,
          conversationId,
          revokedAt: now,
        },
      }),
      authorization({
        existingGrant: {
          contactRequestId: otherId,
          candidateProfileId: profileId,
          companyId,
          conversationId,
          revokedAt: null,
        },
      }),
    ];
    for (const invalid of invalidAuthorizations) {
      expect(authorizeAndRecheckRevealConfirmation(
        input,
        values,
        preview.evidence,
        [confirmationKey],
        invalid,
        now,
      )).toEqual({ ok: false, code: "INVALID_REVEAL_CONFIRMATION" });
    }

    expect(authorizeAndRecheckRevealConfirmation(
      input,
      values,
      preview.evidence,
      [confirmationKey],
      authorization({
        existingGrant: {
          contactRequestId: requestId,
          candidateProfileId: profileId,
          companyId,
          conversationId,
          revokedAt: null,
        },
      }),
      now,
    )).toMatchObject({ ok: true });
  });

  it("encrypts every exact codec with AES-256-GCM and no plaintext", () => {
    const encrypted = encryptRevealValues(values, [newKey, oldKey], binding);
    expect(encrypted).toHaveLength(4);
    for (const item of encrypted) {
      expect(item.encryptionKeyVersion).toBe(newKey.version);
      expect(item.schemaVersion).toBe("v1");
      expect(item.nonce).toHaveLength(REVEAL_SNAPSHOT_POLICY_V1.nonceBytes);
      expect(item.authTag).toHaveLength(REVEAL_SNAPSHOT_POLICY_V1.authTagBytes);
      expect(item.integrityHmac).toMatch(/^[a-f0-9]{64}$/);
    }
    const serialized = JSON.stringify(encrypted.map((item) => ({
      ...item,
      ciphertext: Buffer.from(item.ciphertext).toString("base64"),
    })));
    for (const canary of ["Ada Lovelace", "ADA@EXAMPLE.CH", "+41791234567", "Ada-Lovelace.pdf"]) {
      expect(serialized).not.toContain(canary);
    }
    expect(encrypted.map((item) => decryptRevealValue(item, [newKey, oldKey], binding))).toEqual([
      { field: "DISPLAY_NAME", value: "Ada Lovelace" },
      { field: "EMAIL", value: "ada@example.ch" },
      { field: "PHONE", value: "+41791234567" },
      { field: "CV_METADATA", value: { fileName: "Ada-Lovelace.pdf", mimeType: "application/pdf", sizeBytes: 123_456 } },
    ]);
  });

  it("round-trips every non-empty combination of the four closed fields", () => {
    for (let mask = 1; mask < 2 ** values.length; mask += 1) {
      const selected = values.filter((_, index) => (mask & (1 << index)) !== 0);
      const encrypted = encryptRevealValues(selected, [newKey], binding);
      expect(encrypted.map((item) => decryptRevealValue(item, [newKey], binding))).toEqual(
        selected.map((item) => item.field === "EMAIL"
          ? { ...item, value: item.value.toLowerCase() }
          : item),
      );
    }
  });

  it("retains controlled old-key reads after rotation", () => {
    const encrypted = encryptRevealValues([values[0]!], [oldKey], binding)[0]!;
    expect(decryptRevealValue(encrypted, [newKey, oldKey], binding)).toEqual(values[0]);
    expect(() => decryptRevealValue(encrypted, [newKey], binding)).toThrow("Reveal snapshot is unavailable.");
  });

  it("binds ciphertext to grant, candidate, company, request, field and schema", () => {
    const encrypted = encryptRevealValues([values[0]!], [newKey], binding)[0]!;
    for (const changedBinding of [
      { ...binding, grantId: otherId },
      { ...binding, candidateProfileId: otherId },
      { ...binding, companyId: otherId },
      { ...binding, contactRequestId: otherId },
    ]) {
      expect(() => decryptRevealValue(encrypted, [newKey], changedBinding)).toThrow("Reveal snapshot is unavailable.");
    }
    expect(() => decryptRevealValue({ ...encrypted, field: "EMAIL" }, [newKey], binding)).toThrow("Reveal snapshot is unavailable.");
    expect(() => decryptRevealValue({ ...encrypted, schemaVersion: "v2" as "v1" }, [newKey], binding)).toThrow("Reveal snapshot is unavailable.");
  });

  it.each(["ciphertext", "nonce", "authTag", "integrityHmac"] as const)(
    "gives one generic failure for %s tampering",
    (property) => {
      const original = encryptRevealValues([values[0]!], [newKey], binding)[0]!;
      const mutated: EncryptedRevealField = {
        ...original,
        ciphertext: Uint8Array.from(original.ciphertext),
        nonce: Uint8Array.from(original.nonce),
        authTag: Uint8Array.from(original.authTag),
      };
      if (property === "integrityHmac") {
        (mutated as { integrityHmac: string }).integrityHmac = "0".repeat(64);
      } else {
        const bytes = mutated[property] as Uint8Array;
        bytes[0] = (bytes[0] ?? 0) ^ 1;
      }
      expect(() => decryptRevealValue(mutated, [newKey], binding)).toThrow("Reveal snapshot is unavailable.");
    },
  );

  it("rejects invalid key material, duplicate fields and unsafe CV metadata", () => {
    expect(() => encryptRevealValues([], [newKey], binding)).toThrow();
    expect(() => encryptRevealValues([values[0]!, values[0]!], [newKey], binding)).toThrow(/unique/i);
    expect(() => encryptRevealValues([values[0]!], [{ version: "bad version", secret: newKey.secret }], binding)).toThrow(/version/i);
    expect(() => encryptRevealValues([values[0]!], [{ version: "v1", secret: Buffer.alloc(31).toString("base64") }], binding)).toThrow(/32 bytes/i);
    expect(() => encryptRevealValues([values[0]!], [{ version: "v1", secret: Buffer.alloc(32, 1).toString("base64url") }], binding)).toThrow(/canonical/i);
    const cv = (value: unknown) => ({ field: "CV_METADATA", value } as RevealValue);
    expect(() => encryptRevealValues([cv({ fileName: "../secret.pdf", mimeType: "application/pdf", sizeBytes: 1 })], [newKey], binding)).toThrow();
    expect(() => encryptRevealValues([cv({ fileName: "safe.pdf", mimeType: "text/html", sizeBytes: 1 })], [newKey], binding)).toThrow();
    expect(() => encryptRevealValues([cv({ fileName: "safe.pdf", mimeType: "application/pdf", sizeBytes: 5 * 1024 * 1024 + 1 })], [newKey], binding)).toThrow();
    expect(() => encryptRevealValues([cv({ fileName: "safe.pdf", mimeType: "application/pdf", sizeBytes: 1, documentId: otherId })], [newKey], binding)).toThrow();
  });

  it("snapshots values immutably instead of rereading later edits", () => {
    const mutable = { field: "DISPLAY_NAME" as const, value: "Original Name" };
    const encrypted = encryptRevealValues([mutable], [newKey], binding)[0]!;
    mutable.value = "Later Edited Name";
    expect(decryptRevealValue(encrypted, [newKey], binding)).toEqual({
      field: "DISPLAY_NAME",
      value: "Original Name",
    });
  });

  it("requires an accepted, exact, unrevoked read scope on every read", () => {
    expect(canReadRevealSnapshot(readScope())).toBe(true);
    const mismatches: Partial<RevealReadScope>[] = [
      { requestStatus: "PENDING" },
      { revokedAt: now },
      { grantRequestId: otherId },
      { grantCompanyId: otherId },
      { grantCandidateProfileId: otherId },
      { grantConversationId: otherId },
      { viewerCompanyId: otherId },
    ];
    for (const mismatch of mismatches) expect(canReadRevealSnapshot(readScope(mismatch))).toBe(false);

    const encrypted = encryptRevealValues([values[0]!], [newKey], binding)[0]!;
    expect(decryptAuthorizedRevealSnapshot(encrypted, [newKey], binding, readScope())).toEqual(values[0]);
    for (const mismatch of mismatches) {
      expect(() => decryptAuthorizedRevealSnapshot(encrypted, [newKey], binding, readScope(mismatch))).toThrow("Reveal snapshot is unavailable.");
    }
  });
});
