import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { readProviderInboxHealth } from "@/lib/ops/provider-inbox-health";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-08-06T12:00:00.000Z");
const ENVIRONMENT = "ci";
const CANARY = "provider-inbox-canary@example.test";
let migrated: Migrated | undefined;
let database: DatabaseClient | undefined;
let activationId: string;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase34_provider_inbox_health");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const activation = await database.providerActivation.create({
    data: {
      environment: ENVIRONMENT,
      useCase: "email.delivery-events",
      adapterKey: "resend_contract",
      adapterVersion: "v1",
      mode: "SANDBOX",
      configurationDigest: "a".repeat(64),
      evidenceDigest: "b".repeat(64),
      owner: "Phase 34 Operations",
      runbookRef: "codex-plan/runbooks/worker-operations.md",
      health: "HEALTHY",
      killSwitchEngaged: false,
      effectiveAt: new Date(NOW.getTime() - 60_000),
    },
    select: { id: true },
  });
  activationId = activation.id;
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase-34 provider inbox health PostgreSQL boundary", () => {
  it("reports only redacted aggregates and excludes another environment", async () => {
    await createPaymentInbox("RECEIVED", 2 * 60_000, { environment: ENVIRONMENT });
    await createPaymentInbox("RECEIVED", 30 * 60_000, { environment: "staging" });
    await createEmailInbox("RECEIVED", 2 * 60_000);

    const health = await readProviderInboxHealth(db(), {
      environment: ENVIRONMENT,
      now: NOW,
    });
    expect(health).toMatchObject({
      processingState: "HEALTHY",
      manualAttention: "NONE",
      payment: { received: { count: 1, oldestAgeSeconds: 120 } },
      email: { received: { count: 1, oldestAgeSeconds: 120 } },
    });
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain(activationId);
    expect(serialized).not.toContain("providerReceipt");
  });

  it("degrades at exact boundaries, keeps holds manual and heals on terminal projection", async () => {
    const stalePayment = await createPaymentInbox("RECEIVED", 15 * 60_000, {
      environment: ENVIRONMENT,
    });
    const brokenPayment = await createPaymentInbox("FAILED", 60_000, {
      environment: ENVIRONMENT,
      nextRetryAt: null,
    });
    const heldPayment = await createPaymentInbox("HELD", 60 * 60_000, {
      environment: ENVIRONMENT,
    });
    const staleEmail = await createEmailInbox("RECEIVED", 15 * 60_000);

    const degraded = await readProviderInboxHealth(db(), {
      environment: ENVIRONMENT,
      now: NOW,
    });
    expect(degraded.processingState).toBe("DEGRADED");
    expect(degraded.manualAttention).toBe("REQUIRED");
    expect(degraded.reasons).toEqual(
      expect.arrayContaining([
        "PAYMENT_INBOX_STALE",
        "PAYMENT_RETRY_CONTRACT_BROKEN",
        "EMAIL_INBOX_STALE",
      ]),
    );

    await db().providerEventInbox.updateMany({
      where: { id: { in: [stalePayment, brokenPayment] } },
      data: { status: "PROJECTED", processedAt: NOW },
    });
    await db().emailProviderEventInbox.updateMany({
      where: { id: staleEmail },
      data: {
        status: "IGNORED",
        processedAt: NOW,
        recipientHashes: [],
        recipientHashesWipedAt: NOW,
      },
    });
    const healed = await readProviderInboxHealth(db(), {
      environment: ENVIRONMENT,
      now: NOW,
    });
    expect(healed).toMatchObject({
      processingState: "HEALTHY",
      manualAttention: "REQUIRED",
      reasons: [],
    });
    expect(healed.payment.held.count).toBe(1);
    expect(heldPayment).toEqual(expect.any(String));
  });

  it("treats a terminal email projection failure as immediately degraded", async () => {
    await createEmailInbox("FAILED", 60_000);
    const health = await readProviderInboxHealth(db(), {
      environment: ENVIRONMENT,
      now: NOW,
    });

    expect(health.processingState).toBe("DEGRADED");
    expect(health.reasons).toContain("EMAIL_INBOX_FAILED");
  });
});

async function createPaymentInbox(
  status: "RECEIVED" | "FAILED" | "HELD",
  ageMilliseconds: number,
  options: Readonly<{ environment: string; nextRetryAt?: Date | null }>,
) {
  const id = randomUUID();
  await db().providerEventInbox.create({
    data: {
      id,
      provider: "STRIPE",
      environment: options.environment,
      adapterKey:
        options.environment === "ci" ? "stripe_contract" : "stripe_sandbox",
      adapterVersion: "v1",
      providerMode: options.environment === "ci" ? "CONTRACT" : "SANDBOX",
      expectedLiveMode: false,
      providerAccountReference: `acct_${id}`,
      providerEventId: `evt_${id}`,
      eventType: "payment_intent.succeeded",
      eventCreatedAt: new Date(NOW.getTime() - ageMilliseconds),
      liveMode: false,
      rawBodyDigest: "c".repeat(64),
      signatureDigest: "d".repeat(64),
      payloadSchemaVersion: "stripe-event-v1",
      normalizedPayload: { canary: CANARY },
      status,
      receivedAt: new Date(NOW.getTime() - ageMilliseconds),
      processedAt:
        status === "RECEIVED"
          ? null
          : new Date(NOW.getTime() - ageMilliseconds + 1_000),
      nextRetryAt:
        options.nextRetryAt === undefined
          ? new Date(NOW.getTime() + 60_000)
          : options.nextRetryAt,
      attemptCount: status === "FAILED" ? 1 : 0,
    },
  });
  return id;
}

async function createEmailInbox(
  status: "RECEIVED" | "FAILED",
  ageMilliseconds: number,
) {
  const id = randomUUID();
  await db().emailProviderEventInbox.create({
    data: {
      id,
      environment: ENVIRONMENT,
      adapterKey: "resend_contract",
      adapterVersion: "v1",
      providerActivationId: activationId,
      svixId: `svix_${id}`,
      providerReceipt: `receipt_${id}`,
      recipientHashes: status === "RECEIVED" ? ["f".repeat(64)] : [],
      recipientHashesWipedAt:
        status === "RECEIVED"
          ? null
          : new Date(NOW.getTime() - ageMilliseconds + 1_000),
      eventType: "email.bounced",
      eventCreatedAt: new Date(NOW.getTime() - ageMilliseconds),
      payloadDigest: "e".repeat(64),
      receivedAt: new Date(NOW.getTime() - ageMilliseconds),
      status,
      processedAt:
        status === "RECEIVED"
          ? null
          : new Date(NOW.getTime() - ageMilliseconds + 1_000),
    },
  });
  return id;
}

function db() {
  if (database === undefined) throw new Error("Provider inbox test DB unavailable.");
  return database;
}
