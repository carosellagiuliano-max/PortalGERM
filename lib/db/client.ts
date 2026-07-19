import "server-only";

import { getServerEnvironment } from "@/lib/config/env";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";

declare global {
  var swissTalentHubDatabase: DatabaseClient | undefined;
}

export function getDatabase() {
  const environment = getServerEnvironment();

  globalThis.swissTalentHubDatabase ??=
    environment.secrets.database.withValue(createDatabaseClient);

  return globalThis.swissTalentHubDatabase;
}
