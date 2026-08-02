import { createHash } from "node:crypto";

import { verifyPassword } from "@/lib/auth/password";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { createEmailDeliveryProvider } from "@/lib/providers/email/delivery-composition";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import {
  SEED_DATASET_VERSION,
  SEED_GOLDEN_COUNTS,
  SEED_NAMESPACE,
} from "@/prisma/seed/contract";
import { DEMO_LOGIN_PASSWORD } from "@/prisma/seed/fixtures/companies-jobs";

const fixture = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
  "ascii",
);
const fixtureDigest = createHash("sha256").update(fixture).digest("hex");
const objectKey = "candidate-cv/00000000-0000-4000-8000-000000000036";
const objectVersion = "phase33-local-smoke-v1";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-local-smoke-internal",
      error: safeErrorCode(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  const environment = parseEnvironment(process.env);
  if (
    environment.APP_ENV !== "local" ||
    environment.EMAIL_PROVIDER_MODE !== "local_mock" ||
    environment.PAYMENT_PROVIDER_MODE !== "disabled" ||
    environment.DOCUMENT_STORAGE_MODE !== "filesystem_sandbox" ||
    environment.DOCUMENT_SCANNER_MODE !== "sandbox" ||
    environment.PRIVACY_EXPORT_STORAGE_MODE !== "filesystem_sandbox"
  ) {
    throw new Error("PHASE33_LOCAL_SMOKE_TOPOLOGY_INVALID");
  }

  await Promise.all([
    verifyAppHealth(environment.APP_BUILD_ID),
    verifyRuntimeRole("worker-local", "worker", environment.APP_BUILD_ID),
    verifyRuntimeRole("scheduler-local", "scheduler", environment.APP_BUILD_ID),
  ]);
  await verifySeedAndDemoSurfaces(environment);
  await verifyLocalEmail(environment);
  await verifyLocalStorage(environment);
  await verifyLocalPrivacyStorage(environment);
  await verifyLocalScanner(environment);

  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-local-smoke-internal",
      emailMockPersistence: "PASS",
      demoLoginCredential: "PASS",
      demoSurfaces: ["/", "/jobs", "/jobs/:slug", "/login"],
      externalPaymentEffect: "DISABLED",
      roles: ["scheduler", "worker"],
      scannerSandbox: "PASS",
      status: "PASS",
      storageRoundTrip: "PASS",
      privacyStorageRoundTrip: "PASS",
    })}\n`,
  );
}

async function verifySeedAndDemoSurfaces(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const database = environment.secrets.database.withValue(createDatabaseClient);
  try {
    const [manifest, companyCount, jobCount, candidate, employer, jobs] =
      await Promise.all([
        database.demoSeedManifest.findUnique({
          where: {
            namespace_seedVersion: {
              namespace: SEED_NAMESPACE,
              seedVersion: SEED_DATASET_VERSION,
            },
          },
          select: { completedAt: true, manifestHash: true },
        }),
        database.company.count({ where: { dataProvenance: "DEMO" } }),
        database.job.count({ where: { dataProvenance: "DEMO" } }),
        database.user.findUnique({
          where: { emailNormalized: "candidate@demo.ch" },
          select: {
            credential: { select: { passwordHash: true } },
            emailVerifiedAt: true,
            status: true,
          },
        }),
        database.user.findUnique({
          where: { emailNormalized: "employer@demo.ch" },
          select: {
            credential: { select: { passwordHash: true } },
            emailVerifiedAt: true,
            status: true,
          },
        }),
        database.job.findMany({
          where: {
            dataProvenance: "DEMO",
            publishedRevisionId: { not: null },
            status: "PUBLISHED",
          },
          orderBy: { slug: "asc" },
          select: {
            publishedRevision: { select: { title: true } },
            slug: true,
          },
          take: 20,
        }),
      ]);

    const visibleJob = jobs[0];
    if (
      manifest?.completedAt === null ||
      manifest?.completedAt === undefined ||
      manifest.manifestHash === null ||
      companyCount !== SEED_GOLDEN_COUNTS.companies ||
      jobCount !== SEED_GOLDEN_COUNTS.jobs ||
      jobs.length === 0 ||
      visibleJob === undefined
    ) {
      throw new Error("PHASE33_LOCAL_DEMO_SEED_MISMATCH");
    }

    await Promise.all([
      verifyDemoCredential(candidate),
      verifyDemoCredential(employer),
      verifyHtmlRoute("/", ["SwissTalentHub"]),
      verifyHtmlRoute("/jobs", ["Finde deinen nächsten fairen Job"]),
      verifyVisibleDemoJob(jobs),
      verifyHtmlRoute("/login", [
        "Willkommen zurück",
        'name="email"',
        'name="password"',
      ]),
    ]);
  } finally {
    await database.$disconnect();
  }
}

async function verifyVisibleDemoJob(
  jobs: readonly Readonly<{
    publishedRevision: Readonly<{ title: string }> | null;
    slug: string;
  }>[],
) {
  for (const job of jobs) {
    if (job.publishedRevision === null) continue;
    try {
      await verifyHtmlRoute(`/jobs/${encodeURIComponent(job.slug)}`, [
        job.publishedRevision.title,
      ]);
      return;
    } catch {
      // A fixture can intentionally be expired or otherwise fail closed. The
      // contract requires at least one public DEMO job to cross the app HTTP
      // boundary, while `/jobs` below still validates the complete listing.
    }
  }
  throw new Error("PHASE33_LOCAL_DEMO_JOB_NOT_VISIBLE");
}

async function verifyDemoCredential(
  user:
    | Readonly<{
        credential: Readonly<{ passwordHash: string }> | null;
        emailVerifiedAt: Date | null;
        status: string;
      }>
    | null,
) {
  if (
    user?.status !== "ACTIVE" ||
    user.emailVerifiedAt === null ||
    user.credential === null ||
    !(await verifyPassword(DEMO_LOGIN_PASSWORD, user.credential.passwordHash))
  ) {
    throw new Error("PHASE33_LOCAL_DEMO_LOGIN_MISMATCH");
  }
}

async function verifyHtmlRoute(path: string, markers: readonly string[]) {
  const response = await fetch(`http://app-local:3000${path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.startsWith("text/html") ||
    body.length > 2 * 1024 * 1024 ||
    markers.some((marker) => !body.includes(marker))
  ) {
    throw new Error(`PHASE33_LOCAL_DEMO_SURFACE_FAILED:${path}`);
  }
}

async function verifyLocalPrivacyStorage(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const store = createPrivacyExportObjectStore(environment);
  if (store.providerClass !== "privacy-export-filesystem-encrypted-sandbox-v1") {
    throw new Error("PHASE33_LOCAL_PRIVACY_STORAGE_PROVIDER_MISMATCH");
  }
  const key = "privacy-export/00000000-0000-4000-8000-000000000038";
  const version = "phase33-local-privacy-smoke-v1";
  const receipt = await store.putQuarantined({
    body: chunks(fixture),
    expectedSha256: fixtureDigest,
    expectedSizeBytes: fixture.byteLength,
    objectKey: key,
    objectVersion: version,
  });
  const opened = await store.openVerifiedRead(key);
  if (opened === null || receipt.sha256 !== fixtureDigest) {
    throw new Error("PHASE33_LOCAL_PRIVACY_STORAGE_READ_MISSING");
  }
  const received: Buffer[] = [];
  for await (const chunk of opened.body) received.push(Buffer.from(chunk));
  if (!Buffer.concat(received).equals(fixture)) {
    throw new Error("PHASE33_LOCAL_PRIVACY_STORAGE_READ_MISMATCH");
  }
  const deleted = await store.deleteObject(key, {
    objectVersion: version,
    sha256: fixtureDigest,
  });
  if (deleted !== "DELETED" || (await store.headObject(key)) !== null) {
    throw new Error("PHASE33_LOCAL_PRIVACY_STORAGE_DELETE_MISMATCH");
  }
}

async function verifyLocalEmail(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const provider = createEmailDeliveryProvider(environment);
  const receipt = await provider.deliver({
    idempotencyKey: "phase33-local-email-smoke-v1",
    subject: "Willkommen bei SwissTalentHub",
    templateData: Object.freeze({}),
    templateKey: "registration_welcome",
    text: "Local mock only.",
    timeoutMilliseconds: 5_000,
    to: "local-smoke@phase33.invalid",
  });
  if (receipt.providerClass !== "local-mock-v1") {
    throw new Error("PHASE33_LOCAL_EMAIL_PROVIDER_MISMATCH");
  }
  const database = environment.secrets.database.withValue(createDatabaseClient);
  try {
    const persisted = await database.emailLog.findUnique({
      where: { id: receipt.providerReceipt },
      select: { providerReference: true, status: true },
    });
    if (
      persisted?.status !== "MOCK_RECORDED" ||
      persisted.providerReference === null ||
      !persisted.providerReference.startsWith("mock-email-v2:")
    ) {
      throw new Error("PHASE33_LOCAL_EMAIL_PERSISTENCE_MISMATCH");
    }
  } finally {
    await database.$disconnect();
  }
}

async function verifyLocalStorage(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const store = createDocumentObjectStore(environment);
  if (store.providerClass !== "filesystem-encrypted-sandbox-v1") {
    throw new Error("PHASE33_LOCAL_STORAGE_PROVIDER_MISMATCH");
  }
  const receipt = await store.putQuarantined({
    body: chunks(fixture),
    expectedSha256: fixtureDigest,
    expectedSizeBytes: fixture.byteLength,
    objectKey,
    objectVersion,
  });
  const opened = await store.openVerifiedRead(objectKey);
  if (opened === null || receipt.sha256 !== fixtureDigest) {
    throw new Error("PHASE33_LOCAL_STORAGE_READ_MISSING");
  }
  const received: Buffer[] = [];
  for await (const chunk of opened.body) received.push(Buffer.from(chunk));
  if (!Buffer.concat(received).equals(fixture)) {
    throw new Error("PHASE33_LOCAL_STORAGE_READ_MISMATCH");
  }
  const deleted = await store.deleteObject(objectKey, {
    objectVersion,
    sha256: fixtureDigest,
  });
  if (deleted !== "DELETED" || (await store.headObject(objectKey)) !== null) {
    throw new Error("PHASE33_LOCAL_STORAGE_DELETE_MISMATCH");
  }
}

async function verifyLocalScanner(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const scanner = createDocumentMalwareScanner(environment);
  const receipt = await scanner.scan(chunks(fixture), {
    declaredMimeType: "application/pdf",
    timeoutMilliseconds: 5_000,
  });
  if (
    scanner.providerClass !== "sandbox-content-scanner-v1" ||
    receipt.outcome !== "CLEAN"
  ) {
    throw new Error("PHASE33_LOCAL_SCANNER_MISMATCH");
  }
}

async function verifyAppHealth(buildIdentifier: string | undefined) {
  const live = await jsonHealth("http://app-local:3000/health/live");
  const ready = await jsonHealth("http://app-local:3000/health/ready");
  if (
    buildIdentifier === undefined ||
    live.status !== "ok" ||
    live.buildId !== buildIdentifier ||
    ready.status !== "ready"
  ) {
    throw new Error("PHASE33_LOCAL_APP_HEALTH_MISMATCH");
  }
}

async function verifyRuntimeRole(
  host: "worker-local" | "scheduler-local",
  role: "worker" | "scheduler",
  buildIdentifier: string | undefined,
) {
  const live = await jsonHealth(`http://${host}:3001/health/live`);
  const ready = await jsonHealth(`http://${host}:3001/health/ready`);
  if (
    buildIdentifier === undefined ||
    live.role !== role ||
    live.buildId !== buildIdentifier ||
    ready.role !== role ||
    ready.status !== "ready"
  ) {
    throw new Error("PHASE33_LOCAL_RUNTIME_ROLE_MISMATCH");
  }
}

async function jsonHealth(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  if (response.status !== 200 || body.length > 64 * 1024) {
    throw new Error("PHASE33_LOCAL_HEALTH_FAILED");
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("PHASE33_LOCAL_HEALTH_JSON_INVALID");
  }
  return parsed as Record<string, unknown>;
}

async function* chunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "PHASE33_LOCAL_SMOKE_FAILURE";
  const code = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 96);
  return /^[A-Z0-9][A-Z0-9_:-]{1,95}$/u.test(code)
    ? code
    : "PHASE33_LOCAL_SMOKE_FAILURE";
}
