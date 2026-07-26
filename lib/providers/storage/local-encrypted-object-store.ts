import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  link,
  mkdir,
  open,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { KeyringEntry } from "@/lib/config/env-schema";
import { DOCUMENT_UPLOAD_POLICY_V1 } from "@/lib/documents/document-upload-policy";
import {
  DocumentObjectStoreFailure,
  type DocumentObjectInventoryEntry,
  type DocumentObjectReceipt,
  type DocumentObjectStore,
} from "@/lib/providers/storage/document-object-store";

const MAGIC = Buffer.from("STHVLT01", "ascii");
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const SIZE_BYTES = 8;
const HASH_BYTES = 32;
const FOOTER_BYTES = AUTH_TAG_BYTES + SIZE_BYTES + HASH_BYTES;
const DOCUMENT_OBJECT_KEY_PATTERN =
  /^candidate-cv\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OBJECT_FILE_PATTERN = /^[a-f0-9]{64}\.sthobj$/u;

type ParsedObjectFile = Readonly<{
  headerBytes: number;
  iv: Buffer;
  keyVersion: string;
  objectVersion: string;
  authTag: Buffer;
  sizeBytes: number;
  sha256: string;
}>;

export class LocalEncryptedDocumentObjectStore
  implements DocumentObjectStore
{
  readonly providerClass: string;
  readonly storageRegion: string;
  readonly #root: string;
  readonly #keyring: readonly KeyringEntry[];
  readonly #streamTimeoutMilliseconds: number;
  readonly #maximumBytes: number;
  readonly #maximumChunkBytes: number;
  readonly #objectKeyPattern: RegExp;

  constructor(input: Readonly<{
    root: string;
    storageRegion: string;
    keyring: readonly KeyringEntry[];
    streamTimeoutMilliseconds?: number;
    maximumBytes?: number;
    maximumChunkBytes?: number;
    objectKeyPattern?: RegExp;
    providerClass?: string;
  }>) {
    const root = resolve(input.root);
    if (
      !isAbsolute(input.root) ||
      isWithin(
        root,
        resolve(/* turbopackIgnore: true */ process.cwd()),
      ) ||
      input.keyring.length === 0
    ) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }
    const streamTimeoutMilliseconds =
      input.streamTimeoutMilliseconds ??
      DOCUMENT_UPLOAD_POLICY_V1.uploadStreamTimeoutMilliseconds;
    const maximumBytes =
      input.maximumBytes ?? DOCUMENT_UPLOAD_POLICY_V1.maximumBytes;
    const maximumChunkBytes =
      input.maximumChunkBytes ?? DOCUMENT_UPLOAD_POLICY_V1.maximumChunkBytes;
    if (
      !Number.isSafeInteger(streamTimeoutMilliseconds) ||
      streamTimeoutMilliseconds < 1 ||
      streamTimeoutMilliseconds > 30 * 60 * 1_000 ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 1024 * 1024 * 1024 ||
      !Number.isSafeInteger(maximumChunkBytes) ||
      maximumChunkBytes < 1 ||
      maximumChunkBytes > 8 * 1024 * 1024
    ) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }
    this.#root = root;
    this.storageRegion = input.storageRegion;
    this.#keyring = Object.freeze([...input.keyring]);
    this.#streamTimeoutMilliseconds = streamTimeoutMilliseconds;
    this.#maximumBytes = maximumBytes;
    this.#maximumChunkBytes = maximumChunkBytes;
    this.#objectKeyPattern =
      input.objectKeyPattern ?? DOCUMENT_OBJECT_KEY_PATTERN;
    this.providerClass =
      input.providerClass ?? "filesystem-encrypted-sandbox-v1";
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
    if (
      !Number.isSafeInteger(input.expectedSizeBytes) ||
      input.expectedSizeBytes <= 0 ||
      input.expectedSizeBytes > this.#maximumBytes
    ) {
      throw new DocumentObjectStoreFailure(
        input.expectedSizeBytes <= 0 ? "EMPTY_BODY" : "STREAM_TOO_LARGE",
      );
    }
    const writer = this.#keyring[0]!;
    const keyVersion = writer.version;
    const target = this.#pathFor(input.objectKey);
    const temporary = `${target}.${randomUUID()}.uploading`;
    await mkdir(this.#root, { recursive: true });
    const handle = await open(temporary, "wx").catch(() => {
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    });
    let published = false;

    try {
      const iv = randomBytes(IV_BYTES);
      const key = writer.key.withValue((value) => Buffer.from(value, "base64"));
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      key.fill(0);
      const header = encodeHeader(keyVersion, input.objectVersion, iv);
      await handle.write(header);
      let total = 0;
      const digest = createHash("sha256");
      const iterator = input.body[Symbol.asyncIterator]();
      const deadline = Date.now() + this.#streamTimeoutMilliseconds;

      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          void iterator.return?.().catch(() => undefined);
          throw new DocumentObjectStoreFailure("STREAM_TIMEOUT");
        }
        let next: IteratorResult<Uint8Array>;
        try {
          next = await nextBeforeDeadline(iterator, remaining);
        } catch (error) {
          void iterator.return?.().catch(() => undefined);
          throw error;
        }
        if (next.done) break;
        const rawChunk = next.value;
        const chunk = Buffer.from(
          rawChunk.buffer,
          rawChunk.byteOffset,
          rawChunk.byteLength,
        );
        if (chunk.byteLength > this.#maximumChunkBytes) {
          throw new DocumentObjectStoreFailure("CHUNK_TOO_LARGE");
        }
        total += chunk.byteLength;
        if (
          total > input.expectedSizeBytes ||
          total > this.#maximumBytes
        ) {
          throw new DocumentObjectStoreFailure("STREAM_TOO_LARGE");
        }
        digest.update(chunk);
        const encrypted = cipher.update(chunk);
        if (encrypted.byteLength > 0) await handle.write(encrypted);
      }
      if (total === 0) {
        throw new DocumentObjectStoreFailure("EMPTY_BODY");
      }
      if (total !== input.expectedSizeBytes) {
        throw new DocumentObjectStoreFailure("SIZE_MISMATCH");
      }
      const sha256 = digest.digest("hex");
      if (
        input.expectedSha256 !== undefined &&
        sha256 !== input.expectedSha256
      ) {
        throw new DocumentObjectStoreFailure("HASH_MISMATCH");
      }
      const final = cipher.final();
      if (final.byteLength > 0) await handle.write(final);
      await handle.write(
        encodeFooter(cipher.getAuthTag(), total, Buffer.from(sha256, "hex")),
      );
      await handle.sync();
      await handle.close();

      try {
        await link(temporary, target);
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          throw new DocumentObjectStoreFailure("OBJECT_ALREADY_EXISTS");
        }
        throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
      }
      published = true;
      await unlink(temporary);

      return Object.freeze({
        objectVersion: input.objectVersion,
        sizeBytes: total,
        sha256,
        encryptionKeyVersion: keyVersion,
        storageRegion: this.storageRegion,
      });
    } catch (error) {
      await handle.close().catch(() => undefined);
      if (!published) await unlink(temporary).catch(() => undefined);
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    }
  }

  async headObject(objectKey: string): Promise<DocumentObjectReceipt | null> {
    this.#assertObjectKey(objectKey);
    const parsed = await this.#readObjectFile(this.#pathFor(objectKey));
    return parsed === null ? null : this.#toReceipt(parsed);
  }

  async openVerifiedRead(objectKey: string): Promise<{
    receipt: DocumentObjectReceipt;
    body: AsyncIterable<Uint8Array>;
  } | null> {
    this.#assertObjectKey(objectKey);
    const path = this.#pathFor(objectKey);
    const parsed = await this.#readObjectFile(path);
    if (parsed === null) return null;

    for await (const _chunk of this.#decrypt(path, parsed)) {
      // A full bounded-memory verification pass prevents corrupt ciphertext
      // from being returned before the GCM tag and plaintext hash are checked.
    }
    return Object.freeze({
      receipt: this.#toReceipt(parsed),
      body: this.#decrypt(path, parsed),
    });
  }

  async listObjects(
    input: Readonly<{ limit: number }>,
  ): Promise<readonly DocumentObjectInventoryEntry[]> {
    const limit = Math.max(
      1,
      Math.min(DOCUMENT_UPLOAD_POLICY_V1.reconcilerBatchSize, input.limit),
    );
    const entries = await readdir(this.#root, {
      withFileTypes: true,
    }).catch((error) => {
      if (errorCode(error) === "ENOENT") return [];
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    });
    const inventory: DocumentObjectInventoryEntry[] = [];
    for (const entry of entries) {
      if (
        inventory.length >= limit ||
        !entry.isFile() ||
        !OBJECT_FILE_PATTERN.test(entry.name)
      ) {
        continue;
      }
      const filePath = join(this.#root, entry.name);
      const [metadata, parsed] = await Promise.all([
        stat(filePath),
        this.#readObjectFile(filePath),
      ]);
      if (parsed === null) continue;
      inventory.push(
        Object.freeze({
          objectKeyHash: entry.name.slice(0, -".sthobj".length),
          sizeBytes: parsed.sizeBytes,
          sha256: parsed.sha256,
          lastModifiedAt: metadata.mtime,
        }),
      );
    }
    return Object.freeze(inventory);
  }

  async deleteObject(
    objectKey: string,
    expected: Readonly<{ sha256: string; objectVersion: string }>,
  ): Promise<"DELETED" | "MISSING" | "MISMATCH"> {
    this.#assertObjectKey(objectKey);
    const path = this.#pathFor(objectKey);
    const parsed = await this.#readObjectFile(path);
    if (parsed === null) return "MISSING";
    if (
      parsed.sha256 !== expected.sha256 ||
      parsed.objectVersion !== expected.objectVersion
    ) {
      return "MISMATCH";
    }
    await unlink(path).catch((error) => {
      if (errorCode(error) !== "ENOENT") {
        throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
      }
    });
    return "DELETED";
  }

  async #readObjectFile(path: string): Promise<ParsedObjectFile | null> {
    const handle = await open(path, "r").catch((error) => {
      if (errorCode(error) === "ENOENT") return null;
      throw new DocumentObjectStoreFailure("PROVIDER_IO_FAILURE");
    });
    if (handle === null) return null;
    try {
      const metadata = await handle.stat();
      const prefix = Buffer.alloc(256);
      const prefixRead = await handle.read(prefix, 0, prefix.byteLength, 0);
      const header = decodeHeader(prefix.subarray(0, prefixRead.bytesRead));
      if (metadata.size < header.headerBytes + FOOTER_BYTES + 1) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      const footer = Buffer.alloc(FOOTER_BYTES);
      const footerRead = await handle.read(
        footer,
        0,
        footer.byteLength,
        metadata.size - FOOTER_BYTES,
      );
      if (footerRead.bytesRead !== FOOTER_BYTES) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      const authTag = footer.subarray(0, AUTH_TAG_BYTES);
      const sizeBigInt = footer.readBigUInt64BE(AUTH_TAG_BYTES);
      if (sizeBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      const sizeBytes = Number(sizeBigInt);
      const sha256 = footer
        .subarray(AUTH_TAG_BYTES + SIZE_BYTES)
        .toString("hex");
      if (metadata.size !== header.headerBytes + sizeBytes + FOOTER_BYTES) {
        throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
      }
      return Object.freeze({
        ...header,
        authTag: Buffer.from(authTag),
        sizeBytes,
        sha256,
      });
    } finally {
      await handle.close();
    }
  }

  async *#decrypt(
    path: string,
    parsed: ParsedObjectFile,
  ): AsyncGenerator<Uint8Array> {
    const entry = this.#keyring.find(
      (candidate) => candidate.version === parsed.keyVersion,
    );
    if (entry === undefined) {
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    }
    const key = entry.key.withValue((value) => Buffer.from(value, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv);
    key.fill(0);
    decipher.setAuthTag(parsed.authTag);
    const digest = createHash("sha256");
    let total = 0;
    const stream = createReadStream(path, {
      start: parsed.headerBytes,
      end: parsed.headerBytes + parsed.sizeBytes - 1,
      highWaterMark: this.#maximumChunkBytes,
    });
    try {
      for await (const rawChunk of stream) {
        const plaintext = decipher.update(rawChunk as Buffer);
        if (plaintext.byteLength > 0) {
          total += plaintext.byteLength;
          digest.update(plaintext);
          yield new Uint8Array(plaintext);
        }
      }
      const final = decipher.final();
      if (final.byteLength > 0) {
        total += final.byteLength;
        digest.update(final);
        yield new Uint8Array(final);
      }
    } catch {
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    }
    if (total !== parsed.sizeBytes || digest.digest("hex") !== parsed.sha256) {
      throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
    }
  }

  #toReceipt(parsed: ParsedObjectFile): DocumentObjectReceipt {
    return Object.freeze({
      objectVersion: parsed.objectVersion,
      sizeBytes: parsed.sizeBytes,
      sha256: parsed.sha256,
      encryptionKeyVersion: parsed.keyVersion,
      storageRegion: this.storageRegion,
    });
  }

  #pathFor(objectKey: string): string {
    return join(
      this.#root,
      `${createHash("sha256").update(objectKey, "utf8").digest("hex")}.sthobj`,
    );
  }

  #assertObjectKey(objectKey: string): void {
    this.#objectKeyPattern.lastIndex = 0;
    if (!this.#objectKeyPattern.test(objectKey)) {
      throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
    }
  }
}

export class DisabledDocumentObjectStore implements DocumentObjectStore {
  readonly providerClass = "disabled-v1";
  readonly storageRegion = "disabled";

  async putQuarantined(): Promise<never> {
    throw new DocumentObjectStoreFailure("PROVIDER_DISABLED");
  }

  async headObject(): Promise<null> {
    return null;
  }

  async openVerifiedRead(): Promise<null> {
    return null;
  }

  async listObjects(): Promise<readonly []> {
    return Object.freeze([]);
  }

  async deleteObject(): Promise<"MISSING"> {
    return "MISSING";
  }
}

function nextBeforeDeadline(
  iterator: AsyncIterator<Uint8Array>,
  timeoutMilliseconds: number,
): Promise<IteratorResult<Uint8Array>> {
  return new Promise((resolveNext, rejectNext) => {
    const timer = setTimeout(
      () => rejectNext(new DocumentObjectStoreFailure("STREAM_TIMEOUT")),
      timeoutMilliseconds,
    );
    iterator.next().then(
      (result) => {
        clearTimeout(timer);
        resolveNext(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectNext(error);
      },
    );
  });
}

function encodeHeader(
  keyVersion: string,
  objectVersion: string,
  iv: Buffer,
): Buffer {
  const keyBytes = Buffer.from(keyVersion, "utf8");
  const versionBytes = Buffer.from(objectVersion, "utf8");
  if (
    keyBytes.byteLength < 1 ||
    keyBytes.byteLength > 32 ||
    versionBytes.byteLength < 1 ||
    versionBytes.byteLength > 128
  ) {
    throw new DocumentObjectStoreFailure("CONFIGURATION_INVALID");
  }
  return Buffer.concat([
    MAGIC,
    Buffer.of(keyBytes.byteLength),
    keyBytes,
    Buffer.of(versionBytes.byteLength),
    versionBytes,
    iv,
  ]);
}

function decodeHeader(value: Buffer): Readonly<{
  headerBytes: number;
  keyVersion: string;
  objectVersion: string;
  iv: Buffer;
}> {
  if (value.byteLength < MAGIC.byteLength + 1 || !value.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
  }
  let offset = MAGIC.byteLength;
  const keyLength = value[offset] ?? 0;
  offset += 1;
  if (keyLength < 1 || keyLength > 32 || value.byteLength < offset + keyLength + 1) {
    throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
  }
  const keyVersion = value.subarray(offset, offset + keyLength).toString("utf8");
  offset += keyLength;
  const versionLength = value[offset] ?? 0;
  offset += 1;
  if (
    versionLength < 1 ||
    versionLength > 128 ||
    value.byteLength < offset + versionLength + IV_BYTES
  ) {
    throw new DocumentObjectStoreFailure("OBJECT_CORRUPT");
  }
  const objectVersion = value
    .subarray(offset, offset + versionLength)
    .toString("utf8");
  offset += versionLength;
  const iv = Buffer.from(value.subarray(offset, offset + IV_BYTES));
  offset += IV_BYTES;
  return Object.freeze({ headerBytes: offset, keyVersion, objectVersion, iv });
}

function encodeFooter(authTag: Buffer, sizeBytes: number, digest: Buffer): Buffer {
  const size = Buffer.alloc(SIZE_BYTES);
  size.writeBigUInt64BE(BigInt(sizeBytes));
  return Buffer.concat([authTag, size, digest]);
}

function isWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
