export type DatabaseHealth = Readonly<
  | { ready: true }
  | { ready: false; reason: "database_unavailable" }
>;

export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;

type QueryableDatabase = {
  $queryRaw: (
    query: TemplateStringsArray,
  ) => Promise<readonly Record<string, unknown>[]>;
};

export async function checkDatabaseHealth(
  database: QueryableDatabase,
  timeoutMs = DATABASE_HEALTH_TIMEOUT_MS,
): Promise<DatabaseHealth> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      database.$queryRaw`SELECT 1 AS ready`,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database health check timed out.")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
    return { ready: true };
  } catch {
    return { ready: false, reason: "database_unavailable" };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
