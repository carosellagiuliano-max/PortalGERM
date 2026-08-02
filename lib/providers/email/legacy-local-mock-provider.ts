import type { ServerEnvironment } from "@/lib/config/env-schema";

import type { EmailProvider } from "./email-provider";

/**
 * Compatibility adapter for the developer mailbox only. Provider-backed and
 * disabled modes are deliberately rejected before the mock repository can be
 * touched, so no real-mode failure can be misreported as a mock recording.
 */
export function createLegacyLocalMockEmailProvider(input: Readonly<{
  getMode: () => ServerEnvironment["EMAIL_PROVIDER_MODE"];
  getLocalProvider: () => EmailProvider;
}>): EmailProvider {
  return Object.freeze({
    send(request: Parameters<EmailProvider["send"]>[0]) {
      if (input.getMode() !== "local_mock") {
        return Promise.reject(new Error("LEGACY_EMAIL_PATH_DISABLED"));
      }
      return input.getLocalProvider().send(request);
    },
  });
}
