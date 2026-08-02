import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import type { SecretHandle } from "@/lib/config/env-schema";
import { DocumentObjectStoreFailure } from "@/lib/providers/storage/document-object-store";
import {
  S3DocumentObjectStore,
  type S3ObjectStoreTransport,
} from "@/lib/providers/storage/s3-document-object-store";

const OBJECT_KEY = "candidate-cv/00000000-0000-4000-8000-000000000001";
const OBJECT_VERSION = "00000000-0000-4000-8000-000000000002";
const BODY = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
const SHA256 = createHash("sha256").update(BODY).digest("hex");

describe("Phase-33 S3-compatible document object-store contract", () => {
  it("uses opaque tenant-safe keys, immutable puts, checksums and idempotency", async () => {
    const transport = new InMemoryS3Transport();
    const store = createStore(transport);

    const first = await store.putQuarantined({
      objectKey: OBJECT_KEY,
      objectVersion: OBJECT_VERSION,
      expectedSizeBytes: BODY.length,
      expectedSha256: SHA256,
      body: chunks(BODY, 7),
    });
    const replay = await store.putQuarantined({
      objectKey: OBJECT_KEY,
      objectVersion: OBJECT_VERSION,
      expectedSizeBytes: BODY.length,
      body: chunks(Buffer.from("ignored-idempotent-replay"), 5),
    });

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      objectVersion: OBJECT_VERSION,
      sizeBytes: BODY.length,
      sha256: SHA256,
      encryptionKeyVersion: "phase33-sse-v1",
      storageRegion: "ch-contract-1",
    });
    expect(transport.puts).toBe(1);
    expect(transport.keys).toHaveLength(1);
    expect(transport.keys[0]).toMatch(
      /^document-vault\/[a-f0-9]{64}\.sthobj$/u,
    );
    expect(transport.keys[0]).not.toContain(OBJECT_KEY);

    await expect(
      store.putQuarantined({
        objectKey: OBJECT_KEY,
        objectVersion: "00000000-0000-4000-8000-000000000003",
        expectedSizeBytes: BODY.length,
        expectedSha256: SHA256,
        body: chunks(BODY, BODY.length),
      }),
    ).rejects.toMatchObject({
      code: "OBJECT_ALREADY_EXISTS",
    } satisfies Partial<DocumentObjectStoreFailure>);
  });

  it("verifies the complete immutable object before exposing a read", async () => {
    const transport = new InMemoryS3Transport();
    const store = createStore(transport);
    await store.putQuarantined({
      objectKey: OBJECT_KEY,
      objectVersion: OBJECT_VERSION,
      expectedSizeBytes: BODY.length,
      expectedSha256: SHA256,
      body: chunks(BODY, 8),
    });

    const opened = await store.openVerifiedRead(OBJECT_KEY);
    expect(opened).not.toBeNull();
    await expect(consume(opened!.body)).resolves.toEqual(BODY);
    expect(transport.gets).toBe(1);
    await expect(store.listObjects({ limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        objectKeyHash: createHash("sha256")
          .update(OBJECT_KEY, "utf8")
          .digest("hex"),
        sha256: SHA256,
        sizeBytes: BODY.length,
      }),
    ]);

    transport.tamper();
    await expect(store.openVerifiedRead(OBJECT_KEY)).rejects.toMatchObject({
      code: "OBJECT_CORRUPT",
    });
  });

  it("binds every KMS read to the exact configured key id", async () => {
    const transport = new InMemoryS3Transport();
    expect(() =>
      createStore(transport, 1024 * 1024, {
        kmsKeyId: "  phase33-kms-key  ",
        serverSideEncryption: "aws:kms",
      }),
    ).toThrow("CONFIGURATION_INVALID");
    const store = createStore(transport, 1024 * 1024, {
      kmsKeyId: "arn:aws:kms:eu-central-2:123456789012:key/phase33",
      serverSideEncryption: "aws:kms",
    });
    await store.putQuarantined({
      objectKey: OBJECT_KEY,
      objectVersion: OBJECT_VERSION,
      expectedSizeBytes: BODY.length,
      expectedSha256: SHA256,
      body: chunks(BODY, 8),
    });
    await expect(store.openVerifiedRead(OBJECT_KEY)).resolves.not.toBeNull();

    transport.replaceKmsKeyId(
      "arn:aws:kms:eu-central-2:123456789012:key/wrong",
    );
    await expect(store.openVerifiedRead(OBJECT_KEY)).rejects.toMatchObject({
      code: "OBJECT_CORRUPT",
    });
  });

  it("refuses unbounded chunks and conditionally deletes exact objects", async () => {
    const transport = new InMemoryS3Transport();
    const store = createStore(transport, 4);
    await expect(
      store.putQuarantined({
        objectKey: OBJECT_KEY,
        objectVersion: OBJECT_VERSION,
        expectedSizeBytes: BODY.length,
        expectedSha256: SHA256,
        body: chunks(BODY, BODY.length),
      }),
    ).rejects.toMatchObject({ code: "CHUNK_TOO_LARGE" });

    const normalStore = createStore(transport);
    await normalStore.putQuarantined({
      objectKey: OBJECT_KEY,
      objectVersion: OBJECT_VERSION,
      expectedSizeBytes: BODY.length,
      expectedSha256: SHA256,
      body: chunks(BODY, 9),
    });
    await expect(
      normalStore.deleteObject(OBJECT_KEY, {
        objectVersion: "wrong-version",
        sha256: SHA256,
      }),
    ).resolves.toBe("MISMATCH");
    await expect(
      normalStore.deleteObject(OBJECT_KEY, {
        objectVersion: OBJECT_VERSION,
        sha256: SHA256,
      }),
    ).resolves.toBe("DELETED");
    await expect(normalStore.headObject(OBJECT_KEY)).resolves.toBeNull();
  });
});

function createStore(
  transport: InMemoryS3Transport,
  maximumChunkBytes = 1024 * 1024,
  encryption: Readonly<{
    kmsKeyId?: string;
    serverSideEncryption: "AES256" | "aws:kms";
  }> = { serverSideEncryption: "AES256" },
) {
  return new S3DocumentObjectStore({
    accessKeyId: secret("contract-access"),
    bucket: "phase33-documents",
    endpoint: "http://object-store:9000",
    encryptionKeyVersion: "phase33-sse-v1",
    forcePathStyle: true,
    maximumChunkBytes,
    namespace: "document-vault",
    providerClass: "s3-contract-v1",
    region: "ch-contract-1",
    requestTimeoutMilliseconds: 2_000,
    secretAccessKey: secret("contract-secret"),
    ...encryption,
    transport: transport as unknown as S3ObjectStoreTransport,
  });
}

function secret(value: string): SecretHandle<string> {
  return {
    withValue: (consumer) => consumer(value),
  } as SecretHandle<string>;
}

type StoredObject = {
  body: Buffer;
  checksum: string;
  etag: string;
  key: string;
  metadata: Record<string, string>;
  serverSideEncryption: "AES256" | "aws:kms";
  kmsKeyId: string | undefined;
};

class InMemoryS3Transport {
  readonly keys: string[] = [];
  puts = 0;
  gets = 0;
  #stored: StoredObject | null = null;

  async send(command: unknown): Promise<unknown> {
    if (command instanceof HeadObjectCommand) {
      if (this.#stored === null || command.input.Key !== this.#stored.key) {
        throw missing();
      }
      return this.#head();
    }
    if (command instanceof PutObjectCommand) {
      if (this.#stored !== null) throw precondition();
      const body = await consume(asIterable(command.input.Body));
      const checksum = createHash("sha256").update(body).digest("hex");
      const key = command.input.Key!;
      const serverSideEncryption = command.input.ServerSideEncryption;
      if (
        serverSideEncryption !== "AES256" &&
        serverSideEncryption !== "aws:kms"
      ) {
        throw new Error("UNEXPECTED_S3_ENCRYPTION_MODE");
      }
      this.puts += 1;
      this.keys.push(key);
      this.#stored = {
        body,
        checksum,
        etag: '"phase33-etag"',
        key,
        metadata: { ...(command.input.Metadata ?? {}) },
        serverSideEncryption,
        kmsKeyId: command.input.SSEKMSKeyId,
      };
      return {
        ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64"),
      };
    }
    if (command instanceof GetObjectCommand) {
      if (this.#stored === null || command.input.Key !== this.#stored.key) {
        throw missing();
      }
      this.gets += 1;
      return {
        Body: Readable.from(chunks(this.#stored.body, 6)),
        ChecksumSHA256: Buffer.from(this.#stored.checksum, "hex").toString(
          "base64",
        ),
      };
    }
    if (command instanceof ListObjectsV2Command) {
      return {
        Contents:
          this.#stored === null
            ? []
            : [{ Key: this.#stored.key, LastModified: new Date(0) }],
      };
    }
    if (command instanceof DeleteObjectCommand) {
      if (this.#stored === null || command.input.Key !== this.#stored.key) {
        throw missing();
      }
      if (command.input.IfMatch !== this.#stored.etag) throw precondition();
      this.#stored = null;
      return {};
    }
    throw new Error("UNEXPECTED_S3_COMMAND");
  }

  tamper(): void {
    if (this.#stored === null) throw new Error("OBJECT_MISSING");
    this.#stored.body = Buffer.from(this.#stored.body);
    this.#stored.body[5] = this.#stored.body[5]! ^ 0xff;
  }

  replaceKmsKeyId(kmsKeyId: string): void {
    if (this.#stored === null) throw new Error("OBJECT_MISSING");
    this.#stored.kmsKeyId = kmsKeyId;
  }

  #head() {
    return {
      ChecksumSHA256: Buffer.from(this.#stored!.checksum, "hex").toString(
        "base64",
      ),
      ContentLength: this.#stored!.body.length,
      ETag: this.#stored!.etag,
      Metadata: this.#stored!.metadata,
      ServerSideEncryption: this.#stored!.serverSideEncryption,
      SSEKMSKeyId: this.#stored!.kmsKeyId,
    };
  }
}

function asIterable(value: unknown): AsyncIterable<Uint8Array> {
  if (
    typeof value !== "object" ||
    value === null ||
    !(Symbol.asyncIterator in value)
  ) {
    throw new Error("S3_BODY_NOT_STREAMING");
  }
  return value as AsyncIterable<Uint8Array>;
}

function missing() {
  return Object.assign(new Error("NotFound"), {
    name: "NotFound",
    $metadata: { httpStatusCode: 404 },
  });
}

function precondition() {
  return Object.assign(new Error("PreconditionFailed"), {
    name: "PreconditionFailed",
    $metadata: { httpStatusCode: 412 },
  });
}

async function consume(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function* chunks(bytes: Buffer, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
  }
}
