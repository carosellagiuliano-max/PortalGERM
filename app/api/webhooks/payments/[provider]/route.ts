import { randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { ingestVerifiedPaymentEvent } from "@/lib/billing/payment-inbox";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import { createHostedPaymentProvider } from "@/lib/providers/payments/payment-composition";
import {
  STRIPE_PAYMENT_ADAPTER_V1,
  StripePaymentProviderError,
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
  if (
    provider !== "stripe" ||
    !environment.REAL_PAYMENT_INGESTION ||
    environment.PAYMENT_PROVIDER_MODE !== "stripe_sandbox"
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
    return json({ accepted: false, code: "INVALID_SIGNATURE" }, 400);
  }
  const now = new Date();
  const database = getDatabase();
  const activation = await resolvePersistedProviderActivation(database, {
    adapterKey: "stripe_sandbox",
    adapterVersion: "v1",
    environment: environment.APP_ENV,
    now,
    useCase: "payments.hosted-checkout",
  });
  if (!activation.active || activation.mode !== "SANDBOX") {
    return json(
      { accepted: false, code: "PAYMENT_PROVIDER_INACTIVE" },
      503,
    );
  }
  try {
    // Request.text() is deliberately called exactly once. Signature
    // verification operates on this unparsed raw body.
    const rawBody = await request.text();
    const hostedProvider =
      createHostedPaymentProvider(environment);
    const event = hostedProvider.verifyWebhook({
      rawBody,
      signatureHeader: signature,
    });
    const ingested = await ingestVerifiedPaymentEvent(
      {
        correlationId: randomUUID(),
        environment: environment.APP_ENV as
          | "local"
          | "ci"
          | "staging",
        event,
        projectionEnabled: environment.REAL_PAYMENT_PROJECTION,
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
      return json({ accepted: false, code: error.code }, 400);
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
