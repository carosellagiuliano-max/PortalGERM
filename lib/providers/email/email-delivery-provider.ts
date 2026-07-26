import type { EmailTemplateKey } from "./email-provider";

export type EmailDeliveryRequest = Readonly<{
  to: string;
  templateKey: EmailTemplateKey;
  subject: string;
  text: string;
  templateData: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
  timeoutMilliseconds: number;
}>;

export type EmailDeliveryReceipt = Readonly<{
  providerClass: string;
  providerReceipt: string;
  accepted: true;
}>;

export type EmailDeliveryFailureKind =
  | "TRANSIENT"
  | "PERMANENT"
  | "BOUNCE"
  | "SUPPRESSED"
  | "TIMEOUT"
  | "CONFIGURATION";

export interface EmailDeliveryProvider {
  readonly providerClass: string;
  deliver(input: EmailDeliveryRequest): Promise<EmailDeliveryReceipt>;
}

export class EmailDeliveryFailure extends Error {
  constructor(
    readonly kind: EmailDeliveryFailureKind,
    readonly code: string,
  ) {
    super(`E-mail delivery failed: ${kind}:${code}`);
    this.name = "EmailDeliveryFailure";
  }
}
