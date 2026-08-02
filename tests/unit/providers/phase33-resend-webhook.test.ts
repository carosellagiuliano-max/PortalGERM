// @vitest-environment node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { Webhook } from "svix";
import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  RESEND_WEBHOOK_CONTRACT_V1,
  ResendWebhookVerificationError,
  readBoundedResendWebhookBody,
  verifyResendDeliveryWebhook,
} from "@/lib/providers/email/resend-webhook";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

const webhookSecret = `whsec_${Buffer.alloc(32, 11).toString("base64")}`;

describe("Phase-33 signed Resend webhook contract", () => {
  it("verifies the raw body and returns only a digest plus PII-free delivery data", () => {
    const rawBody = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-08-01T10:00:00.000Z",
      data: {
        email_id: "email_phase33_receipt",
        to: ["candidate@example.ch"],
      },
    });
    const verified = verifyResendDeliveryWebhook(
      signedInput(rawBody, new Date()),
    );
    const repeated = verifyResendDeliveryWebhook(
      signedInput(rawBody, new Date()),
    );
    const otherSecret = `whsec_${Buffer.alloc(32, 12).toString("base64")}`;
    const rotatedWebhookSecret = verifyResendDeliveryWebhook(
      signedInput(rawBody, new Date(), otherSecret),
    );
    const changedBodyDigest = verifyResendDeliveryWebhook(
      signedInput(
        rawBody.replace("email_phase33_receipt", "email_phase33_changed"),
        new Date(),
        otherSecret,
      ),
    ).payloadDigest;

    expect(verified).toMatchObject({
      eventId: "msg_phase33Webhook01",
      event: {
        kind: "BOUNCED",
        providerReceipt: "email_phase33_receipt",
      },
    });
    expect(verified.payloadDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(repeated.payloadDigest).toBe(verified.payloadDigest);
    expect(rotatedWebhookSecret.payloadDigest).toBe(verified.payloadDigest);
    expect(rotatedWebhookSecret.payloadDigestCandidates).toContain(
      verified.payloadDigest,
    );
    expect(verified.payloadDigest).not.toBe(
      createHash("sha256").update(rawBody).digest("hex"),
    );
    expect(changedBodyDigest).not.toBe(verified.payloadDigest);
    expect(JSON.stringify(verified)).not.toContain("candidate@example.ch");
  });

  it("rejects tampering, stale timestamps, malformed headers and oversized bodies", () => {
    const rawBody = deliveryBody();
    const signed = signedInput(rawBody, new Date());

    expectError(
      () => verifyResendDeliveryWebhook({ ...signed, rawBody: `${rawBody} ` }),
      "SIGNATURE_INVALID",
    );
    expectError(
      () =>
        verifyResendDeliveryWebhook(
          signedInput(rawBody, new Date(Date.now() - 10 * 60_000)),
        ),
      "SIGNATURE_INVALID",
    );
    expectError(
      () => verifyResendDeliveryWebhook({ ...signed, svixId: "invalid" }),
      "HEADERS_INVALID",
    );
    expectError(
      () =>
        verifyResendDeliveryWebhook({
          ...signed,
          rawBody: "x".repeat(
            RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes + 1,
          ),
        }),
      "BODY_TOO_LARGE",
    );
  });

  it("keeps exact replay evidence during notification-key overlap and expires it after removal", () => {
    const rawBody = deliveryBody();
    const timestamp = new Date();
    const originalKeys = `notification-v1:${keyMaterial(21)}`;
    const retainedKeys = `notification-v2:${keyMaterial(22)},` + originalKeys;
    const removedKeys = `notification-v2:${keyMaterial(22)}`;
    const original = verifyResendDeliveryWebhook(
      signedInput(rawBody, timestamp, webhookSecret, originalKeys),
    );
    const retained = verifyResendDeliveryWebhook(
      signedInput(rawBody, timestamp, webhookSecret, retainedKeys),
    );
    const removed = verifyResendDeliveryWebhook(
      signedInput(rawBody, timestamp, webhookSecret, removedKeys),
    );

    expect(retained.payloadDigest).not.toBe(original.payloadDigest);
    expect(retained.payloadDigestCandidates).toContain(original.payloadDigest);
    expect(removed.payloadDigestCandidates).not.toContain(
      original.payloadDigest,
    );
  });

  it("rejects signed but unsupported event shapes without retaining the payload", () => {
    const rawBody = JSON.stringify({
      type: "email.opened",
      created_at: new Date().toISOString(),
      data: { email_id: "email_phase33", to: ["candidate@example.ch"] },
    });
    expectError(
      () => verifyResendDeliveryWebhook(signedInput(rawBody, new Date())),
      "EVENT_UNSUPPORTED",
    );
  });

  it("bounds the request stream before buffering an attacker-controlled body", async () => {
    await expect(
      readBoundedResendWebhookBody(
        new Request("http://phase33.invalid/webhook", {
          method: "POST",
          body: "safe-body",
        }),
      ),
    ).resolves.toEqual(Buffer.from("safe-body"));
    await expect(
      readBoundedResendWebhookBody(
        new Request("http://phase33.invalid/webhook", {
          method: "POST",
          body: "x".repeat(RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes + 1),
        }),
      ),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
});

function signedInput(
  rawBody: string,
  timestamp: Date,
  signingSecret = webhookSecret,
  notificationRecipientHashKeys = `recipient-hash-v1:${keyMaterial(18)}`,
) {
  const eventId = "msg_phase33Webhook01";
  const parsedEnvironment = environment(
    signingSecret,
    notificationRecipientHashKeys,
  );
  return {
    rawBody,
    secret: parsedEnvironment.secrets.resendWebhook!,
    recipientHashKeyring:
      parsedEnvironment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
    svixId: eventId,
    svixTimestamp: String(Math.floor(timestamp.getTime() / 1_000)),
    svixSignature: new Webhook(signingSecret).sign(eventId, timestamp, rawBody),
  };
}

function deliveryBody() {
  return JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: "email_phase33", to: ["candidate@example.ch"] },
  });
}

function environment(
  secret = webhookSecret,
  notificationRecipientHashKeys = `recipient-hash-v1:${keyMaterial(18)}`,
) {
  return parseEnvironment(
    createValidEnvironment({
      EMAIL_PROVIDER_MODE: "resend_sandbox",
      EMAIL_PROVIDER_API_KEY: "re_phase33_sandbox_key",
      RESEND_WEBHOOK_SECRET: secret,
      RESEND_SECRET_VERSION: "phase33-v1",
      RESEND_WEBHOOK_SECRET_VERSION: "phase33-webhook-v1",
      NOTIFICATION_RECIPIENT_HASH_KEYS: notificationRecipientHashKeys,
      EMAIL_FROM: "SwissTalentHub <sandbox@resend.dev>",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      NOTIFICATION_DISPATCH: "command",
    }),
  );
}

function expectError(
  operation: () => unknown,
  code: ResendWebhookVerificationError["code"],
) {
  try {
    operation();
    throw new Error("Expected Resend webhook verification to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ResendWebhookVerificationError);
    expect((error as ResendWebhookVerificationError).code).toBe(code);
  }
}
