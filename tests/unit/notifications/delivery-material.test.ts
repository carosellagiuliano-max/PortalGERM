import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decryptNotificationRecipient,
  encryptNotificationRecipient,
} from "@/lib/notifications/delivery-material";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createValidEnvironment } from "@/tests/fixtures/environment";

describe("notification recipient row binding", () => {
  it("decrypts only under the exact outbox, dedupe and template identity", () => {
    const keyring = parseEnvironment(
      createValidEnvironment(),
    ).secrets.keyrings.NOTIFICATION_DELIVERY_KEYS;
    const binding = {
      bindingVersion: "v2" as const,
      dedupeKey: "recipient-binding:a",
      outboxId: "20000000-0000-4000-8000-000000000901",
      retentionUntil: "2026-08-02T11:00:00.000Z",
      templateKey: "privacy_request_changed",
    };
    const encrypted = encryptNotificationRecipient(
      "bound-recipient@example.ch",
      keyring,
      binding,
    );

    expect(
      decryptNotificationRecipient(encrypted, keyring, binding),
    ).toBe("bound-recipient@example.ch");
    expect(() =>
      decryptNotificationRecipient(encrypted, keyring, {
        ...binding,
        outboxId: "20000000-0000-4000-8000-000000000902",
      }),
    ).toThrow();
    expect(() =>
      decryptNotificationRecipient(encrypted, keyring, {
        ...binding,
        dedupeKey: "recipient-binding:b",
      }),
    ).toThrow();
  });
});
