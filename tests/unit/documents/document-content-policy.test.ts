import { describe, expect, it } from "vitest";

import { inspectDocumentContent } from "@/lib/documents/document-content-policy";

describe("Phase 21 document content policy", () => {
  it.each([
    [
      "application/pdf",
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
    ],
    [
      "image/png",
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]),
    ],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])],
    [
      "image/webp",
      Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ", "binary"),
    ],
  ])("detects clean %s by magic and terminal bytes", async (mime, bytes) => {
    await expect(
      inspectDocumentContent(chunks(bytes, 3), {
        declaredMimeType: mime,
      }),
    ).resolves.toEqual({ ok: true, detectedMimeType: mime });
  });

  it.each([
    [
      "MIME_MAGIC_MISMATCH",
      "image/png",
      Buffer.from("%PDF-1.4\n%%EOF"),
    ],
    [
      "POLYGLOT_OR_ACTIVE_CONTENT",
      "application/pdf",
      Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("\n%%EOF"),
      ]),
    ],
    [
      "POLYGLOT_OR_ACTIVE_CONTENT",
      "application/pdf",
      Buffer.from("%PDF-1.4\n/JavaScript\n%%EOF"),
    ],
    [
      "MALWARE_SIGNATURE",
      "application/pdf",
      Buffer.from("%PDF-1.4\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE\n%%EOF"),
    ],
    [
      "MALFORMED_FILE",
      "application/pdf",
      Buffer.from("%PDF-1.4\nmissing terminal"),
    ],
    [
      "SCANNER_TIMEOUT",
      "application/pdf",
      Buffer.from("%PDF-1.4\nSTH_SCAN_TIMEOUT_FIXTURE\n%%EOF"),
    ],
  ])("fails closed with %s", async (code, mime, bytes) => {
    await expect(
      inspectDocumentContent(chunks(bytes, 2), {
        declaredMimeType: mime,
      }),
    ).resolves.toEqual({ ok: false, code });
  });

  it("rejects overlarge chunks before parser work", async () => {
    async function* oversizedChunk() {
      yield new Uint8Array(1024 * 1024 + 1);
    }
    await expect(
      inspectDocumentContent(oversizedChunk(), {
        declaredMimeType: "application/pdf",
      }),
    ).resolves.toEqual({ ok: false, code: "CHUNK_TOO_LARGE" });
  });
});

async function* chunks(bytes: Buffer, size: number) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}
