import { describe, expect, it } from "vitest";

import {
  DOCUMENT_UPLOAD_POLICY_V1,
  normalizeCandidateFilename,
  validateDocumentUploadMetadata,
} from "@/lib/documents/document-upload-policy";

describe("Phase 21 document upload policy", () => {
  it.each([
    ["lebenslauf.pdf", "application/pdf"],
    ["portrait.png", "image/png"],
    ["profil.jpeg", "image/jpeg"],
    ["profil.jpg", "image/jpeg"],
    ["portfolio.webp", "image/webp"],
  ])("accepts the closed filename/MIME pair %s", (filename, mime) => {
    expect(
      validateDocumentUploadMetadata({
        filename,
        declaredMimeType: mime,
        expectedSizeBytes: DOCUMENT_UPLOAD_POLICY_V1.maximumBytes,
        expectedSha256: "a".repeat(64),
      }),
    ).toMatchObject({
      ok: true,
      safeFilename: filename,
      declaredMimeType: mime,
      expectedSizeBytes: DOCUMENT_UPLOAD_POLICY_V1.maximumBytes,
    });
  });

  it.each([
    [0, "EMPTY_FILE"],
    [-1, "EMPTY_FILE"],
    [5 * 1024 * 1024 + 1, "FILE_TOO_LARGE"],
    [1.5, "INVALID_SIZE"],
    [Number.NaN, "INVALID_SIZE"],
  ])("rejects byte size %s as %s", (expectedSizeBytes, code) => {
    expect(
      validateDocumentUploadMetadata({
        filename: "cv.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes,
      }),
    ).toEqual({ ok: false, code });
  });

  it.each([
    "../cv.pdf",
    "..\\cv.pdf",
    "folder/cv.pdf",
    "cv\u202eexe.pdf",
    "cv\u0000.pdf",
    "  ",
  ])("rejects unsafe or ambiguous filename %j", (filename) => {
    expect(normalizeCandidateFilename(filename)).toBeNull();
  });

  it("normalizes Unicode without accepting an extension/MIME mismatch", () => {
    expect(normalizeCandidateFilename("  Résumé.pdf  ")).toBe("Résumé.pdf");
    expect(
      validateDocumentUploadMetadata({
        filename: "cv.png",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: 1,
      }),
    ).toEqual({ ok: false, code: "MIME_EXTENSION_MISMATCH" });
  });

  it("rejects open MIME types and non-canonical hashes", () => {
    expect(
      validateDocumentUploadMetadata({
        filename: "cv.svg",
        declaredMimeType: "image/svg+xml",
        expectedSizeBytes: 10,
      }),
    ).toEqual({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
    expect(
      validateDocumentUploadMetadata({
        filename: "cv.pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: 10,
        expectedSha256: "ABC",
      }),
    ).toEqual({ ok: false, code: "INVALID_HASH" });
  });

  it("freezes the stream, intent, grant and concurrency limits", () => {
    expect(DOCUMENT_UPLOAD_POLICY_V1).toEqual({
      maximumBytes: 5_242_880,
      maximumChunkBytes: 1_048_576,
      maximumConcurrentUploadsPerActor: 3,
      intentTtlMilliseconds: 600_000,
      uploadStreamTimeoutMilliseconds: 120_000,
      readGrantTtlMilliseconds: 60_000,
      scannerTimeoutMilliseconds: 120_000,
      reconcilerBatchSize: 100,
    });
  });
});
