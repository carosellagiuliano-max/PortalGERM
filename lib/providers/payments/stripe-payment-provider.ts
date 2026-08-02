import { createHash } from "node:crypto";

import Stripe from "stripe";
import { z } from "zod";

import type {
  CheckoutSession,
  CreatePaymentOperationInput,
  HostedPaymentProvider,
  NormalizedPaymentProviderEvent,
  PaymentRuntimeMode,
  ProviderInvoicePaymentResolution,
  ProviderRefundResult,
  StripePaymentAdapterKey,
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

export type StripePaymentRuntime = Readonly<{
  adapterKey: StripePaymentAdapterKey;
  adapterVersion: "v1";
  activationMode: "ALLOWLIST" | "SANDBOX" | "LIVE";
  expectedLiveMode: boolean;
  providerMode: PaymentRuntimeMode;
  secretKeyPrefix: "sk_test_" | "sk_live_";
}>;

export const STRIPE_PAYMENT_ADAPTERS_V1 = Object.freeze({
  stripe_contract: Object.freeze({
    adapterKey: "stripe_contract" as const,
    adapterVersion: "v1" as const,
    activationMode: "ALLOWLIST" as const,
    expectedLiveMode: false,
    providerMode: "CONTRACT" as const,
    secretKeyPrefix: "sk_test_" as const,
  }),
  stripe_sandbox: Object.freeze({
    adapterKey: "stripe_sandbox" as const,
    adapterVersion: "v1" as const,
    activationMode: "SANDBOX" as const,
    expectedLiveMode: false,
    providerMode: "SANDBOX" as const,
    secretKeyPrefix: "sk_test_" as const,
  }),
  stripe_live: Object.freeze({
    adapterKey: "stripe_live" as const,
    adapterVersion: "v1" as const,
    activationMode: "LIVE" as const,
    expectedLiveMode: true,
    providerMode: "LIVE" as const,
    secretKeyPrefix: "sk_live_" as const,
  }),
});

/** Backwards-compatible policy metadata; it is not a runtime-mode fallback. */
export const STRIPE_PAYMENT_ADAPTER_V1 = Object.freeze({
  ...STRIPE_PAYMENT_ADAPTERS_V1.stripe_sandbox,
  provider: "STRIPE" as const,
  useCase: "payments.hosted-checkout" as const,
  webhookToleranceSeconds: 300,
  maximumRawBodyBytes: 256 * 1024,
  liveModeSupported: true,
  fallbackProvider: null,
});

export async function readBoundedStripeWebhookBody(
  request: Request,
): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes) {
        await reader.cancel("Stripe webhook body exceeded contract limit");
        throw new StripePaymentProviderError(
          "BODY_TOO_LARGE",
          "Stripe webhook body exceeds the contract limit.",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export function resolveStripePaymentRuntime(
  mode: unknown,
): StripePaymentRuntime | null {
  return typeof mode === "string" &&
    Object.hasOwn(STRIPE_PAYMENT_ADAPTERS_V1, mode)
    ? STRIPE_PAYMENT_ADAPTERS_V1[
        mode as keyof typeof STRIPE_PAYMENT_ADAPTERS_V1
      ]
    : null;
}

/**
 * Public, secret-free digest that binds a ProviderActivation ledger row to
 * the exact Stripe merchant account and runtime semantics used by the app.
 * Secret rotation is bound separately through `STRIPE_SECRET_VERSION`.
 */
export function stripePaymentConfigurationDigest(
  input: Readonly<{
    contractEndpoint?: string;
    providerAccountReference: string;
    runtime: StripePaymentRuntime;
  }>,
): string {
  if (!/^acct_[A-Za-z0-9]{8,}$/u.test(input.providerAccountReference)) {
    throw new StripePaymentProviderError(
      "INVALID_CONFIGURATION",
      "Stripe account binding is invalid.",
    );
  }
  const contractTransport = resolveStripeContractTransport(
    input.runtime,
    input.contractEndpoint,
    false,
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        accountId: input.providerAccountReference,
        activationMode: input.runtime.activationMode,
        adapterKey: input.runtime.adapterKey,
        adapterVersion: input.runtime.adapterVersion,
        expectedLiveMode: input.runtime.expectedLiveMode,
        providerMode: input.runtime.providerMode,
        contractEndpoint: contractTransport?.canonicalEndpoint ?? null,
        useCase: "payments.hosted-checkout",
      }),
    )
    .digest("hex");
}

export class StripePaymentProviderError extends Error {
  readonly code:
    | "BODY_TOO_LARGE"
    | "INVALID_CONFIGURATION"
    | "INVALID_CHECKOUT_INPUT"
    | "CHECKOUT_UNAVAILABLE"
    | "WEBHOOK_INVALID"
    | "WEBHOOK_ACCOUNT_MISMATCH"
    | "WEBHOOK_ENVIRONMENT_MISMATCH"
    | "DIRECT_CONFIRMATION_FORBIDDEN"
    | "INVOICE_PAYMENT_CONFLICT"
    | "INVOICE_PAYMENT_UNAVAILABLE"
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
  contractEndpoint?: string;
  mode: StripePaymentAdapterKey;
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

type StripeContractTransport = Readonly<{
  canonicalEndpoint: string;
  host: string;
  port: number;
  protocol: "http" | "https";
}>;

function resolveStripeContractTransport(
  runtime: StripePaymentRuntime,
  endpoint: string | undefined,
  injectedClient: boolean,
): StripeContractTransport | null {
  if (runtime.adapterKey !== "stripe_contract") {
    if (endpoint !== undefined) {
      throw new StripePaymentProviderError(
        "INVALID_CONFIGURATION",
        "A custom Stripe endpoint is restricted to contract mode.",
      );
    }
    return null;
  }
  if (endpoint === undefined) {
    if (injectedClient) return null;
    throw new StripePaymentProviderError(
      "INVALID_CONFIGURATION",
      "Stripe contract mode requires an explicit local contract endpoint.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new StripePaymentProviderError(
      "INVALID_CONFIGURATION",
      "Stripe contract endpoint is invalid.",
    );
  }
  const protocol =
    parsed.protocol === "http:"
      ? ("http" as const)
      : parsed.protocol === "https:"
        ? ("https" as const)
        : null;
  const safeSingleLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
    parsed.hostname,
  );
  const safeLoopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const port = Number(parsed.port);
  if (
    protocol === null ||
    (!safeLoopback && !safeSingleLabel) ||
    parsed.port === "" ||
    !Number.isInteger(port) ||
    port < 1_024 ||
    port > 65_535 ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new StripePaymentProviderError(
      "INVALID_CONFIGURATION",
      "Stripe contract endpoint is outside the local contract allowlist.",
    );
  }
  return Object.freeze({
    canonicalEndpoint: `${protocol}://${parsed.hostname}:${port}`,
    host: parsed.hostname,
    port,
    protocol,
  });
}

/**
 * Hosted Stripe adapter with an explicit contract, sandbox or live identity.
 * It never receives card data and never falls back across modes or to Mock.
 * Domain writes remain owned by Billing after a signed, account-bound event.
 */
export class StripePaymentProvider implements HostedPaymentProvider {
  readonly kind = "STRIPE" as const;
  readonly adapterKey: StripePaymentAdapterKey;
  readonly adapterVersion = "v1" as const;
  readonly providerAccountReference: string;
  readonly providerMode: PaymentRuntimeMode;
  readonly expectedLiveMode: boolean;
  readonly #accountId: string | null;
  readonly #stripe: Stripe | null;
  readonly #webhookSecret: string | null;

  constructor(configuration?: StripePaymentProviderConfiguration) {
    if (configuration === undefined) {
      this.adapterKey = "stripe_sandbox";
      this.providerAccountReference = "";
      this.providerMode = "SANDBOX";
      this.expectedLiveMode = false;
      this.#accountId = null;
      this.#webhookSecret = null;
      this.#stripe = null;
      return;
    }
    const runtime = resolveStripePaymentRuntime(configuration.mode);
    const contractTransport =
      runtime === null
        ? null
        : resolveStripeContractTransport(
            runtime,
            configuration.contractEndpoint,
            configuration.stripeClient !== undefined,
          );
    if (
      runtime === null ||
      !/^acct_[A-Za-z0-9]{8,}$/u.test(configuration.accountId) ||
      !configuration.secretKey.startsWith(runtime.secretKeyPrefix) ||
      !/^(?:sk_test_|sk_live_)[A-Za-z0-9]{8,}$/u.test(
        configuration.secretKey,
      ) ||
      !/^whsec_[A-Za-z0-9]{8,}$/u.test(configuration.webhookSecret)
    ) {
      throw new StripePaymentProviderError(
        "INVALID_CONFIGURATION",
        "Stripe configuration does not match the explicit adapter mode.",
      );
    }
    this.adapterKey = runtime.adapterKey;
    this.providerAccountReference = configuration.accountId;
    this.providerMode = runtime.providerMode;
    this.expectedLiveMode = runtime.expectedLiveMode;
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
        ...(contractTransport === null
          ? {}
          : {
              host: contractTransport.host,
              port: contractTransport.port,
              protocol: contractTransport.protocol,
              telemetry: false,
            }),
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
      const metadata = {
        order_id: parsed.data.orderId,
        payment_attempt_id: parsed.data.authoritative.paymentAttemptId,
        quote_digest: parsed.data.authoritative.quoteDigest,
        adapter_key: this.adapterKey,
        provider_price_reference:
          parsed.data.authoritative.checkout.kind === "SUBSCRIPTION"
            ? parsed.data.authoritative.checkout.providerPriceReference
            : "one_time",
      };
      const common = {
        locale: "de" as const,
        client_reference_id: parsed.data.orderId,
        customer_email: parsed.data.authoritative.customerEmail,
        success_url: parsed.data.successUrl,
        cancel_url: parsed.data.cancelUrl,
        expires_at: Math.floor(
          parsed.data.authoritative.expiresAt.getTime() / 1_000,
        ),
        metadata,
      };
      const request: Stripe.Checkout.SessionCreateParams =
        parsed.data.authoritative.checkout.kind === "SUBSCRIPTION"
          ? {
              ...common,
              mode: "subscription",
              line_items: [
                {
                  quantity: 1,
                  price:
                    parsed.data.authoritative.checkout.providerPriceReference,
                },
              ],
              subscription_data: { metadata },
            }
          : {
              ...common,
              mode: "payment",
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
              payment_intent_data: { metadata },
            };
      const session = await stripe.checkout.sessions.create(request, {
        idempotencyKey: parsed.data.idempotencyKey,
      });
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
        "Stripe hosted checkout could not be created.",
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

  async expireCheckoutSession(
    input: Readonly<{
      idempotencyKey: string;
      orderId: string;
      providerSessionReference: string;
    }>,
  ): Promise<void> {
    const stripe = this.requireConfiguredStripe();
    const parsed = expireCheckoutInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new StripePaymentProviderError(
        "INVALID_CHECKOUT_INPUT",
        "Hosted checkout expiration requires a bound session reference.",
      );
    }
    try {
      await stripe.checkout.sessions.expire(
        parsed.data.providerSessionReference,
        {},
        { idempotencyKey: parsed.data.idempotencyKey },
      );
    } catch (error) {
      throw new StripePaymentProviderError(
        "CHECKOUT_UNAVAILABLE",
        "Stripe hosted checkout could not be expired.",
        { cause: error },
      );
    }
  }

  async createRefund(
    input: Readonly<{
      amountRappen: number;
      idempotencyKey: string;
      orderId: string;
      paymentAttemptId: string;
      providerPaymentReference: string;
      reasonCode: string;
      refundId: string;
      sourceKind: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
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
            refund_id: parsed.data.refundId,
            reason_code: parsed.data.reasonCode,
            source_kind: parsed.data.sourceKind,
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
        "Stripe refund could not be created.",
        { cause: error },
      );
    }
  }

  /**
   * Invoice webhooks do not guarantee an expanded `payments` collection.
   * Resolve the single paid PaymentIntent through Stripe's bounded
   * InvoicePayment list and return only an account-bound evidence digest and
   * the references required by the domain. No provider payload is persisted.
   */
  async resolveInvoicePayment(
    input: Readonly<{
      amountRappen: number;
      currency: "CHF";
      providerInvoiceReference: string;
    }>,
  ): Promise<ProviderInvoicePaymentResolution> {
    const stripe = this.requireConfiguredStripe();
    const parsed = invoicePaymentResolutionInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new StripePaymentProviderError(
        "INVOICE_PAYMENT_CONFLICT",
        "Invoice payment hydration requires an exact CHF invoice snapshot.",
      );
    }
    try {
      const result = await stripe.invoicePayments.list({
        invoice: parsed.data.providerInvoiceReference,
        limit: 10,
        status: "paid",
      });
      if (result.has_more || result.data.length !== 1) {
        throw new StripePaymentProviderError(
          "INVOICE_PAYMENT_CONFLICT",
          "Invoice payment hydration did not resolve exactly one paid allocation.",
        );
      }
      const invoicePayment = result.data[0]!;
      const invoiceReference = firstReference(invoicePayment.invoice);
      const providerPaymentReference =
        invoicePayment.payment.type === "payment_intent"
          ? firstReference(invoicePayment.payment.payment_intent)
          : null;
      if (
        invoiceReference !== parsed.data.providerInvoiceReference ||
        providerPaymentReference === null ||
        invoicePayment.status !== "paid" ||
        invoicePayment.amount_paid !== parsed.data.amountRappen ||
        invoicePayment.currency.toUpperCase() !== parsed.data.currency ||
        invoicePayment.livemode !== this.expectedLiveMode ||
        !referenceSchema.safeParse(invoicePayment.id).success
      ) {
        throw new StripePaymentProviderError(
          "INVOICE_PAYMENT_CONFLICT",
          "Invoice payment hydration conflicts with the signed invoice snapshot.",
        );
      }
      const source = "STRIPE_INVOICE_PAYMENTS_LIST_V1" as const;
      const evidenceDigest = createHash("sha256")
        .update(
          JSON.stringify({
            adapterKey: this.adapterKey,
            adapterVersion: this.adapterVersion,
            amountRappen: invoicePayment.amount_paid,
            currency: parsed.data.currency,
            expectedLiveMode: this.expectedLiveMode,
            providerAccountReference: this.providerAccountReference,
            providerInvoicePaymentReference: invoicePayment.id,
            providerInvoiceReference: invoiceReference,
            providerMode: this.providerMode,
            providerPaymentReference,
            source,
          }),
        )
        .digest("hex");
      return Object.freeze({
        amountRappen: parsed.data.amountRappen,
        currency: parsed.data.currency,
        evidenceDigest,
        providerInvoicePaymentReference: invoicePayment.id,
        providerInvoiceReference: invoiceReference,
        providerPaymentReference,
        source,
      });
    } catch (error) {
      if (error instanceof StripePaymentProviderError) throw error;
      throw new StripePaymentProviderError(
        "INVOICE_PAYMENT_UNAVAILABLE",
        "Stripe invoice payment hydration is temporarily unavailable.",
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
    if (event.livemode !== this.expectedLiveMode) {
      throw new StripePaymentProviderError(
        "WEBHOOK_ENVIRONMENT_MISMATCH",
        "Stripe event livemode does not match the configured adapter mode.",
      );
    }
    if (event.account !== null && event.account !== undefined) {
      throw new StripePaymentProviderError(
        "WEBHOOK_ACCOUNT_MISMATCH",
        "Connected-account events are forbidden for the single-merchant adapter.",
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
    expiresAt: z.date(),
    quoteDigest: sha256Schema,
    paymentAttemptId: uuidSchema,
    checkout: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("ONE_TIME") }),
      z.strictObject({
        kind: z.literal("SUBSCRIPTION"),
        billingInterval: z.literal("MONTHLY"),
        providerPriceReference: z.string().regex(/^price_[A-Za-z0-9]{8,}$/u),
      }),
    ]),
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
  refundId: uuidSchema,
  sourceKind: z.enum(["INITIAL_ORDER", "SUBSCRIPTION_PROVIDER_INVOICE"]),
});

const invoicePaymentResolutionInputSchema = z.strictObject({
  amountRappen: z.number().int().positive().max(100_000_000),
  currency: z.literal("CHF"),
  providerInvoiceReference: referenceSchema,
});

const expireCheckoutInputSchema = z.strictObject({
  idempotencyKey: z
    .string()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u),
  orderId: uuidSchema,
  providerSessionReference: referenceSchema,
});

function normalizeStripeEvent(
  event: Stripe.Event,
  accountId: string,
): NormalizedPaymentProviderEvent {
  const object: Record<string, unknown> = isRecord(event.data.object)
    ? event.data.object
    : {};
  const parent = recordOrEmpty(object.parent);
  const subscriptionDetails = firstRecord(
    parent.subscription_details,
    object.subscription_details,
  );
  const metadata = recordOrEmpty(object.metadata);
  const subscriptionMetadata = recordOrEmpty(subscriptionDetails.metadata);
  const metadataRecords = [metadata, subscriptionMetadata] as const;
  const orderId = firstUuid(
    metadataValue("order_id", metadataRecords),
    object.client_reference_id,
  );
  const paymentAttemptId = firstUuid(
    metadataValue("payment_attempt_id", metadataRecords),
  );
  const refundId = firstUuid(metadataValue("refund_id", metadataRecords));
  const firstLine = firstInvoiceLine(object);
  const linePeriod = recordOrEmpty(firstLine.period);
  const linePricing = recordOrEmpty(firstLine.pricing);
  const linePriceDetails = recordOrEmpty(linePricing.price_details);
  const amountRappen = firstInteger(
    object.amount_total,
    object.amount_received,
    object.amount_paid,
    object.amount_due,
    object.amount,
  );
  const currency =
    typeof object.currency === "string" ? object.currency.toUpperCase() : null;
  const providerSessionReference =
    typeof object.id === "string" && event.type.startsWith("checkout.session.")
      ? safeReference(object.id)
      : safeReference(metadataValue("checkout_session_id", metadataRecords));
  const providerPaymentReference = firstReference(
    object.payment_intent,
    object.charge,
    recordOrEmpty(object.confirmation_secret).payment_intent,
    solePaidInvoicePaymentReference(object),
    event.type.startsWith("payment_intent.") ? object.id : null,
  );
  const providerCustomerReference = firstReference(
    object.customer,
    metadataValue("provider_customer_reference", metadataRecords),
  );
  const providerSubscriptionReference = firstReference(
    object.subscription,
    subscriptionDetails.subscription,
    event.type.startsWith("customer.subscription.") ? object.id : null,
    metadataValue("provider_subscription_reference", metadataRecords),
  );
  const providerInvoiceReference = firstReference(
    event.type.startsWith("invoice.") ? object.id : null,
    object.invoice,
    object.latest_invoice,
  );
  const providerPriceReference = firstReference(
    metadataValue("provider_price_reference", metadataRecords),
    recordOrEmpty(firstLine.price).id,
    linePriceDetails.price,
  );
  return Object.freeze({
    providerEventId: referenceSchema.parse(event.id),
    providerObjectReference: safeReference(object.id),
    eventType: safeTextSchema.parse(event.type),
    eventCreatedAt: new Date(event.created * 1_000),
    apiVersion: event.api_version ?? null,
    liveMode: event.livemode,
    providerAccountReference: event.account ?? accountId,
    providerCancelAtPeriodEnd:
      typeof object.cancel_at_period_end === "boolean"
        ? object.cancel_at_period_end
        : null,
    orderId,
    paymentAttemptId,
    refundId,
    amountRappen,
    currency,
    providerSessionReference,
    providerPaymentReference,
    providerCustomerReference,
    providerInvoiceReference,
    providerPriceReference,
    providerSubscriptionReference,
    providerPeriodStart: firstEpochDate(
      object.current_period_start,
      linePeriod.start,
      object.period_start,
    ),
    providerPeriodEnd: firstEpochDate(
      object.current_period_end,
      linePeriod.end,
      object.period_end,
    ),
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

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function firstRecord(...values: readonly unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}

function metadataValue(
  key: string,
  records: readonly Readonly<Record<string, unknown>>[],
) {
  for (const record of records) {
    if (record[key] !== undefined) return record[key];
  }
  return null;
}

function firstInvoiceLine(object: Readonly<Record<string, unknown>>) {
  const lines = recordOrEmpty(object.lines);
  if (!Array.isArray(lines.data)) return {} as Record<string, unknown>;
  return firstRecord(...lines.data);
}

/**
 * Current Stripe invoice payloads expose the PaymentIntent through the
 * InvoicePayment list instead of the legacy top-level `payment_intent` field.
 * Multiple distinct paid allocations are held for manual reconciliation: a
 * single internal refund reference would be ambiguous in that case.
 */
function solePaidInvoicePaymentReference(
  object: Readonly<Record<string, unknown>>,
) {
  const payments = recordOrEmpty(object.payments);
  if (!Array.isArray(payments.data)) return null;
  const references = new Set<string>();
  for (const entry of payments.data) {
    if (!isRecord(entry) || entry.status !== "paid") continue;
    const payment = recordOrEmpty(entry.payment);
    const reference = firstReference(
      payment.payment_intent,
      payment.charge,
      entry.payment_intent,
      entry.charge,
    );
    if (reference !== null) references.add(reference);
  }
  return references.size === 1 ? [...references][0]! : null;
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

function firstEpochDate(...values: readonly unknown[]) {
  for (const value of values) {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      const result = new Date(value * 1_000);
      if (Number.isFinite(result.getTime())) return result;
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
