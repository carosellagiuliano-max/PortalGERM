import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import {
  DocumentObjectStoreFailure,
  type DocumentObjectStore,
} from "@/lib/providers/storage/document-object-store";

export type ObjectStoreProviderAuthorityBinding = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  expectedConfigurationDigest: string;
  expectedMode: "SANDBOX" | "ALLOWLIST" | "LIVE";
  expectedSecretVersionRef: string;
  useCase: string;
}>;

/**
 * Adds an exact, persisted provider-authority check immediately before every
 * external storage operation. Constructing this wrapper performs no DB I/O, so
 * the owning service can finish actor/resource authorization first.
 */
export function bindObjectStoreToProviderAuthority(
  input: Readonly<{
    binding: ObjectStoreProviderAuthorityBinding | null;
    database: DatabaseClient;
    delegate: DocumentObjectStore;
    environment: ServerEnvironment;
    now?: () => Date;
  }>,
): DocumentObjectStore {
  const assertAuthority = async () => {
    if (input.binding === null) throw inactiveProvider();
    try {
      const decision = await resolvePersistedProviderActivation(
        input.database,
        {
          adapterKey: input.binding.adapterKey,
          adapterVersion: input.binding.adapterVersion,
          environment: input.environment.APP_ENV,
          expectedConfigurationDigest:
            input.binding.expectedConfigurationDigest,
          expectedMode: input.binding.expectedMode,
          expectedSecretVersionRef: input.binding.expectedSecretVersionRef,
          now: input.now?.() ?? new Date(),
          useCase: input.binding.useCase,
        },
      );
      if (!decision.active) throw inactiveProvider();
    } catch (error) {
      if (error instanceof DocumentObjectStoreFailure) throw error;
      throw inactiveProvider();
    }
  };

  return Object.freeze({
    providerClass: input.delegate.providerClass,
    storageRegion: input.delegate.storageRegion,
    async putQuarantined(value) {
      await assertAuthority();
      return input.delegate.putQuarantined(value);
    },
    async headObject(objectKey) {
      await assertAuthority();
      return input.delegate.headObject(objectKey);
    },
    async openVerifiedRead(objectKey) {
      await assertAuthority();
      return input.delegate.openVerifiedRead(objectKey);
    },
    async listObjects(value) {
      await assertAuthority();
      return input.delegate.listObjects(value);
    },
    async deleteObject(objectKey, expected) {
      await assertAuthority();
      return input.delegate.deleteObject(objectKey, expected);
    },
  });
}

function inactiveProvider() {
  return new DocumentObjectStoreFailure("PROVIDER_DISABLED");
}
