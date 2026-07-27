import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  PROVIDER_CATALOG,
  getProviderDefinition,
} from "@/lib/ops/provider-catalog";
import { resolveProviderActivation } from "@/lib/ops/provider-activation-policy";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      contract: "phase23-provider-activation-smoke-v1",
      status: "BLOCKED",
      error: errorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  const command = parseArguments(process.argv.slice(2));
  loadLocalEnvironment();
  const environment = parseEnvironment(process.env);
  if (environment.APP_ENV !== command.environment) {
    throw new Error("PROVIDER_SMOKE_ENVIRONMENT_MISMATCH");
  }
  const database =
    environment.secrets.database.withValue(createDatabaseClient);
  try {
    const now = new Date();
    const useCases = [
      ...new Set(PROVIDER_CATALOG.map(({ useCase }) => useCase)),
    ].sort();
    const outcomes = [];
    let failed = false;
    for (const useCase of useCases) {
      const activation = await database.providerActivation.findFirst({
        where: { environment: command.environment, useCase },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const registered =
        activation === null
          ? null
          : getProviderDefinition(
              activation.useCase,
              activation.adapterKey,
              activation.adapterVersion,
            );
      const decision =
        activation === null || registered === null
          ? { active: false as const, reason: "MISSING_OR_UNKNOWN_LEDGER" }
          : resolveProviderActivation({
              activation,
              adapterKey: activation.adapterKey,
              adapterVersion: activation.adapterVersion,
              environment: command.environment,
              useCase,
              now,
            });
      const modeMatches =
        decision.active && decision.mode.toLowerCase() === command.mode;
      if (!decision.active || !modeMatches) failed = true;
      outcomes.push({
        useCase,
        adapter:
          activation === null
            ? null
            : `${activation.adapterKey}:${activation.adapterVersion}`,
        requestedMode: command.mode,
        active: decision.active && modeMatches,
        reason: decision.active
          ? modeMatches
            ? "ACTIVE"
            : "MODE_MISMATCH"
          : decision.reason,
        owner: activation?.owner ?? null,
        runbookRef: activation?.runbookRef ?? null,
      });
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          contract: "phase23-provider-activation-smoke-v1",
          environment: command.environment,
          requestedMode: command.mode,
          status: failed ? "BLOCKED" : "PASSED",
          outcomes,
        },
        null,
        2,
      )}\n`,
    );
    if (failed) process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}

function parseArguments(values: readonly string[]) {
  let environment: "local" | "ci" | "preview" | "staging" | "production" | undefined;
  let mode: "sandbox" | "allowlist" | "live" | undefined;
  let allRegistered = false;
  for (const value of values) {
    const environmentMatch =
      /^--environment=(local|ci|preview|staging|production)$/u.exec(value);
    if (environmentMatch !== null) {
      environment = environmentMatch[1] as typeof environment;
      continue;
    }
    const modeMatch = /^--mode=(sandbox|allowlist|live)$/u.exec(value);
    if (modeMatch !== null) {
      mode = modeMatch[1] as typeof mode;
      continue;
    }
    if (value === "--all-registered") {
      allRegistered = true;
      continue;
    }
    throw new Error("PROVIDER_SMOKE_ARGUMENT_INVALID");
  }
  if (
    environment === undefined ||
    mode === undefined ||
    !allRegistered
  ) {
    throw new Error("PROVIDER_SMOKE_ARGUMENT_INCOMPLETE");
  }
  return Object.freeze({ environment, mode });
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "PROVIDER_SMOKE_FAILED";
  if (
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9]{2,16}$/u.test(error.code)
  ) {
    return `DATABASE_${error.code}`;
  }
  return error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
}
