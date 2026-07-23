export type DatabaseHealth = Readonly<
  | { ready: true }
  | { ready: false; reason: "database_unavailable" }
>;

export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;
export const REQUIRED_MIGRATION_ID =
  "20260723194000_phase_17_company_profile_array_defaults";

type QueryableDatabase = {
  $queryRaw: (
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => Promise<readonly Record<string, unknown>[]>;
};

export async function checkDatabaseHealth(
  database: QueryableDatabase,
  timeoutMs = DATABASE_HEALTH_TIMEOUT_MS,
): Promise<DatabaseHealth> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    const rows = await Promise.race([
      database.$queryRaw`
        SELECT (
          to_regclass('public."User"') IS NOT NULL
          AND to_regclass('public."_prisma_migrations"') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "_prisma_migrations"
            WHERE finished_at IS NULL
              AND rolled_back_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM "_prisma_migrations"
            WHERE migration_name = ${REQUIRED_MIGRATION_ID}
              AND finished_at IS NOT NULL
              AND rolled_back_at IS NULL
          )
        ) AS ready
      `,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database health check timed out.")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
    return rows[0]?.ready === true || rows[0]?.ready === 1
      ? { ready: true }
      : { ready: false, reason: "database_unavailable" };
  } catch {
    return { ready: false, reason: "database_unavailable" };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
