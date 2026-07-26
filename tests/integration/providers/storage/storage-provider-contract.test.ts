import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalEncryptedDocumentObjectStore } from "@/lib/providers/storage/local-encrypted-object-store";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Phase 21 encrypted object-store provider contract", () => {
  it("streams, encrypts, heads, verifies, reads and deletes one exact object", async () => {
    const store = await createStore();
    const bytes = Buffer.from("%PDF-1.4\nprovider-contract\n%%EOF", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `candidate-cv/${randomUUID()}`;
    const objectVersion = randomUUID();

    const receipt = await store.putQuarantined({
      objectKey,
      objectVersion,
      expectedSizeBytes: bytes.length,
      expectedSha256: sha256,
      body: chunks(bytes, 4),
    });
    expect(receipt).toEqual({
      objectVersion,
      sizeBytes: bytes.length,
      sha256,
      encryptionKeyVersion: "storage-v1",
      storageRegion: "local-test",
    });
    expect(await store.headObject(objectKey)).toEqual(receipt);
    const opened = await store.openVerifiedRead(objectKey);
    expect(opened?.receipt).toEqual(receipt);
    expect(await collect(opened!.body)).toEqual(bytes);
    expect(await store.listObjects({ limit: 100 })).toEqual([
      expect.objectContaining({
        objectKeyHash: createHash("sha256")
          .update(objectKey, "utf8")
          .digest("hex"),
        sizeBytes: bytes.length,
        sha256,
      }),
    ]);
    await expect(
      store.deleteObject(objectKey, {
        sha256: "0".repeat(64),
        objectVersion,
      }),
    ).resolves.toBe("MISMATCH");
    await expect(
      store.deleteObject(objectKey, { sha256, objectVersion }),
    ).resolves.toBe("DELETED");
    await expect(store.headObject(objectKey)).resolves.toBeNull();
  });

  it.each([
    ["empty", 1, empty(), "EMPTY_BODY"],
    ["short", 10, chunks(Buffer.from("abc"), 2), "SIZE_MISMATCH"],
    [
      "oversize-stream",
      1,
      chunks(Buffer.from("ab"), 2),
      "STREAM_TOO_LARGE",
    ],
    [
      "large-chunk",
      1024 * 1024,
      oneChunk(1024 * 1024 + 1),
      "CHUNK_TOO_LARGE",
    ],
  ])(
    "rejects %s without publishing an object",
    async (_name, expectedSizeBytes, body, code) => {
      const store = await createStore();
      const objectKey = `candidate-cv/${randomUUID()}`;
      await expect(
        store.putQuarantined({
          objectKey,
          objectVersion: randomUUID(),
          expectedSizeBytes,
          body,
        }),
      ).rejects.toMatchObject({ code });
      await expect(store.headObject(objectKey)).resolves.toBeNull();
    },
  );

  it("retains old read keys while selecting only the first key for new writes", async () => {
    const root = await newRoot();
    const old = keyEntry("storage-v1");
    const oldStore = new LocalEncryptedDocumentObjectStore({
      root,
      storageRegion: "local-test",
      keyring: [old] as never,
    });
    const firstKey = `candidate-cv/${randomUUID()}`;
    const bytes = Buffer.from("%PDF-1.4\nrotation\n%%EOF");
    await oldStore.putQuarantined({
      objectKey: firstKey,
      objectVersion: randomUUID(),
      expectedSizeBytes: bytes.length,
      body: chunks(bytes, 8),
    });
    const rotated = new LocalEncryptedDocumentObjectStore({
      root,
      storageRegion: "local-test",
      keyring: [keyEntry("storage-v2"), old] as never,
    });
    expect((await rotated.headObject(firstKey))?.encryptionKeyVersion).toBe(
      "storage-v1",
    );
    expect(await collect((await rotated.openVerifiedRead(firstKey))!.body)).toEqual(
      bytes,
    );
    const nextKey = `candidate-cv/${randomUUID()}`;
    await rotated.putQuarantined({
      objectKey: nextKey,
      objectVersion: randomUUID(),
      expectedSizeBytes: bytes.length,
      body: chunks(bytes, 8),
    });
    expect((await rotated.headObject(nextKey))?.encryptionKeyVersion).toBe(
      "storage-v2",
    );
  });

  it("aborts a stalled stream at the provider deadline without publishing bytes", async () => {
    const root = await newRoot();
    const store = new LocalEncryptedDocumentObjectStore({
      root,
      storageRegion: "local-test",
      keyring: [keyEntry("storage-v1")] as never,
      streamTimeoutMilliseconds: 20,
    });
    const objectKey = `candidate-cv/${randomUUID()}`;
    await expect(
      store.putQuarantined({
        objectKey,
        objectVersion: randomUUID(),
        expectedSizeBytes: 1,
        body: stalled(),
      }),
    ).rejects.toMatchObject({ code: "STREAM_TIMEOUT" });
    await expect(store.headObject(objectKey)).resolves.toBeNull();
  });

  it("rejects repository-local roots and never falls back to the metadata mock", () => {
    expect(
      () =>
        new LocalEncryptedDocumentObjectStore({
          root: resolve(process.cwd(), "unsafe-vault"),
          storageRegion: "local-test",
          keyring: [keyEntry("storage-v1")] as never,
        }),
    ).toThrow(/CONFIGURATION_INVALID/u);
  });
});

async function createStore() {
  return new LocalEncryptedDocumentObjectStore({
    root: await newRoot(),
    storageRegion: "local-test",
    keyring: [keyEntry("storage-v1")] as never,
  });
}

async function newRoot() {
  const root = await mkdtemp(resolve(tmpdir(), "sth-provider-contract-"));
  roots.push(root);
  return root;
}

function keyEntry(version: string) {
  const secret = randomBytes(32).toString("base64");
  return {
    version,
    key: {
      withValue<TResult>(consumer: (value: string) => TResult) {
        return consumer(secret);
      },
    },
  };
}

async function* chunks(bytes: Buffer, size: number) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + size));
  }
}

async function* empty() {}

async function* oneChunk(size: number) {
  yield new Uint8Array(size);
}

async function* stalled() {
  await new Promise(() => undefined);
  yield new Uint8Array([1]);
}

async function collect(source: AsyncIterable<Uint8Array>) {
  const values: Buffer[] = [];
  for await (const chunk of source) values.push(Buffer.from(chunk));
  return Buffer.concat(values);
}
