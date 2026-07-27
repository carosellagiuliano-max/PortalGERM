import Stripe from "stripe";
import { z } from "zod";

import type {
  CheckoutSession,
  CreatePaymentOperationInput,
  HostedPaymentProvider,
  NormalizedPaymentProviderEvent,
  ProviderRefundResult,
} from "@/lib/providers/payments/payment-provider";
import { isSafeAbsoluteHttpUrl } from "@/lib/validation/common";

const uuidSchema = z.uuid();
const referenceSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]+$/u);
const safeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const emailSchema = z.email().max(320);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const STRIPE_PAYMENT_ADAPTER_V1 = Object.freeze({
  adapterKey: "stripe_sandbox" as const,
  adapterVersion: "v1" as const,
  provider: "STRIPE" as const,
  useCase: "payments.hosted-checkout" as const,
  webhookToleranceSeconds: 300,
  maximumRawBodyBytes: 256 * 1024,
  liveModeSupported: false,
  fallbackProvider: null,
});

export class StripePaymentProviderError extends Error {
  readonly code:
    | "INVALID_CONFIGURATION"
    | "INVALID_CHECKOUT_INPUT"
    | "CHECKOUT_UNAVAILABLE"
    | "WEBHOOK_INVALID"
    | "WEBHOOK_ACCOUNT_MISMATCH"
    | "WEBHOOK_ENVIRONMENT_MISMATCH"
    | "DIRECT_CONFIRMATION_FORBIDDEN"
    | "STRIPE_PROVIDER_NOT_IMPLEMENTED";

  constructor(
    code: StripePaymentProviderError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StripePaymentProviderError";
    this.code = code;
  }
}

export type StripePaymentProviderConfiguration = Readonly<{
  accountId: string;
  secretKey: string;
  webhookSecret: string;
  stripeClient?: Stripe;
}>;

export class StripePaymentProviderUnavailableError extends StripePaymentProviderError {
  constructor() {
    super(
      "STRIPE_PROVIDER_NOT_IMPLEMENTED",
      "Stripe is unavailable without the explicit Phase-24 sandbox composition.",
    );
    this.name = "StripePaymentProviderUnavailableError";
  }
}

/**
 * Hosted Stripe test-mode adapter. It never receives card data and has no
 * live-mode branch or Mock fallback. Domain writes remain owned by Billing.
 */
export class StripePaymentProvider implements HostedPaymentProvider {
  readonly kind = "STRIPE" as const;
  readonly #accountId: string | null;
  readonly #stripe: Stripe | null;
  readonly #webhookSecret: string | null;

  constructor(configuration?: StripePaymentProviderConfiguration) {
    if (configuration === undefined) {
      this.#accountId = null;
      this.#webhookSecret = null;
      this.#stripe = null;
      return;
    }
    if (
      !/^acct_[A-Za-z0-9]{8,}$/u.test(configuration.accountId) ||
      !/^sk_test_[A-Za-z0-9]{8,}$/u.test(configuration.secretKey) ||
      !/^whsec_[A-Za-z0-9]{8,}$/u.test(configuration.webhookSecret)
    ) {
      throw new StripePaymentProviderError(
        "INVALID_CONFIGURATION",
        "Stripe sandbox configuration is incomplete or not test-mode.",
      );
    }
    this.#accountId = configuration.accountId;
    this.#webhookSecret = configuration.webhookSecret;
    this.#stripe =
      configuration.stripeClient ??
      new Stripe(configuration.secretKey, {
        appInfo: {
          name: "SwissTalentHub",
          version: STRIPE_PAYMENT_ADAPTER_V1.adapterVersion,
        },
        maxNetworkRetries: 0,
        timeout: 10_000,
        typescript: true,
      });
  }

  async createCheckout(
    input: CreatePaymentOperationInput,
  ): Promise<CheckoutSession> {
    const stripe = this.requireConfiguredStripe();
    const parsed = checkoutInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new StripePaymentProviderError(
        "INVALID_CHECKOUT_INPUT",
        "Hosted checkout requires a bounded server-authoritative CHF snapshot.",
      );
    }
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          locale: "de",
          client_reference_id: parsed.data.orderId,
          customer_email: parsed.data.authoritative.customerEmail,
          success_url: parsed.data.successUrl,
          cancel_url: parsed.data.cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "chf",
                unit_amount: parsed.data.authoritative.amountRappen,
                product_data: {
                  name: parsed.data.authoritative.description,
                  metadata: {
                    quote_digest: parsed.data.authoritative.quoteDigest,
                  },
                },
              },
            },
          ],
          metadata: {
            order_id: parsed.data.orderId,
            payment_attempt_id: parsed.data.authoritative.paymentAttemptId,
            quote_digest: parsed.data.authoritative.quoteDigest,
          },
          payment_intent_data: {
            metadata: {
              order_id: parsed.data.orderId,
              payment_attempt_id: parsed.data.authoritative.paymentAttemptId,
              quote_digest: parsed.data.authoritative.quoteDigest,
            },
          },
        },
        { idempotencyKey: parsed.data.idempotencyKey },
      );
      if (
        session.url === null ||
        !isSafeAbsoluteHttpUrl(session.url) ||
        !referenceSchema.safeParse(session.id).success
      ) {
        throw new Error("Stripe returned no safe hosted checkout URL.");
      }
      return Object.freeze({
        orderId: parsed.data.orderId,
        checkoutUrl: session.url,
        provider: this.kind,
        providerSessionReference: session.id,
      });
    } catch (error) {
      if (error instanceof StripePaymentProviderError) throw error;
      throw new StripePaymentProviderError(
        "CHECKOUT_UNAVAILABLE",
        "Stripe sandbox checkout could not be created.",
        { cause: error },
      );
    }
  }

  async confirmPayment(_input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ providerReference: string }> {
    this.requireConfiguredStripe();
    throw new StripePaymentProviderError(
      "DIRECT_CONFIRMATION_FORBIDDEN",
      "Real payment confirmation is accepted only from a verified webhook.",
    );
  }

  async cancel(_input: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<void> {
    this.requireConfiguredStripe();
    throw new StripePaymentProviderError(
      "DIRECT_CONFIRMATION_FORBIDDEN",
      "Real checkout cancellation is projected from provider state.",
    );
  }

  async createRefund(
    input: Readonly<{
      amountRappen: number;
      idempotencyKey: string;
      orderId: string;
      paymentAttemptId: string;
      providerPaymentReference: string;
      reasonCode: string;
    }>,
  ): Promise<ProviderRefundResult> {
    const stripe = this.requireConfiguredStripe();
    const parsed = refundInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new StripePaymentProviderError(
        "INVALID_CHECKOUT_INPUT",
        "Refund requires a bounded server-authoritative CHF snapshot.",
      );
    }
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: parsed.data.providerPaymentReference,
          amount: parsed.data.amountRappen,
          metadata: {
            order_id: parsed.data.orderId,
            payment_attempt_id: parsed.data.paymentAttemptId,
            reason_code: parsed.data.reasonCode,
          },
        },
        { idempotencyKey: parsed.data.idempotencyKey },
      );
      if (
        !referenceSchema.safeParse(refund.id).success ||
        refund.amount !== parsed.data.amountRappen ||
        refund.currency.toUpperCase() !== "CHF"
      ) {
        throw new Error("Stripe returned a conflicting refund snapshot.");
      }
      return Object.freeze({
        amountRappen: refund.amount,
        currency: "CHF" as const,
        providerRefundReference: refund.id,
        status:
          refund.status === "succeeded"
            ? ("SUCCEEDED" as const)
            : refund.status === "failed" || refund.status === "canceled"
              ? ("FAILED" as const)
              : ("PENDING" as const),
      });
    } catch (error) {
      if (error instanceof StripePaymentProviderError) throw error;
      throw new StripePaymentProviderError(
        "CHECKOUT_UNAVAILABLE",
        "Stripe sandbox refund could not be created.",
        { cause: error },
      );
    }
  }

  verifyWebhook(
    input: Readonly<{
      rawBody: string;
      signatureHeader: string;
      toleranceSeconds?: number;
    }>,
  ): NormalizedPaymentProviderEvent {
    const stripe = this.requireConfiguredStripe();
    const webhookSecret = this.#webhookSecret!;
    const accountId = this.#accountId!;
    if (
      Buffer.byteLength(input.rawBody, "utf8") >
        STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes ||
      input.signatureHeader.length > 8_192
    ) {
      throw new StripePaymentProviderError(
        "WEBHOOK_INVALID",
        "Stripe webhook exceeds the accepted signed envelope.",
      );
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        input.rawBody,
        input.signatureHeader,
        webhookSecret,
        input.toleranceSeconds ??
          STRIPE_PAYMENT_ADAPTER_V1.webhookToleranceSeconds,
      );
    } catch (error) {
      throw new StripePaymentProviderError(
        "WEBHOOK_INVALID",
        "Stripe webhook signature or timestamp is invalid.",
        { cause: error },
      );
    }
    if (event.livemode) {
      throw new StripePaymentProviderError(
        "WEBHOOK_ENVIRONMENT_MISMATCH",
        "Live Stripe events are forbidden by the Phase-24 sandbox adapter.",
      );
    }
    if (event.account !== null && event.account !== accountId) {
      throw new StripePaymentProviderError(
        "WEBHOOK_ACCOUNT_MISMATCH",
        "Stripe event belongs to a different merchant account.",
      );
    }
    return normalizeStripeEvent(event, accountId);
  }

  private requireConfiguredStripe(): Stripe {
    if (
      this.#stripe === null ||
      this.#accountId === null ||
      this.#webhookSecret === null
    ) {
      throw new StripePaymentProviderUnavailableError();
    }
    return this.#stripe;
  }
}

const checkoutInputSchema = z.strictObject({
  orderId: uuidSchema,
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u),
  successUrl: z
    .string()
    .max(2_048)
    .refine((value) => isSafeAbsoluteHttpUrl(value) && !value.includes("#")),
  cancelUrl: z
    .string()
    .max(2_048)
    .refine((value) => isSafeAbsoluteHttpUrl(value) && !value.includes("#")),
  authoritative: z.strictObject({
    amountRappen: z.number().int().positive().max(100_000_000),
    currency: z.literal("CHF"),
    customerEmail: emailSchema,
    description: safeTextSchema,
    quoteDigest: sha256Schema,
    paymentAttemptId: uuidSchema,
  }),
});

const refundInputSchema = z.strictObject({
  amountRappen: z.number().int().positive().max(100_000_000),
  idempotencyKey: z
    .string()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u),
  orderId: uuidSchema,
  paymentAttemptId: uuidSchema,
  providerPaymentReference: referenceSchema,
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
});

function normalizeStripeEvent(
  event: Stripe.Event,
  accountId: string,
): NormalizedPaymentProviderEvent {
  const object: Record<string, unknown> = isRecord(event.data.object)
    ? event.data.object
    : {};
  const metadata: Record<string, unknown> = isRecord(object.metadata)
    ? object.metadata
    : {};
  const orderId = firstUuid(metadata.order_id, object.client_reference_id);
  const paymentAttemptId = firstUuid(metadata.payment_attempt_id);
  const amountRappen = firstInteger(
    object.amount_total,
    object.amount_received,
    object.amount_paid,
    object.amount,
  );
  const currency =
    typeof object.currency === "string" ? object.currency.toUpperCase() : null;
  const providerSessionReference =
    typeof object.id === "string" && event.type.startsWith("checkout.session.")
      ? safeReference(object.id)
      : safeReference(metadata.checkout_session_id);
  const providerPaymentReference = firstReference(
    object.payment_intent,
    object.charge,
    event.type.startsWith("payment_intent.") ? object.id : null,
  );
  return Object.freeze({
    providerEventId: referenceSchema.parse(event.id),
    providerObjectReference: safeReference(object.id),
    eventType: safeTextSchema.parse(event.type),
    eventCreatedAt: new Date(event.created * 1_000),
    apiVersion: event.api_version ?? null,
    liveMode: event.livemode,
    providerAccountReference: event.account ?? accountId,
    orderId,
    paymentAttemptId,
    amountRappen,
    currency,
    providerSessionReference,
    providerPaymentReference,
    providerStatus:
      typeof object.payment_status === "string"
        ? object.payment_status
        : typeof object.status === "string"
          ? object.status
          : null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstUuid(...values: readonly unknown[]) {
  for (const value of values) {
    if (uuidSchema.safeParse(value).success) return value as string;
  }
  return null;
}

function firstInteger(...values: readonly unknown[]) {
  for (const value of values) {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return value;
    }
  }
  return null;
}

function firstReference(...values: readonly unknown[]) {
  for (const value of values) {
    const reference =
      typeof value === "string"
        ? value
        : isRecord(value) && typeof value.id === "string"
          ? value.id
          : null;
    const safe = safeReference(reference);
    if (safe !== null) return safe;
  }
  return null;
}

function safeReference(value: unknown) {
  return referenceSchema.safeParse(value).success ? (value as string) : null;
}
