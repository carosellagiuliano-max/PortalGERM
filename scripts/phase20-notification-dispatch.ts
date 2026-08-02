import { randomBytes } from "node:crypto";

import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { createEmailDeliveryProvider } from "@/lib/providers/email/delivery-composition";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

let database: ReturnType<typeof createDatabaseClient> | undefined;

try {
  const command = parseArguments(process.argv.slice(2));
  const environment = parseEnvironment(process.env);
  database = environment.secrets.database.withValue(createDatabaseClient);
  const binding = emailProviderActivationBinding(
    environment,
    "email.transactional",
  );
  if (binding === null) throw new Error("EMAIL_PROVIDER_DISABLED");
  const authority = await resolvePersistedProviderActivation(database, {
    adapterKey: binding.adapterKey,
    adapterVersion: binding.adapterVersion,
    environment: environment.APP_ENV,
    expectedConfigurationDigest: binding.expectedConfigurationDigest,
    expectedMode: binding.expectedMode,
    expectedSecretVersionRef: binding.expectedSecretVersionRef,
    now: new Date(),
    useCase: binding.useCase,
  });
  if (!authority.active) throw new Error("EMAIL_PROVIDER_NOT_AUTHORIZED");
  const provider = createEmailDeliveryProvider(environment);
  const result = await dispatchNotificationBatch({
    database,
    environment,
    provider,
    workerId:
      command.workerId ?? `phase20-command-${randomBytes(8).toString("hex")}`,
    batchSize: command.batchSize,
  });

  console.info(
    JSON.stringify({
      command: "notification-dispatch",
      providerClass: provider.providerClass,
      ...result,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      command: "notification-dispatch",
      status: "FAILED",
      error: "NOTIFICATION_DISPATCH_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}

function parseArguments(values: readonly string[]) {
  let batchSize = 25;
  let workerId: string | undefined;

  for (const value of values) {
    const batchMatch = /^--batch=(\d{1,3})$/u.exec(value);
    if (batchMatch !== null) {
      batchSize = Number(batchMatch[1]);
      continue;
    }

    const workerMatch =
      /^--worker-id=([A-Za-z0-9][A-Za-z0-9._:-]{0,95})$/u.exec(value);
    if (workerMatch !== null) {
      workerId = workerMatch[1];
      continue;
    }

    throw new Error("NOTIFICATION_DISPATCH_ARGUMENT_INVALID");
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("NOTIFICATION_DISPATCH_BATCH_INVALID");
  }

  return Object.freeze({ batchSize, workerId });
}
