import { randomUUID } from "node:crypto";

import type {
  StorageProvider,
  StoredFileMetadata,
  UploadInput,
} from "@/lib/providers/storage/storage-provider";

export const MOCK_STORAGE_ALLOWED_MIME_TYPES = Object.freeze([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const);

export type MockStorageMimeType =
  (typeof MOCK_STORAGE_ALLOWED_MIME_TYPES)[number];

export const MOCK_STORAGE_POLICY_V1 = Object.freeze({
  maximumBytes: 5 * 1024 * 1024,
  maximumFileNameCharacters: 255,
  storageKeyPrefix: "mock-storage/" as const,
  persistsFileBytes: false,
  downloadable: false as const,
});

export type MockStoredMetadataRecord = Readonly<{
  storageKey: string;
  safeFileName: string;
  mimeType: MockStorageMimeType;
  size: number;
  downloadable: false;
}>;

export type MockStorageProviderOptions = Readonly<{
  keyFactory?: () => string;
}>;

export class MockStorageValidationError extends TypeError {
  readonly code:
    | "INVALID_INPUT"
    | "INVALID_FILE_NAME"
    | "INVALID_MIME_TYPE"
    | "INVALID_SIZE"
    | "BUFFER_SIZE_MISMATCH"
    | "INVALID_STORAGE_KEY"
    | "DUPLICATE_STORAGE_KEY";

  constructor(code: MockStorageValidationError["code"], message: string) {
    super(message);
    this.name = "MockStorageValidationError";
    this.code = code;
  }
}

/**
 * Metadata-only mock. The optional Buffer is inspected for consistency and is
 * never copied into the record, written to disk or retained by this instance.
 */
export class MockStorageProvider implements StorageProvider {
  readonly #keyFactory: () => string;
  readonly #metadata = new Map<string, MockStoredMetadataRecord>();

  constructor(options: MockStorageProviderOptions = {}) {
    this.#keyFactory = options.keyFactory ?? randomUUID;
  }

  async upload(input: UploadInput): Promise<StoredFileMetadata> {
    assertExactUploadInput(input);
    const safeFileName = normalizeSafeFileName(input.fileName);
    const mimeType = assertAllowedMimeType(input.mimeType);
    const size = assertAllowedSize(input.size);

    if (input.buffer !== undefined) {
      if (!Buffer.isBuffer(input.buffer) || input.buffer.byteLength !== size) {
        throw new MockStorageValidationError(
          "BUFFER_SIZE_MISMATCH",
          "The optional upload buffer must match the declared metadata size.",
        );
      }
    }

    const storageKey = createStorageKey(this.#keyFactory());
    if (this.#metadata.has(storageKey)) {
      throw new MockStorageValidationError(
        "DUPLICATE_STORAGE_KEY",
        "The mock storage key already exists.",
      );
    }

    const record = Object.freeze({
      storageKey,
      safeFileName,
      mimeType,
      size,
      downloadable: MOCK_STORAGE_POLICY_V1.downloadable,
    });
    this.#metadata.set(storageKey, record);

    return Object.freeze({
      storageKey,
      downloadable: MOCK_STORAGE_POLICY_V1.downloadable,
    });
  }

  async getReadUrl(_storageKey: string): Promise<null> {
    return null;
  }

  async delete(storageKey: string): Promise<void> {
    if (typeof storageKey === "string") {
      this.#metadata.delete(storageKey);
    }
  }

  /** Mock-only metadata inspection; it never exposes a byte or read URL. */
  getStoredMetadata(storageKey: string): MockStoredMetadataRecord | null {
    return this.#metadata.get(storageKey) ?? null;
  }
}

export function normalizeSafeFileName(fileName: unknown): string {
  if (typeof fileName !== "string") {
    throw new MockStorageValidationError(
      "INVALID_FILE_NAME",
      "The file name must be text.",
    );
  }

  const normalized = fileName.trim().normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > MOCK_STORAGE_POLICY_V1.maximumFileNameCharacters ||
    normalized === "." ||
    normalized === ".." ||
    /[\\/\u0000-\u001f\u007f]/.test(normalized) ||
    /[\u202a-\u202e\u2066-\u2069]/iu.test(normalized)
  ) {
    throw new MockStorageValidationError(
      "INVALID_FILE_NAME",
      "The file name must be a bounded name without paths or control characters.",
    );
  }
  return normalized;
}

function assertAllowedMimeType(mimeType: unknown): MockStorageMimeType {
  if (
    typeof mimeType !== "string" ||
    !MOCK_STORAGE_ALLOWED_MIME_TYPES.some((allowed) => allowed === mimeType)
  ) {
    throw new MockStorageValidationError(
      "INVALID_MIME_TYPE",
      "The file MIME type is not allowed by the mock storage policy.",
    );
  }
  return mimeType as MockStorageMimeType;
}

function assertAllowedSize(size: unknown): number {
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MOCK_STORAGE_POLICY_V1.maximumBytes
  ) {
    throw new MockStorageValidationError(
      "INVALID_SIZE",
      "The file size must be a positive integer no larger than 5 MiB.",
    );
  }
  return size;
}

function createStorageKey(suffix: unknown): string {
  if (
    typeof suffix !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(suffix)
  ) {
    throw new MockStorageValidationError(
      "INVALID_STORAGE_KEY",
      "The mock storage key factory returned an unsafe key segment.",
    );
  }
  return `${MOCK_STORAGE_POLICY_V1.storageKeyPrefix}${suffix}`;
}

function assertExactUploadInput(input: unknown): asserts input is UploadInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new MockStorageValidationError(
      "INVALID_INPUT",
      "Mock storage upload input must be a metadata object.",
    );
  }

  const required = ["fileName", "mimeType", "size"] as const;
  const allowed = new Set<string>([...required, "buffer"]);
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    required.some(
      (key) => !Object.prototype.hasOwnProperty.call(input, key),
    )
  ) {
    throw new MockStorageValidationError(
      "INVALID_INPUT",
      "Mock storage upload input contains unsupported metadata fields.",
    );
  }
}
