import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerEnvironment } = vi.hoisted(() => ({
  getServerEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getServerEnvironment }));

import {
  captureLocalMockEmail,
  consumeLocalMockEmail,
} from "@/lib/providers/email/local-mock-mailbox";

const secret = Buffer.alloc(40, 29).toString("base64");
const captureInput = Object.freeze({
  to: "candidate@example.test",
  templateKey: "password_reset_mock" as const,
  subject: "Passwort für SwissTalentHub zurücksetzen",
  body: "Lokale Nachricht mit einem geschützten Link.",
  actionUrl: "http://127.0.0.1:3000/reset-password#token=raw-reset-token-that-is-at-least-thirty-two-bytes",
});

describe("configured local mock mailbox boundary", () => {
  beforeEach(() => {
    getServerEnvironment.mockReset();
    globalThis.swissTalentHubLocalMockMailbox = undefined;
  });

  it.each([
    ["production", "production"],
    ["staging", "test"],
  ])("stays closed in %s even if a caller supplies an enabled flag", (appEnv, nodeEnv) => {
    configureEnvironment({ appEnv, enabled: true, nodeEnv });

    expect(captureLocalMockEmail(captureInput)).toBe("disabled");
    expect(consumeLocalMockEmail(`Bearer ${secret}`)).toEqual({
      status: "closed",
    });
  });

  it("stays closed unless the explicit feature flag is enabled", () => {
    configureEnvironment({ enabled: false });

    expect(captureLocalMockEmail(captureInput)).toBe("disabled");
    expect(consumeLocalMockEmail(`Bearer ${secret}`)).toEqual({
      status: "closed",
    });
  });

  it("uses the configured secret on every one-time read", () => {
    configureEnvironment({ enabled: true });

    expect(captureLocalMockEmail(captureInput)).toBe("recorded");
    expect(consumeLocalMockEmail("Bearer wrong-secret")).toEqual({
      status: "unauthorized",
    });
    expect(consumeLocalMockEmail(`Bearer ${secret}`)).toMatchObject({
      status: "delivered",
      envelope: { actionUrl: captureInput.actionUrl },
    });
    expect(consumeLocalMockEmail(`Bearer ${secret}`)).toEqual({
      status: "empty",
    });
  });
});

function configureEnvironment(
  options: Readonly<{
    appEnv?: string;
    enabled: boolean;
    nodeEnv?: string;
  }>,
) {
  getServerEnvironment.mockReturnValue({
    APP_ENV: options.appEnv ?? "local",
    NODE_ENV: options.nodeEnv ?? "test",
    APP_URL: "http://127.0.0.1:3000",
    ENABLE_LOCAL_MOCK_MAILBOX: options.enabled,
    secrets: {
      localMailbox: {
        withValue: (consumer: (value: string) => unknown) => consumer(secret),
      },
    },
  });
}
