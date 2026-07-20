import { runDemoSeedVerification } from "@/prisma/seed/orchestrator";
import { formatSeedManifestLog } from "@/prisma/seed/manifest";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

try {
  const result = await runDemoSeedVerification({
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    ENABLE_DEMO_SEED: process.env.ENABLE_DEMO_SEED,
  });

  console.info(
    `Phase-06 sealed demo seed verified read-only in ${result.guard.mode}.`,
  );
  console.info(formatSeedManifestLog(result.envelope));
} catch (error) {
  console.error(formatSafeSeedFailure(error));
  process.exitCode = 1;
}

function formatSafeSeedFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = readSafeErrorCode(error);
  return `Phase-06 read-only seed verification failed: ${name}${
    code === undefined ? "" : ` (${code})`
  }.`;
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
