import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveJobAlertDeliveryAvailability } from "@/lib/candidate/job-alert-delivery-runtime";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-08-06T12:00:00.000Z");
const DEPLOYMENT_DIGEST = "phase34-alert-delivery-runtime";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase34_job_alert_runtime");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = parseEnvironment(
    createValidEnvironment({
      APP_ENV: "production",
      NODE_ENV: "production",
      APP_URL: "https://alerts.swisstalenthub.example",
      APP_BUILD_ID: DEPLOYMENT_DIGEST,
      DATABASE_URL: migrated.connectionString,
      TEST_DATABASE_URL: undefined,
      TRUSTED_PROXY_HOPS: "2",
      EMAIL_PROVIDER_MODE: "resend_live",
      EMAIL_PROVIDER_API_KEY: "re_phase34_alert_runtime",
      EMAIL_FROM: "SwissTalentHub <alerts@example.ch>",
      RESEND_WEBHOOK_SECRET: "whsec_phase34_alert_runtime",
      RESEND_SECRET_VERSION: "phase34-email-v1",
      RESEND_WEBHOOK_SECRET_VERSION: "phase34-webhook-v1",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(38)}`,
      NOTIFICATION_RECIPIENT_HASH_KEYS: `recipient-v1:${keyMaterial(39)}`,
      WORKER_RUNTIME: "autonomous",
    }),
  );
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
  environment = undefined;
});

describe.sequential("Phase-34 job-alert runtime delivery truth", () => {
  it("requires current provider, handler, worker and scheduler authority and fails closed after revoke", async () => {
    await expect(availability(NOW)).resolves.toMatchObject({
      canActivate: false,
      reason: "JOB_ALERT_PROVIDER_INACTIVE",
    });

    const providerIds = await createProviderActivations();
    await expect(availability(NOW)).resolves.toMatchObject({
      canActivate: false,
      reason: "DIGEST_HANDLER_INACTIVE",
    });

    await createHandlerActivations();
    await expect(availability(NOW)).resolves.toMatchObject({
      canActivate: false,
      reason: "WORKER_HEARTBEAT_STALE",
    });

    await createRuntimeRun("phase33-worker-phase34-alert", NOW);
    await expect(availability(NOW)).resolves.toMatchObject({
      canActivate: false,
      reason: "SCHEDULER_HEARTBEAT_STALE",
    });

    await createRuntimeRun("phase33-scheduler-phase34-alert", NOW);
    await expect(availability(NOW)).resolves.toEqual({
      canActivate: true,
      manualMockEnabled: false,
      mode: "EXTERNAL",
      reason: "AVAILABLE",
    });

    await expect(
      availability(
        new Date(
          NOW.getTime() +
            45_000 +
            1,
        ),
      ),
    ).resolves.toMatchObject({
      canActivate: false,
      reason: "WORKER_HEARTBEAT_STALE",
    });

    await db().providerActivation.update({
      where: { id: providerIds.jobAlert },
      data: {
        killSwitchEngaged: true,
        revokedAt: new Date(NOW.getTime() + 1),
        revokeReasonCode: "PHASE34_ALERT_TEST_REVOKE",
      },
    });
    await expect(availability(new Date(NOW.getTime() + 2))).resolves.toMatchObject(
      {
        canActivate: false,
        reason: "JOB_ALERT_PROVIDER_INACTIVE",
      },
    );
  });

  it("keeps isolated Local/CI local_mock explicit without claiming external delivery", async () => {
    const local = parseEnvironment(
      createValidEnvironment({
        DATABASE_URL: migrated?.connectionString,
        EMAIL_PROVIDER_MODE: "local_mock",
      }),
    );

    await expect(
      resolveJobAlertDeliveryAvailability(db(), local, NOW),
    ).resolves.toEqual({
      canActivate: true,
      manualMockEnabled: true,
      mode: "LOCAL_MOCK",
      reason: "AVAILABLE",
    });
  });

  it.each(["preview", "staging"] as const)(
    "keeps %s fail-closed when only the web application is configured",
    async (appEnvironment) => {
      const webOnly = parseEnvironment(
        createValidEnvironment({
          APP_ENV: appEnvironment,
          NODE_ENV: "production",
          APP_URL: `https://${appEnvironment}.swisstalenthub.example`,
          APP_BUILD_ID: DEPLOYMENT_DIGEST,
          DATABASE_URL: migrated?.connectionString,
          TEST_DATABASE_URL: undefined,
          TRUSTED_PROXY_HOPS: "2",
          EMAIL_PROVIDER_MODE: "disabled",
          NOTIFICATION_OUTBOX_PRODUCERS: "true",
          NOTIFICATION_DISPATCH: "paused",
          WORKER_RUNTIME: "paused",
        }),
      );

      await expect(
        resolveJobAlertDeliveryAvailability(db(), webOnly, NOW),
      ).resolves.toEqual({
        canActivate: false,
        manualMockEnabled: false,
        mode: "UNAVAILABLE",
        reason: "DELIVERY_CONFIGURATION_UNAVAILABLE",
      });
    },
  );
});

async function createProviderActivations() {
  const ids: Partial<Record<"jobAlert" | "deliveryEvents", string>> = {};
  for (const [name, useCase] of [
    ["jobAlert", "email.job-alert"],
    ["deliveryEvents", "email.delivery-events"],
  ] as const) {
    const binding = emailProviderActivationBinding(env(), useCase);
    if (binding === null) throw new Error("Phase-34 e-mail binding unavailable.");
    const row = await db().providerActivation.create({
      data: {
        environment: env().APP_ENV,
        useCase,
        adapterKey: binding.adapterKey,
        adapterVersion: binding.adapterVersion,
        mode: binding.expectedMode,
        configurationDigest: binding.expectedConfigurationDigest,
        secretVersionRef: binding.expectedSecretVersionRef,
        region: "ch-test-1",
        dpaRef: "dpa:phase34:test",
        contractRef: "contract:phase34:test",
        approvalRef: "approval:phase34:test",
        evidenceDigest: name === "jobAlert" ? "a".repeat(64) : "b".repeat(64),
        owner: "Phase 34 Test",
        runbookRef: "codex-plan/runbooks/provider-activation.md",
        health: "HEALTHY",
        healthCheckedAt: NOW,
        quotaUnits: 10_000,
        sustainableCapacity: 10_000,
        unitCostMicros: 1n,
        unitCostSource: "phase34-test-fixture",
        killSwitchEngaged: false,
        effectiveAt: new Date(NOW.getTime() - 1_000),
      },
      select: { id: true },
    });
    ids[name] = row.id;
  }
  return {
    jobAlert: ids.jobAlert!,
    deliveryEvents: ids.deliveryEvents!,
  };
}

async function createHandlerActivations() {
  const keys = [
    "candidate.job-alert-digest",
    "notifications.dispatch",
    "notifications.provider-event-project",
  ] as const;
  for (const [index, key] of keys.entries()) {
    const handler = getWorkerHandlerDefinition(key, "v1");
    if (handler === null) throw new Error(`Missing handler ${key}.`);
    await db().workerHandlerActivation.create({
      data: {
        generation: 1,
        environment: env().APP_ENV,
        handlerKey: handler.handlerKey,
        handlerVersion: handler.handlerVersion,
        payloadVersion: handler.payloadVersion,
        mode: "LIVE",
        configurationDigest: String(index + 3).repeat(64),
        deploymentDigest: DEPLOYMENT_DIGEST,
        owner: "Phase 34 Test",
        runbookRef: handler.runbookRef,
        sloRef: handler.sloRef,
        evidenceDigest: String(index + 6).repeat(64),
        providerUseCase: handler.providerUseCase,
        leaseMilliseconds: 60_000,
        heartbeatMilliseconds: 20_000,
        batchSize: 25,
        maxAttempts: 8,
        maxConcurrency: 1,
        killSwitchEngaged: false,
        effectiveAt: new Date(NOW.getTime() - 1_000),
      },
    });
  }
}

async function createRuntimeRun(workerId: string, now: Date) {
  await db().workerRun.create({
    data: {
      workerId,
      environment: env().APP_ENV,
      deploymentDigest: DEPLOYMENT_DIGEST,
      runtimeVersion: "phase33-runtime-v1",
      status: "RUNNING",
      startedAt: now,
      heartbeatAt: now,
    },
  });
}

function availability(now: Date) {
  return resolveJobAlertDeliveryAvailability(db(), env(), now);
}

function db() {
  if (database === undefined) throw new Error("Phase-34 database unavailable.");
  return database;
}

function env() {
  if (environment === undefined) {
    throw new Error("Phase-34 environment unavailable.");
  }
  return environment;
}
