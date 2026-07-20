// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  MOCK_STORAGE_ALLOWED_MIME_TYPES,
  MOCK_STORAGE_POLICY_V1,
  MockStorageProvider,
  MockStorageValidationError,
  type UploadInput,
} from "@/lib/providers/storage";

describe("MockStorageProvider", () => {
  it.each(MOCK_STORAGE_ALLOWED_MIME_TYPES)(
    "accepts allowed metadata for %s without a byte payload",
    async (mimeType) => {
      const provider = new MockStorageProvider({
        keyFactory: () => "document-001",
      });

      const result = await provider.upload({
        fileName: "lebenslauf.pdf",
        mimeType,
        size: MOCK_STORAGE_POLICY_V1.maximumBytes,
      });

      expect(result).toEqual({
        storageKey: "mock-storage/document-001",
        downloadable: false,
      });
      expect(await provider.getReadUrl(result.storageKey)).toBeNull();
      expect(provider.getStoredMetadata(result.storageKey)).toEqual({
        storageKey: result.storageKey,
        safeFileName: "lebenslauf.pdf",
        mimeType,
        size: MOCK_STORAGE_POLICY_V1.maximumBytes,
        downloadable: false,
      });
    },
  );

  it("inspects an optional Buffer but retains metadata only", async () => {
    const provider = new MockStorageProvider({
      keyFactory: () => "document-buffer-001",
    });
    const buffer = Buffer.from("mock CV bytes that must not be retained", "utf8");
    const result = await provider.upload({
      fileName: " CV-Cafe\u0301.pdf ",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
    });
    buffer.fill(0);

    const stored = provider.getStoredMetadata(result.storageKey);
    expect(stored).toEqual({
      storageKey: "mock-storage/document-buffer-001",
      safeFileName: "CV-Café.pdf",
      mimeType: "application/pdf",
      size: 39,
      downloadable: false,
    });
    expect(stored).not.toHaveProperty("buffer");
    expect(MOCK_STORAGE_POLICY_V1.persistsFileBytes).toBe(false);
  });

  it.each([
    { fileName: "../secret.pdf", mimeType: "application/pdf", size: 1 },
    { fileName: "folder\\secret.pdf", mimeType: "application/pdf", size: 1 },
    { fileName: "bad\u0000name.pdf", mimeType: "application/pdf", size: 1 },
    { fileName: "..", mimeType: "application/pdf", size: 1 },
  ])("rejects unsafe file metadata: $fileName", async (input) => {
    const provider = new MockStorageProvider();
    await expect(provider.upload(input)).rejects.toMatchObject({
      code: "INVALID_FILE_NAME",
    });
  });

  it("enforces the exact MIME allowlist and the 5 MiB boundary", async () => {
    const provider = new MockStorageProvider();

    await expect(
      provider.upload({
        fileName: "cv.svg",
        mimeType: "image/svg+xml",
        size: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_MIME_TYPE" });
    await expect(
      provider.upload({
        fileName: "cv.pdf",
        mimeType: "application/pdf; charset=utf-8",
        size: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_MIME_TYPE" });
    await expect(
      provider.upload({
        fileName: "cv.pdf",
        mimeType: "application/pdf",
        size: MOCK_STORAGE_POLICY_V1.maximumBytes + 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIZE" });
    await expect(
      provider.upload({
        fileName: "cv.pdf",
        mimeType: "application/pdf",
        size: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIZE" });
  });

  it("rejects buffer/metadata mismatches and unsupported fields", async () => {
    const provider = new MockStorageProvider();
    await expect(
      provider.upload({
        fileName: "cv.pdf",
        mimeType: "application/pdf",
        size: 2,
        buffer: Buffer.from("one"),
      }),
    ).rejects.toMatchObject({ code: "BUFFER_SIZE_MISMATCH" });

    const unsupported = {
      fileName: "cv.pdf",
      mimeType: "application/pdf",
      size: 1,
      diskPath: "C:\\temp\\cv.pdf",
    } as unknown as UploadInput;
    await expect(provider.upload(unsupported)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("keeps reads non-downloadable and deletion idempotent", async () => {
    const provider = new MockStorageProvider({
      keyFactory: () => "delete-001",
    });
    const uploaded = await provider.upload({
      fileName: "cv.webp",
      mimeType: "image/webp",
      size: 1,
    });

    expect(await provider.getReadUrl(uploaded.storageKey)).toBeNull();
    expect(await provider.getReadUrl("../../not-a-storage-key")).toBeNull();
    await expect(provider.delete(uploaded.storageKey)).resolves.toBeUndefined();
    await expect(provider.delete(uploaded.storageKey)).resolves.toBeUndefined();
    expect(provider.getStoredMetadata(uploaded.storageKey)).toBeNull();
  });

  it("fails closed when a key factory returns an unsafe or duplicate key", async () => {
    const unsafeProvider = new MockStorageProvider({
      keyFactory: () => "../escape",
    });
    await expect(
      unsafeProvider.upload({
        fileName: "cv.pdf",
        mimeType: "application/pdf",
        size: 1,
      }),
    ).rejects.toBeInstanceOf(MockStorageValidationError);

    const duplicateProvider = new MockStorageProvider({
      keyFactory: () => "same-key",
    });
    const metadata = {
      fileName: "cv.pdf",
      mimeType: "application/pdf",
      size: 1,
    } as const;
    await duplicateProvider.upload(metadata);
    await expect(duplicateProvider.upload(metadata)).rejects.toMatchObject({
      code: "DUPLICATE_STORAGE_KEY",
    });
  });
});
