import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import {
  ingestVerifiedResendDeliveryWebhook,
  ResendEventInboxConflictError,
} from "@/lib/providers/email/resend-event-inbox";
import {
  RESEND_WEBHOOK_CONTRACT_V1,
  ResendWebhookVerificationError,
  readBoundedResendWebhookBody,
  verifyResendDeliveryWebhook,
} from "@/lib/providers/email/resend-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const environment = getServerEnvironment();
  const binding = emailProviderActivationBinding(
    environment,
    "email.delivery-events",
  );
  const secret = environment.secrets.resendWebhook;
  if (
    binding === null ||
    binding.adapterKey === "local_mock" ||
    secret === undefined
  ) {
    return json({ accepted: false, code: "EMAIL_INGESTION_DISABLED" }, 503);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > RESEND_WEBHOOK_CONTRACT_V1.maximumRawBodyBytes
  ) {
    return json({ accepted: false, code: "BODY_TOO_LARGE" }, 413);
  }

  try {
    // Internet-controlled bytes are bounded and authenticated before the
    // route is allowed to acquire a database client or query the activation
    // ledger. The raw body is consumed exactly once before JSON parsing.
    const rawBody = await readBoundedResendWebhookBody(request);
    const verified = verifyResendDeliveryWebhook({
      rawBody,
      secret,
      recipientHashKeyring:
        environment.secrets.keyrings.NOTIFICATION_RECIPIENT_HASH_KEYS,
      svixId: request.headers.get("svix-id"),
      svixSignature: request.headers.get("svix-signature"),
      svixTimestamp: request.headers.get("svix-timestamp"),
    });
    const now = new Date();
    const database = getDatabase();
    const activation = await resolvePersistedProviderActivation(database, {
      adapterKey: binding.adapterKey,
      adapterVersion: binding.adapterVersion,
      environment: environment.APP_ENV,
      expectedConfigurationDigest: binding.expectedConfigurationDigest,
      expectedMode: binding.expectedMode,
      ...(binding.expectedSecretVersionRef === undefined
        ? {}
        : {
            expectedSecretVersionRef:
              binding.expectedSecretVersionRef,
          }),
      now,
      useCase: RESEND_WEBHOOK_CONTRACT_V1.useCase,
    });
    if (!activation.active) {
      return json(
        { accepted: false, code: "EMAIL_PROVIDER_INACTIVE" },
        503,
      );
    }
    const ingested = await ingestVerifiedResendDeliveryWebhook(
      {
        providerActivationId: activation.activationId,
        adapterKey: binding.adapterKey,
        environment: environment.APP_ENV,
        receivedAt: now,
        verified,
      },
      database,
    );
    return json(
      {
        accepted: true,
        inboxId: ingested.inboxId,
        projectedSuppressions: ingested.projectedSuppressions,
        replay: ingested.replay,
      },
      ingested.replay ? 200 : 202,
    );
  } catch (error) {
    if (error instanceof ResendWebhookVerificationError) {
      return json(
        { accepted: false, code: error.code },
        error.code === "BODY_TOO_LARGE" ? 413 : 400,
      );
    }
    if (error instanceof ResendEventInboxConflictError) {
      return json({ accepted: false, code: error.code }, 409);
    }
    return json(
      { accepted: false, code: "EMAIL_INGESTION_UNAVAILABLE" },
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
