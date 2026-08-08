import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import {
  RESEND_EVENT_PROJECTION_POLICY_V1,
  resendEventProjectionWorkDedupeKey,
} from "@/lib/providers/email/resend-event-inbox";

describe("Phase-34 Resend provider-event worker contract", () => {
  it("registers one implemented event-driven handler with the delivery-events provider boundary", () => {
    expect(
      getWorkerHandlerDefinition(
        RESEND_EVENT_PROJECTION_POLICY_V1.handlerKey,
        RESEND_EVENT_PROJECTION_POLICY_V1.handlerVersion,
      ),
    ).toMatchObject({
      execution: "IMPLEMENTED",
      handlerKey: "notifications.provider-event-project",
      handlerVersion: "v1",
      payloadVersion: "v1",
      providerUseCase: "email.delivery-events",
      schedule: "event-driven",
    });
  });

  it("derives a stable bounded queue identity solely from the opaque inbox UUID", () => {
    const inboxId = randomUUID();

    expect(resendEventProjectionWorkDedupeKey(inboxId)).toBe(
      `notifications.provider-event-project:v1:${inboxId}`,
    );
    expect(
      resendEventProjectionWorkDedupeKey(inboxId).length,
    ).toBeLessThanOrEqual(160);
    expect(() =>
      resendEventProjectionWorkDedupeKey("customer@example.ch"),
    ).toThrow(TypeError);
  });
});
