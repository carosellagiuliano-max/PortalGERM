import { DOCUMENT_UPLOAD_POLICY_V1 } from "@/lib/documents/document-upload-policy";

export type DetectedDocumentMimeType =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export type DocumentContentDecision =
  | Readonly<{ ok: true; detectedMimeType: DetectedDocumentMimeType }>
  | Readonly<{
      ok: false;
      code:
        | "EMPTY_FILE"
        | "FILE_TOO_LARGE"
        | "CHUNK_TOO_LARGE"
        | "UNKNOWN_MAGIC"
        | "MIME_MAGIC_MISMATCH"
        | "MALFORMED_FILE"
        | "POLYGLOT_OR_ACTIVE_CONTENT"
        | "MALWARE_SIGNATURE"
        | "SCANNER_TIMEOUT";
    }>;

const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const SUSPICIOUS_MARKERS = Object.freeze([
  new TextEncoder().encode("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
  new TextEncoder().encode("/JavaScript"),
  new TextEncoder().encode("/Launch"),
  new TextEncoder().encode("<script"),
  Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
  Uint8Array.of(0x4d, 0x5a),
]);
const TIMEOUT_MARKER = new TextEncoder().encode("STH_SCAN_TIMEOUT_FIXTURE");
const MARKER_CARRY_BYTES = 64;

export async function inspectDocumentContent(
  stream: AsyncIterable<Uint8Array>,
  input: Readonly<{
    declaredMimeType: string;
    timeoutMilliseconds?: number;
    now?: () => number;
  }>,
): Promise<DocumentContentDecision> {
  const startedAt = (input.now ?? Date.now)();
  const timeout =
    input.timeoutMilliseconds ??
    DOCUMENT_UPLOAD_POLICY_V1.scannerTimeoutMilliseconds;
  let total = 0;
  let prefix = new Uint8Array();
  let suffix = new Uint8Array();
  let carry = new Uint8Array();

  for await (const rawChunk of stream) {
    const chunk = copyChunk(rawChunk);
    if (chunk.byteLength > DOCUMENT_UPLOAD_POLICY_V1.maximumChunkBytes) {
      return failure("CHUNK_TOO_LARGE");
    }
    total += chunk.byteLength;
    if (total > DOCUMENT_UPLOAD_POLICY_V1.maximumBytes) {
      return failure("FILE_TOO_LARGE");
    }
    if ((input.now ?? Date.now)() - startedAt > timeout) {
      return failure("SCANNER_TIMEOUT");
    }
    if (prefix.byteLength < 32) {
      prefix = concatenate(prefix, chunk).slice(0, 32);
    }
    suffix = concatenate(suffix, chunk).slice(-32);
    const searchable = concatenate(carry, chunk);
    if (containsBytes(searchable, TIMEOUT_MARKER)) {
      return failure("SCANNER_TIMEOUT");
    }
    if (containsBytes(searchable, SUSPICIOUS_MARKERS[0]!)) {
      return failure("MALWARE_SIGNATURE");
    }
    if (SUSPICIOUS_MARKERS.slice(1).some((marker) => containsBytes(searchable, marker))) {
      return failure("POLYGLOT_OR_ACTIVE_CONTENT");
    }
    carry = searchable.slice(-MARKER_CARRY_BYTES);
  }

  if (total === 0) {
    return failure("EMPTY_FILE");
  }
  const detectedMimeType = detectMime(prefix);
  if (detectedMimeType === null) {
    return failure("UNKNOWN_MAGIC");
  }
  if (detectedMimeType !== input.declaredMimeType) {
    return failure("MIME_MAGIC_MISMATCH");
  }
  if (!hasValidTerminalBytes(detectedMimeType, suffix)) {
    return failure("MALFORMED_FILE");
  }
  return Object.freeze({ ok: true, detectedMimeType });
}

function detectMime(prefix: Uint8Array): DetectedDocumentMimeType | null {
  if (startsWith(prefix, new TextEncoder().encode("%PDF-"))) {
    return "application/pdf";
  }
  if (startsWith(prefix, PNG_MAGIC)) {
    return "image/png";
  }
  if (
    prefix[0] === 0xff &&
    prefix[1] === 0xd8 &&
    prefix[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    startsWith(prefix, new TextEncoder().encode("RIFF")) &&
    startsWith(prefix.slice(8), new TextEncoder().encode("WEBP"))
  ) {
    return "image/webp";
  }
  return null;
}

function hasValidTerminalBytes(
  mime: DetectedDocumentMimeType,
  suffix: Uint8Array,
): boolean {
  if (mime === "application/pdf") {
    return containsBytes(suffix, new TextEncoder().encode("%%EOF"));
  }
  if (mime === "image/png") {
    return containsBytes(
      suffix,
      Uint8Array.of(0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82),
    );
  }
  if (mime === "image/jpeg") {
    return suffix.at(-2) === 0xff && suffix.at(-1) === 0xd9;
  }
  return suffix.byteLength >= 12;
}

function startsWith(value: Uint8Array, expected: Uint8Array): boolean {
  if (value.byteLength < expected.byteLength) return false;
  return expected.every((byte, index) => value[index] === byte);
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || haystack.byteLength < needle.byteLength) {
    return false;
  }
  outer: for (
    let start = 0;
    start <= haystack.byteLength - needle.byteLength;
    start += 1
  ) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function copyChunk(chunk: Uint8Array): Uint8Array {
  return new Uint8Array(chunk.buffer.slice(
    chunk.byteOffset,
    chunk.byteOffset + chunk.byteLength,
  ));
}

function failure(
  code: Extract<DocumentContentDecision, { ok: false }>["code"],
): Extract<DocumentContentDecision, { ok: false }> {
  return Object.freeze({ ok: false, code });
}
