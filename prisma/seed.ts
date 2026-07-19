import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

const environment = parseEnvironment(process.env);
const database = environment.secrets.database.withValue(createDatabaseClient);

try {
  const result = await database.$queryRaw<
    Array<{
      user_table: string | null;
      plan_version_table: string | null;
      audit_log_table: string | null;
    }>
  >`
    SELECT
      to_regclass('public."User"')::text AS user_table,
      to_regclass('public."PlanVersion"')::text AS plan_version_table,
      to_regclass('public."AuditLog"')::text AS audit_log_table
  `;

  if (
    !result[0]?.user_table ||
    !result[0]?.plan_version_table ||
    !result[0]?.audit_log_table
  ) {
    throw new Error("Phase-02 domain tables are not fully migrated.");
  }

  console.info(
    "Phase-02 technical seed completed: schema reachable; catalog and demo fixtures remain owned by Phase 05.",
  );
} finally {
  await database.$disconnect();
}
