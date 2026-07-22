import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

export function createDatabaseClient(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 10,
  });
  return new PrismaClient({
    adapter,
    transactionOptions: {
      // Public server renders intentionally compose several read snapshots.
      // A bounded queue absorbs cold-start connection contention without
      // weakening the per-query and database statement timeouts above.
      maxWait: 10_000,
      timeout: 15_000,
    },
  });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
