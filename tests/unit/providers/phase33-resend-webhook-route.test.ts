// @vitest-environment node

import { Buffer } from "node:buffer";

import { Webhook } from "svix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/webhooks/email/resend/route";
import { parseEnvironment } from "@/lib/config/env-schema";
import { RESEND_WEBHOOK_CONTRACT_V1 } from "@/lib/providers/email/resend-webhook";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const mocks = vi.hoisted(() => {
  const database = Object.freeze({ marker: "resend-webhook-database" });
  return {
    database,
    getDatabase: vi.fn(() => database),
    getServerEnvironment: vi.fn(),
    ingestVerifiedResendDeliveryWebhook: vi.fn(),
    resolvePersistedProviderActivation: vi.fn(),
  };
});

vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/ops/operations-ledger", () => ({
  resolvePersistedProviderActivation: mocks.resolvePersistedProviderActivation,
}));
vi.mock("@/lib/providers/email/resend-event-inbox", () => ({
  ResendEventInboxConflictError: class ResendEventInboxConflictError extends Error {},
  ingestVerifiedResendDeliveryWebhook:
    mocks.ingestVerifiedResendDeliveryWebhook,
}));

const WEBHOOK_SECRET = `whsec_${Buffer.alloc(32, 23).toString("base64")}`;
const WRONG_WEBHOOK_SECRET = `whsec_${Buffer.alloc(32, 24).toString("base64")}`;

describe("POST /api/webhooks/email/resend authentication order", () => {
  beforeEach(() => {
    mocks.getServerEnvironment.mockReturnValue(resendEnvironment());
    mocks.resolvePersistedProviderActivation.mockResolvedValue({
      active: true,
      activationId: "00000000-0000-4000-8000-000000000033",
      adapterKey: "resend_sandbox",
      adapterVersion: "v1",
      mode: "SANDBOX",
    });
    mocks.ingestVerifiedResendDeliveryWebhook.mockResolvedValue({
      inboxId: "0196f82d-3fb4-7f1a-8c9d-123456789abc",
      projectedSuppressions: 0,
      replay: false,
    });
  });

  it("does not acquire a database client when signature headers are missing", async () => {
    const response = await POST(
      new Request("https://swisstalenthub.test/api/webhooks/email/resend", {
        method: "POST",
        body: resendEventBody(),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "HEADERS_INVALID" });
    expectNoDatabaseEffect();
  });

  it("cryptographically rejects a bad signature before every database call", async () => {
    const rawBody = resendEventBody();
    const response = await POST(
      resendRequest(rawBody, signedHeaders(rawBody, WRONG_WEBHOOK_SECRET)),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SIGNATURE_INVALID" });
    expectNoDatabaseEffect();
  });

  it("rejects a declared oversized body before every database call", async () => {
    const rawBody = resendEventBody();
    const request = resendRequest(rawBody, signedHeaders(rawBody));
    request.headers.set(
      "content-length",
      String(RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes + 1),
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
    expectNoDatabaseEffect();
  });

  it("bounds an oversized chunked stream before every database call", async () => {
    const response = await POST(
      streamedResendRequest([
        new Uint8Array(RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes),
        new Uint8Array(1),
      ]),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
    expectNoDatabaseEffect();
  });

  it("queries the exact activation only after a valid signed envelope", async () => {
    const rawBody = resendEventBody();
    const response = await POST(resendRequest(rawBody, signedHeaders(rawBody)));

    expect(response.status).toBe(202);
    expect(mocks.getDatabase).toHaveBeenCalledOnce();
    expect(mocks.resolvePersistedProviderActivation).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({
        adapterKey: "resend_sandbox",
        expectedMode: "SANDBOX",
        expectedSecretVersionRef: "phase33-route-webhook-v1",
        useCase: "email.delivery-events",
      }),
    );
    expect(mocks.ingestVerifiedResendDeliveryWebhook).toHaveBeenCalledOnce();
    expect(mocks.ingestVerifiedResendDeliveryWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        providerActivationId: "00000000-0000-4000-8000-000000000033",
      }),
      mocks.database,
    );
  });
});

function resendEnvironment() {
  return parseEnvironment(
    createValidEnvironment({
      EMAIL_FROM: "SwissTalentHub <sandbox@resend.dev>",
      EMAIL_PROVIDER_API_KEY: "re_phase33_route_key",
      EMAIL_PROVIDER_MODE: "resend_sandbox",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      RESEND_SECRET_VERSION: "phase33-route-v1",
      RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RESEND_WEBHOOK_SECRET_VERSION: "phase33-route-webhook-v1",
    }),
  );
}

function resendEventBody() {
  return JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      email_id: "email_phase33_route_receipt",
      to: ["candidate@example.ch"],
    },
  });
}

function signedHeaders(rawBody: string, secret = WEBHOOK_SECRET) {
  const eventId = "msg_phase33WebhookRoute01";
  const timestamp = new Date();
  return {
    "svix-id": eventId,
    "svix-signature": new Webhook(secret).sign(eventId, timestamp, rawBody),
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
  };
}

function resendRequest(rawBody: string, headers: Record<string, string>) {
  return new Request("https://swisstalenthub.test/api/webhooks/email/resend", {
    method: "POST",
    body: rawBody,
    headers,
  });
}

function streamedResendRequest(chunks: Uint8Array[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("https://swisstalenthub.test/api/webhooks/email/resend", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function expectNoDatabaseEffect() {
  expect(mocks.getDatabase).not.toHaveBeenCalled();
  expect(mocks.resolvePersistedProviderActivation).not.toHaveBeenCalled();
  expect(mocks.ingestVerifiedResendDeliveryWebhook).not.toHaveBeenCalled();
}
