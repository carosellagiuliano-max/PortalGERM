import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

const environment = parseEnvironment(process.env);
const databaseHandle =
  environment.APP_ENV === "ci" && environment.secrets.testDatabase
    ? environment.secrets.testDatabase
    : environment.secrets.database;
const database = databaseHandle.withValue(createDatabaseClient);

try {
  const result = await database.$queryRaw<Array<{ ready: number }>>`
    SELECT 1 AS ready
  `;

  if (Number(result[0]?.ready) !== 1) {
    throw new Error("Database smoke query returned an unexpected result.");
  }

  console.info("Database smoke passed with SELECT 1; no domain rows were written.");
} finally {
  await database.$disconnect();
}
