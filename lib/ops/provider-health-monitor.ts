import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { paymentProviderActivationBinding } from "@/lib/providers/payments/provider-activation-binding";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";

const healthyProbeIntervalMilliseconds = 60_000;
const degradedProbeIntervalMilliseconds = 15_000;
const probeTimeoutMilliseconds = 5_000;
const maximumProbeBodyBytes = 16 * 1024;

export type ProviderHealthProbeKind =
  | "EMAIL"
  | "DOCUMENT_OBJECT_STORE"
  | "DOCUMENT_SCANNER"
  | "PRIVACY_EXPORT_STORE"
  | "PAYMENT";

type HealthBinding = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  expectedConfigurationDigest: string;
  expectedMode: "SANDBOX" | "ALLOWLIST" | "LIVE";
  expectedSecretVersionRef: string;
  probeKind: ProviderHealthProbeKind;
  useCase: string;
}>;

export type ProviderHealthRefreshSummary = Readonly<{
  checked: number;
  degraded: number;
  healthy: number;
  skipped: number;
}>;

/**
 * Refreshes only exact, already-authorized provider rows. It never creates,
 * broadens or resurrects authority. Probe failures are persisted as DEGRADED
 * so all business paths fail closed until a later successful health check.
 */
export async function refreshConfiguredProviderHealth(
  input: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    now: Date;
    probes?: Partial<Record<ProviderHealthProbeKind, () => Promise<void>>>;
  }>,
): Promise<ProviderHealthRefreshSummary> {
  const bindings = configuredBindings(input.environment);
  const due: Array<{
    activationId: string;
    binding: HealthBinding;
  }> = [];
  let skipped = 0;

  for (const binding of bindings) {
    const activation = await input.database.providerActivation.findFirst({
      where: {
        environment: input.environment.APP_ENV,
        useCase: binding.useCase,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (
      activation === null ||
      !isExactCurrentActivation(activation, binding, input.now)
    ) {
      skipped += 1;
      continue;
    }
    const interval =
      activation.health === "HEALTHY"
        ? healthyProbeIntervalMilliseconds
        : degradedProbeIntervalMilliseconds;
    if (
      activation.healthCheckedAt !== null &&
      activation.healthCheckedAt <= input.now &&
      input.now.getTime() - activation.healthCheckedAt.getTime() < interval
    ) {
      skipped += 1;
      continue;
    }
    due.push({ activationId: activation.id, binding });
  }

  const probeResults = new Map<ProviderHealthProbeKind, Promise<boolean>>();
  for (const { binding } of due) {
    if (!probeResults.has(binding.probeKind)) {
      const probe =
        input.probes?.[binding.probeKind] ??
        (() => runProviderProbe(binding.probeKind, input.environment));
      probeResults.set(
        binding.probeKind,
        probe().then(
          () => true,
          () => false,
        ),
      );
    }
  }

  let healthy = 0;
  let degraded = 0;
  for (const { activationId, binding } of due) {
    const isHealthy = await probeResults.get(binding.probeKind)!;
    const updated = await input.database.providerActivation.updateMany({
      where: {
        id: activationId,
        environment: input.environment.APP_ENV,
        useCase: binding.useCase,
        adapterKey: binding.adapterKey,
        adapterVersion: binding.adapterVersion,
        configurationDigest: binding.expectedConfigurationDigest,
        secretVersionRef: binding.expectedSecretVersionRef,
        mode: binding.expectedMode,
        revokedAt: null,
        killSwitchEngaged: false,
      },
      data: {
        health: isHealthy ? "HEALTHY" : "DEGRADED",
        healthCheckedAt: input.now,
      },
    });
    if (updated.count === 0) {
      skipped += 1;
      continue;
    }
    if (isHealthy) healthy += 1;
    else degraded += 1;
  }
  return Object.freeze({
    checked: healthy + degraded,
    degraded,
    healthy,
    skipped,
  });
}

function configuredBindings(environment: ServerEnvironment): HealthBinding[] {
  const output: HealthBinding[] = [];
  for (const useCase of [
    "email.transactional",
    "email.job-alert",
    "email.delivery-events",
  ] as const) {
    const binding = emailProviderActivationBinding(environment, useCase);
    if (binding === null || binding.expectedSecretVersionRef === undefined) {
      continue;
    }
    output.push({ ...binding, probeKind: "EMAIL" });
  }
  const objectStore = documentObjectStoreActivationBinding(environment);
  if (objectStore !== null) {
    output.push({
      ...objectStore,
      adapterVersion: "v1",
      probeKind: "DOCUMENT_OBJECT_STORE",
    });
  }
  const scanner = documentScannerActivationBinding(environment);
  if (scanner !== null) {
    output.push({
      ...scanner,
      adapterVersion: "v1",
      probeKind: "DOCUMENT_SCANNER",
    });
  }
  const privacy = privacyExportStoreActivationBinding(environment);
  if (privacy !== null) {
    output.push({ ...privacy, probeKind: "PRIVACY_EXPORT_STORE" });
  }
  const payment = paymentProviderActivationBinding(environment);
  if (payment !== null) {
    output.push({ ...payment, probeKind: "PAYMENT" });
  }
  return output;
}

function isExactCurrentActivation(
  activation: NonNullable<
    Awaited<ReturnType<DatabaseClient["providerActivation"]["findFirst"]>>
  >,
  binding: HealthBinding,
  now: Date,
) {
  return (
    activation.adapterKey === binding.adapterKey &&
    activation.adapterVersion === binding.adapterVersion &&
    activation.configurationDigest === binding.expectedConfigurationDigest &&
    activation.secretVersionRef === binding.expectedSecretVersionRef &&
    activation.mode === binding.expectedMode &&
    activation.revokedAt === null &&
    !activation.killSwitchEngaged &&
    activation.effectiveAt !== null &&
    activation.effectiveAt <= now &&
    (activation.expiresAt === null || activation.expiresAt > now)
  );
}

async function runProviderProbe(
  kind: ProviderHealthProbeKind,
  environment: ServerEnvironment,
) {
  switch (kind) {
    case "EMAIL":
      return probeEmail(environment);
    case "DOCUMENT_OBJECT_STORE":
      await createDocumentObjectStore(environment).listObjects({ limit: 1 });
      return;
    case "PRIVACY_EXPORT_STORE":
      await createPrivacyExportObjectStore(environment).listObjects({
        limit: 1,
      });
      return;
    case "DOCUMENT_SCANNER": {
      const result = await createDocumentMalwareScanner(environment).scan(
        singleChunk(
          Buffer.from(
            "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
            "utf8",
          ),
        ),
        {
          declaredMimeType: "application/pdf",
          timeoutMilliseconds: probeTimeoutMilliseconds,
        },
      );
      if (result.outcome !== "CLEAN") {
        throw new Error("PROVIDER_HEALTH_SCANNER_DEGRADED");
      }
      return;
    }
    case "PAYMENT":
      return probePayment(environment);
  }
}

async function probeEmail(environment: ServerEnvironment) {
  if (environment.EMAIL_PROVIDER_MODE === "local_mock") return;
  const credential = environment.secrets.emailProvider;
  if (credential === undefined) {
    throw new Error("PROVIDER_HEALTH_EMAIL_CREDENTIAL_MISSING");
  }
  const endpoint =
    environment.EMAIL_PROVIDER_MODE === "resend_contract"
      ? "http://provider-contract:8080/health/ready"
      : "https://api.resend.com/domains?limit=100";
  const response = await credential.withValue((secret) =>
    fetch(endpoint, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "error",
      signal: AbortSignal.timeout(probeTimeoutMilliseconds),
    }),
  );
  const body = await readBoundedBody(response);
  if (!response.ok) throw new Error("PROVIDER_HEALTH_EMAIL_UNAVAILABLE");
  if (environment.EMAIL_PROVIDER_MODE === "resend_contract") {
    const value = safeJson(body);
    if (
      value?.providerMode !== "CONTRACT_STUB_ONLY" ||
      value.status !== "ready"
    ) {
      throw new Error("PROVIDER_HEALTH_EMAIL_IDENTITY_MISMATCH");
    }
    return;
  }
  if (environment.EMAIL_FROM === undefined) {
    throw new Error("PROVIDER_HEALTH_EMAIL_FROM_MISSING");
  }
  assertResendSendingDomainHealth(body, environment.EMAIL_FROM);
}

export function assertResendSendingDomainHealth(
  serialized: string,
  emailFrom: string,
) {
  const senderDomain = extractMailboxDomain(emailFrom);
  const value = safeJson(serialized);
  const domains = Array.isArray(value?.data) ? value.data : null;
  if (senderDomain === null || domains === null || domains.length > 100) {
    throw new Error("PROVIDER_HEALTH_EMAIL_DOMAIN_RESPONSE_INVALID");
  }
  const match = domains.find((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return false;
    }
    const domain = candidate as Record<string, unknown>;
    const capabilities =
      typeof domain.capabilities === "object" &&
      domain.capabilities !== null &&
      !Array.isArray(domain.capabilities)
        ? (domain.capabilities as Record<string, unknown>)
        : null;
    return (
      typeof domain.name === "string" &&
      domain.name.toLocaleLowerCase("en") === senderDomain &&
      (domain.status === "verified" ||
        domain.status === "partially_verified") &&
      capabilities?.sending === "enabled"
    );
  });
  if (match === undefined) {
    throw new Error("PROVIDER_HEALTH_EMAIL_SENDING_DOMAIN_UNVERIFIED");
  }
}

function extractMailboxDomain(value: string) {
  const mailbox = /<([^<>\s]+)>$/u.exec(value)?.[1] ?? value.trim();
  const at = mailbox.lastIndexOf("@");
  if (at < 1 || at === mailbox.length - 1) return null;
  return mailbox.slice(at + 1).toLocaleLowerCase("en");
}

async function probePayment(environment: ServerEnvironment) {
  const credential = environment.secrets.stripeSecretKey;
  const accountId = environment.STRIPE_ACCOUNT_ID;
  if (credential === undefined || accountId === undefined) {
    throw new Error("PROVIDER_HEALTH_PAYMENT_CREDENTIAL_MISSING");
  }
  const endpoint =
    environment.PAYMENT_PROVIDER_MODE === "stripe_contract"
      ? `${environment.STRIPE_CONTRACT_ENDPOINT}/v1/account`
      : "https://api.stripe.com/v1/account";
  const response = await credential.withValue((secret) =>
    fetch(endpoint, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(probeTimeoutMilliseconds),
    }),
  );
  const body = safeJson(await readBoundedBody(response));
  const expectsLive = environment.PAYMENT_PROVIDER_MODE === "stripe_live";
  if (!response.ok || body?.id !== accountId || body.livemode !== expectsLive) {
    throw new Error("PROVIDER_HEALTH_PAYMENT_IDENTITY_MISMATCH");
  }
}

async function readBoundedBody(response: Response) {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumProbeBodyBytes) {
        await reader.cancel("provider health response exceeded bound");
        throw new Error("PROVIDER_HEALTH_RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  ).toString("utf8");
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

async function* singleChunk(value: Uint8Array) {
  yield value;
}
