import { parseEnvironment } from "@/lib/config/env-schema";
import { candidateWorkflowSeedCryptoFromEnvironment } from "@/prisma/seed/blocks/candidate-workflows";
import { runDemoSeed } from "@/prisma/seed/orchestrator";
import { formatSeedManifestLog } from "@/prisma/seed/manifest";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

try {
  const environment = parseEnvironment(process.env);
  const result = await environment.secrets.database.withValue((databaseUrl) =>
    runDemoSeed(
      {
        APP_ENV: environment.APP_ENV,
        DATABASE_URL: databaseUrl,
        ENABLE_DEMO_SEED: process.env.ENABLE_DEMO_SEED,
      },
      {
        candidateWorkflowCrypto:
          candidateWorkflowSeedCryptoFromEnvironment(environment),
      },
    ),
  );

  console.info(
    `Phase-06 demo seed ${result.previouslyCompleted ? "verified" : "completed"} in ${result.guard.mode}.`,
  );
  console.info(formatSeedManifestLog(result.envelope));
} catch (error) {
  console.error(formatSafeSeedFailure("Phase-06 demo seed failed", error));
  process.exitCode = 1;
}

function formatSafeSeedFailure(prefix: string, error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = readSafeErrorCode(error);
  return `${prefix}: ${name}${code === undefined ? "" : ` (${code})`}.`;
}

function readSafeErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === "string" && /^[A-Z0-9_]{2,64}$/.test(code)
    ? code
    : undefined;
}
