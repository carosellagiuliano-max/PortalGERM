import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { runAuditIpRetention } from "@/lib/audit/maintenance";
import { createLogger } from "@/lib/utils/logger";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

const logger = createLogger();
const environment = parseEnvironment(process.env);
const database = environment.secrets.database.withValue(createDatabaseClient);

try {
  const result = await runAuditIpRetention(database);
  logger.info("audit_ip_retention.completed", {
    count: result.nullifiedCount,
  });
} catch (error) {
  logger.error("audit_ip_retention.failed", { error });
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
