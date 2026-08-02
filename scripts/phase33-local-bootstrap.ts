import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import {
  ensurePhase33LocalHandlerActivations,
  ensurePhase33LocalProviderActivation,
  type Phase33LocalProviderBinding,
} from "@/lib/ops/phase33-contract-activation";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-local-bootstrap",
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
    environment.APP_ENV !== "local" ||
    environment.WORKER_RUNTIME !== "sandbox_command" ||
    environment.EMAIL_PROVIDER_MODE !== "local_mock" ||
    environment.PAYMENT_PROVIDER_MODE !== "disabled" ||
    environment.DOCUMENT_STORAGE_MODE !== "filesystem_sandbox" ||
    environment.DOCUMENT_SCANNER_MODE !== "sandbox"
  ) {
    throw new Error("PHASE33_LOCAL_BOOTSTRAP_FORBIDDEN");
  }
  const bindings = resolveBindings(environment);
  const database = environment.secrets.database.withValue(createDatabaseClient);
  try {
    const now = new Date();
    const providers = [];
    for (const binding of bindings) {
      providers.push(
        await ensurePhase33LocalProviderActivation(database, {
          binding,
          deploymentDigest,
          environment,
          now,
        }),
      );
    }
    const handlers = await ensurePhase33LocalHandlerActivations(database, {
      deploymentDigest,
      environment,
      now,
    });
    process.stdout.write(
      `${JSON.stringify({
        command: "phase33-local-bootstrap",
        deploymentDigest,
        handlerActivations: handlers.length,
        handlerReused: handlers.filter(({ reused }) => reused).length,
        paymentProvider: "DISABLED_NO_EXTERNAL_EFFECT",
        providerActivations: providers.length,
        providerReused: providers.filter(({ reused }) => reused).length,
        providerUseCases: bindings.map(({ useCase }) => useCase).sort(),
        status: "PASS",
      })}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

function resolveBindings(
  environment: ReturnType<typeof parseEnvironment>,
): readonly Phase33LocalProviderBinding[] {
  const email = ["email.transactional", "email.job-alert"].map((useCase) =>
    emailProviderActivationBinding(
      environment,
      useCase as "email.transactional" | "email.job-alert",
    ),
  );
  const objectStore = documentObjectStoreActivationBinding(environment);
  const scanner = documentScannerActivationBinding(environment);
  const privacyExport = privacyExportStoreActivationBinding(environment);
  if (
    email.some((binding) => binding === null) ||
    objectStore === null ||
    scanner === null ||
    privacyExport === null
  ) {
    throw new Error("PHASE33_LOCAL_BINDING_INCOMPLETE");
  }

  const bindings: Phase33LocalProviderBinding[] = [];
  for (const binding of email) {
    if (binding === null || binding.expectedMode !== "SANDBOX") {
      throw new Error("PHASE33_LOCAL_EMAIL_BINDING_INVALID");
    }
    bindings.push({
      adapterKey: binding.adapterKey,
      adapterVersion: binding.adapterVersion,
      expectedConfigurationDigest: binding.expectedConfigurationDigest,
      expectedMode: "SANDBOX",
      expectedSecretVersionRef:
        binding.expectedSecretVersionRef ?? "builtin:local-mock-mailbox:v1",
      region: "local-test",
      useCase: binding.useCase,
    });
  }
  for (const binding of [objectStore, scanner]) {
    if (
      binding.expectedMode !== "SANDBOX" ||
      binding.expectedSecretVersionRef === undefined
    ) {
      throw new Error("PHASE33_LOCAL_DOCUMENT_BINDING_INVALID");
    }
    bindings.push({
      adapterKey: binding.adapterKey,
      adapterVersion: "v1",
      expectedConfigurationDigest: binding.expectedConfigurationDigest,
      expectedMode: "SANDBOX",
      expectedSecretVersionRef: binding.expectedSecretVersionRef,
      region: binding.region,
      useCase: binding.useCase,
    });
  }
  if (
    privacyExport.expectedMode !== "SANDBOX" ||
    privacyExport.expectedSecretVersionRef === undefined
  ) {
    throw new Error("PHASE33_LOCAL_PRIVACY_BINDING_INVALID");
  }
  bindings.push({
    ...privacyExport,
    expectedMode: "SANDBOX",
    expectedSecretVersionRef: privacyExport.expectedSecretVersionRef,
    region: environment.PRIVACY_EXPORT_STORAGE_REGION,
  });
  return Object.freeze(bindings);
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "PHASE33_LOCAL_BOOTSTRAP_FAILURE";
  const code = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 96);
  return /^[A-Z0-9][A-Z0-9_:-]{1,95}$/u.test(code)
    ? code
    : "PHASE33_LOCAL_BOOTSTRAP_FAILURE";
}
