import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
  type DocumentProviderActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";

export type DocumentProviderRequirement = "OBJECT_STORE" | "MALWARE_SCANNER";

/**
 * Resolves the persisted provider authority immediately before provider I/O.
 * Callers must complete actor/resource authorization first so this lookup cannot
 * become an existence oracle for documents belonging to another actor.
 */
export async function hasExactDocumentProviderAuthority(
  database: DatabaseClient,
  environment: ServerEnvironment,
  now: Date,
  requirements: readonly DocumentProviderRequirement[],
): Promise<boolean> {
  try {
    for (const requirement of requirements) {
      const binding = resolveBinding(environment, requirement);
      if (binding === null) return false;
      const decision = await resolvePersistedProviderActivation(database, {
        adapterKey: binding.adapterKey,
        adapterVersion: binding.adapterVersion,
        environment: environment.APP_ENV,
        expectedConfigurationDigest: binding.expectedConfigurationDigest,
        expectedMode: binding.expectedMode,
        expectedSecretVersionRef: binding.expectedSecretVersionRef,
        now,
        useCase: binding.useCase,
      });
      if (!decision.active) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveBinding(
  environment: ServerEnvironment,
  requirement: DocumentProviderRequirement,
): DocumentProviderActivationBinding | null {
  return requirement === "OBJECT_STORE"
    ? documentObjectStoreActivationBinding(environment)
    : documentScannerActivationBinding(environment);
}
