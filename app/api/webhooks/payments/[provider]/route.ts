import { randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { ingestVerifiedPaymentEvent } from "@/lib/billing/payment-inbox";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import {
  createHostedPaymentProvider,
  getHostedPaymentRuntime,
  getStripeContractEndpoint,
} from "@/lib/providers/payments/payment-composition";
import {
  STRIPE_PAYMENT_ADAPTER_V1,
  StripePaymentProviderError,
  readBoundedStripeWebhookBody,
  stripePaymentConfigurationDigest,
} from "@/lib/providers/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: Readonly<{
    params: Promise<{ provider: string }>;
  }>,
) {
  const { provider } = await context.params;
  const environment = getServerEnvironment();
  const paymentRuntime = getHostedPaymentRuntime(environment);
  const contractEndpoint = getStripeContractEndpoint(environment);
  if (
    provider !== "stripe" ||
    !environment.REAL_PAYMENT_INGESTION ||
    paymentRuntime === null ||
    environment.STRIPE_ACCOUNT_ID === undefined ||
    environment.STRIPE_SECRET_VERSION === undefined ||
    (paymentRuntime.adapterKey === "stripe_contract" &&
      contractEndpoint === undefined)
  ) {
    return json(
      { accepted: false, code: "PAYMENT_INGESTION_DISABLED" },
      503,
    );
  }
  const signature = request.headers.get("stripe-signature");
  const declaredLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    signature === null ||
    signature.length > 8_192 ||
    (Number.isFinite(declaredLength) &&
      declaredLength >
        STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes)
  ) {
    return json(
      {
        accepted: false,
        code:
          declaredLength > STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes
            ? "BODY_TOO_LARGE"
            : "INVALID_SIGNATURE",
      },
      declaredLength > STRIPE_PAYMENT_ADAPTER_V1.maximumRawBodyBytes
        ? 413
        : 400,
    );
  }
  try {
    // Internet-controlled bytes are bounded and authenticated before the
    // route is allowed to acquire a database client or query the activation
    // ledger. This keeps invalid webhook traffic out of the DB pool.
    const rawBody = await readBoundedStripeWebhookBody(request);
    const hostedProvider =
      createHostedPaymentProvider(environment);
    if (
      hostedProvider.adapterKey !== paymentRuntime.adapterKey ||
      hostedProvider.providerMode !== paymentRuntime.providerMode ||
      hostedProvider.expectedLiveMode !== paymentRuntime.expectedLiveMode
    ) {
      throw new StripePaymentProviderError(
        "INVALID_CONFIGURATION",
        "Payment provider composition does not match its activation binding.",
      );
    }
    const event = hostedProvider.verifyWebhook({
      rawBody,
      signatureHeader: signature,
    });
    const now = new Date();
    const database = getDatabase();
    const activation = await resolvePersistedProviderActivation(database, {
      adapterKey: paymentRuntime.adapterKey,
      adapterVersion: paymentRuntime.adapterVersion,
      environment: environment.APP_ENV,
      expectedConfigurationDigest: stripePaymentConfigurationDigest({
        ...(paymentRuntime.adapterKey === "stripe_contract"
          ? { contractEndpoint }
          : {}),
        providerAccountReference: environment.STRIPE_ACCOUNT_ID,
        runtime: paymentRuntime,
      }),
      expectedMode: paymentRuntime.activationMode,
      expectedSecretVersionRef: environment.STRIPE_SECRET_VERSION,
      now,
      useCase: "payments.hosted-checkout",
    });
    const outboundActivationActive =
      activation.active && activation.mode === paymentRuntime.activationMode;
    const ingested = await ingestVerifiedPaymentEvent(
      {
        adapterKey: paymentRuntime.adapterKey,
        adapterVersion: paymentRuntime.adapterVersion,
        correlationId: randomUUID(),
        environment: environment.APP_ENV,
        event,
        expectedLiveMode: paymentRuntime.expectedLiveMode,
        outboundActivationActive,
        projectionEnabled: environment.REAL_PAYMENT_PROJECTION,
        providerMode: paymentRuntime.providerMode,
        rawBody,
        receivedAt: now,
        signatureHeader: signature,
      },
      database,
    );
    return json(
      {
        accepted: true,
        inboxId: ingested.inboxId,
        queued: ingested.queued,
        replay: ingested.replay,
      },
      ingested.replay ? 200 : 202,
    );
  } catch (error) {
    if (error instanceof StripePaymentProviderError) {
      return json(
        { accepted: false, code: error.code },
        error.code === "BODY_TOO_LARGE" ? 413 : 400,
      );
    }
    return json(
      { accepted: false, code: "PAYMENT_INGESTION_UNAVAILABLE" },
      503,
    );
  }
}

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
