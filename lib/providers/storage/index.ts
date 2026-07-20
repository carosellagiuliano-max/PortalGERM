import type { StorageProvider } from "@/lib/providers/storage/storage-provider";
import { MockStorageProvider } from "@/lib/providers/storage/mock-storage-provider";

export type {
  StorageProvider,
  StoredFileMetadata,
  UploadInput,
} from "@/lib/providers/storage/storage-provider";
export {
  MOCK_STORAGE_ALLOWED_MIME_TYPES,
  MOCK_STORAGE_POLICY_V1,
  MockStorageProvider,
  MockStorageValidationError,
  normalizeSafeFileName,
  type MockStorageMimeType,
  type MockStorageProviderOptions,
  type MockStoredMetadataRecord,
} from "@/lib/providers/storage/mock-storage-provider";

// Explicit local composition root; there is no environment-based real provider.
export const storageProvider: StorageProvider = new MockStorageProvider();
