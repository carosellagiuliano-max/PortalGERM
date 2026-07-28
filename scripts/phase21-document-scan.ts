import { randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { scanDocumentVersion } from "@/lib/documents/vault-service";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";

const environment = getServerEnvironment();
const database = getDatabase();
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Math.max(1, Math.min(100, Number(limitArgument?.split("=")[1] ?? 25)));
const versions = await database.documentVersion.findMany({
  where: { status: { in: ["QUARANTINED", "SCAN_FAILED"] } },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  take: limit,
  select: {
    id: true,
    candidateProfile: { select: { userId: true } },
    company: {
      select: {
        memberships: {
          where: {
            status: "ACTIVE",
            removedAt: null,
            role: { in: ["OWNER", "ADMIN"] },
            user: { status: "ACTIVE" },
          },
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
          take: 1,
          select: { userId: true },
        },
      },
    },
  },
});
const objectStore = createDocumentObjectStore(environment);
const scanner = createDocumentMalwareScanner(environment);
const outcomes = [];
for (const version of versions) {
  const scanActorUserId =
    version.candidateProfile?.userId ??
    version.company?.memberships[0]?.userId;
  if (scanActorUserId === undefined) continue;
  outcomes.push(
    await scanDocumentVersion(
      {
        actorUserId: scanActorUserId,
        documentVersionId: version.id,
        correlationId: randomUUID(),
      },
      { database, environment, objectStore, scanner },
    ),
  );
}
process.stdout.write(
  `${JSON.stringify({ attempted: versions.length, outcomes }, null, 2)}\n`,
);
await database.$disconnect();
