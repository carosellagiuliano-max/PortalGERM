import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  decryptNotificationProviderRequest,
  encryptNotificationProviderRequest,
} from "@/lib/notifications/provider-request-material";
import { createValidEnvironment } from "@/tests/fixtures/environment";

describe("Phase 33 immutable notification provider request", () => {
  it("round-trips an encrypted exact request across retained key rotation", () => {
    const oldEnvironment = parseEnvironment({
      ...createValidEnvironment(),
      NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(21)}`,
    });
    const rotatedEnvironment = parseEnvironment({
      ...createValidEnvironment(),
      NOTIFICATION_DELIVERY_KEYS: `notification-v2:${keyMaterial(22)},notification-v1:${keyMaterial(21)}`,
    });
    const request = {
      idempotencyKey: "notify:phase33:frozen-request",
      subject: "Unveränderlicher Inhalt",
      templateData: { companyName: "Beispiel AG", token: "opaque-value" },
      templateKey: "company_invitation" as const,
      text: "Diese Nachricht bleibt bei jedem Retry bytegleich.",
      timeoutMilliseconds: 10_000,
      to: "owner@example.test",
    };
    const binding = providerRequestBinding(request.idempotencyKey, request.templateKey);

    const encrypted = encryptNotificationProviderRequest(
      request,
      oldEnvironment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
      binding,
    );
    expect(
      decryptNotificationProviderRequest(
        encrypted,
        rotatedEnvironment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
        binding,
      ),
    ).toEqual(request);
    expect(encrypted.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Buffer.from(encrypted.ciphertext).toString("utf8")).not.toContain(
      "owner@example.test",
    );
  });

  it("rejects digest tampering and a missing historical key", () => {
    const environment = parseEnvironment({
      ...createValidEnvironment(),
      NOTIFICATION_DELIVERY_KEYS: `notification-v1:${keyMaterial(31)}`,
    });
    const request = {
        idempotencyKey: "notify:phase33:tamper",
        subject: "Subject",
        templateData: {},
        templateKey: "login_email_changed_notice",
        text: "Body",
        timeoutMilliseconds: 10_000,
        to: "security@example.test",
      } as const;
    const binding = providerRequestBinding(request.idempotencyKey, request.templateKey);
    const encrypted = encryptNotificationProviderRequest(
      request,
      environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
      binding,
    );
    expect(() =>
      decryptNotificationProviderRequest(
        { ...encrypted, digest: "0".repeat(64) },
        environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
        binding,
      ),
    ).toThrow("NOTIFICATION_PROVIDER_REQUEST_DIGEST_MISMATCH");

    const otherEnvironment = parseEnvironment({
      ...createValidEnvironment(),
      NOTIFICATION_DELIVERY_KEYS: `notification-v2:${keyMaterial(32)}`,
    });
    expect(() =>
      decryptNotificationProviderRequest(
        encrypted,
        otherEnvironment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
        binding,
      ),
    ).toThrow("NOTIFICATION_PROVIDER_REQUEST_KEY_VERSION_UNKNOWN");

    expect(() =>
      decryptNotificationProviderRequest(
        encrypted,
        environment.secrets.keyrings.NOTIFICATION_DELIVERY_KEYS,
        { ...binding, outboxId: "30000000-0000-4000-8000-000000000099" },
      ),
    ).toThrow();
  });
});

function providerRequestBinding(
  providerDedupeKey: string,
  templateKey: "company_invitation" | "login_email_changed_notice",
) {
  return Object.freeze({
    outboxId: "30000000-0000-4000-8000-000000000001",
    providerActivationId: "30000000-0000-4000-8000-000000000002",
    providerDedupeKey,
    templateKey,
  });
}

function keyMaterial(byte: number) {
  return Buffer.alloc(32, byte).toString("base64");
}
