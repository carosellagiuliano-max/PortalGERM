export interface UploadInput {
  fileName: string;
  mimeType: string;
  size: number;
  buffer?: Buffer;
}

export interface StoredFileMetadata {
  storageKey: string;
  downloadable: false;
}

export interface StorageProvider {
  upload(input: UploadInput): Promise<StoredFileMetadata>;
  getReadUrl(storageKey: string): Promise<null>;
  delete(storageKey: string): Promise<void>;
}
