import { describe, expect, it } from "vitest";

import {
  EMAIL_NOTIFICATION_POLICY,
  classifyPurpose,
  mayUserDisablePurpose,
  resolveNotificationSendDecision,
} from "@/lib/notifications/purpose-policy";
import { EMAIL_TEMPLATE_KEYS } from "@/lib/providers/email/email-provider";

describe("Phase 20 notification purpose/preference policy", () => {
  it("classifies every template through one closed taxonomy", () => {
    expect(Object.keys(EMAIL_NOTIFICATION_POLICY).sort()).toEqual(
      [...EMAIL_TEMPLATE_KEYS].sort(),
    );
    expect(classifyPurpose("PASSWORD_RESET")).toBe("MANDATORY");
    expect(classifyPurpose("JOB_ALERT")).toBe("OPTIONAL");
    expect(mayUserDisablePurpose("JOB_ALERT")).toBe(true);
    expect(mayUserDisablePurpose("PASSWORD_RESET")).toBe(false);
  });

  it("never lets a marketing opt-out suppress mandatory communication", () => {
    expect(
      resolveNotificationSendDecision({
        purpose: "PASSWORD_RESET",
        preferenceEnabled: false,
        optionalEmailEnabled: false,
      }),
    ).toBe("SEND");
    expect(
      resolveNotificationSendDecision({
        purpose: "LOGIN_EMAIL_CHANGED_NOTICE",
        preferenceEnabled: false,
        optionalEmailEnabled: false,
      }),
    ).toBe("SEND");
  });

  it("requires both current opt-in and the optional delivery activation", () => {
    expect(
      resolveNotificationSendDecision({
        purpose: "JOB_ALERT",
        preferenceEnabled: true,
        optionalEmailEnabled: true,
      }),
    ).toBe("SEND");
    expect(
      resolveNotificationSendDecision({
        purpose: "JOB_ALERT",
        preferenceEnabled: false,
        optionalEmailEnabled: true,
      }),
    ).toBe("SUPPRESS");
    expect(
      resolveNotificationSendDecision({
        purpose: "JOB_ALERT",
        preferenceEnabled: true,
        optionalEmailEnabled: false,
      }),
    ).toBe("SUPPRESS");
  });

  it("fails an unreviewed purpose closed at the classifier boundary", () => {
    expect(
      resolveNotificationSendDecision({
        purpose: "UNREVIEWED_PURPOSE" as never,
        preferenceEnabled: true,
        optionalEmailEnabled: true,
      }),
    ).toBe("REJECT_UNKNOWN");
  });
});
