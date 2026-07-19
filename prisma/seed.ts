import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

const environment = parseEnvironment(process.env);
const database = environment.secrets.database.withValue(createDatabaseClient);

try {
  const result = await database.$queryRaw<Array<{ ready: number }>>`
    SELECT 1 AS ready
  `;

  if (Number(result[0]?.ready) !== 1) {
    throw new Error("Database smoke query returned an unexpected result.");
  }

  console.info(
    "Phase-01 seed completed: database reachable; no demo or domain rows written.",
  );
} finally {
  await database.$disconnect();
}
