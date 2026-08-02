import { describe, expect, it, vi } from "vitest";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { createLegacyLocalMockEmailProvider } from "@/lib/providers/email/legacy-local-mock-provider";

const request = Object.freeze({
  to: "local@example.test",
  templateKey: "registration_welcome" as const,
  subject: "Willkommen",
  data: Object.freeze({ firstName: "Local" }),
});

describe("legacy local mock provider boundary", () => {
  it("records only when the exact mode is local_mock", async () => {
    const send = vi.fn(async () =>
      Object.freeze({
        logId: "20000000-0000-4000-8000-000000000001",
        created: true,
      }),
    );
    const provider = createLegacyLocalMockEmailProvider({
      getMode: () => "local_mock",
      getLocalProvider: () => ({ send }) as EmailProvider,
    });

    await expect(provider.send(request)).resolves.toMatchObject({
      created: true,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    "disabled",
    "resend_sandbox",
    "resend_contract",
    "resend_live",
  ] as const)("fails closed in %s without touching the mock", async (mode) => {
    const send = vi.fn();
    const provider = createLegacyLocalMockEmailProvider({
      getMode: () => mode as ServerEnvironment["EMAIL_PROVIDER_MODE"],
      getLocalProvider: () => ({ send }) as unknown as EmailProvider,
    });

    await expect(provider.send(request)).rejects.toThrow(
      "LEGACY_EMAIL_PATH_DISABLED",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
