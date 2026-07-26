export const DOCUMENT_UPLOAD_POLICY_V1 = Object.freeze({
  maximumBytes: 5 * 1024 * 1024,
  maximumChunkBytes: 1024 * 1024,
  maximumConcurrentUploadsPerActor: 3,
  intentTtlMilliseconds: 10 * 60 * 1_000,
  uploadStreamTimeoutMilliseconds: 120 * 1_000,
  readGrantTtlMilliseconds: 60 * 1_000,
  scannerTimeoutMilliseconds: 120 * 1_000,
  reconcilerBatchSize: 100,
});

export const DOCUMENT_MIME_EXTENSION_MATRIX_V1 = Object.freeze({
  "application/pdf": Object.freeze(["pdf"]),
  "image/png": Object.freeze(["png"]),
  "image/jpeg": Object.freeze(["jpg", "jpeg"]),
  "image/webp": Object.freeze(["webp"]),
} as const);

export type AllowedDocumentMimeType =
  keyof typeof DOCUMENT_MIME_EXTENSION_MATRIX_V1;

export type DocumentUploadPolicyDecision =
  | Readonly<{
      ok: true;
      safeFilename: string;
      declaredMimeType: AllowedDocumentMimeType;
      expectedSizeBytes: number;
      expectedSha256?: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "EMPTY_FILE"
        | "FILE_TOO_LARGE"
        | "INVALID_SIZE"
        | "UNSAFE_FILENAME"
        | "UNSUPPORTED_FILE_TYPE"
        | "MIME_EXTENSION_MISMATCH"
        | "INVALID_HASH";
    }>;

const UNSAFE_FILENAME_PATTERN =
  /[\/\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function validateDocumentUploadMetadata(
  input: Readonly<{
    filename: string;
    declaredMimeType: string;
    expectedSizeBytes: number;
    expectedSha256?: string;
  }>,
): DocumentUploadPolicyDecision {
  if (!Number.isSafeInteger(input.expectedSizeBytes)) {
    return failure("INVALID_SIZE");
  }
  if (input.expectedSizeBytes <= 0) {
    return failure("EMPTY_FILE");
  }
  if (input.expectedSizeBytes > DOCUMENT_UPLOAD_POLICY_V1.maximumBytes) {
    return failure("FILE_TOO_LARGE");
  }

  const safeFilename = normalizeCandidateFilename(input.filename);
  if (safeFilename === null) {
    return failure("UNSAFE_FILENAME");
  }
  if (!isAllowedDocumentMimeType(input.declaredMimeType)) {
    return failure("UNSUPPORTED_FILE_TYPE");
  }
  const extension = safeFilename.split(".").at(-1)?.toLowerCase() ?? "";
  if (
    !DOCUMENT_MIME_EXTENSION_MATRIX_V1[input.declaredMimeType].some(
      (allowed) => allowed === extension,
    )
  ) {
    return failure("MIME_EXTENSION_MISMATCH");
  }
  if (
    input.expectedSha256 !== undefined &&
    !SHA256_PATTERN.test(input.expectedSha256)
  ) {
    return failure("INVALID_HASH");
  }

  return Object.freeze({
    ok: true,
    safeFilename,
    declaredMimeType: input.declaredMimeType,
    expectedSizeBytes: input.expectedSizeBytes,
    ...(input.expectedSha256 === undefined
      ? {}
      : { expectedSha256: input.expectedSha256 }),
  });
}

export function normalizeCandidateFilename(value: string): string | null {
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length < 3 ||
    normalized.length > 255 ||
    normalized === "." ||
    normalized === ".." ||
    UNSAFE_FILENAME_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function isAllowedDocumentMimeType(
  value: string,
): value is AllowedDocumentMimeType {
  return Object.prototype.hasOwnProperty.call(
    DOCUMENT_MIME_EXTENSION_MATRIX_V1,
    value,
  );
}

function failure(
  code: Extract<DocumentUploadPolicyDecision, { ok: false }>["code"],
): Extract<DocumentUploadPolicyDecision, { ok: false }> {
  return Object.freeze({ ok: false, code });
}
