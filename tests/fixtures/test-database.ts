import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import { inspectPostgresTarget } from "@/lib/db/database-target";

type TestDatabaseConfiguration = Readonly<{
  connectionString: string;
  databaseName: string;
}>;

export function getIsolatedTestDatabaseConfiguration(): TestDatabaseConfiguration {
  loadLocalEnvironment();

  if (
    (process.env.APP_ENV !== "local" && process.env.APP_ENV !== "ci") ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "Integration and HTTP smoke databases are restricted to local or CI non-production runtimes.",
    );
  }

  const rawTestUrl = process.env.TEST_DATABASE_URL;
  if (!rawTestUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests; DATABASE_URL is never used as a fallback.",
    );
  }

  const testTarget = parsePostgresTarget("TEST_DATABASE_URL", rawTestUrl);
  const { databaseName, schemaName } = testTarget;

  if (
    !databaseName.toLowerCase().includes("test") &&
    !schemaName.toLowerCase().includes("test")
  ) {
    throw new Error(
      "TEST_DATABASE_URL must identify a database or schema whose name contains 'test'.",
    );
  }

  const rawApplicationUrl = process.env.DATABASE_URL;
  if (rawApplicationUrl) {
    const applicationTarget = parsePostgresTarget(
      "DATABASE_URL",
      rawApplicationUrl,
    );
    if (applicationTarget.identity === testTarget.identity) {
      throw new Error(
        "TEST_DATABASE_URL must not target the same server database and schema as DATABASE_URL.",
      );
    }
  }

  return Object.freeze({ connectionString: rawTestUrl, databaseName });
}

function parsePostgresTarget(variable: string, rawValue: string) {
  const target = inspectPostgresTarget(rawValue);
  if (target === undefined) {
    throw new Error(`${variable} must be a valid PostgreSQL URL with a database name.`);
  }

  return target;
}
