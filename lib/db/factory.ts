import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

export type DatabaseQueryObservation = Readonly<{
  durationMs: number;
  transactionControl: boolean;
  driverControl: boolean;
}>;

export type DatabaseClientOptions = Readonly<{
  /**
   * Optional performance instrumentation. Deliberately exposes neither SQL
   * nor bound parameters so callers cannot accidentally persist search terms,
   * credentials or other personal data in test/evidence output.
   */
  onQuery?: (observation: DatabaseQueryObservation) => void;
}>;

export function createDatabaseClient(
  connectionString: string,
  options: DatabaseClientOptions = {},
) {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 10,
  });
  const client = new PrismaClient({
    adapter,
    log:
      options.onQuery === undefined ? [] : [{ emit: "event", level: "query" }],
    transactionOptions: {
      // Public server renders intentionally compose several read snapshots.
      // A bounded queue absorbs cold-start connection contention without
      // weakening the per-query and database statement timeouts above.
      maxWait: 10_000,
      timeout: 15_000,
    },
  });
  if (options.onQuery !== undefined) {
    client.$on("query", ({ duration, query }) => {
      options.onQuery?.(
        Object.freeze({
          durationMs: duration,
          transactionControl:
            /^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/iu.test(
              query.trimStart(),
            ),
          driverControl: /^DEALLOCATE\b/iu.test(query.trimStart()),
        }),
      );
    });
  }
  return client;
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
