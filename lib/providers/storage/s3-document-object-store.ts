import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

import type { SecretHandle } from "@/lib/config/env-schema";
import { DOCUMENT_UPLOAD_POLICY_V1 } from "@/lib/documents/document-upload-policy";
import {
  DocumentObjectStoreFailure,
  type DocumentObjectInventoryEntry,
  type DocumentObjectReceipt,
  type DocumentObjectStore,
} from "@/lib/providers/storage/document-object-store";

const DEFAULT_OBJECT_KEY_PATTERN =
  /^(?:candidate-cv|company-verification)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STORAGE_KEY_PATTERN = /^([a-f0-9]{64})\.sthobj$/u;
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAXIMUM_VERIFIED_READ_BUFFER_BYTES = 64 * 1024 * 1024;

type RawHead = Readonly<{
  etag: string;
  providerVersionId: string | null;
  receipt: DocumentObjectReceipt;
}>;

type ValidatedStreamState = {
  completed: boolean;
  error: DocumentObjectStoreFailure | null;
  sha256: string | null;
  sizeBytes: number;
};

export type S3ObjectStoreTransport = Pick<S3Client, "send">;

/**
 * Immutable, private S3-compatible object storage for the document Vault.
 *
 * Logical object keys are never sent to S3. They are SHA-256 mapped into a
 * purpose-specific namespace, uploads use `If-None-Match: *`, and every read
 * is checked against the provider checksum and immutable object metadata.
 * The domain remains the authorization boundary; this adapter never creates
 * public URLs or accepts arbitrary bucket keys.
 */
export class S3DocumentObjectStore implements DocumentObjectStore {
  readonly providerClass: string;
  readonly storageRegion: string;
  readonly #bucket: string;
  readonly #client: S3ObjectStoreTransport;
  readonly #encryptionKeyVersion: string;
  readonly #kmsKeyId: string | undefined;
  readonly #maximumBytes: number;
  readonly #maximumChunkBytes: number;
  readonly #namespace: string;
  readonly #objectKeyPattern: RegExp;
  readonly #requestTimeoutMilliseconds: number;
  readonly #serverSideEncryption: "AES256" | "aws:kms";

  constructor(
    input: Readonly<{
      accessKeyId: SecretHandle<string>;
      bucket: string;
      endpoint: string;
      encryptionKeyVersion: string;
      forcePathStyle: boolean;
      kmsKeyId?: string;
      maximumBytes?: number;
      maximumChunkBytes?: number;
      namespace: string;
      objectKeyPattern?: RegExp;
      providerClass: string;
      region: string;
      requestTimeoutMilliseconds?: number;
      secretAccessKey: SecretHandle<string>;
      sessionToken?: SecretHandle<string>;
      serverSideEncryption: "AES256" | "aws:kms";
      transport?: S3ObjectStoreTransport;
    }>,
  ) {
    const endpoint = parseEndpoint(input.endpoint);
    const maximumBytes =
      input.maximumBytes ?? DOCUMENT_UPLOAD_POLICY_V1.maximumBytes;
    const maximumChunkBytes =
      input.maximumChunkBytes ?? DOCUMENT_UPLOAD_POLICY_V1.maximumChunkBytes;
    const requestTimeoutMilliseconds =
      input.requestTimeoutMilliseconds ??
      DOCUMENT_UPLOAD_POLICY_V1.uploadStreamTimeoutMilliseconds;
    if (
      endpoint === null ||
      !isEndpointAllowedForProvider(endpoint, input.providerClass) ||
      !isSafeBucket(input.bucket) ||
      !SAFE_NAMESPACE_PATTERN.test(input.namespace) ||
      !SAFE_VERSION_PATTERN.test(input.encryptionKeyVersion) ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > MAXIMUM_VERIFIED_READ_BUFFER_BYTES ||
      !Number.isSafeInteger(maximumChunkBytes) ||
      maximumChunkBytes < 1 ||
      maximumChunkBytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(requestTimeoutMilliseconds) ||
      requestTimeoutMilliseconds < 1 ||
      requestTimeoutMilliseconds > 30 * 60 * 1_000 ||
      (input.serverSideEncryption === "aws:kms" &&
        (input.kmsKeyId === undefined ||
          input.kmsKeyId !== input.kmsKeyId.trim() ||
          input.kmsKeyId.length < 3 ||
          input.kmsKeyId.length > 512)) ||
      (input.serverSideEncryption === "AES256" && input.kmsKeyId !== undefined)
    ) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }
    this.#bucket = input.bucket;
    this.#encryptionKeyVersion = input.encryptionKeyVersion;
    this.#kmsKeyId = input.kmsKeyId;
    this.#maximumBytes = maximumBytes;
    this.#maximumChunkBytes = maximumChunkBytes;
    this.#namespace = input.namespace;
    this.#objectKeyPattern =
      input.objectKeyPattern ?? DEFAULT_OBJECT_KEY_PATTERN;
    this.#requestTimeoutMilliseconds = requestTimeoutMilliseconds;
    this.#serverSideEncryption = input.serverSideEncryption;
    this.providerClass = input.providerClass;
    this.storageRegion = input.region;

    this.#client =
      input.transport ??
      new S3Client({
        endpoint: endpoint.href.replace(/\/$/u, ""),
        forcePathStyle: input.forcePathStyle,
        maxAttempts: 1,
        region: input.region,
        credentials: async () =>
          input.accessKeyId.withValue((accessKeyId) =>
            input.secretAccessKey.withValue((secretAccessKey) => ({
              accessKeyId,
              secretAccessKey,
              ...(input.sessionToken === undefined
                ? {}
                : {
                    sessionToken: input.sessionToken.withValue(
                      (sessionToken) => sessionToken,
                    ),
                  }),
            })),
          ),
      });
  }

  async putQuarantined(
    input: Readonly<{
      objectKey: string;
      objectVersion: string;
      expectedSizeBytes: number;
      expectedSha256?: string;
      body: AsyncIterable<Uint8Array>;
    }>,
  ): Promise<DocumentObjectReceipt> {
    this.#assertObjectKey(input.objectKey);
    if (!SAFE_VERSION_PATTERN.test(input.objectVersion)) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }
    if (
      !Number.isSafeInteger(input.expectedSizeBytes) ||
      input.expectedSizeBytes <= 0 ||
      input.expectedSizeBytes > this.#maximumBytes
    ) {
      throw new DocumentObjectStoreFailure(
        input.expectedSizeBytes <= 0 ? "EMPTY_BODY" : "STREAM_TOO_LARGE",
      );
    }
    if (
      input.expectedSha256 !== undefined &&
      !SHA256_PATTERN.test(input.expectedSha256)
    ) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }

    const existing = await this.#head(input.objectKey);
    if (existing !== null) {
      if (
        existing.receipt.objectVersion === input.objectVersion &&
        existing.receipt.sizeBytes === input.expectedSizeBytes &&
        (input.expectedSha256 === undefined ||
          existing.receipt.sha256 === input.expectedSha256)
      ) {
        return existing.receipt;
      }
      throw new DocumentObjectStoreFailure("OBJECT_ALREADY_EXISTS");
    }

    const state: ValidatedStreamState = {
      completed: false,
      error: null,
      sha256: null,
      sizeBytes: 0,
    };
    const storageKey = this.#storageKey(input.objectKey);
    try {
      const response = await withAbortTimeout(
        this.#requestTimeoutMilliseconds,
        "STREAM_TIMEOUT",
        (abortSignal) =>
          this.#client.send(
            new PutObjectCommand({
              Bucket: this.#bucket,
              Key: storageKey,
              Body: Readable.from(
                validateUploadBody(
                  input.body,
                  {
                    expectedSha256: input.expectedSha256,
                    expectedSizeBytes: input.expectedSizeBytes,
                    maximumBytes: this.#maximumBytes,
                    maximumChunkBytes: this.#maximumChunkBytes,
                    timeoutMilliseconds: this.#requestTimeoutMilliseconds,
                  },
                  state,
                ),
              ),
              ChecksumAlgorithm: "SHA256",
              ...(input.expectedSha256 === undefined
                ? {}
                : {
                    ChecksumSHA256: Buffer.from(
                      input.expectedSha256,
                      "hex",
                    ).toString("base64"),
                  }),
              ContentLength: input.expectedSizeBytes,
              ContentType: "application/octet-stream",
              IfNoneMatch: "*",
              Metadata: {
                "sth-encryption-version": this.#encryptionKeyVersion,
                "sth-object-version": input.objectVersion,
              },
              ServerSideEncryption: this.#serverSideEncryption,
              ...(this.#kmsKeyId === undefined
                ? {}
                : {
                    BucketKeyEnabled: true,
                    SSEKMSKeyId: this.#kmsKeyId,
                  }),
            }),
            { abortSignal },
          ),
      );
      if (!state.completed || state.sha256 === null) {
        throw (
          state.error ?? new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE")
        );
      }
      const responseChecksum = decodeProviderChecksum(response.ChecksumSHA256);
      if (responseChecksum !== null && responseChecksum !== state.sha256) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      const stored = await this.#head(input.objectKey);
      if (
        stored === null ||
        stored.receipt.objectVersion !== input.objectVersion ||
        stored.receipt.sizeBytes !== state.sizeBytes ||
        stored.receipt.sha256 !== state.sha256 ||
        stored.receipt.encryptionKeyVersion !== this.#encryptionKeyVersion
      ) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      return stored.receipt;
    } catch (error) {
      if (state.error !== null) throw state.error;
      const recovered = await this.#head(input.objectKey).catch(() => null);
      if (
        recovered !== null &&
        state.sha256 !== null &&
        recovered.receipt.objectVersion === input.objectVersion &&
        recovered.receipt.sizeBytes === input.expectedSizeBytes &&
        recovered.receipt.sha256 === state.sha256
      ) {
        return recovered.receipt;
      }
      if (isPreconditionFailure(error)) {
        throw new DocumentObjectStoreFailure("OBJECT_ALREADY_EXISTS");
      }
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    }
  }

  async headObject(objectKey: string): Promise<DocumentObjectReceipt | null> {
    return (await this.#head(objectKey))?.receipt ?? null;
  }

  async openVerifiedRead(objectKey: string): Promise<{
    receipt: DocumentObjectReceipt;
    body: AsyncIterable<Uint8Array>;
  } | null> {
    const head = await this.#head(objectKey);
    if (head === null) return null;

    // One immutable If-Match GET is fully buffered and verified before any
    // caller-visible byte. A second provider response could otherwise change
    // after the verification pass and leak corrupt bytes before its final hash.
    const verified = await this.#consumeVerifiedObject(objectKey, head);
    return Object.freeze({
      receipt: head.receipt,
      body: bufferedVerifiedBody(verified, this.#maximumChunkBytes),
    });
  }

  async listObjects(
    input: Readonly<{ limit: number }>,
  ): Promise<readonly DocumentObjectInventoryEntry[]> {
    const limit = Math.max(
      1,
      Math.min(DOCUMENT_UPLOAD_POLICY_V1.reconcilerBatchSize, input.limit),
    );
    try {
      const response = await withAbortTimeout(
        Math.min(10_000, this.#requestTimeoutMilliseconds),
        "PROVIDER_IO_FAILURE",
        (abortSignal) =>
          this.#client.send(
            new ListObjectsV2Command({
              Bucket: this.#bucket,
              MaxKeys: limit,
              Prefix: `${this.#namespace}/`,
            }),
            { abortSignal },
          ),
      );
      const inventory: DocumentObjectInventoryEntry[] = [];
      for (const object of response.Contents ?? []) {
        if (inventory.length >= limit || object.Key === undefined) continue;
        const basename = object.Key.slice(`${this.#namespace}/`.length);
        const matched = STORAGE_KEY_PATTERN.exec(basename);
        if (matched === null) continue;
        const raw = await this.#headStorageKey(object.Key);
        if (raw === null) continue;
        inventory.push(
          Object.freeze({
            objectKeyHash: matched[1]!,
            sizeBytes: raw.receipt.sizeBytes,
            sha256: raw.receipt.sha256,
            lastModifiedAt: object.LastModified ?? new Date(0),
          }),
        );
      }
      return Object.freeze(inventory);
    } catch (error) {
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    }
  }

  async deleteObject(
    objectKey: string,
    expected: Readonly<{ sha256: string; objectVersion: string }>,
  ): Promise<"DELETED" | "MISSING" | "MISMATCH"> {
    const head = await this.#head(objectKey);
    if (head === null) return "MISSING";
    if (
      head.receipt.sha256 !== expected.sha256 ||
      head.receipt.objectVersion !== expected.objectVersion
    ) {
      return "MISMATCH";
    }
    try {
      await withAbortTimeout(
        Math.min(10_000, this.#requestTimeoutMilliseconds),
        "PROVIDER_IO_FAILURE",
        (abortSignal) =>
          this.#client.send(
            new DeleteObjectCommand({
              Bucket: this.#bucket,
              Key: this.#storageKey(objectKey),
              IfMatch: head.etag,
              ...(head.providerVersionId === null
                ? {}
                : { VersionId: head.providerVersionId }),
            }),
            { abortSignal },
          ),
      );
      return "DELETED";
    } catch (error) {
      if (isMissing(error)) return "MISSING";
      if (isPreconditionFailure(error)) return "MISMATCH";
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    }
  }

  async #consumeVerifiedObject(
    objectKey: string,
    head: RawHead,
  ): Promise<Buffer> {
    const response = await this.#getObject(objectKey, head.etag);
    const body = asAsyncIterable(response.Body);
    if (body === null) {
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of verifyReadBody(body, head.receipt, {
      maximumChunkBytes: this.#maximumChunkBytes,
      timeoutMilliseconds: this.#requestTimeoutMilliseconds,
    })) {
      chunks.push(Buffer.from(chunk));
    }
    const responseChecksum = decodeProviderChecksum(response.ChecksumSHA256);
    if (responseChecksum !== null && responseChecksum !== head.receipt.sha256) {
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    }
    return Buffer.concat(chunks, head.receipt.sizeBytes);
  }

  async #getObject(objectKey: string, etag: string) {
    return withAbortTimeout(
      this.#requestTimeoutMilliseconds,
      "STREAM_TIMEOUT",
      (abortSignal) =>
        this.#client.send(
          new GetObjectCommand({
            Bucket: this.#bucket,
            ChecksumMode: "ENABLED",
            IfMatch: etag,
            Key: this.#storageKey(objectKey),
          }),
          { abortSignal },
        ),
    ).catch((error: unknown) => {
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    });
  }

  async #head(objectKey: string): Promise<RawHead | null> {
    this.#assertObjectKey(objectKey);
    return this.#headStorageKey(this.#storageKey(objectKey));
  }

  async #headStorageKey(storageKey: string): Promise<RawHead | null> {
    let output: HeadObjectCommandOutput;
    try {
      output = await withAbortTimeout(
        Math.min(10_000, this.#requestTimeoutMilliseconds),
        "PROVIDER_IO_FAILURE",
        (abortSignal) =>
          this.#client.send(
            new HeadObjectCommand({
              Bucket: this.#bucket,
              ChecksumMode: "ENABLED",
              Key: storageKey,
            }),
            { abortSignal },
          ),
      );
    } catch (error) {
      if (isMissing(error)) return null;
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    }
    const checksum = decodeProviderChecksum(output.ChecksumSHA256);
    const objectVersion = output.Metadata?.["sth-object-version"];
    const encryptionKeyVersion = output.Metadata?.["sth-encryption-version"];
    const etag = output.ETag;
    if (
      checksum === null ||
      objectVersion === undefined ||
      !SAFE_VERSION_PATTERN.test(objectVersion) ||
      encryptionKeyVersion !== this.#encryptionKeyVersion ||
      etag === undefined ||
      (output.VersionId !== undefined &&
        (output.VersionId.length < 1 || output.VersionId.length > 256)) ||
      !Number.isSafeInteger(output.ContentLength) ||
      output.ContentLength! < 1 ||
      output.ContentLength! > this.#maximumBytes ||
      output.ServerSideEncryption !== this.#serverSideEncryption ||
      (this.#serverSideEncryption === "aws:kms" &&
        output.SSEKMSKeyId !== this.#kmsKeyId) ||
      (this.#serverSideEncryption === "AES256" &&
        output.SSEKMSKeyId !== undefined)
    ) {
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    }
    return Object.freeze({
      etag,
      providerVersionId:
        output.VersionId === undefined ? null : output.VersionId,
      receipt: Object.freeze({
        objectVersion,
        sizeBytes: output.ContentLength!,
        sha256: checksum,
        encryptionKeyVersion,
        storageRegion: this.storageRegion,
      }),
    });
  }

  #assertObjectKey(objectKey: string): void {
    this.#objectKeyPattern.lastIndex = 0;
    if (!this.#objectKeyPattern.test(objectKey)) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }
  }

  #storageKey(objectKey: string): string {
    const digest = createHash("sha256").update(objectKey, "utf8").digest("hex");
    return `${this.#namespace}/${digest}.sthobj`;
  }
}

async function* bufferedVerifiedBody(
  value: Buffer,
  maximumChunkBytes: number,
): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < value.byteLength; offset += maximumChunkBytes) {
    const end = Math.min(offset + maximumChunkBytes, value.byteLength);
    yield new Uint8Array(value.subarray(offset, end));
  }
}

async function* validateUploadBody(
  source: AsyncIterable<Uint8Array>,
  limits: Readonly<{
    expectedSha256?: string;
    expectedSizeBytes: number;
    maximumBytes: number;
    maximumChunkBytes: number;
    timeoutMilliseconds: number;
  }>,
  state: ValidatedStreamState,
): AsyncGenerator<Uint8Array> {
  const digest = createHash("sha256");
  const iterator = source[Symbol.asyncIterator]();
  const deadline = Date.now() + limits.timeoutMilliseconds;
  try {
    while (true) {
      const next = await nextBeforeDeadline(iterator, deadline);
      if (next.done) break;
      const chunk = copyChunk(next.value);
      if (chunk.byteLength > limits.maximumChunkBytes) {
        throw new DocumentObjectStoreFailure("CHUNK_TOO_LARGE");
      }
      state.sizeBytes += chunk.byteLength;
      if (
        state.sizeBytes > limits.expectedSizeBytes ||
        state.sizeBytes > limits.maximumBytes
      ) {
        throw new DocumentObjectStoreFailure("STREAM_TOO_LARGE");
      }
      digest.update(chunk);
      yield chunk;
    }
    if (state.sizeBytes === 0) {
      throw new DocumentObjectStoreFailure("EMPTY_BODY");
    }
    if (state.sizeBytes !== limits.expectedSizeBytes) {
      throw new DocumentObjectStoreFailure("SIZE_MISMATCH");
    }
    state.sha256 = digest.digest("hex");
    if (
      limits.expectedSha256 !== undefined &&
      state.sha256 !== limits.expectedSha256
    ) {
      throw new DocumentObjectStoreFailure("HASH_MISMATCH");
    }
    state.completed = true;
  } catch (error) {
    state.error =
      error instanceof DocumentObjectStoreFailure
        ? error
        : new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    void iterator.return?.().catch(() => undefined);
    throw state.error;
  }
}

async function* verifyReadBody(
  source: AsyncIterable<Uint8Array>,
  receipt: DocumentObjectReceipt,
  limits: Readonly<{
    maximumChunkBytes: number;
    timeoutMilliseconds: number;
  }>,
): AsyncGenerator<Uint8Array> {
  const digest = createHash("sha256");
  const iterator = source[Symbol.asyncIterator]();
  const deadline = Date.now() + limits.timeoutMilliseconds;
  let total = 0;
  try {
    while (true) {
      const next = await nextBeforeDeadline(iterator, deadline);
      if (next.done) break;
      const chunk = copyChunk(next.value);
      if (chunk.byteLength > limits.maximumChunkBytes) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      total += chunk.byteLength;
      if (total > receipt.sizeBytes) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      digest.update(chunk);
      yield chunk;
    }
  } catch (error) {
    void iterator.return?.().catch(() => undefined);
    if (error instanceof DocumentObjectStoreFailure) throw error;
    throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
  }
  if (total !== receipt.sizeBytes || digest.digest("hex") !== receipt.sha256) {
    throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
  }
}

function nextBeforeDeadline(
  iterator: AsyncIterator<Uint8Array>,
  deadline: number,
): Promise<IteratorResult<Uint8Array>> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return Promise.reject(new DocumentObjectStoreFailure("STREAM_TIMEOUT"));
  }
  return new Promise((resolveNext, rejectNext) => {
    const timer = setTimeout(
      () => rejectNext(new DocumentObjectStoreFailure("STREAM_TIMEOUT")),
      remaining,
    );
    iterator.next().then(
      (value) => {
        clearTimeout(timer);
        resolveNext(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectNext(error);
      },
    );
  });
}

async function withAbortTimeout<TResult>(
  timeoutMilliseconds: number,
  failureCode: "STREAM_TIMEOUT" | "PROVIDER_IO_FAILURE",
  operation: (abortSignal: AbortSignal) => Promise<TResult>,
): Promise<TResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new DocumentObjectStoreFailure(failureCode);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function asAsyncIterable(value: unknown): AsyncIterable<Uint8Array> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !(Symbol.asyncIterator in value) ||
    typeof value[Symbol.asyncIterator] !== "function"
  ) {
    return null;
  }
  return value as AsyncIterable<Uint8Array>;
}

function copyChunk(value: Uint8Array): Uint8Array {
  return new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
}

function decodeProviderChecksum(value: string | undefined): string | null {
  if (value === undefined) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength === 32 ? decoded.toString("hex") : null;
}

function parseEndpoint(value: string): URL | null {
  try {
    const endpoint = new URL(value);
    if (
      (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.search !== "" ||
      endpoint.hash !== "" ||
      (endpoint.pathname !== "" && endpoint.pathname !== "/")
    ) {
      return null;
    }
    return endpoint;
  } catch {
    return null;
  }
}

function isEndpointAllowedForProvider(
  endpoint: URL,
  providerClass: string,
): boolean {
  if (providerClass.includes("-contract-")) {
    return (
      endpoint.protocol === "http:" &&
      endpoint.hostname === "object-store" &&
      endpoint.port === "9000"
    );
  }
  if (!providerClass.includes("-live-")) return false;
  const hostname = endpoint.hostname.toLowerCase();
  return (
    endpoint.protocol === "https:" &&
    hostname !== "localhost" &&
    hostname !== "0.0.0.0" &&
    hostname !== "[::]" &&
    hostname !== "[::1]" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !hostname.endsWith(".invalid") &&
    !/^127\./u.test(hostname)
  );
}

function isSafeBucket(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(value) &&
    !value.includes("..") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)
  );
}

function isMissing(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function isPreconditionFailure(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.name === "ConditionalRequestConflict" ||
    candidate.$metadata?.httpStatusCode === 409 ||
    candidate.$metadata?.httpStatusCode === 412
  );
}
