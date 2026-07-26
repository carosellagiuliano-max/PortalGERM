import "server-only";

import type { ServerEnvironment } from "@/lib/config/env-schema";

import { emailProvider } from ".";
import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
} from "./email-delivery-provider";
import { LocalMockDeliveryProvider } from "./mock-delivery-provider";
import { ResendSandboxEmailProvider } from "./resend-email-provider";

class DisabledEmailDeliveryProvider implements EmailDeliveryProvider {
  readonly providerClass = "disabled-v1";

  async deliver(): Promise<never> {
    throw new EmailDeliveryFailure("CONFIGURATION", "PROVIDER_DISABLED");
  }
}

export function createEmailDeliveryProvider(
  environment: ServerEnvironment,
): EmailDeliveryProvider {
  switch (environment.EMAIL_PROVIDER_MODE) {
    case "disabled":
      return new DisabledEmailDeliveryProvider();
    case "local_mock":
      return new LocalMockDeliveryProvider(emailProvider);
    case "resend_sandbox":
      return new ResendSandboxEmailProvider({
        apiKey: environment.secrets.emailProvider,
        from: environment.EMAIL_FROM,
      });
  }
}
