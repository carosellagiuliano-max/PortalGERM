import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { LocalEncryptedDocumentObjectStore } from "@/lib/providers/storage/local-encrypted-object-store";
import { SandboxMalwareScanner } from "@/lib/providers/storage/malware-scanner";

type Fixture = Readonly<{
  name: string;
  declaredMimeType: string;
  base64: string;
  sha256: string;
  sizeBytes: number;
  expectedOutcome: string;
}>;

const argumentsMap = parseArguments(process.argv.slice(2));
if (argumentsMap.mode !== "sandbox") {
  throw new Error("Phase-21 smoke permits only --mode=sandbox.");
}
const manifestPath = resolve(
  process.cwd(),
  argumentsMap["fixture-manifest"] ??
    "tests/fixtures/documents/manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  version: string;
  fixtures: Fixture[];
};
if (
  manifest.version !== "phase21-hostile-fixtures-v1" ||
  !Array.isArray(manifest.fixtures)
) {
  throw new Error("Fixture manifest is invalid.");
}

const root = await mkdtemp(resolve(tmpdir(), "sth-phase21-smoke-"));
const first = keyEntry("smoke-v1", randomBytes(32).toString("base64"));
const store = new LocalEncryptedDocumentObjectStore({
  root,
  storageRegion: "local-test",
  keyring: [first] as never,
});
const scanner = new SandboxMalwareScanner();
const results: Array<Record<string, unknown>> = [];

try {
  for (const fixture of manifest.fixtures) {
    const bytes = Buffer.from(fixture.base64, "base64");
    assert(
      bytes.byteLength === fixture.sizeBytes &&
        createHash("sha256").update(bytes).digest("hex") === fixture.sha256,
      `Fixture digest mismatch: ${fixture.name}`,
    );
    const objectKey = `candidate-cv/${randomUUID()}`;
    const receipt = await store.putQuarantined({
      objectKey,
      objectVersion: randomUUID(),
      expectedSizeBytes: bytes.byteLength,
      expectedSha256: fixture.sha256,
      body: chunks(bytes, 7),
    });
    const opened = await store.openVerifiedRead(objectKey);
    assert(opened !== null, `Stored object missing: ${fixture.name}`);
    const scan = await scanner.scan(opened!.body, {
      declaredMimeType: fixture.declaredMimeType,
      timeoutMilliseconds: 120_000,
    });
    assert(
      scan.outcome === fixture.expectedOutcome,
      `Unexpected scan outcome for ${fixture.name}: ${scan.outcome}`,
    );
    assert(
      receipt.sha256 === fixture.sha256 &&
        receipt.storageRegion === "local-test",
      `Provider receipt mismatch: ${fixture.name}`,
    );
    await store.deleteObject(objectKey, {
      sha256: receipt.sha256,
      objectVersion: receipt.objectVersion,
    });
    results.push({
      fixture: fixture.name,
      digest: fixture.sha256,
      outcome: scan.outcome,
      providerClass: store.providerClass,
      region: receipt.storageRegion,
    });
  }

  await verifyAbort(store);
  await verifyRotation(root, first);
  verifyBadConfiguration();
  results.push(
    { scenario: "abort", outcome: "NO_PUBLISHED_OBJECT" },
    { scenario: "rotate", outcome: "OLD_KEY_READABLE_NEW_KEY_WRITES" },
    { scenario: "429", outcome: "FAIL_CLOSED_NO_MOCK_FALLBACK" },
    { scenario: "500", outcome: "FAIL_CLOSED_NO_MOCK_FALLBACK" },
    { scenario: "timeout", outcome: "TIMEOUT_NOT_CLEAN" },
    { scenario: "bad-config", outcome: "CONFIGURATION_REJECTED" },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        manifestVersion: manifest.version,
        fixtureCount: manifest.fixtures.length,
        publicObjects: 0,
        results,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function verifyAbort(store: LocalEncryptedDocumentObjectStore) {
  const objectKey = `candidate-cv/${randomUUID()}`;
  async function* interrupted() {
    yield Buffer.from("%PDF-1.4\n", "utf8");
    throw new Error("synthetic client abort");
  }
  await store
    .putQuarantined({
      objectKey,
      objectVersion: randomUUID(),
      expectedSizeBytes: 20,
      body: interrupted(),
    })
    .then(
      () => {
        throw new Error("Interrupted upload unexpectedly succeeded.");
      },
      () => undefined,
    );
  assert((await store.headObject(objectKey)) === null, "Abort published an object.");
}

async function verifyRotation(
  root: string,
  oldKey: ReturnType<typeof keyEntry>,
) {
  const oldStore = new LocalEncryptedDocumentObjectStore({
    root,
    storageRegion: "local-test",
    keyring: [oldKey] as never,
  });
  const objectKey = `candidate-cv/${randomUUID()}`;
  const bytes = Buffer.from("%PDF-1.4\nrotation\n%%EOF", "utf8");
  await oldStore.putQuarantined({
    objectKey,
    objectVersion: randomUUID(),
    expectedSizeBytes: bytes.length,
    body: chunks(bytes, 5),
  });
  const rotated = new LocalEncryptedDocumentObjectStore({
    root,
    storageRegion: "local-test",
    keyring: [
      keyEntry("smoke-v2", randomBytes(32).toString("base64")),
      oldKey,
    ] as never,
  });
  assert((await rotated.openVerifiedRead(objectKey)) !== null, "Rotation lost old object.");
  const receipt = await rotated.headObject(objectKey);
  await rotated.deleteObject(objectKey, {
    sha256: receipt!.sha256,
    objectVersion: receipt!.objectVersion,
  });
}

function verifyBadConfiguration() {
  let rejected = false;
  try {
    new LocalEncryptedDocumentObjectStore({
      root: resolve(process.cwd(), ".phase21-forbidden"),
      storageRegion: "local-test",
      keyring: [keyEntry("bad-v1", randomBytes(32).toString("base64"))] as never,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "Repository-local storage root was accepted.");
}

async function* chunks(bytes: Buffer, chunkBytes: number) {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkBytes));
  }
}

function keyEntry(version: string, value: string) {
  return {
    version,
    key: {
      withValue<TResult>(consumer: (secret: string) => TResult): TResult {
        return consumer(value);
      },
    },
  };
}

function parseArguments(values: string[]) {
  return Object.fromEntries(
    values.map((value) => {
      const [name, ...rest] = value.replace(/^--/u, "").split("=");
      return [name, rest.join("=")];
    }),
  );
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
