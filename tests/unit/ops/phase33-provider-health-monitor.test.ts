import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  assertResendSendingDomainHealth,
  refreshConfiguredProviderHealth,
} from "@/lib/ops/provider-health-monitor";
import type { ProviderActivationRecord } from "@/lib/ops/provider-activation-policy";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const NOW = new Date("2026-08-01T22:00:00.000Z");

describe("Phase-33 provider health monitor", () => {
  it("probes a shared adapter once and refreshes only exact current use-case rows", async () => {
    const environment = localEmailEnvironment();
    const records = new Map(
      ["email.transactional", "email.job-alert"].map((useCase) => {
        const binding = emailProviderActivationBinding(
          environment,
          useCase as "email.transactional" | "email.job-alert",
        );
        if (
          binding === null ||
          binding.expectedSecretVersionRef === undefined
        ) {
          throw new Error("Expected local email binding");
        }
        return [useCase, record(binding)] as const;
      }),
    );
    records.set("email.job-alert", {
      ...records.get("email.job-alert")!,
      configurationDigest: "f".repeat(64),
    });
    const updates: unknown[] = [];
    const database = databaseFixture(records, updates);
    const emailProbe = vi.fn(async () => undefined);

    await expect(
      refreshConfiguredProviderHealth({
        database,
        environment,
        now: NOW,
        probes: { EMAIL: emailProbe },
      }),
    ).resolves.toEqual({
      checked: 1,
      degraded: 0,
      healthy: 1,
      skipped: 1,
    });
    expect(emailProbe).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      data: { health: "HEALTHY", healthCheckedAt: NOW },
      where: {
        useCase: "email.transactional",
        secretVersionRef: "builtin:local-mock-mailbox:v1",
      },
    });
  });

  it("persists a failed probe as degraded and throttles a fresh healthy row", async () => {
    const environment = localEmailEnvironment();
    const binding = emailProviderActivationBinding(
      environment,
      "email.transactional",
    );
    if (binding === null || binding.expectedSecretVersionRef === undefined) {
      throw new Error("Expected local email binding");
    }
    const records = new Map<string, ActivationFixture>([
      ["email.transactional", record(binding)],
    ]);
    const updates: Array<{ data: { health: string } }> = [];
    const failedProbe = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    await expect(
      refreshConfiguredProviderHealth({
        database: databaseFixture(records, updates),
        environment,
        now: NOW,
        probes: { EMAIL: failedProbe },
      }),
    ).resolves.toMatchObject({ checked: 1, degraded: 1, healthy: 0 });
    expect(updates[0]?.data.health).toBe("DEGRADED");

    records.set("email.transactional", {
      ...record(binding),
      healthCheckedAt: new Date(NOW.getTime() - 1_000),
    });
    const freshProbe = vi.fn(async () => undefined);
    await expect(
      refreshConfiguredProviderHealth({
        database: databaseFixture(records, []),
        environment,
        now: NOW,
        probes: { EMAIL: freshProbe },
      }),
    ).resolves.toMatchObject({ checked: 0, skipped: 2 });
    expect(freshProbe).not.toHaveBeenCalled();
  });

  it("requires the exact EMAIL_FROM domain to be verified for sending", () => {
    const response = JSON.stringify({
      object: "list",
      has_more: false,
      data: [
        {
          name: "notifications.example.ch",
          status: "verified",
          capabilities: { sending: "enabled", receiving: "disabled" },
        },
      ],
    });
    expect(() =>
      assertResendSendingDomainHealth(
        response,
        "SwissTalentHub <mail@notifications.example.ch>",
      ),
    ).not.toThrow();
    expect(() =>
      assertResendSendingDomainHealth(response, "mail@wrong.example.ch"),
    ).toThrow("PROVIDER_HEALTH_EMAIL_SENDING_DOMAIN_UNVERIFIED");
    expect(() =>
      assertResendSendingDomainHealth(
        JSON.stringify({
          data: [
            {
              name: "notifications.example.ch",
              status: "pending",
              capabilities: { sending: "enabled" },
            },
          ],
        }),
        "mail@notifications.example.ch",
      ),
    ).toThrow("PROVIDER_HEALTH_EMAIL_SENDING_DOMAIN_UNVERIFIED");
  });
});

type ActivationFixture = ProviderActivationRecord &
  Readonly<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }>;

function databaseFixture(
  records: Map<string, ActivationFixture>,
  updates: unknown[],
) {
  return {
    providerActivation: {
      findFirst: vi.fn(
        async (query: { where: { useCase: string } }) =>
          records.get(query.where.useCase) ?? null,
      ),
      updateMany: vi.fn(async (query: unknown) => {
        updates.push(query);
        return { count: 1 };
      }),
    },
  } as unknown as DatabaseClient;
}

function localEmailEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      EMAIL_PROVIDER_MODE: "local_mock",
      ENABLE_LOCAL_MOCK_MAILBOX: "true",
      DEV_MAILBOX_SECRET: Buffer.alloc(32, 21).toString("base64"),
      WORKER_RUNTIME: "sandbox_command",
    }),
  );
}

function record(
  binding: NonNullable<ReturnType<typeof emailProviderActivationBinding>>,
): ActivationFixture {
  return {
    id: crypto.randomUUID(),
    adapterKey: binding.adapterKey,
    adapterVersion: binding.adapterVersion,
    approvalRef: "approval:phase33-test",
    configurationDigest: binding.expectedConfigurationDigest,
    contractRef: "contract:phase33-test",
    createdAt: new Date(NOW.getTime() - 120_000),
    dpaRef: "dpa:phase33-test",
    effectiveAt: new Date(NOW.getTime() - 120_000),
    environment: "local",
    evidenceDigest: "a".repeat(64),
    expiresAt: null,
    health: "HEALTHY",
    healthCheckedAt: new Date(NOW.getTime() - 120_000),
    killSwitchEngaged: false,
    mode: binding.expectedMode,
    owner: "Communications / Platform",
    quotaUnits: 1_000,
    region: "local-test",
    revokedAt: null,
    runbookRef: "codex-plan/runbooks/provider-activation.md",
    secretVersionRef: binding.expectedSecretVersionRef ?? null,
    sustainableCapacity: 1_000,
    unitCostMicros: 0n,
    unitCostSource: "fixture:phase33",
    updatedAt: new Date(NOW.getTime() - 120_000),
    useCase: binding.useCase,
  };
}
