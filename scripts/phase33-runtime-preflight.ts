import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { checkDatabaseHealth } from "@/lib/db/health";

let database: ReturnType<typeof createDatabaseClient> | undefined;

try {
  const environment = parseEnvironment(process.env);
  database = environment.secrets.database.withValue(createDatabaseClient);
  const health = await checkDatabaseHealth(database);
  if (!health.ready) {
    throw new Error("DATABASE_NOT_READY");
  }
  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-runtime-preflight",
      appEnvironment: environment.APP_ENV,
      buildIdentifier: environment.APP_BUILD_ID ?? "local-development",
      status: "PASS",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-runtime-preflight",
      error: safeErrorCode(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}

function safeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "PREFLIGHT_FAILED";
  const code = error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
  return /^[A-Z0-9][A-Z0-9_:-]{1,63}$/u.test(code)
    ? code
    : "PREFLIGHT_FAILED";
}
