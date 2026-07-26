export type DocumentObjectReceipt = Readonly<{
  objectVersion: string;
  sizeBytes: number;
  sha256: string;
  encryptionKeyVersion: string;
  storageRegion: string;
}>;

export type DocumentObjectInventoryEntry = Readonly<{
  objectKeyHash: string;
  sizeBytes: number;
  sha256: string;
  lastModifiedAt: Date;
}>;

export type DocumentObjectStore = Readonly<{
  providerClass: string;
  storageRegion: string;
  putQuarantined(
    input: Readonly<{
      objectKey: string;
      objectVersion: string;
      expectedSizeBytes: number;
      expectedSha256?: string;
      body: AsyncIterable<Uint8Array>;
    }>,
  ): Promise<DocumentObjectReceipt>;
  headObject(objectKey: string): Promise<DocumentObjectReceipt | null>;
  openVerifiedRead(objectKey: string): Promise<{
    receipt: DocumentObjectReceipt;
    body: AsyncIterable<Uint8Array>;
  } | null>;
  listObjects(
    input: Readonly<{ limit: number }>,
  ): Promise<readonly DocumentObjectInventoryEntry[]>;
  deleteObject(
    objectKey: string,
    expected: Readonly<{ sha256: string; objectVersion: string }>,
  ): Promise<"DELETED" | "MISSING" | "MISMATCH">;
}>;

export class DocumentObjectStoreFailure extends Error {
  readonly code:
    | "PROVIDER_DISABLED"
    | "CONFIGURATION_INVALID"
    | "OBJECT_ALREADY_EXISTS"
    | "EMPTY_BODY"
    | "STREAM_TOO_LARGE"
    | "STREAM_TIMEOUT"
    | "CHUNK_TOO_LARGE"
    | "SIZE_MISMATCH"
    | "HASH_MISMATCH"
    | "OBJECT_CORRUPT"
    | "PROVIDER_IO_FAILURE";

  constructor(code: DocumentObjectStoreFailure["code"]) {
    super(`Document object store failed: ${code}`);
    this.name = "DocumentObjectStoreFailure";
    this.code = code;
  }
}
