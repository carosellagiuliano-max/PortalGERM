import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  emailProviderActivationBinding,
  type EmailProviderActivationUseCase,
} from "@/lib/providers/email/provider-activation-binding";

export async function activatePhase33SandboxEmailUseCases(
  database: DatabaseClient,
  environment: ServerEnvironment,
  useCases: readonly Exclude<
    EmailProviderActivationUseCase,
    "email.delivery-events"
  >[],
  now: Date,
) {
  for (const useCase of useCases) {
    const binding = emailProviderActivationBinding(environment, useCase);
    if (binding === null || binding.adapterKey !== "local_mock") {
      throw new Error("PHASE33_EMAIL_TEST_BINDING_UNAVAILABLE");
    }
    await database.$transaction(async (transaction) => {
      await transaction.providerActivation.updateMany({
        where: {
          environment: environment.APP_ENV,
          useCase,
          revokedAt: null,
        },
        data: {
          killSwitchEngaged: true,
          revokedAt: now,
          revokeReasonCode: "SUPERSEDED",
        },
      });
      await transaction.providerActivation.create({
        data: {
          environment: environment.APP_ENV,
          useCase,
          adapterKey: binding.adapterKey,
          adapterVersion: binding.adapterVersion,
          mode: binding.expectedMode,
          configurationDigest: binding.expectedConfigurationDigest,
          secretVersionRef: binding.expectedSecretVersionRef,
          region: "local-test",
          dpaRef: "dpa:phase33:test",
          contractRef: "contract:phase33:test",
          approvalRef: "approval:phase33:test",
          evidenceDigest: "a".repeat(64),
          owner: "Phase 33 Test",
          runbookRef: "codex-plan/runbooks/provider-activation.md",
          health: "HEALTHY",
          healthCheckedAt: now,
          quotaUnits: 10_000,
          sustainableCapacity: 10_000,
          unitCostMicros: 0n,
          unitCostSource: "phase33-test-fixture",
          killSwitchEngaged: false,
          effectiveAt: now,
        },
      });
    });
  }
}
