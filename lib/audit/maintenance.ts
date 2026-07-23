import { nullifyExpiredAuditIpHashes } from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";

export async function runAuditIpRetention(
  database: DatabaseClient,
) {
  const nullifiedCount = await nullifyExpiredAuditIpHashes(
    {
      async nullifyExpiredIpHashes() {
        // Selection and the append-only trigger deliberately use the same
        // PostgreSQL statement clock. An application-host clock can therefore
        // neither redact a young row nor make one rejected row abort the batch.
        return database.$executeRaw`
          UPDATE "AuditLog"
             SET "ipHash" = NULL,
                 "ipHashVersion" = NULL
           WHERE "ipHash" IS NOT NULL
             AND "createdAt" <= statement_timestamp() - INTERVAL '30 days'
        `;
      },
    },
  );

  return Object.freeze({ nullifiedCount });
}
