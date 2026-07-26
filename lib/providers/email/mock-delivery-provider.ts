import "server-only";

import type { EmailProvider } from "./email-provider";
import type {
  EmailDeliveryProvider,
  EmailDeliveryRequest,
} from "./email-delivery-provider";

export class LocalMockDeliveryProvider implements EmailDeliveryProvider {
  readonly providerClass = "local-mock-v1";

  constructor(private readonly provider: EmailProvider) {}

  async deliver(input: EmailDeliveryRequest) {
    const delivered = await this.provider.send({
      to: input.to,
      templateKey: input.templateKey,
      subject: input.subject,
      data: { ...input.templateData, idempotencyKey: input.idempotencyKey },
    });
    return Object.freeze({
      providerClass: this.providerClass,
      providerReceipt: delivered.logId,
      accepted: true as const,
    });
  }
}
