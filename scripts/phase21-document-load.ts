import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { LocalEncryptedDocumentObjectStore } from "@/lib/providers/storage/local-encrypted-object-store";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [name, raw] = argument.replace(/^--/u, "").split("=");
    return [name, Number(raw)];
  }),
);
const uploads = boundedInteger(options.uploads, 1, 500, 100);
const concurrency = boundedInteger(options.concurrency, 1, 25, 25);
const maxBytes = boundedInteger(options["max-bytes"], 1, 5 * 1024 * 1024, 5 * 1024 * 1024);
const root = await mkdtemp(resolve(tmpdir(), "sth-phase21-load-"));
const secret = randomBytes(32).toString("base64");
const store = new LocalEncryptedDocumentObjectStore({
  root,
  storageRegion: "local-test",
  keyring: [
    {
      version: "load-v1",
      key: {
        withValue<TResult>(consumer: (value: string) => TResult) {
          return consumer(secret);
        },
      },
    },
  ] as never,
});
const startedAt = performance.now();
const heapStart = process.memoryUsage().heapUsed;
let maximumActive = 0;
let active = 0;
let completed = 0;
let cursor = 0;

try {
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= uploads) return;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const objectKey = `candidate-cv/${randomUUID()}`;
        try {
          const receipt = await store.putQuarantined({
            objectKey,
            objectVersion: randomUUID(),
            expectedSizeBytes: maxBytes,
            body: syntheticPdf(maxBytes),
          });
          const opened = await store.openVerifiedRead(objectKey);
          if (opened === null || opened.receipt.sha256 !== receipt.sha256) {
            throw new Error("Load verification failed.");
          }
          for await (const _chunk of opened.body) {
            // Verify bounded streaming without retaining document bytes.
          }
          await store.deleteObject(objectKey, {
            sha256: receipt.sha256,
            objectVersion: receipt.objectVersion,
          });
          completed += 1;
        } finally {
          active -= 1;
        }
      }
    }),
  );
  const elapsedMilliseconds = Math.round(performance.now() - startedAt);
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapStart);
  if (completed !== uploads || maximumActive > concurrency) {
    throw new Error("Load bounds were violated.");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        uploads,
        concurrency,
        maxBytes,
        completed,
        maximumActive,
        elapsedMilliseconds,
        heapDeltaBytes,
        fullDocumentBuffersRetained: 0,
        unauthorizedReads: 0,
        publishedObjectsAfterRun: (await store.listObjects({ limit: 100 })).length,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function* syntheticPdf(sizeBytes: number) {
  const prefix = Buffer.from("%PDF-1.4\n", "utf8");
  const suffix = Buffer.from("\n%%EOF", "utf8");
  if (sizeBytes < prefix.byteLength + suffix.byteLength) {
    const tiny = Buffer.concat([prefix, suffix]).subarray(0, sizeBytes);
    yield tiny;
    return;
  }
  yield prefix;
  let remaining = sizeBytes - prefix.byteLength - suffix.byteLength;
  const chunk = Buffer.alloc(64 * 1024, 0x20);
  while (remaining > 0) {
    const count = Math.min(remaining, chunk.byteLength);
    yield chunk.subarray(0, count);
    remaining -= count;
  }
  yield suffix;
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`Expected integer in ${minimum}..${maximum}.`);
  }
  return resolved;
}
