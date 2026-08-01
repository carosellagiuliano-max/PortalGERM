import { describe, expect, it } from "vitest";

import {
  getInvitationDeliveryFeedback,
  getPasswordResetDeliveryFeedback,
  getTransactionalEmailDeliveryState,
} from "@/lib/notifications/delivery-state";

const BASE = {
  EMAIL_PROVIDER_MODE: "disabled" as const,
  ENABLE_LOCAL_MOCK_MAILBOX: false,
  NOTIFICATION_DISPATCH: "paused" as const,
  NOTIFICATION_OUTBOX_PRODUCERS: false,
};

describe("transactional email delivery state", () => {
  it("distinguishes external dispatch, a local mailbox, a paused queue and record-only mode", () => {
    expect(getTransactionalEmailDeliveryState(BASE)).toBe("record_only");
    expect(getTransactionalEmailDeliveryState({
      ...BASE,
      ENABLE_LOCAL_MOCK_MAILBOX: true,
    })).toBe("local_mailbox");
    expect(getTransactionalEmailDeliveryState({
      ...BASE,
      NOTIFICATION_OUTBOX_PRODUCERS: true,
    })).toBe("queued_paused");
    expect(getTransactionalEmailDeliveryState({
      ...BASE,
      EMAIL_PROVIDER_MODE: "resend_sandbox",
      NOTIFICATION_DISPATCH: "command",
      NOTIFICATION_OUTBOX_PRODUCERS: true,
    })).toBe("external_dispatch");
  });

  it("does not describe an inaccessible mock log as a delivered invitation", () => {
    const message = getInvitationDeliveryFeedback({
      deliveryState: "record_only",
      emailRecorded: true,
      operation: "created",
    });

    expect(message).toContain("kein erreichbarer E-Mail-Versand aktiv");
    expect(message).not.toContain("zugestellt");
    expect(message).not.toContain("lokalen Mailbox");
  });

  it("marks password recovery unavailable when no recipient-reachable path exists", () => {
    expect(getPasswordResetDeliveryFeedback("record_only")).toEqual({
      status: "unavailable",
      message: expect.stringContaining("nicht zugestellt"),
    });
    expect(getPasswordResetDeliveryFeedback("queued_paused")).toEqual({
      status: "unavailable",
      message: expect.stringContaining("derzeit pausiert"),
    });
    expect(getPasswordResetDeliveryFeedback("external_dispatch")).toMatchObject({
      status: "success",
    });
  });
});
