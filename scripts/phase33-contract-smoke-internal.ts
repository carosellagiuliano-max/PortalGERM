import { createHash } from "node:crypto";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  assertPhase33ContractTopology,
  probePhase33ContractDependencies,
} from "@/lib/ops/phase33-contract-probes";
import { createEmailDeliveryProvider } from "@/lib/providers/email/delivery-composition";
import { createHostedPaymentProvider } from "@/lib/providers/payments/payment-composition";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";
import { bindObjectStoreToProviderAuthority } from "@/lib/providers/storage/provider-authority-bound-object-store";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";

const providerOrigin = "http://provider-contract:8080";
const fixture = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
  "ascii",
);
const fixtureDigest = createHash("sha256").update(fixture).digest("hex");
const objectKey = "candidate-cv/00000000-0000-4000-8000-000000000033";
const objectVersion = "phase33-contract-smoke-v1";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-contract-smoke-internal",
      error: safeErrorCode(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  const environment = parseEnvironment(process.env);
  assertPhase33ContractTopology(environment);
  await probePhase33ContractDependencies(environment);
  await Promise.all([
    verifyEmailComposition(environment),
    verifyPaymentComposition(environment),
    verifyRuntimeRole("worker-contract", "worker", environment.APP_BUILD_ID),
    verifyRuntimeRole(
      "scheduler-contract",
      "scheduler",
      environment.APP_BUILD_ID,
    ),
  ]);
  await verifyStorageRoundTrip(environment);
  const database = environment.secrets.database.withValue(createDatabaseClient);
  try {
    await verifyPrivacyDatabaseAuthority(environment, database);
    await verifyPrivacyStorageRoundTrip(environment, database);
  } finally {
    await database.$disconnect();
  }
  await verifyClamAvScan(environment);
  await verifyProviderSummary();

  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-contract-smoke-internal",
      effects: "ISOLATED_CONTRACT_ONLY",
      providerFailureInjection: "PASS",
      providerSuccess: "PASS",
      roles: ["scheduler", "worker"],
      scanner: "PASS",
      status: "PASS",
      storageRoundTrip: "PASS",
      privacyStorageRoundTrip: "PASS",
      privacyDatabaseAuthority: "PASS",
    })}\n`,
  );
}

async function verifyPrivacyStorageRoundTrip(
  environment: ReturnType<typeof parseEnvironment>,
  database: DatabaseClient,
) {
  const store = bindObjectStoreToProviderAuthority({
    binding: privacyExportStoreActivationBinding(environment),
    database,
    delegate: createPrivacyExportObjectStore(environment),
    environment,
  });
  if (store.providerClass !== "privacy-export-s3-contract-v1") {
    throw new Error("PHASE33_CONTRACT_PRIVACY_STORAGE_IDENTITY_MISMATCH");
  }
  const key = "privacy-export/00000000-0000-4000-8000-000000000037";
  const version = "phase33-contract-privacy-smoke-v1";
  const receipt = await store.putQuarantined({
    body: chunks(fixture),
    expectedSha256: fixtureDigest,
    expectedSizeBytes: fixture.byteLength,
    objectKey: key,
    objectVersion: version,
  });
  const opened = await store.openVerifiedRead(key);
  if (opened === null || receipt.sha256 !== fixtureDigest) {
    throw new Error("PHASE33_CONTRACT_PRIVACY_STORAGE_READ_MISSING");
  }
  const received: Buffer[] = [];
  for await (const chunk of opened.body) received.push(Buffer.from(chunk));
  if (!Buffer.concat(received).equals(fixture)) {
    throw new Error("PHASE33_CONTRACT_PRIVACY_STORAGE_READ_MISMATCH");
  }
  const deleted = await store.deleteObject(key, {
    objectVersion: version,
    sha256: fixtureDigest,
  });
  if (deleted !== "DELETED" || (await store.headObject(key)) !== null) {
    throw new Error("PHASE33_CONTRACT_PRIVACY_STORAGE_DELETE_MISMATCH");
  }
}

async function verifyPrivacyDatabaseAuthority(
  environment: ReturnType<typeof parseEnvironment>,
  database: DatabaseClient,
) {
  const binding = privacyExportStoreActivationBinding(environment);
  const deploymentDigest = environment.APP_BUILD_ID;
  if (
    binding === null ||
    binding.expectedMode !== "ALLOWLIST" ||
    deploymentDigest === undefined
  ) {
    throw new Error("PHASE33_CONTRACT_PRIVACY_AUTHORITY_BINDING_MISSING");
  }
  const [providerCount, handlerActivations] = await Promise.all([
    database.providerActivation.count({
      where: {
        adapterKey: binding.adapterKey,
        adapterVersion: binding.adapterVersion,
        configurationDigest: binding.expectedConfigurationDigest,
        environment: environment.APP_ENV,
        health: "HEALTHY",
        killSwitchEngaged: false,
        mode: "ALLOWLIST",
        revokedAt: null,
        secretVersionRef: binding.expectedSecretVersionRef,
        useCase: binding.useCase,
      },
    }),
    database.workerHandlerActivation.findMany({
      where: {
        deploymentDigest,
        environment: environment.APP_ENV,
        handlerKey: {
          in: ["privacy.export", "privacy.correction", "privacy.erasure"],
        },
        killSwitchEngaged: false,
        mode: "SANDBOX",
        payloadVersion: "v1",
        revokedAt: null,
      },
      orderBy: { handlerKey: "asc" },
      select: {
        handlerKey: true,
        handlerVersion: true,
        payloadVersion: true,
      },
    }),
  ]);
  if (
    providerCount !== 1 ||
    JSON.stringify(handlerActivations) !==
      JSON.stringify([
        {
          handlerKey: "privacy.correction",
          handlerVersion: "v1",
          payloadVersion: "v1",
        },
        {
          handlerKey: "privacy.erasure",
          handlerVersion: "v1",
          payloadVersion: "v1",
        },
        {
          handlerKey: "privacy.export",
          handlerVersion: "v1",
          payloadVersion: "v1",
        },
      ])
  ) {
    throw new Error("PHASE33_CONTRACT_PRIVACY_DATABASE_AUTHORITY_MISMATCH");
  }
}

async function verifyEmailComposition(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const provider = createEmailDeliveryProvider(environment);
  const receipt = await provider.deliver({
    idempotencyKey: "phase33-contract-resend-success-v1",
    subject: "Phase 33 isolated contract probe",
    templateData: Object.freeze({}),
    templateKey: "registration_welcome",
    text: "No external delivery is possible in this isolated topology.",
    timeoutMilliseconds: 5_000,
    to: "sink@contract.invalid",
  });
  if (
    receipt.providerClass !== "resend-contract-v1" ||
    !receipt.providerReceipt.startsWith("contract_email_")
  ) {
    throw new Error("PHASE33_CONTRACT_RESEND_COMPOSITION_MISMATCH");
  }
  const credential = environment.secrets.emailProvider;
  if (credential === undefined) {
    throw new Error("PHASE33_CONTRACT_RESEND_CREDENTIAL_MISSING");
  }
  await credential.withValue(async (apiKey) => {
    const failure = await contractRequest("/resend/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": "phase33-contract-resend-failure-v1",
        "x-phase33-contract-scenario": "rate_limited",
      },
      body: JSON.stringify({ probe: true }),
    });
    expectProviderResponse(failure, 429);
  });
}

async function verifyPaymentComposition(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const provider = createHostedPaymentProvider(environment);
  const expiresAt = new Date(Date.now() + 35 * 60_000);
  const checkout = await provider.createCheckout({
    authoritative: {
      amountRappen: 16_107,
      checkout: {
        billingInterval: "MONTHLY",
        kind: "SUBSCRIPTION",
        providerPriceReference: "price_phase33contract",
      },
      currency: "CHF",
      customerEmail: "billing@contract.invalid",
      description: "Phase 33 isolated contract subscription",
      expiresAt,
      paymentAttemptId: "00000000-0000-4000-8000-000000000034",
      quoteDigest: "a".repeat(64),
    },
    cancelUrl: "https://contract.invalid/employer/billing/subscription",
    idempotencyKey: "phase33-contract-stripe-success-v1",
    orderId: "00000000-0000-4000-8000-000000000035",
    successUrl: "https://contract.invalid/employer/billing/success",
  });
  if (
    checkout.provider !== "STRIPE" ||
    !checkout.providerSessionReference?.startsWith("cs_contract_") ||
    !checkout.checkoutUrl.startsWith("https://checkout.contract.invalid/")
  ) {
    throw new Error("PHASE33_CONTRACT_STRIPE_COMPOSITION_MISMATCH");
  }
  const credential = environment.secrets.stripeSecretKey;
  if (credential === undefined) {
    throw new Error("PHASE33_CONTRACT_STRIPE_CREDENTIAL_MISSING");
  }
  await credential.withValue(async (secretKey) => {
    const failure = await contractRequest("/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": "phase33-contract-stripe-failure-v1",
        "x-phase33-contract-scenario": "unavailable",
      },
      body: "mode=subscription",
    });
    expectProviderResponse(failure, 500);
  });
}

async function verifyProviderSummary() {
  const summary = await contractRequest("/contract/summary", {
    method: "GET",
  });
  expectProviderResponse(summary, 200);
  const parsed = safeJson(summary.body);
  const counters = asRecord(parsed?.counters);
  if (
    parsed?.providerMode !== "CONTRACT_STUB_ONLY" ||
    typeof counters?.resend !== "number" ||
    counters.resend < 2 ||
    typeof counters["stripe-checkout"] !== "number" ||
    counters["stripe-checkout"] < 2
  ) {
    throw new Error("PHASE33_CONTRACT_PROVIDER_COUNTER_MISMATCH");
  }
}

async function verifyStorageRoundTrip(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const store = createDocumentObjectStore(environment);
  if (store.providerClass !== "s3-contract-v1") {
    throw new Error("PHASE33_CONTRACT_STORAGE_IDENTITY_MISMATCH");
  }
  const receipt = await store.putQuarantined({
    body: chunks(fixture),
    expectedSha256: fixtureDigest,
    expectedSizeBytes: fixture.byteLength,
    objectKey,
    objectVersion,
  });
  if (
    receipt.sha256 !== fixtureDigest ||
    receipt.sizeBytes !== fixture.byteLength ||
    receipt.objectVersion !== objectVersion
  ) {
    throw new Error("PHASE33_CONTRACT_STORAGE_RECEIPT_MISMATCH");
  }
  const opened = await store.openVerifiedRead(objectKey);
  if (opened === null) {
    throw new Error("PHASE33_CONTRACT_STORAGE_READ_MISSING");
  }
  const received: Buffer[] = [];
  for await (const chunk of opened.body) received.push(Buffer.from(chunk));
  if (!Buffer.concat(received).equals(fixture)) {
    throw new Error("PHASE33_CONTRACT_STORAGE_READ_MISMATCH");
  }
  const deleted = await store.deleteObject(objectKey, {
    objectVersion,
    sha256: fixtureDigest,
  });
  if (deleted !== "DELETED" || (await store.headObject(objectKey)) !== null) {
    throw new Error("PHASE33_CONTRACT_STORAGE_DELETE_MISMATCH");
  }
}

async function verifyClamAvScan(
  environment: ReturnType<typeof parseEnvironment>,
) {
  const scanner = createDocumentMalwareScanner(environment);
  if (scanner.providerClass !== "clamav-contract-v1") {
    throw new Error("PHASE33_CONTRACT_SCANNER_IDENTITY_MISMATCH");
  }
  const receipt = await scanner.scan(chunks(fixture), {
    declaredMimeType: "application/pdf",
    timeoutMilliseconds: 10_000,
  });
  if (
    receipt.outcome !== "CLEAN" ||
    !receipt.engineVersion.startsWith("clamav-")
  ) {
    throw new Error("PHASE33_CONTRACT_SCANNER_RESULT_MISMATCH");
  }
}

async function verifyRuntimeRole(
  host: "worker-contract" | "scheduler-contract",
  role: "worker" | "scheduler",
  buildIdentifier: string | undefined,
) {
  if (buildIdentifier === undefined) {
    throw new Error("PHASE33_CONTRACT_BUILD_ID_MISSING");
  }
  for (const endpoint of ["live", "ready"] as const) {
    const response = await fetch(`http://${host}:3001/health/${endpoint}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await readBoundedResponse(response);
    const parsed = safeJson(body);
    if (
      response.status !== 200 ||
      parsed?.role !== role ||
      (endpoint === "live" && parsed.buildId !== buildIdentifier) ||
      (endpoint === "ready" && parsed.status !== "ready")
    ) {
      throw new Error("PHASE33_CONTRACT_RUNTIME_ROLE_MISMATCH");
    }
  }
}

async function contractRequest(path: string, init: RequestInit) {
  const response = await fetch(`${providerOrigin}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await readBoundedResponse(response);
  return Object.freeze({ response, body });
}

function expectProviderResponse(
  result: Readonly<{ response: Response; body: string }>,
  status: number,
) {
  if (
    result.response.status !== status ||
    result.response.headers.get("x-phase33-provider-mode") !==
      "CONTRACT_STUB_ONLY" ||
    safeJson(result.body) === null
  ) {
    throw new Error("PHASE33_CONTRACT_PROVIDER_RESPONSE_MISMATCH");
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 64 * 1024) {
        await reader.cancel("Phase-33 contract response exceeded its bound");
        throw new Error("PHASE33_CONTRACT_RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function* chunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
}

function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "PHASE33_CONTRACT_SMOKE_FAILURE";
  const code = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 96);
  return /^[A-Z0-9][A-Z0-9_:-]{1,95}$/u.test(code)
    ? code
    : "PHASE33_CONTRACT_SMOKE_FAILURE";
}
