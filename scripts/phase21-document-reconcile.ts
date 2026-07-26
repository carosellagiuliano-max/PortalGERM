import { randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { reconcileDocumentObjects } from "@/lib/documents/reconciliation";
import { createDocumentObjectStore } from "@/lib/providers/storage/document-storage-composition";

const environment = getServerEnvironment();
const database = getDatabase();
const result = await reconcileDocumentObjects(
  {
    mode: process.argv.includes("--apply") ? "command" : "dry_run",
    correlationId: randomUUID(),
  },
  {
    database,
    environment,
    objectStore: createDocumentObjectStore(environment),
  },
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await database.$disconnect();
if (!result.ok) process.exitCode = 1;
