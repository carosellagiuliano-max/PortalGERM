import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import {
  ensurePhase33ContractHandlerActivations,
  ensurePhase33ContractProviderActivation,
  type Phase33ContractProviderBinding,
} from "@/lib/ops/phase33-contract-activation";
import { probePhase33ContractDependencies } from "@/lib/ops/phase33-contract-probes";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { paymentProviderActivationBinding } from "@/lib/providers/payments/provider-activation-binding";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-contract-bootstrap",
      error: safeErrorCode(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  const environment = parseEnvironment(process.env);
  const deploymentDigest = environment.APP_BUILD_ID;
  if (
    deploymentDigest === undefined ||
    environment.WORKER_RUNTIME !== "sandbox_command"
  ) {
    throw new Error("PHASE33_CONTRACT_BOOTSTRAP_FORBIDDEN");
  }

  await probePhase33ContractDependencies(environment);
  const bindings = resolveProviderBindings(environment);
  const database = environment.secrets.database.withValue(createDatabaseClient);
  try {
    const now = new Date();
    const providerResults = [];
    for (const binding of bindings) {
      providerResults.push(
        await ensurePhase33ContractProviderActivation(database, {
          binding,
          deploymentDigest,
          environment,
          now,
        }),
      );
    }
    const handlerResults = await ensurePhase33ContractHandlerActivations(
      database,
      { deploymentDigest, environment, now },
    );

    process.stdout.write(
      `${JSON.stringify({
        command: "phase33-contract-bootstrap",
        deploymentDigest,
        handlerActivations: handlerResults.length,
        handlerReused: handlerResults.filter((result) => result.reused).length,
        providerActivations: providerResults.length,
        providerReused: providerResults.filter((result) => result.reused).length,
        providerUseCases: bindings.map(({ useCase }) => useCase).sort(),
        status: "PASS",
      })}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

function resolveProviderBindings(
  environment: ReturnType<typeof parseEnvironment>,
): readonly Phase33ContractProviderBinding[] {
  const emailBindings = [
    "email.transactional",
    "email.job-alert",
    "email.delivery-events",
  ].map((useCase) =>
    emailProviderActivationBinding(
      environment,
      useCase as
        | "email.transactional"
        | "email.job-alert"
        | "email.delivery-events",
    ),
  );
  const objectStore = documentObjectStoreActivationBinding(environment);
  const scanner = documentScannerActivationBinding(environment);
  const privacyExport = privacyExportStoreActivationBinding(environment);
  const payment = paymentProviderActivationBinding(environment);
  if (
    emailBindings.some((binding) => binding === null) ||
    objectStore === null ||
    scanner === null ||
    privacyExport === null ||
    payment?.adapterKey !== "stripe_contract"
  ) {
    throw new Error("PHASE33_CONTRACT_BINDING_INCOMPLETE");
  }

  const bindings: Phase33ContractProviderBinding[] = [];
  for (const binding of emailBindings) {
    if (
      binding === null ||
      binding.expectedMode !== "ALLOWLIST" ||
      binding.expectedSecretVersionRef === undefined
    ) {
      throw new Error("PHASE33_CONTRACT_EMAIL_BINDING_INVALID");
    }
    bindings.push({
      adapterKey: binding.adapterKey,
      adapterVersion: binding.adapterVersion,
      expectedConfigurationDigest: binding.expectedConfigurationDigest,
      expectedMode: binding.expectedMode,
      expectedSecretVersionRef: binding.expectedSecretVersionRef,
      region: "ch-contract-1",
      useCase: binding.useCase,
    });
  }
  for (const binding of [objectStore, scanner]) {
    if (
      binding.expectedMode !== "ALLOWLIST" ||
      binding.expectedSecretVersionRef === undefined
    ) {
      throw new Error("PHASE33_CONTRACT_DOCUMENT_BINDING_INVALID");
    }
    bindings.push({
      adapterKey: binding.adapterKey,
      adapterVersion: "v1",
      expectedConfigurationDigest: binding.expectedConfigurationDigest,
      expectedMode: binding.expectedMode,
      expectedSecretVersionRef: binding.expectedSecretVersionRef,
      region: binding.region,
      useCase: binding.useCase,
    });
  }
  if (
    privacyExport.expectedMode !== "ALLOWLIST" ||
    privacyExport.expectedSecretVersionRef === undefined
  ) {
    throw new Error("PHASE33_CONTRACT_PRIVACY_BINDING_INVALID");
  }
  bindings.push({
    ...privacyExport,
    expectedMode: "ALLOWLIST",
    expectedSecretVersionRef: privacyExport.expectedSecretVersionRef,
    region: environment.PRIVACY_EXPORT_STORAGE_REGION,
  });
  if (payment.expectedMode !== "ALLOWLIST") {
    throw new Error("PHASE33_CONTRACT_PAYMENT_BINDING_INVALID");
  }
  bindings.push({
    ...payment,
    expectedMode: "ALLOWLIST",
  });

  if (new Set(bindings.map(({ useCase }) => useCase)).size !== bindings.length) {
    throw new Error("PHASE33_CONTRACT_BINDING_DUPLICATE");
  }
  return Object.freeze(bindings);
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "PHASE33_CONTRACT_BOOTSTRAP_FAILURE";
  const code = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 96);
  return /^[A-Z0-9][A-Z0-9_:-]{1,95}$/u.test(code)
    ? code
    : "PHASE33_CONTRACT_BOOTSTRAP_FAILURE";
}
