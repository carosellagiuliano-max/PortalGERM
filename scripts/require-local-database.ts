import { parseEnvironment } from "@/lib/config/env-schema";
import { inspectPostgresTarget } from "@/lib/db/database-target";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

const environment = parseEnvironment(process.env);
if (environment.APP_ENV !== "local") {
  throw new Error("This interactive database tool is restricted to APP_ENV=local.");
}

const databaseTarget =
  environment.secrets.database.withValue(inspectPostgresTarget);
if (databaseTarget === undefined) {
  throw new Error("This interactive database tool requires a valid database target.");
}

if (databaseTarget.hostname !== "loopback") {
  throw new Error("This interactive database tool requires a loopback database host.");
}

if (/(prod|production|staging)/i.test(databaseTarget.databaseName)) {
  throw new Error("This interactive database tool refuses a production-labelled database.");
}

console.info("Local database target guard passed.");
