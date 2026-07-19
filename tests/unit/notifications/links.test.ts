import { describe, expect, it, vi } from "vitest";

import {
  UnsafeNotificationLinkError,
  resolveAuthorizedNotificationLink,
  type AuthorizedNotificationLinkPort,
} from "@/lib/notifications/links";

const recipientUserId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const payload = Object.freeze({ applicationId, status: "SUBMITTED" } as const);

describe("authorized notification links", () => {
  it("delegates recipient-target reauthorization before returning a path", async () => {
    const observed: unknown[] = [];
    const port: AuthorizedNotificationLinkPort = {
      async authorizeAndBuildLink(input) {
        observed.push(input);
        return `/candidate/applications/${applicationId}`;
      },
    };

    await expect(
      resolveAuthorizedNotificationLink(port, {
        kind: "APPLICATION_SUBMITTED",
        payload,
        recipientUserId,
      }),
    ).resolves.toBe(`/candidate/applications/${applicationId}`);
    expect(observed).toEqual([
      { kind: "APPLICATION_SUBMITTED", payload, recipientUserId },
    ]);
  });

  it("returns null when the authorization port denies the target", async () => {
    const port: AuthorizedNotificationLinkPort = {
      async authorizeAndBuildLink() {
        return null;
      },
    };

    await expect(
      resolveAuthorizedNotificationLink(port, {
        kind: "APPLICATION_SUBMITTED",
        payload,
        recipientUserId,
      }),
    ).resolves.toBeNull();
  });

  it("does not query authorization when the payload or recipient is invalid", async () => {
    const authorizeAndBuildLink = vi.fn(async () => "/safe");
    const port = { authorizeAndBuildLink } as AuthorizedNotificationLinkPort;

    await expect(
      resolveAuthorizedNotificationLink(port, {
        kind: "APPLICATION_SUBMITTED",
        payload: { ...payload, message: "private-canary" },
        recipientUserId,
      }),
    ).rejects.toThrow();
    await expect(
      resolveAuthorizedNotificationLink(port, {
        kind: "APPLICATION_SUBMITTED",
        payload,
        recipientUserId: "not-a-uuid",
      }),
    ).rejects.toThrow();
    expect(authorizeAndBuildLink).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "\\evil.example\\path",
    "/safe\r\nInjected: true",
  ])("rejects unsafe paths returned by the port: %s", async (unsafePath) => {
    const port: AuthorizedNotificationLinkPort = {
      async authorizeAndBuildLink() {
        return unsafePath;
      },
    };

    try {
      await resolveAuthorizedNotificationLink(port, {
        kind: "APPLICATION_SUBMITTED",
        payload,
        recipientUserId,
      });
      expect.unreachable("unsafe port result must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeNotificationLinkError);
      expect(String(error)).not.toContain(unsafePath);
    }
  });
});
